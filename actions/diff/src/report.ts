import {
	type AccessDiff,
	ENVIRONMENT_DIFF_LIMITS,
	ENVIRONMENT_DIFF_REASON_MESSAGES,
	type EnvironmentDiff,
	type EnvironmentDiffReason,
	type EnvironmentDiffReasonCode,
	type EnvironmentDiffReport,
	type RecipientIdentity,
	type RecipientRename,
	type VariableDiff,
} from "../../../cli/src/helpers/createEnvironmentDiffReport"
import { ACTION_LIMITS } from "./limits"
import { byteLength, escapeMarkdown, isRecord, SafeActionError } from "./safety"

export type {
	AccessDiff,
	EnvironmentDiff,
	EnvironmentDiffReport,
	RecipientIdentity,
	RecipientRename,
	VariableDiff,
}

export const COMMENT_MARKER = "<!-- dotenc-diff-action:v1 -->"

const ACCESS_REASON_CODES = new Set<EnvironmentDiffReasonCode>([
	"base_recipient_metadata_invalid",
	"head_recipient_metadata_invalid",
	"base_and_head_recipient_metadata_invalid",
])

const hasExactKeys = (
	value: Record<string, unknown>,
	required: string[],
	optional: string[] = [],
): boolean => {
	const keys = Reflect.ownKeys(value)
	if (keys.some((key) => typeof key !== "string")) return false
	const allowed = new Set([...required, ...optional])
	return (
		required.every((key) => Object.hasOwn(value, key)) &&
		(keys as string[]).every((key) => allowed.has(key))
	)
}

const hasAsciiControl = (value: string): boolean =>
	Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0) ?? 0
		return codePoint <= 0x1f || codePoint === 0x7f
	})

const boundedText = (value: unknown, maxBytes: number): value is string =>
	typeof value === "string" &&
	value.length > 0 &&
	byteLength(value) <= maxBytes &&
	!hasAsciiControl(value)

const neutralizeFormatControls = (value: string): string =>
	Array.from(value)
		.map((character) => {
			if (!/[\p{C}\p{Zl}\p{Zp}]/u.test(character)) return character
			const codePoint = character.codePointAt(0) ?? 0
			return `U${codePoint.toString(16).toUpperCase().padStart(4, "0")}`
		})
		.join("")

const compareText = (left: string, right: string): number =>
	left < right ? -1 : left > right ? 1 : 0

const canonicalReason = (
	value: unknown,
	section: "variables" | "access",
): EnvironmentDiffReason => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["code", "message"]) ||
		typeof value.code !== "string" ||
		!Object.hasOwn(ENVIRONMENT_DIFF_REASON_MESSAGES, value.code)
	) {
		throw new SafeActionError("invalid_diff_report")
	}
	const code = value.code as EnvironmentDiffReasonCode
	if (
		(section === "access") !== ACCESS_REASON_CODES.has(code) ||
		value.message !== ENVIRONMENT_DIFF_REASON_MESSAGES[code]
	) {
		throw new SafeActionError("invalid_diff_report")
	}
	return { code, message: ENVIRONMENT_DIFF_REASON_MESSAGES[code] }
}

const canonicalVariableNames = (value: unknown): string[] => {
	if (
		!Array.isArray(value) ||
		value.length > ENVIRONMENT_DIFF_LIMITS.maxVariablesPerEnvironment
	) {
		throw new SafeActionError("invalid_diff_report")
	}
	const names = value.map((name) => {
		if (!boundedText(name, ENVIRONMENT_DIFF_LIMITS.maxVariableNameBytes)) {
			throw new SafeActionError("invalid_diff_report")
		}
		return neutralizeFormatControls(name)
	})
	if (new Set(names).size !== names.length) {
		throw new SafeActionError("invalid_diff_report")
	}
	return names.sort(compareText)
}

