import { type Environment, environmentSchema } from "../schemas/environment"
import type {
	AccessDiff,
	EncryptedEnvironmentInput,
	EnvironmentDiff,
	EnvironmentDiffInput,
	EnvironmentDiffInputErrorCode,
	EnvironmentDiffReason,
	EnvironmentDiffReasonCode,
	EnvironmentDiffReport,
	RecipientIdentity,
	VariableDiff,
} from "../schemas/environmentDiffReport"
import {
	ENVIRONMENT_DIFF_LIMITS,
	ENVIRONMENT_DIFF_REPORT_SCHEMA_VERSION,
} from "../schemas/environmentDiffReport"
import { decryptData } from "./crypto"
import { decryptDataKey } from "./decryptDataKey"
import {
	decryptEnvironmentData,
	environmentDataKeysEqual,
} from "./decryptEnvironment"
import { getPrivateKeys } from "./getPrivateKeys"
import { parseEnv } from "./parseEnv"

export type {
	AccessDiff,
	EncryptedEnvironmentInput,
	EnvironmentDiff,
	EnvironmentDiffInput,
	EnvironmentDiffInputErrorCode,
	EnvironmentDiffReason,
	EnvironmentDiffReasonCode,
	EnvironmentDiffReport,
	RecipientIdentity,
	RecipientRename,
	VariableDiff,
} from "../schemas/environmentDiffReport"
export {
	ENVIRONMENT_DIFF_LIMITS,
	ENVIRONMENT_DIFF_REPORT_SCHEMA_VERSION,
} from "../schemas/environmentDiffReport"

export class EnvironmentDiffInputError extends Error {
	readonly code: EnvironmentDiffInputErrorCode

	constructor(code: EnvironmentDiffInputErrorCode, message: string) {
		super(message)
		this.name = "EnvironmentDiffInputError"
		this.code = code
	}
}

export type EnvironmentDiffDecryptor = (
	environmentName: string,
	environment: Environment,
) => Promise<string>

export type EnvironmentDiffDataKeyComparator = (
	base: Environment,
	head: Environment,
) => Promise<boolean>

export type CreateEnvironmentDiffReportOptions = {
	/** Restrict key discovery to the dedicated environment key in trusted CI. */
	privateKeySource?: "all" | "environment"
	/** Test/integration seam; errors are always converted to static report reasons. */
	decryptEnvironment?: EnvironmentDiffDecryptor
	/**
	 * Test/integration seam that returns true only when the unwrapped data keys
	 * are equal. A custom decryptor without this comparator cannot prove rotation.
	 */
	dataKeysEqual?: EnvironmentDiffDataKeyComparator
}

type ValidatedInputFile = EncryptedEnvironmentInput & { name: string }

type ParsedEnvironmentSide = {
	access:
		| { status: "valid"; recipients: RecipientIdentity[] }
		| { status: "invalid" }
	environment: { status: "valid"; value: Environment } | { status: "invalid" }
}

type VariableMap = Map<string, string>
type VariableReadResult =
	| { status: "available"; plaintext: string; variables: VariableMap }
	| {
			status: "unavailable"
			kind: "environment" | "decryption" | "plaintext"
	  }

