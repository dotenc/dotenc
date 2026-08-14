import { spawnSync } from "node:child_process"
import os from "node:os"

const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024
const MAX_HISTORY_REVISIONS = 64
const MAX_GIT_DELETIONS = 100
const MAX_GIT_COMMAND_MILLISECONDS = 5_000
const FULL_COMMIT_HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

export type DoctorGitCommandResult = {
	status: number | null
	stdout: Buffer
	failed: boolean
}

export type DoctorGitRunner = (
	args: string[],
	cwd: string,
	input?: Buffer,
) => DoctorGitCommandResult

export type DoctorGitDeletion = {
	path: string
	indexDeleted: boolean
	worktreeDeleted: boolean
}

export type DoctorGitHistoryResult =
	| { status: "found"; revision: string }
	| { status: "not-found" }
	| { status: "incomplete" }

const safeGitEnvironment = (): NodeJS.ProcessEnv => {
	const environment: NodeJS.ProcessEnv = {
		GIT_ATTR_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: os.devNull,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_NO_LAZY_FETCH: "1",
		GIT_OPTIONAL_LOCKS: "0",
		GIT_PAGER: "cat",
		GIT_TERMINAL_PROMPT: "0",
		LANG: "C",
		LC_ALL: "C",
	}
	for (const name of [
		"PATH",
		"PATHEXT",
		"SystemRoot",
		"WINDIR",
		"COMSPEC",
		"TMPDIR",
		"TMP",
		"TEMP",
	]) {
		if (process.env[name] !== undefined) environment[name] = process.env[name]
	}
	return environment
}

const defaultRunner: DoctorGitRunner = (args, cwd, input) => {
	const result = spawnSync(
		"git",
		[
			"--no-pager",
			"-c",
			`core.attributesFile=${os.devNull}`,
			"-c",
			"core.fsmonitor=false",
			"-c",
			`core.hooksPath=${os.devNull}`,
			"-c",
			"maintenance.auto=false",
			"-c",
			"gc.auto=0",
			...args,
		],
		{
			cwd,
			env: safeGitEnvironment(),
			encoding: "buffer",
			...(input ? { input } : {}),
			maxBuffer: MAX_GIT_OUTPUT_BYTES,
			stdio: [input ? "pipe" : "ignore", "pipe", "ignore"],
			timeout: MAX_GIT_COMMAND_MILLISECONDS,
			windowsHide: true,
		},
	)

	return {
		status: result.status,
		stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
		failed: result.error !== undefined,
	}
}

const successful = (result: DoctorGitCommandResult) =>
	!result.failed && result.status === 0

const splitNul = (stdout: Buffer): string[] =>
	stdout
		.toString("utf8")
		.split("\0")
		.filter((value) => value.length > 0)

const encodeNulPaths = (filePaths: string[]): Buffer | undefined => {
	const paths = [...new Set(filePaths)].sort((left, right) =>
		left.localeCompare(right),
	)
	if (paths.some((filePath) => !isSafeDoctorRelativePath(filePath))) {
		return undefined
	}
	const input = Buffer.from(paths.length > 0 ? `${paths.join("\0")}\0` : "")
	if (input.byteLength > MAX_GIT_OUTPUT_BYTES) {
		input.fill(0)
		return undefined
	}
	return input
}

export const isSafeDoctorRelativePath = (filePath: string): boolean => {
	if (!filePath || filePath.startsWith("/") || filePath.includes("\\")) {
		return false
	}
	if (
		filePath
			.split("/")
			.some((part) => part === "" || part === "." || part === "..")
	) {
		return false
	}
	for (const character of filePath) {
		const codePoint = character.codePointAt(0) ?? 0
		if (codePoint === 0xfffd || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(character)) {
			return false
		}
	}
	return true
}

export class DoctorGitInspector {
	readonly #projectRoot: string
	readonly #run: DoctorGitRunner
	#prefix: string | undefined | null = null
	#promisorRepository: boolean | undefined | null = null