const canonicalVariableDiff = (value: unknown): VariableDiff => {
	if (
		!isRecord(value) ||
		!hasExactKeys(
			value,
			["status", "added", "changed", "removed"],
			["reason"],
		) ||
		(value.status !== "available" && value.status !== "unavailable")
	) {
		throw new SafeActionError("invalid_diff_report")
	}
	const added = canonicalVariableNames(value.added)
	const changed = canonicalVariableNames(value.changed)
	const removed = canonicalVariableNames(value.removed)
	const allNames = [...added, ...changed, ...removed]
	if (
		new Set(allNames).size !== allNames.length ||
		allNames.length > ENVIRONMENT_DIFF_LIMITS.maxVariablesPerEnvironment * 2
	) {
		throw new SafeActionError("invalid_diff_report")
	}

	if (value.status === "unavailable") {
		if (allNames.length !== 0 || !Object.hasOwn(value, "reason")) {
			throw new SafeActionError("invalid_diff_report")
		}
		return {
			status: "unavailable",
			added,
			changed,
			removed,
			reason: canonicalReason(value.reason, "variables"),
		}
	}
	if (Object.hasOwn(value, "reason")) {
		throw new SafeActionError("invalid_diff_report")
	}
	return { status: "available", added, changed, removed }
}

const canonicalRecipient = (value: unknown): RecipientIdentity => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["name", "fingerprint"]) ||
		!boundedText(value.name, ENVIRONMENT_DIFF_LIMITS.maxRecipientNameBytes) ||
		!boundedText(value.fingerprint, ENVIRONMENT_DIFF_LIMITS.maxFingerprintBytes)
	) {
		throw new SafeActionError("invalid_diff_report")
	}
	return {
		name: neutralizeFormatControls(value.name),
		fingerprint: neutralizeFormatControls(value.fingerprint),
	}
}

const canonicalRecipients = (value: unknown): RecipientIdentity[] => {
	if (
		!Array.isArray(value) ||
		value.length > ENVIRONMENT_DIFF_LIMITS.maxRecipientsPerEnvironment
	) {
		throw new SafeActionError("invalid_diff_report")
	}
	const recipients = value.map(canonicalRecipient)
	if (
		new Set(recipients.map((item) => item.fingerprint)).size !==
		recipients.length
	) {
		throw new SafeActionError("invalid_diff_report")
	}
	return recipients.sort(
		(left, right) =>
			compareText(left.fingerprint, right.fingerprint) ||
			compareText(left.name, right.name),
	)
}

const canonicalRenames = (value: unknown): RecipientRename[] => {
	if (
		!Array.isArray(value) ||
		value.length > ENVIRONMENT_DIFF_LIMITS.maxRecipientsPerEnvironment
	) {
		throw new SafeActionError("invalid_diff_report")
	}
	const renames = value.map((rename): RecipientRename => {
		if (
			!isRecord(rename) ||
			!hasExactKeys(rename, ["fingerprint", "from", "to"]) ||
			!boundedText(
				rename.fingerprint,
				ENVIRONMENT_DIFF_LIMITS.maxFingerprintBytes,
			) ||
			!boundedText(
				rename.from,
				ENVIRONMENT_DIFF_LIMITS.maxRecipientNameBytes,
			) ||
			!boundedText(rename.to, ENVIRONMENT_DIFF_LIMITS.maxRecipientNameBytes)
		) {
			throw new SafeActionError("invalid_diff_report")
		}
		return {
			fingerprint: neutralizeFormatControls(rename.fingerprint),
			from: neutralizeFormatControls(rename.from),
			to: neutralizeFormatControls(rename.to),
		}
	})
	if (
		new Set(renames.map((item) => item.fingerprint)).size !== renames.length
	) {
		throw new SafeActionError("invalid_diff_report")
	}
	return renames.sort((left, right) =>
		compareText(left.fingerprint, right.fingerprint),
	)
}