export const ENVIRONMENT_DIFF_REASON_MESSAGES = Object.freeze({
	base_environment_invalid:
		"Variable diff unavailable because the base environment is invalid.",
	head_environment_invalid:
		"Variable diff unavailable because the head environment is invalid.",
	base_and_head_environments_invalid:
		"Variable diff unavailable because the base and head environments are invalid.",
	base_recipient_metadata_invalid:
		"Access diff unavailable because the base recipient metadata is invalid.",
	head_recipient_metadata_invalid:
		"Access diff unavailable because the head recipient metadata is invalid.",
	base_and_head_recipient_metadata_invalid:
		"Access diff unavailable because the base and head recipient metadata is invalid.",
	base_decryption_failed:
		"Variable diff unavailable because the base environment could not be decrypted.",
	head_decryption_failed:
		"Variable diff unavailable because the head environment could not be decrypted.",
	base_and_head_decryption_failed:
		"Variable diff unavailable because the base and head environments could not be decrypted.",
	base_plaintext_invalid:
		"Variable diff unavailable because the decrypted base content is not a supported dotenv document.",
	head_plaintext_invalid:
		"Variable diff unavailable because the decrypted head content is not a supported dotenv document.",
	base_and_head_plaintexts_invalid:
		"Variable diff unavailable because the decrypted base and head content is not supported dotenv.",
	base_and_head_variables_unavailable:
		"Variable diff unavailable on both sides.",
} satisfies Record<EnvironmentDiffReasonCode, string>)

const emptyVariableChanges = () => ({
	added: [] as string[],
	changed: [] as string[],
	removed: [] as string[],
})

const emptyAccessChanges = () => ({
	grants: [] as RecipientIdentity[],
	revocations: [] as RecipientIdentity[],
	renames: [] as { fingerprint: string; from: string; to: string }[],
})

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false
	}

	const prototype = Object.getPrototypeOf(value)
	return prototype === Object.prototype || prototype === null
}

const hasExactKeys = (
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[] = [],
) => {
	const ownKeys = Reflect.ownKeys(value)
	if (ownKeys.some((key) => typeof key !== "string")) return false

	const allowed = new Set([...required, ...optional])
	const stringKeys = ownKeys as string[]
	return (
		required.every((key) => Object.hasOwn(value, key)) &&
		stringKeys.every((key) => allowed.has(key))
	)
}

const compareText = (left: string, right: string) =>
	left < right ? -1 : left > right ? 1 : 0

const containsControlCharacters = (value: string) => {
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0
		if (codePoint <= 0x1f || codePoint === 0x7f) return true
	}
	return false
}

const isBoundedText = (value: unknown, maximumBytes: number): value is string =>
	typeof value === "string" &&
	value.length > 0 &&
	Buffer.byteLength(value, "utf-8") <= maximumBytes &&
	!containsControlCharacters(value)

const isCanonicalBase64 = (value: unknown, maximumBytes: number) => {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		Buffer.byteLength(value, "utf-8") > maximumBytes ||
		value.length % 4 !== 0 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(value)
	) {
		return false
	}

	const decoded = Buffer.from(value, "base64")
	return decoded.toString("base64") === value
}

const parseEnvironmentPath = (filePath: string): string | null => {
	if (
		filePath.length === 0 ||
		Buffer.byteLength(filePath, "utf-8") >
			ENVIRONMENT_DIFF_LIMITS.maxPathBytes ||
		containsControlCharacters(filePath) ||
		filePath.startsWith("/") ||
		filePath.includes("\\")
	) {
		return null
	}

	const segments = filePath.split("/")
	if (
		segments.some(
			(segment) => segment.length === 0 || segment === "." || segment === "..",
		)
	) {
		return null
	}

	const fileName = segments.at(-1)
	const match = fileName?.match(/^\.env\.(.+)\.enc$/)
	if (!match) return null

	const environmentName = match[1]
	if (
		Buffer.byteLength(environmentName, "utf-8") >
		ENVIRONMENT_DIFF_LIMITS.maxEnvironmentNameBytes
	) {
		return null
	}

	return environmentName
}

const inputError = (
	code: EnvironmentDiffInputErrorCode,
	message: string,
): never => {
	throw new EnvironmentDiffInputError(code, message)
}