	constructor(projectRoot: string, run: DoctorGitRunner = defaultRunner) {
		this.#projectRoot = projectRoot
		this.#run = run
	}

	#execute(args: string[], input?: Buffer): DoctorGitCommandResult {
		return this.#run(args, this.#projectRoot, input)
	}

	#projectPrefix(): string | undefined {
		if (this.#prefix !== null) return this.#prefix
		const result = this.#execute(["rev-parse", "--show-prefix"])
		if (!successful(result)) {
			this.#prefix = undefined
			return undefined
		}
		const prefix = result.stdout.toString("utf8").replace(/\r?\n$/, "")
		if (prefix && !isSafeDoctorRelativePath(prefix.replace(/\/$/, ""))) {
			this.#prefix = undefined
			return undefined
		}
		this.#prefix = prefix
		return prefix
	}

	#isPromisorRepository(): boolean | undefined {
		if (this.#promisorRepository !== null) return this.#promisorRepository
		const extension = this.#execute([
			"config",
			"--includes",
			"--local",
			"--get-all",
			"extensions.partialClone",
		])
		if (
			extension.failed ||
			(extension.status !== 0 && extension.status !== 1)
		) {
			this.#promisorRepository = undefined
			return undefined
		}
		if (extension.status === 0) {
			this.#promisorRepository = true
			return true
		}

		const remotes = this.#execute([
			"config",
			"--includes",
			"--local",
			"--bool",
			"--get-regexp",
			"^remote\\..*\\.promisor$",
		])
		if (remotes.failed || (remotes.status !== 0 && remotes.status !== 1)) {
			this.#promisorRepository = undefined
			return undefined
		}
		if (remotes.status === 1) {
			this.#promisorRepository = false
			return false
		}
		const values = remotes.stdout
			.toString("utf8")
			.split(/\r?\n/)
			.filter((value) => value.length > 0)
		if (
			values.length === 0 ||
			values.some(
				(value) => !/^remote\.[^\s]+\.promisor (?:true|false)$/.test(value),
			)
		) {
			this.#promisorRepository = undefined
			return undefined
		}
		this.#promisorRepository = values.some((value) => value.endsWith(" true"))
		return this.#promisorRepository
	}

	isRepository(): boolean | undefined {
		const result = this.#execute(["rev-parse", "--is-inside-work-tree"])
		if (result.failed || result.status === null) return undefined
		if (result.status !== 0) return false
		const value = result.stdout.toString("utf8").trim()
		return value === "true" ? true : value === "false" ? false : undefined
	}

	isShallow(): boolean | undefined {
		const result = this.#execute(["rev-parse", "--is-shallow-repository"])
		if (!successful(result)) return undefined
		const value = result.stdout.toString("utf8").trim()
		return value === "true" ? true : value === "false" ? false : undefined
	}

	deletedPaths(): DoctorGitDeletion[] | undefined {
		// `git status` is deliberately avoided here: deciding whether a tracked
		// worktree file changed can execute repository-configured clean filters.
		// These plumbing queries inspect only index stages, index/tree names, and
		// file existence. They never ask Git to convert worktree contents.
		const unmerged = this.#execute(["ls-files", "--unmerged", "-z", "--", "."])
		if (!successful(unmerged) || unmerged.stdout.byteLength > 0)
			return undefined

		const worktree = this.#execute(["ls-files", "--deleted", "-z", "--", "."])
		if (!successful(worktree)) return undefined
		const worktreeDeleted = new Set(splitNul(worktree.stdout))
		if (
			worktreeDeleted.size > MAX_GIT_DELETIONS ||
			[...worktreeDeleted].some(
				(filePath) => !isSafeDoctorRelativePath(filePath),
			)
		) {
			return undefined
		}
		if (worktreeDeleted.size > 0) {
			const indexEntries = this.#execute([
				"ls-files",
				"--stage",
				"-z",
				"--",
				".",
			])
			if (!successful(indexEntries)) return undefined
			const modes = new Map<string, string>()
			for (const record of splitNul(indexEntries.stdout)) {
				const separator = record.indexOf("\t")
				if (separator === -1) return undefined
				const metadata = record.slice(0, separator)
				const filePath = record.slice(separator + 1)
				if (!worktreeDeleted.has(filePath)) continue
				const match = /^([0-7]{6}) (?:[0-9a-f]{40}|[0-9a-f]{64}) 0$/.exec(
					metadata,
				)
				if (!match || modes.has(filePath)) return undefined
				modes.set(filePath, match[1])
			}
			if (
				modes.size !== worktreeDeleted.size ||
				[...modes.values()].some(
					(mode) => mode !== "100644" && mode !== "100755",
				)
			) {
				return undefined
			}
		}

		const head = this.#execute([
			"rev-parse",
			"--verify",
			"--quiet",
			"HEAD^{commit}",
		])
		if (head.failed || (head.status !== 0 && head.status !== 1))
			return undefined

		const indexDeleted = new Set<string>()
		if (head.status === 0) {
			const staged = this.#execute([
				"diff-index",
				"--cached",
				"--relative",
				"--raw",
				"-z",
				"--full-index",
				"--find-renames",
				`-l${MAX_GIT_DELETIONS}`,
				"--no-ext-diff",
				"--no-textconv",
				"HEAD",
				"--",
				".",
			])
			if (!successful(staged)) return undefined
			const fields = splitNul(staged.stdout)
			let additions = 0
			for (let index = 0; index < fields.length; ) {
				const metadata = fields[index]
				const filePath = fields[index + 1]
				index += 2
				const match =
					/^:([0-7]{6}) ([0-7]{6}) (?:[0-9a-f]{40}|[0-9a-f]{64}) (?:[0-9a-f]{40}|[0-9a-f]{64}) ([ACDMRTUXB]|[RC][0-9]{1,3})$/.exec(
						metadata ?? "",
					)
				if (!match || !filePath) return undefined
				const [, oldMode, newMode, status] = match
				if (status.startsWith("R") || status.startsWith("C")) {
					if (!fields[index]) return undefined
					index += 1
					continue
				}
				if (status === "U") return undefined
				if (status === "A") additions += 1
				if (status === "D") {
					if (
						!isSafeDoctorRelativePath(filePath) ||
						!["100644", "100755"].includes(oldMode) ||
						newMode !== "000000"
					) {
						return undefined
					}
					indexDeleted.add(filePath)
				}
			}
			// Git skips inexact rename detection when either side exceeds `-l`.
			// Fail closed rather than misreport a staged rename as a deletion.
			if (
				indexDeleted.size > MAX_GIT_DELETIONS ||
				(indexDeleted.size > 0 && additions > MAX_GIT_DELETIONS)
			) {
				return undefined
			}
		}

		const paths = new Set([...indexDeleted, ...worktreeDeleted])
		if (paths.size > MAX_GIT_DELETIONS) return undefined
		return [...paths]
			.sort((left, right) => left.localeCompare(right))
			.map((filePath) => ({
				path: filePath,
				indexDeleted: indexDeleted.has(filePath),
				worktreeDeleted: worktreeDeleted.has(filePath),
			}))
	}

	configValues(key: string): string[] | undefined {
		const result = this.#execute([
			"config",
			"--includes",
			"--local",
			"--get-all",
			key,
		])
		if (result.failed || (result.status !== 0 && result.status !== 1)) {
			return undefined
		}
		if (result.status === 1) return []
		return result.stdout
			.toString("utf8")
			.split(/\r?\n/)
			.filter((value) => value.length > 0)
	}

	configBooleanValues(key: string): boolean[] | undefined {
		const result = this.#execute([
			"config",
			"--includes",
			"--local",
			"--bool",
			"--get-all",
			key,
		])
		if (result.failed || (result.status !== 0 && result.status !== 1)) {
			return undefined
		}
		if (result.status === 1) return []
		const values = result.stdout
			.toString("utf8")
			.split(/\r?\n/)
			.filter((value) => value.length > 0)
		if (values.some((value) => value !== "true" && value !== "false")) {
			return undefined
		}
		return values.map((value) => value === "true")
	}

	attributeValue(filePath: string, attribute: string): string | undefined {
		return this.attributeValues([filePath], attribute)?.get(filePath)
	}

	attributeValues(
		filePaths: string[],
		attribute: string,
	): Map<string, string> | undefined {
		if (!/^[a-zA-Z0-9.-]+$/.test(attribute)) return undefined
		const input = encodeNulPaths(filePaths)
		if (!input) return undefined
		if (input.byteLength === 0) return new Map()
		const requested = new Set(filePaths)
		const result = this.#execute(
			["check-attr", "-z", "--stdin", attribute],
			input,
		)
		input.fill(0)
		if (!successful(result)) return undefined
		const fields = splitNul(result.stdout)
		if (fields.length !== requested.size * 3) return undefined
		const values = new Map<string, string>()
		for (let index = 0; index < fields.length; index += 3) {
			const filePath = fields[index]
			if (fields[index + 1] !== attribute || !requested.has(filePath)) {
				return undefined
			}
			values.set(filePath, fields[index + 2])
		}
		return values.size === requested.size ? values : undefined
	}

	isTracked(filePath: string): boolean | undefined {
		const paths = this.trackedPaths([filePath])
		return paths ? paths.has(filePath) : undefined
	}

	trackedPaths(filePaths: string[]): Set<string> | undefined {
		const input = encodeNulPaths(filePaths)
		if (!input) return undefined
		input.fill(0)
		if (filePaths.length === 0) return new Set()
		const requested = new Set(filePaths)
		const result = this.#execute(["ls-files", "-z", "--cached", "--", "."])
		if (!successful(result)) return undefined
		const allTracked = splitNul(result.stdout)
		if (allTracked.some((filePath) => !isSafeDoctorRelativePath(filePath))) {
			return undefined
		}
		return new Set(allTracked.filter((filePath) => requested.has(filePath)))
	}

	isIgnored(filePath: string): boolean | undefined {
		const paths = this.ignoredPaths([filePath])
		return paths ? paths.has(filePath) : undefined
	}

	ignoredPaths(filePaths: string[]): Set<string> | undefined {
		const input = encodeNulPaths(filePaths)
		if (!input) return undefined
		if (input.byteLength === 0) return new Set()
		const requested = new Set(filePaths)
		const result = this.#execute(["check-ignore", "-z", "--stdin"], input)
		input.fill(0)
		if (result.failed || (result.status !== 0 && result.status !== 1)) {
			return undefined
		}
		const ignored = new Set(splitNul(result.stdout))
		return [...ignored].every((filePath) => requested.has(filePath))
			? ignored
			: undefined
	}

	latestValidRevision(
		filePath: string,
		isValidEnvelope: (source: string) => boolean,
	): DoctorGitHistoryResult {
		if (!isSafeDoctorRelativePath(filePath)) return { status: "incomplete" }
		if (this.#isPromisorRepository() !== false) return { status: "incomplete" }
		const prefix = this.#projectPrefix()
		if (prefix === undefined) return { status: "incomplete" }
		const repositoryPath = `${prefix}${filePath}`
		const log = this.#execute([
			"--literal-pathspecs",
			"rev-list",
			"--all",
			"--reflog",
			"--date-order",
			`--max-count=${MAX_HISTORY_REVISIONS + 1}`,
			"--full-history",
			"--",
			filePath,
		])
		if (!successful(log)) return { status: "incomplete" }

		const revisionLines = log.stdout
			.toString("utf8")
			.split(/\r?\n/)
			.filter((revision) => revision.length > 0)
		if (revisionLines.some((revision) => !FULL_COMMIT_HASH.test(revision))) {
			return { status: "incomplete" }
		}
		if (revisionLines.length === 0) return { status: "not-found" }

		const boundedRevisions = revisionLines.slice(0, MAX_HISTORY_REVISIONS)
		const modeInput = Buffer.from(`${boundedRevisions.join("\n")}\n`, "utf8")
		const modeResult = this.#execute(
			[
				"--literal-pathspecs",
				"diff-tree",
				"--stdin",
				"--root",
				"-r",
				"--raw",
				"-z",
				"--no-renames",
				"--full-index",
				"--",
				filePath,
			],
			modeInput,
		)
		modeInput.fill(0)
		if (!successful(modeResult)) return { status: "incomplete" }
		const modeFields = splitNul(modeResult.stdout)
		const requestedRevisions = new Set(boundedRevisions)
		const regularRevisions: string[] = []
		for (let index = 0; index < modeFields.length; ) {
			const revision = modeFields[index]
			index += 1
			if (!requestedRevisions.has(revision)) return { status: "incomplete" }
			const header = modeFields[index]
			const changedPath = modeFields[index + 1]
			index += 2
			const match =
				/^:([0-7]{6}) ([0-7]{6}) (?:[0-9a-f]{40}|[0-9a-f]{64}) (?:[0-9a-f]{40}|[0-9a-f]{64}) [A-Z][0-9]*$/.exec(
					header ?? "",
				)
			if (!match || changedPath !== repositoryPath) {
				return { status: "incomplete" }
			}
			if (match[2] === "100644" || match[2] === "100755") {
				regularRevisions.push(revision)
			}
		}
		if (modeFields.length !== boundedRevisions.length * 3) {
			return { status: "incomplete" }
		}
		if (regularRevisions.length === 0) {
			return revisionLines.length > MAX_HISTORY_REVISIONS
				? { status: "incomplete" }
				: { status: "not-found" }
		}

		const revisions = regularRevisions
		const batchInput = Buffer.from(
			`${revisions
				.map((revision) => `${revision}:${repositoryPath}`)
				.join("\n")}\n`,
			"utf8",
		)
		const batch = this.#execute(["cat-file", "--batch"], batchInput)
		batchInput.fill(0)
		if (!successful(batch)) {
			batch.stdout.fill(0)
			return { status: "incomplete" }
		}

		let offset = 0
		let missingObject = false
		try {
			for (const revision of revisions) {
				const headerEnd = batch.stdout.indexOf(0x0a, offset)
				if (headerEnd === -1) return { status: "incomplete" }
				const header = batch.stdout.subarray(offset, headerEnd).toString("utf8")
				offset = headerEnd + 1
				if (header.endsWith(" missing")) {
					missingObject = true
					continue
				}

				const match = /^(?:[0-9a-f]{40}|[0-9a-f]{64}) blob ([0-9]+)$/.exec(
					header,
				)
				if (!match) return { status: "incomplete" }
				const byteLength = Number(match[1])
				const contentEnd = offset + byteLength
				if (
					!Number.isSafeInteger(byteLength) ||
					byteLength < 0 ||
					contentEnd >= batch.stdout.byteLength ||
					batch.stdout[contentEnd] !== 0x0a
				) {
					return { status: "incomplete" }
				}

				let source: string
				try {
					source = new TextDecoder("utf-8", { fatal: true }).decode(
						batch.stdout.subarray(offset, contentEnd),
					)
				} catch {
					offset = contentEnd + 1
					continue
				}
				offset = contentEnd + 1
				if (isValidEnvelope(source)) {
					return { status: "found", revision }
				}
			}
			if (offset !== batch.stdout.byteLength) {
				return { status: "incomplete" }
			}
		} finally {
			batch.stdout.fill(0)
		}

		return missingObject || revisionLines.length > MAX_HISTORY_REVISIONS
			? { status: "incomplete" }
			: { status: "not-found" }
	}
}