const canonicalAccessDiff = (value: unknown): AccessDiff => {
	if (
		!isRecord(value) ||
		!hasExactKeys(
			value,
			["status", "grants", "revocations", "renames"],
			["reason"],
		) ||
		(value.status !== "available" && value.status !== "unavailable")
	) {
		throw new SafeActionError("invalid_diff_report")
	}
	const grants = canonicalRecipients(value.grants)
	const revocations = canonicalRecipients(value.revocations)
	const renames = canonicalRenames(value.renames)
	const changedFingerprints = [
		...grants.map((recipient) => recipient.fingerprint),
		...revocations.map((recipient) => recipient.fingerprint),
		...renames.map((rename) => rename.fingerprint),
	]
	if (new Set(changedFingerprints).size !== changedFingerprints.length) {
		throw new SafeActionError("invalid_diff_report")
	}
	if (value.status === "unavailable") {
		if (
			grants.length + revocations.length + renames.length !== 0 ||
			!Object.hasOwn(value, "reason")
		) {
			throw new SafeActionError("invalid_diff_report")
		}
		return {
			status: "unavailable",
			grants,
			revocations,
			renames,
			reason: canonicalReason(value.reason, "access"),
		}
	}
	if (Object.hasOwn(value, "reason")) {
		throw new SafeActionError("invalid_diff_report")
	}
	return { status: "available", grants, revocations, renames }
}

const canonicalEnvironment = (value: unknown): EnvironmentDiff => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["path", "name", "status", "variables", "access"]) ||
		!boundedText(value.path, ENVIRONMENT_DIFF_LIMITS.maxPathBytes) ||
		!boundedText(value.name, ENVIRONMENT_DIFF_LIMITS.maxEnvironmentNameBytes) ||
		(value.status !== "added" &&
			value.status !== "deleted" &&
			value.status !== "modified") ||
		value.path.startsWith("/") ||
		value.path.includes("\\") ||
		value.path
			.split("/")
			.some((segment) => !segment || segment === "." || segment === "..")
	) {
		throw new SafeActionError("invalid_diff_report")
	}
	const filename = value.path.slice(value.path.lastIndexOf("/") + 1)
	const match = filename.match(/^\.env\.(.+)\.enc$/)
	if (!match || match[1] !== value.name) {
		throw new SafeActionError("invalid_diff_report")
	}
	return {
		path: neutralizeFormatControls(value.path),
		name: neutralizeFormatControls(value.name),
		status: value.status,
		variables: canonicalVariableDiff(value.variables),
		access: canonicalAccessDiff(value.access),
	}
}

export const canonicalizeReport = (value: unknown): EnvironmentDiffReport => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["schemaVersion", "environments"]) ||
		value.schemaVersion !== 1 ||
		!Array.isArray(value.environments) ||
		value.environments.length > ENVIRONMENT_DIFF_LIMITS.maxFilesPerSide * 2
	) {
		throw new SafeActionError("invalid_diff_report")
	}
	const environments = value.environments.map(canonicalEnvironment)
	if (
		new Set(environments.map((item) => item.path)).size !== environments.length
	) {
		throw new SafeActionError("invalid_diff_report")
	}
	return {
		schemaVersion: 1,
		environments: environments.sort((left, right) =>
			compareText(left.path, right.path),
		),
	}
}

const displayText = (value: string): string =>
	Array.from(value)
		.slice(0, 512)
		.map((character) => {
			const codePoint = character.codePointAt(0) ?? 0
			if (
				codePoint <= 0x1f ||
				codePoint === 0x7f ||
				/[\p{C}\p{Zl}\p{Zp}]/u.test(character)
			) {
				return `U${codePoint.toString(16).toUpperCase().padStart(4, "0")}`
			}
			return character
		})
		.join("")