const validateInputFiles = (
	value: unknown,
	seenPaths: Set<string>,
): ValidatedInputFile[] => {
	if (!Array.isArray(value)) {
		return inputError(
			"invalid_request",
			"Diff input must contain base and head file arrays.",
		)
	}
	if (value.length > ENVIRONMENT_DIFF_LIMITS.maxFilesPerSide) {
		return inputError(
			"too_many_files",
			"Diff input exceeds the file-count limit.",
		)
	}

	return value.map((candidate) => {
		if (
			!isPlainRecord(candidate) ||
			!hasExactKeys(candidate, ["path", "content"]) ||
			typeof candidate.path !== "string" ||
			typeof candidate.content !== "string"
		) {
			return inputError(
				"invalid_request",
				"Each diff input file must contain only string path and content fields.",
			)
		}

		const name = parseEnvironmentPath(candidate.path)
		if (!name) {
			return inputError(
				"invalid_path",
				"Diff input contains an invalid encrypted-environment path.",
			)
		}
		if (seenPaths.has(candidate.path)) {
			return inputError(
				"duplicate_path",
				"Diff input contains a duplicate path on one side.",
			)
		}
		seenPaths.add(candidate.path)

		if (
			Buffer.byteLength(candidate.content, "utf-8") >
			ENVIRONMENT_DIFF_LIMITS.maxFileBytes
		) {
			return inputError(
				"file_too_large",
				"An encrypted environment exceeds the per-file byte limit.",
			)
		}

		return { path: candidate.path, content: candidate.content, name }
	})
}

const validateInput = (
	input: EnvironmentDiffInput,
): { base: ValidatedInputFile[]; head: ValidatedInputFile[] } => {
	if (!isPlainRecord(input) || !hasExactKeys(input, ["base", "head"])) {
		return inputError(
			"invalid_request",
			"Diff input must contain only base and head file arrays.",
		)
	}

	const base = validateInputFiles(input.base, new Set())
	const head = validateInputFiles(input.head, new Set())
	const totalBytes = [...base, ...head].reduce(
		(total, file) =>
			total +
			Buffer.byteLength(file.path, "utf-8") +
			Buffer.byteLength(file.content, "utf-8"),
		0,
	)

	if (totalBytes > ENVIRONMENT_DIFF_LIMITS.maxTotalBytes) {
		return inputError(
			"input_too_large",
			"Diff input exceeds the total byte limit.",
		)
	}

	return { base, head }
}

class InvalidJsonEnvelope extends Error {}

type JsonMemberScan = {
	hasDuplicates: boolean
	recipientMetadataAmbiguous: boolean
}

/** JSON.parse keeps the last duplicate member, so classify duplicates first. */
const scanJsonMembers = (source: string): JsonMemberScan => {
	let offset = 0
	let hasDuplicates = false
	let recipientMetadataAmbiguous = false

	const skipWhitespace = () => {
		while (offset < source.length && /\s/.test(source[offset])) offset += 1
	}

	const parseString = (): string => {
		const start = offset
		offset += 1
		while (offset < source.length) {
			if (source[offset] === "\\") {
				offset += 2
				continue
			}
			if (source[offset] === '"') {
				offset += 1
				return JSON.parse(source.slice(start, offset)) as string
			}
			offset += 1
		}
		throw new InvalidJsonEnvelope()
	}

	const parsePrimitive = () => {
		const start = offset
		while (offset < source.length && !/[\s,\]}]/.test(source[offset])) {
			offset += 1
		}
		if (offset === start) throw new InvalidJsonEnvelope()
	}

	const parseValue = (
		depth: number,
		location: "root" | "recipients" | "other",
	): void => {
		if (depth > ENVIRONMENT_DIFF_LIMITS.maxJsonDepth) {
			throw new InvalidJsonEnvelope()
		}
		skipWhitespace()
		const token = source[offset]
		if (token === '"') {
			parseString()
			return
		}
		if (token === "{") {
			offset += 1
			skipWhitespace()
			const members = new Set<string>()
			if (source[offset] === "}") {
				offset += 1
				return
			}
			while (offset < source.length) {
				skipWhitespace()
				if (source[offset] !== '"') throw new InvalidJsonEnvelope()
				const member = parseString()
				if (members.has(member)) {
					hasDuplicates = true
					if (
						location === "recipients" ||
						(location === "root" && member === "keys")
					) {
						recipientMetadataAmbiguous = true
					}
				}
				members.add(member)
				skipWhitespace()
				if (source[offset] !== ":") throw new InvalidJsonEnvelope()
				offset += 1
				const memberLocation =
					location === "recipients" ||
					(location === "root" && member === "keys")
						? "recipients"
						: "other"
				parseValue(depth + 1, memberLocation)
				skipWhitespace()
				if (source[offset] === "}") {
					offset += 1
					return
				}
				if (source[offset] !== ",") throw new InvalidJsonEnvelope()
				offset += 1
			}
			throw new InvalidJsonEnvelope()
		}
		if (token === "[") {
			offset += 1
			skipWhitespace()
			if (source[offset] === "]") {
				offset += 1
				return
			}
			while (offset < source.length) {
				parseValue(depth + 1, location)
				skipWhitespace()
				if (source[offset] === "]") {
					offset += 1
					return
				}
				if (source[offset] !== ",") throw new InvalidJsonEnvelope()
				offset += 1
			}
			throw new InvalidJsonEnvelope()
		}
		parsePrimitive()
	}

	parseValue(0, "root")
	skipWhitespace()
	if (offset !== source.length) throw new InvalidJsonEnvelope()
	return { hasDuplicates, recipientMetadataAmbiguous }
}

const parseRecipientMetadata = (
	raw: unknown,
): ParsedEnvironmentSide["access"] => {
	if (!isPlainRecord(raw) || !Array.isArray(raw.keys)) {
		return { status: "invalid" }
	}
	if (
		raw.keys.length === 0 ||
		raw.keys.length > ENVIRONMENT_DIFF_LIMITS.maxRecipientsPerEnvironment
	) {
		return { status: "invalid" }
	}

	const recipients: RecipientIdentity[] = []
	const fingerprints = new Set<string>()
	const names = new Set<string>()

	for (const candidate of raw.keys) {
		if (
			!isPlainRecord(candidate) ||
			!hasExactKeys(candidate, [
				"name",
				"fingerprint",
				"encryptedDataKey",
				"algorithm",
			]) ||
			!isBoundedText(
				candidate.name,
				ENVIRONMENT_DIFF_LIMITS.maxRecipientNameBytes,
			) ||
			!isBoundedText(
				candidate.fingerprint,
				ENVIRONMENT_DIFF_LIMITS.maxFingerprintBytes,
			)
		) {
			return { status: "invalid" }
		}

		if (fingerprints.has(candidate.fingerprint) || names.has(candidate.name)) {
			return { status: "invalid" }
		}
		fingerprints.add(candidate.fingerprint)
		names.add(candidate.name)
		recipients.push({
			name: candidate.name,
			fingerprint: candidate.fingerprint,
		})
	}

	return { status: "valid", recipients }
}

const hasValidRecipientWrapping = (raw: unknown): boolean => {
	if (!isPlainRecord(raw) || !Array.isArray(raw.keys)) return false

	return raw.keys.every(
		(candidate) =>
			isPlainRecord(candidate) &&
			hasExactKeys(candidate, [
				"name",
				"fingerprint",
				"encryptedDataKey",
				"algorithm",
			]) &&
			isCanonicalBase64(
				candidate.encryptedDataKey,
				ENVIRONMENT_DIFF_LIMITS.maxEncryptedDataKeyBytes,
			) &&
			(candidate.algorithm === "rsa" || candidate.algorithm === "ed25519"),
	)
}