const htmlCode = (value: string): string => {
	const escaped = displayText(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("`", "&#96;")
		.replaceAll("[", "&#91;")
		.replaceAll("]", "&#93;")
		.replaceAll("(", "&#40;")
		.replaceAll(")", "&#41;")
		.replaceAll("@", "&#64;")
	return `<code>${escaped}</code>`
}

class MarkdownBuilder {
	readonly #lines: string[] = []
	readonly #maxBytes: number
	#bytes = 0
	truncated = false

	constructor(maxBytes: number) {
		this.#maxBytes = maxBytes
	}

	add(line = ""): boolean {
		const size = byteLength(`${line}\n`)
		if (this.#bytes + size > this.#maxBytes) {
			this.truncated = true
			return false
		}
		this.#lines.push(line)
		this.#bytes += size
		return true
	}

	toString(): string {
		return `${this.#lines.join("\n")}\n`
	}
}

const environmentStatus = (status: EnvironmentDiff["status"]): string => {
	if (status === "added") return "Environment added"
	if (status === "deleted") return "Environment deleted"
	return "Environment modified"
}

const reasonMessage = (reason: EnvironmentDiffReason | undefined): string =>
	reason?.message || "The semantic changes could not be verified."

const changeLines = (items: string[], symbol: "+" | "~" | "-"): string[] =>
	items.map((item) => `${symbol} ${item}`)

const addDiffBlock = (builder: MarkdownBuilder, lines: string[]): boolean => {
	const rendered = lines.map(displayText)
	let fence = "```"
	while (rendered.some((line) => line.includes(fence))) fence += "`"

	return builder.add([`${fence}diff`, ...rendered, fence].join("\n"))
}

const addEnvironment = (
	builder: MarkdownBuilder,
	environment: EnvironmentDiff,
): boolean => {
	if (!builder.add(`### ${escapeMarkdown(environment.name)}`)) return false
	if (!builder.add()) return false
	if (
		!builder.add(
			`_${environmentStatus(environment.status)} · ${htmlCode(environment.path)}_`,
		)
	) {
		return false
	}
	if (!builder.add()) return false
	if (!builder.add("#### Variables")) return false
	if (!builder.add()) return false

	const variableChangeCount =
		environment.variables.added.length +
		environment.variables.changed.length +
		environment.variables.removed.length
	if (environment.variables.status === "unavailable") {
		if (
			!builder.add(
				`> Variable diff unavailable: ${escapeMarkdown(reasonMessage(environment.variables.reason))}`,
			)
		) {
			return false
		}
	} else if (variableChangeCount === 0) {
		if (!builder.add("No variable-name changes.")) return false
	} else {
		const lines = [
			...changeLines(environment.variables.changed, "~"),
			...changeLines(environment.variables.added, "+"),
			...changeLines(environment.variables.removed, "-"),
		]
		if (!addDiffBlock(builder, lines)) return false
	}

	if (!builder.add()) return false
	if (!builder.add("#### Access")) return false
	if (!builder.add()) return false
	const accessChangeCount =
		environment.access.grants.length +
		environment.access.revocations.length +
		environment.access.renames.length
	if (environment.access.status === "unavailable") {
		if (
			!builder.add(
				`> Access diff unavailable: ${escapeMarkdown(reasonMessage(environment.access.reason))}`,
			)
		) {
			return false
		}
	} else if (accessChangeCount === 0) {
		if (!builder.add("No recipient changes.")) return false
	} else {
		const lines = [
			...environment.access.renames.map(
				(rename) => `~ ${rename.from} → ${rename.to}`,
			),
			...changeLines(
				environment.access.grants.map((grant) => grant.name),
				"+",
			),
			...changeLines(
				environment.access.revocations.map((revocation) => revocation.name),
				"-",
			),
		]
		if (!addDiffBlock(builder, lines)) return false
	}

	return builder.add()
}

export const renderReport = (
	report: EnvironmentDiffReport,
	options: { includeMarker?: boolean } = {},
): string => {
	const reservedFooterBytes = 1024
	const builder = new MarkdownBuilder(
		ACTION_LIMITS.maxCommentBytes - reservedFooterBytes,
	)
	if (options.includeMarker) {
		builder.add(COMMENT_MARKER)
	}
	builder.add("## dotenc environment diff")
	builder.add()

	if (report.environments.length === 0) {
		builder.add(
			"No semantic dotenc environment changes were found. Re-encryption-only changes are ignored.",
		)
		builder.add()
	} else {
		for (const environment of report.environments) {
			if (!addEnvironment(builder, environment)) break
		}
	}

	if (builder.truncated) {
		builder.add(
			"> Display truncated at the action's safe comment-size limit. The machine-readable report remains available as the action output.",
		)
		builder.add()
	}
	const markdown = builder.toString()
	if (byteLength(markdown) > ACTION_LIMITS.maxCommentBytes) {
		throw new SafeActionError("report_render_limit")
	}
	return markdown
}

export const renderUnavailableReport = (): string =>
	[
		"## dotenc environment diff",
		"",
		"> The redacted diff is temporarily unavailable because the action could not complete safely.",
		"",
		"No encrypted or decrypted content is included in this error.",
		"",
	].join("\n")

export const reportHasChanges = (report: EnvironmentDiffReport): boolean =>
	report.environments.length > 0