const parseEnvironment = (content: string): ParsedEnvironmentSide => {
	let raw: unknown
	let jsonScan: JsonMemberScan
	try {
		jsonScan = scanJsonMembers(content)
		raw = JSON.parse(content)
	} catch {
		return {
			access: { status: "invalid" },
			environment: { status: "invalid" },
		}
	}

	const access = jsonScan.recipientMetadataAmbiguous
		? { status: "invalid" as const }
		: parseRecipientMetadata(raw)
	if (
		jsonScan.hasDuplicates ||
		!isPlainRecord(raw) ||
		!hasExactKeys(raw, ["keys", "encryptedContent"], ["version"]) ||
		(raw.version !== undefined && raw.version !== 1 && raw.version !== 2) ||
		!hasValidRecipientWrapping(raw) ||
		!isCanonicalBase64(
			raw.encryptedContent,
			ENVIRONMENT_DIFF_LIMITS.maxFileBytes,
		) ||
		access.status === "invalid"
	) {
		return { access, environment: { status: "invalid" } }
	}

	const parsed = environmentSchema.safeParse(raw)
	if (!parsed.success) {
		return { access, environment: { status: "invalid" } }
	}

	return {
		access,
		environment: { status: "valid", value: parsed.data },
	}
}

class InvalidPlaintext extends Error {}

// node:util parseEnv treats the next matching quote as the terminator even when
// it follows a backslash. Keep duplicate detection aligned with that grammar.
const findClosingQuote = (value: string, quote: string, start: number) =>
	value.indexOf(quote, start)

const detectDuplicateDotenvVariables = (plaintext: string): Set<string> => {
	const declarations = new Set<string>()
	let openQuote: string | undefined

	for (const rawLine of plaintext.split("\n")) {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
		if (openQuote) {
			if (findClosingQuote(line, openQuote, 0) !== -1) openQuote = undefined
			continue
		}

		let declaration = line.trimStart()
		if (declaration.length === 0 || declaration.startsWith("#")) continue
		if (/^export[ \t]+/.test(declaration)) {
			declaration = declaration.replace(/^export[ \t]+/, "")
		}
		const equalsIndex = declaration.indexOf("=")
		if (equalsIndex <= 0) continue
		const name = declaration.slice(0, equalsIndex).trim()
		if (name.length === 0) continue
		if (declarations.has(name)) throw new InvalidPlaintext()
		declarations.add(name)

		const value = declaration.slice(equalsIndex + 1).trimStart()
		const quote = value[0]
		if (
			(quote === '"' || quote === "'" || quote === "`") &&
			findClosingQuote(value, quote, 1) === -1
		) {
			openQuote = quote
		}
	}

	if (openQuote) throw new InvalidPlaintext()
	return declarations
}

const parsePlaintextVariables = (plaintext: unknown): VariableMap => {
	if (
		typeof plaintext !== "string" ||
		Buffer.byteLength(plaintext, "utf-8") >
			ENVIRONMENT_DIFF_LIMITS.maxPlaintextBytes
	) {
		throw new InvalidPlaintext()
	}

	const declarations = detectDuplicateDotenvVariables(plaintext)
	let parsed: Record<string, string>
	try {
		parsed = parseEnv(plaintext)
	} catch {
		throw new InvalidPlaintext()
	}

	const entries = Object.entries(parsed)
	if (entries.length > ENVIRONMENT_DIFF_LIMITS.maxVariablesPerEnvironment) {
		throw new InvalidPlaintext()
	}

	const variables = new Map<string, string>()
	for (const [name, value] of entries) {
		if (
			Buffer.byteLength(name, "utf-8") >
				ENVIRONMENT_DIFF_LIMITS.maxVariableNameBytes ||
			containsControlCharacters(name)
		) {
			throw new InvalidPlaintext()
		}
		variables.set(name, value)
	}

	for (const declaration of declarations) {
		if (!variables.has(declaration)) throw new InvalidPlaintext()
	}

	return variables
}

const createDefaultCrypto = (
	privateKeySource: "all" | "environment",
): {
	decryptEnvironment: EnvironmentDiffDecryptor
	dataKeysEqual: EnvironmentDiffDataKeyComparator
} => {
	let privateKeysPromise: ReturnType<typeof getPrivateKeys> | undefined
	const loadPrivateKeys = () => {
		privateKeysPromise ??= getPrivateKeys({
			environmentOnly: privateKeySource === "environment",
			environmentKeyErrorMode: "collect",
			logError: () => {},
		})
		return privateKeysPromise
	}

	return {
		decryptEnvironment: (environmentName, environment) =>
			decryptEnvironmentData(environmentName, environment, {
				getPrivateKeys: loadPrivateKeys,
				decryptDataKey,
				decryptData,
			}),
		dataKeysEqual: (base, head) =>
			environmentDataKeysEqual(base, head, {
				getPrivateKeys: loadPrivateKeys,
				decryptDataKey,
			}),
	}
}

const readVariables = async (
	parsed: ParsedEnvironmentSide | undefined,
	environmentName: string,
	decryptEnvironment: EnvironmentDiffDecryptor,
): Promise<VariableReadResult> => {
	if (!parsed) {
		return { status: "available", plaintext: "", variables: new Map() }
	}
	if (parsed.environment.status === "invalid") {
		return { status: "unavailable", kind: "environment" }
	}

	let plaintext: string
	try {
		plaintext = await decryptEnvironment(
			environmentName,
			parsed.environment.value,
		)
	} catch {
		return { status: "unavailable", kind: "decryption" }
	}

	try {
		return {
			status: "available",
			plaintext,
			variables: parsePlaintextVariables(plaintext),
		}
	} catch {
		return { status: "unavailable", kind: "plaintext" }
	}
}

const reason = (code: EnvironmentDiffReasonCode): EnvironmentDiffReason => ({
	code,
	message: ENVIRONMENT_DIFF_REASON_MESSAGES[code],
})

const variableFailureReason = (
	base: VariableReadResult,
	head: VariableReadResult,
): EnvironmentDiffReason => {
	const baseKind = base.status === "unavailable" ? base.kind : undefined
	const headKind = head.status === "unavailable" ? head.kind : undefined

	if (baseKind && headKind) {
		if (baseKind !== headKind)
			return reason("base_and_head_variables_unavailable")
		if (baseKind === "environment") {
			return reason("base_and_head_environments_invalid")
		}
		if (baseKind === "decryption") {
			return reason("base_and_head_decryption_failed")
		}
		return reason("base_and_head_plaintexts_invalid")
	}
	if (baseKind === "environment") return reason("base_environment_invalid")
	if (headKind === "environment") return reason("head_environment_invalid")
	if (baseKind === "decryption") return reason("base_decryption_failed")
	if (headKind === "decryption") return reason("head_decryption_failed")
	if (baseKind === "plaintext") return reason("base_plaintext_invalid")
	return reason("head_plaintext_invalid")
}

const createVariableDiff = (
	base: VariableReadResult,
	head: VariableReadResult,
): VariableDiff => {
	if (base.status === "unavailable" || head.status === "unavailable") {
		return {
			status: "unavailable",
			...emptyVariableChanges(),
			reason: variableFailureReason(base, head),
		}
	}

	const added: string[] = []
	const changed: string[] = []
	const removed: string[] = []
	const names = new Set([...base.variables.keys(), ...head.variables.keys()])

	for (const name of [...names].sort(compareText)) {
		const hadBase = base.variables.has(name)
		const hasHead = head.variables.has(name)
		if (!hadBase && hasHead) added.push(name)
		else if (hadBase && !hasHead) removed.push(name)
		else if (base.variables.get(name) !== head.variables.get(name)) {
			changed.push(name)
		}
	}

	return { status: "available", added, changed, removed }
}

const createAccessDiff = (
	base: ParsedEnvironmentSide | undefined,
	head: ParsedEnvironmentSide | undefined,
): AccessDiff => {
	const baseInvalid = base?.access.status === "invalid"
	const headInvalid = head?.access.status === "invalid"
	if (baseInvalid || headInvalid) {
		const code =
			baseInvalid && headInvalid
				? "base_and_head_recipient_metadata_invalid"
				: baseInvalid
					? "base_recipient_metadata_invalid"
					: "head_recipient_metadata_invalid"
		return {
			status: "unavailable",
			...emptyAccessChanges(),
			reason: reason(code),
		}
	}

	const baseRecipients =
		base?.access.status === "valid" ? base.access.recipients : []
	const headRecipients =
		head?.access.status === "valid" ? head.access.recipients : []
	const baseByFingerprint = new Map(
		baseRecipients.map((recipient) => [recipient.fingerprint, recipient]),
	)
	const headByFingerprint = new Map(
		headRecipients.map((recipient) => [recipient.fingerprint, recipient]),
	)

	const grants = headRecipients
		.filter((recipient) => !baseByFingerprint.has(recipient.fingerprint))
		.map((recipient) => ({ ...recipient }))
		.sort(
			(left, right) =>
				compareText(left.fingerprint, right.fingerprint) ||
				compareText(left.name, right.name),
		)
	const revocations = baseRecipients
		.filter((recipient) => !headByFingerprint.has(recipient.fingerprint))
		.map((recipient) => ({ ...recipient }))
		.sort(
			(left, right) =>
				compareText(left.fingerprint, right.fingerprint) ||
				compareText(left.name, right.name),
		)
	const renames = headRecipients
		.flatMap((recipient) => {
			const previous = baseByFingerprint.get(recipient.fingerprint)
			return previous && previous.name !== recipient.name
				? [
						{
							fingerprint: recipient.fingerprint,
							from: previous.name,
							to: recipient.name,
						},
					]
				: []
		})
		.sort((left, right) => compareText(left.fingerprint, right.fingerprint))

	return { status: "available", grants, revocations, renames }
}

const hasVariableChanges = (diff: VariableDiff) =>
	diff.added.length > 0 || diff.changed.length > 0 || diff.removed.length > 0

const hasAccessChanges = (diff: AccessDiff) =>
	diff.grants.length > 0 ||
	diff.revocations.length > 0 ||
	diff.renames.length > 0

const hasUnchangedRotationMetadata = (
	base: ParsedEnvironmentSide | undefined,
	head: ParsedEnvironmentSide | undefined,
): boolean => {
	if (
		!base ||
		!head ||
		base.environment.status !== "valid" ||
		head.environment.status !== "valid"
	) {
		return false
	}

	const baseEnvironment = base.environment.value
	const headEnvironment = head.environment.value
	if (
		(baseEnvironment.version ?? 1) !== (headEnvironment.version ?? 1) ||
		baseEnvironment.keys.length !== headEnvironment.keys.length
	) {
		return false
	}

	const headByFingerprint = new Map(
		headEnvironment.keys.map((recipient) => [recipient.fingerprint, recipient]),
	)
	return baseEnvironment.keys.every((baseRecipient) => {
		const headRecipient = headByFingerprint.get(baseRecipient.fingerprint)
		return (
			headRecipient !== undefined &&
			headRecipient.name === baseRecipient.name &&
			headRecipient.algorithm === baseRecipient.algorithm
		)
	})
}

const haveAllRecipientWrappersChanged = (
	base: Environment,
	head: Environment,
): boolean => {
	const headByFingerprint = new Map(
		head.keys.map((recipient) => [recipient.fingerprint, recipient]),
	)
	return base.keys.every(
		(baseRecipient) =>
			headByFingerprint.get(baseRecipient.fingerprint)?.encryptedDataKey !==
			baseRecipient.encryptedDataKey,
	)
}

const isVerifiedDataKeyOnlyChange = async (
	baseParsed: ParsedEnvironmentSide | undefined,
	headParsed: ParsedEnvironmentSide | undefined,
	baseVariables: VariableReadResult,
	headVariables: VariableReadResult,
	dataKeysEqual: EnvironmentDiffDataKeyComparator | undefined,
): Promise<boolean> => {
	if (
		!dataKeysEqual ||
		baseVariables.status !== "available" ||
		headVariables.status !== "available" ||
		baseVariables.plaintext !== headVariables.plaintext ||
		!hasUnchangedRotationMetadata(baseParsed, headParsed) ||
		!baseParsed ||
		!headParsed ||
		baseParsed.environment.status !== "valid" ||
		headParsed.environment.status !== "valid"
	) {
		return false
	}

	let keysAreEqual: boolean
	try {
		keysAreEqual = await dataKeysEqual(
			baseParsed.environment.value,
			headParsed.environment.value,
		)
	} catch {
		throw new Error("Data key comparison could not be completed safely.")
	}
	if (keysAreEqual !== true && keysAreEqual !== false) {
		throw new Error("Data key comparison could not be completed safely.")
	}
	if (keysAreEqual) return false
	if (
		!haveAllRecipientWrappersChanged(
			baseParsed.environment.value,
			headParsed.environment.value,
		)
	) {
		throw new Error("Data key rotation could not be verified safely.")
	}
	return true
}

/**
 * Builds a redacted, GitHub-independent semantic report. Plaintext values never
 * leave this function and caught error messages are never reflected in output.
 */
export const createEnvironmentDiffReport = async (
	input: EnvironmentDiffInput,
	options: CreateEnvironmentDiffReportOptions = {},
): Promise<EnvironmentDiffReport> => {
	const validated = validateInput(input)
	const baseByPath = new Map(validated.base.map((file) => [file.path, file]))
	const headByPath = new Map(validated.head.map((file) => [file.path, file]))
	const paths = [...new Set([...baseByPath.keys(), ...headByPath.keys()])].sort(
		compareText,
	)
	const defaultCrypto = options.decryptEnvironment
		? undefined
		: createDefaultCrypto(options.privateKeySource ?? "all")
	const decryptEnvironment =
		options.decryptEnvironment ?? defaultCrypto?.decryptEnvironment
	if (!decryptEnvironment) {
		throw new Error("Environment diff decryptor is unavailable.")
	}
	const dataKeysEqual = options.dataKeysEqual ?? defaultCrypto?.dataKeysEqual
	const environments: EnvironmentDiff[] = []

	for (const filePath of paths) {
		const baseFile = baseByPath.get(filePath)
		const headFile = headByPath.get(filePath)
		if (baseFile && headFile && baseFile.content === headFile.content) continue

		const environmentName = (headFile ?? baseFile)?.name
		if (!environmentName) continue
		const status = !baseFile ? "added" : !headFile ? "deleted" : "modified"
		const baseParsed = baseFile ? parseEnvironment(baseFile.content) : undefined
		const headParsed = headFile ? parseEnvironment(headFile.content) : undefined
		const [baseVariables, headVariables] = await Promise.all([
			readVariables(baseParsed, environmentName, decryptEnvironment),
			readVariables(headParsed, environmentName, decryptEnvironment),
		])
		const variables = createVariableDiff(baseVariables, headVariables)
		const access = createAccessDiff(baseParsed, headParsed)

		if (
			status === "modified" &&
			variables.status === "available" &&
			access.status === "available" &&
			!hasVariableChanges(variables) &&
			!hasAccessChanges(access)
		) {
			const verifiedDataKeyOnlyChange = await isVerifiedDataKeyOnlyChange(
				baseParsed,
				headParsed,
				baseVariables,
				headVariables,
				dataKeysEqual,
			)
			if (!verifiedDataKeyOnlyChange) continue
		}

		environments.push({
			path: filePath,
			name: environmentName,
			status,
			variables,
			access,
		})
	}

	return {
		schemaVersion: ENVIRONMENT_DIFF_REPORT_SCHEMA_VERSION,
		environments,
	}
}
