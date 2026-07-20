import { spawn } from "node:child_process"
import type crypto from "node:crypto"
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto"
import { existsSync, type Stats } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { type Environment, environmentSchema } from "../schemas/environment"
import { ENVIRONMENT_DIFF_LIMITS } from "../schemas/environmentDiffReport"
import { promptConfirm, promptMultiSelect } from "../ui/prompts"
import { isInteractive } from "../ui/tty"
import { createEnvironmentDiffReport } from "./createEnvironmentDiffReport"
import { createDataKey, encryptData } from "./crypto"
import { decryptEnvironmentData } from "./decryptEnvironment"
import { encryptDataKey } from "./encryptDataKey"
import { getKeyFingerprint } from "./getKeyFingerprint"
import { getPublicKeys, type PublicKeyEntry } from "./getPublicKeys"
import { resolveProjectRoot } from "./resolveProjectRoot"
import { validateKeyName } from "./validateKeyName"

export const GITHUB_DIFF_SECRET_NAME = "DOTENC_DIFF_PRIVATE_KEY_BASE64"
export const GITHUB_DIFF_WORKFLOW_PATH = ".github/workflows/dotenc-diff.yml"
export const GITHUB_DIFF_DEFAULT_KEY_NAME = "github-diff"

const OFFICIAL_ACTION_REPOSITORY = "dotenc/dotenc"
const OFFICIAL_ACTION_REF = "v1"
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i
const REPOSITORY_NAME =
	/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/
const ENVIRONMENT_FILE = /^\.env\.(.+)\.enc$/
const MAX_PROCESS_OUTPUT_BYTES = 256 * 1024
const PROCESS_TIMEOUT_MS = 30_000

const BASE_CHILD_ENVIRONMENT_NAMES = [
	"ALL_PROXY",
	"ComSpec",
	"HOME",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"LOGNAME",
	"NO_PROXY",
	"PATH",
	"PATHEXT",
	"SSL_CERT_DIR",
	"SSL_CERT_FILE",
	"SystemRoot",
	"TEMP",
	"TERM",
	"TMP",
	"TMPDIR",
	"USER",
	"XDG_CONFIG_HOME",
] as const

const GITHUB_CHILD_ENVIRONMENT_NAMES = [
	"GH_CONFIG_DIR",
	"GH_ENTERPRISE_TOKEN",
	"GH_HOST",
	"GH_TOKEN",
	"GITHUB_ENTERPRISE_TOKEN",
	"GITHUB_TOKEN",
] as const

export type InstallGithubDiffsOptions = {
	actionRef?: string
	all?: boolean
	allowFork?: boolean
	cwd?: string
	environment?: string[]
	keyName?: string
	repo?: string
	yes?: boolean
}

type ToolRunOptions = {
	cwd: string
	input?: Buffer
	/** Marks stdin as secret material for tests and future runners. */
	sensitiveInput?: boolean
}

type TrackedEnvironment = {
	absolutePath: string
	dir: string
	indexSize: number
	mode: "100644" | "100755"
	name: string
	relativePath: string
}

type SelectedEnvironment = TrackedEnvironment & {
	content: string
	environment: Environment
	originalBytes: Buffer
	originalMode: number
	plaintext: string
	projectRoot: string
}

type LocalChange = {
	afterHash: string
	before: Buffer | null
	filePath: string
	mode: number
}

type RepositoryInfo = {
	isFork: boolean
	nameWithOwner: string
}

export type InstallGithubDiffsResult =
	| { status: "cancelled" }
	| {
			actionRef: string
			environments: string[]
			keyPaths: string[]
			repository: string
			secretName: typeof GITHUB_DIFF_SECRET_NAME
			status: "installed"
			workflowPath: string
	  }

export type InstallGithubDiffsDependencies = {
	createKeyPair: () => {
		privateKey: crypto.KeyObject
		publicKey: crypto.KeyObject
	}
	decryptEnvironmentData: typeof decryptEnvironmentData
	existsSync: typeof existsSync
	getPublicKeys: typeof getPublicKeys
	isInteractive: typeof isInteractive
	log: (message: string) => void
	promptConfirm: typeof promptConfirm
	promptMultiSelect: typeof promptMultiSelect
	realpath: typeof fs.realpath
	runGh: (args: string[], options: ToolRunOptions) => Promise<string>
	runGit: (args: string[], options: ToolRunOptions) => Promise<string>
}

type ProcessOptions = ToolRunOptions & {
	environment?: NodeJS.ProcessEnv
	maxOutputBytes?: number
	timeoutMs?: number
}

const createChildEnvironment = (
	includeGithubAuth = false,
): NodeJS.ProcessEnv => {
	const environment: NodeJS.ProcessEnv = {}
	const names = includeGithubAuth
		? [...BASE_CHILD_ENVIRONMENT_NAMES, ...GITHUB_CHILD_ENVIRONMENT_NAMES]
		: BASE_CHILD_ENVIRONMENT_NAMES
	for (const name of names) {
		const value = process.env[name]
		if (value !== undefined) environment[name] = value
	}
	return environment
}

/** Run an installer subprocess without a shell or diagnostic echoing. */
export const _runInstallerProcess = (
	command: string,
	args: string[],
	options: ProcessOptions,
	spawnImpl: typeof spawn = spawn,
): Promise<string> =>
	new Promise((resolve, reject) => {
		const maximumOutput = options.maxOutputBytes ?? MAX_PROCESS_OUTPUT_BYTES
		const timeoutMs = options.timeoutMs ?? PROCESS_TIMEOUT_MS
		const stdout: Buffer[] = []
		let stdoutBytes = 0
		let stderrBytes = 0
		let outputExceeded = false
		let timedOut = false
		let settled = false

		const child = spawnImpl(command, args, {
			cwd: options.cwd,
			env: options.environment ?? createChildEnvironment(),
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		})

		const timer = setTimeout(() => {
			timedOut = true
			child.kill("SIGKILL")
		}, timeoutMs)

		child.stdout.on("data", (chunk: Buffer | string) => {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
			stdoutBytes += buffer.byteLength
			if (stdoutBytes + stderrBytes > maximumOutput) {
				outputExceeded = true
				child.kill("SIGKILL")
				return
			}
			stdout.push(buffer)
		})

		// Drain stderr, but never replay subprocess diagnostics. A provider CLI can
		// include request details in errors, so callers receive static failures.
		child.stderr.on("data", (chunk: Buffer | string) => {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
			stderrBytes += buffer.byteLength
			if (stdoutBytes + stderrBytes > maximumOutput) {
				outputExceeded = true
				child.kill("SIGKILL")
			}
		})

		child.stdin.on("error", () => {
			// The close/error handlers below produce the bounded static diagnostic.
		})
		child.stdin.end(options.input)

		child.once("error", () => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			reject(new Error(`${command} could not be started.`))
		})

		child.once("close", (code) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			if (timedOut) {
				reject(new Error(`${command} timed out.`))
				return
			}
			if (outputExceeded) {
				reject(new Error(`${command} produced too much output.`))
				return
			}
			if (code !== 0) {
				reject(new Error(`${command} exited with code ${code ?? 1}.`))
				return
			}
			resolve(Buffer.concat(stdout, stdoutBytes).toString("utf-8"))
		})
	})

const defaultDependencies: InstallGithubDiffsDependencies = {
	createKeyPair: () => generateKeyPairSync("ed25519"),
	decryptEnvironmentData,
	existsSync,
	getPublicKeys,
	isInteractive,
	log: (message) => console.log(message),
	promptConfirm,
	promptMultiSelect,
	realpath: fs.realpath,
	runGh: (args, options) =>
		_runInstallerProcess("gh", args, {
			...options,
			environment: createChildEnvironment(true),
		}),
	runGit: (args, options) =>
		_runInstallerProcess("git", args, {
			...options,
			environment: createChildEnvironment(),
		}),
}

const isWithin = (parent: string, candidate: string): boolean => {
	const relative = path.relative(parent, candidate)
	return (
		relative === "" ||
		(!path.isAbsolute(relative) &&
			relative !== ".." &&
			!relative.startsWith(`..${path.sep}`))
	)
}

const toRepositoryPath = (value: string): string =>
	value.split(path.sep).join("/")

const normalizeEnvironmentArgument = (value: string): string =>
	value.replace(/\\/g, "/").replace(/^\.\//, "")

const literalGitPathspec = (filePath: string): string => `:(literal)${filePath}`

const containsControlCharacter = (value: string): boolean =>
	Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0) ?? 0
		return codePoint <= 0x1f || codePoint === 0x7f
	})

const assertActionPathForGit = (filePath: string): void => {
	if (
		!filePath ||
		filePath.startsWith("/") ||
		filePath.startsWith(":") ||
		filePath.includes("\\") ||
		containsControlCharacter(filePath) ||
		filePath
			.split("/")
			.some((segment) => !segment || segment === "." || segment === "..")
	) {
		throw new Error(`Installer target has an invalid Git path.`)
	}
}

const assertActionPath = (filePath: string): void => {
	assertActionPathForGit(filePath)
	if (
		Buffer.byteLength(filePath, "utf-8") >
			ENVIRONMENT_DIFF_LIMITS.maxPathBytes ||
		!ENVIRONMENT_FILE.test(path.posix.basename(filePath))
	) {
		throw new Error(
			`Encrypted environment path is not supported by the GitHub diff action: ${JSON.stringify(filePath)}.`,
		)
	}

	const match = ENVIRONMENT_FILE.exec(path.posix.basename(filePath))
	if (
		!match ||
		Buffer.byteLength(match[1], "utf-8") >
			ENVIRONMENT_DIFF_LIMITS.maxEnvironmentNameBytes
	) {
		throw new Error(
			`Encrypted environment path is not supported by the GitHub diff action: ${JSON.stringify(filePath)}.`,
		)
	}
}

const lstatIfPresent = async (filePath: string): Promise<Stats | undefined> => {
	try {
		return await fs.lstat(filePath)
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return undefined
		}
		throw error
	}
}

const assertSafeDirectory = async (directory: string): Promise<void> => {
	const stat = await lstatIfPresent(directory)
	if (!stat) return
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(
			`Installer directory must be a real directory: ${directory}.`,
		)
	}
}

const parseTrackedEnvironments = (
	output: string,
	gitRoot: string,
): Omit<TrackedEnvironment, "indexSize">[] => {
	const environments: Omit<TrackedEnvironment, "indexSize">[] = []
	const seen = new Set<string>()

	for (const record of output.split("\0")) {
		if (!record) continue
		const separator = record.indexOf("\t")
		if (separator === -1)
			throw new Error("Git returned an invalid index record.")
		const [mode, _objectId, stage] = record.slice(0, separator).split(" ")
		const relativePath = record.slice(separator + 1)
		const match = ENVIRONMENT_FILE.exec(path.posix.basename(relativePath))
		if (!match) continue

		assertActionPath(relativePath)
		if (stage !== "0" || (mode !== "100644" && mode !== "100755")) {
			throw new Error(
				`Encrypted environment must be an ordinary, unconflicted Git file: ${relativePath}.`,
			)
		}
		if (seen.has(relativePath)) {
			throw new Error(
				`Git returned a duplicate environment path: ${relativePath}.`,
			)
		}
		seen.add(relativePath)

		const absolutePath = path.join(gitRoot, ...relativePath.split("/"))
		if (!isWithin(gitRoot, absolutePath)) {
			throw new Error(`Encrypted environment escapes the Git repository.`)
		}
		environments.push({
			absolutePath,
			dir: path.dirname(absolutePath),
			mode,
			name: match[1],
			relativePath,
		})
	}

	return environments.sort((left, right) =>
		left.relativePath.localeCompare(right.relativePath),
	)
}

const loadIndexSizes = async (
	environments: Omit<TrackedEnvironment, "indexSize">[],
	gitRoot: string,
	runGit: InstallGithubDiffsDependencies["runGit"],
): Promise<TrackedEnvironment[]> => {
	if (environments.length === 0) return []
	const input = Buffer.from(
		`${environments.map((environment) => `:${environment.relativePath}`).join("\n")}\n`,
		"utf-8",
	)
	let output: string
	try {
		output = await runGit(
			["cat-file", "--batch-check=%(objecttype) %(objectsize)"],
			{ cwd: gitRoot, input },
		)
	} catch {
		throw new Error(
			"Could not inspect encrypted environments in the Git index.",
		)
	}

	const lines = output.trimEnd().split("\n")
	if (lines.length !== environments.length) {
		throw new Error("Git returned incomplete encrypted-environment metadata.")
	}

	return environments.map((environment, index) => {
		const match = /^blob ([0-9]+)$/.exec(lines[index])
		const indexSize = match ? Number(match[1]) : Number.NaN
		if (!Number.isSafeInteger(indexSize) || indexSize < 0) {
			throw new Error(
				`Git returned invalid metadata for ${environment.relativePath}.`,
			)
		}
		return { ...environment, indexSize }
	})
}

const assertInstallTargetsAbsentFromGit = async (
	relativePaths: string[],
	gitRoot: string,
	runGit: InstallGithubDiffsDependencies["runGit"],
): Promise<void> => {
	for (const relativePath of relativePaths) assertActionPathForGit(relativePath)

	let matches: [string, string]
	try {
		matches = await Promise.all([
			runGit(
				["ls-files", "-z", "--", ...relativePaths.map(literalGitPathspec)],
				{ cwd: gitRoot },
			),
			runGit(
				[
					"ls-tree",
					"-r",
					"--name-only",
					"-z",
					"HEAD",
					"--",
					...relativePaths.map(literalGitPathspec),
				],
				{ cwd: gitRoot },
			),
		])
	} catch {
		throw new Error("Could not verify installer target paths against Git.")
	}

	const [indexMatches, headMatches] = matches
	const collision = [...indexMatches.split("\0"), ...headMatches.split("\0")]
		.filter(Boolean)
		.sort()[0]
	if (collision) {
		throw new Error(
			`Installer target already exists in Git; refusing to replace it: ${collision}.`,
		)
	}
}

const assertRepositoryLimits = (
	environments: TrackedEnvironment[],
	sizeOverrides: ReadonlyMap<string, number> = new Map(),
): void => {
	if (environments.length > ENVIRONMENT_DIFF_LIMITS.maxFilesPerSide) {
		throw new Error(
			`The repository has ${environments.length} encrypted environments; the GitHub diff action supports at most ${ENVIRONMENT_DIFF_LIMITS.maxFilesPerSide}.`,
		)
	}

	let bytesPerComparison = 0
	for (const environment of environments) {
		const size =
			sizeOverrides.get(environment.relativePath) ?? environment.indexSize
		if (size > ENVIRONMENT_DIFF_LIMITS.maxFileBytes) {
			throw new Error(
				`Encrypted environment exceeds the GitHub diff action's file limit: ${environment.relativePath}.`,
			)
		}
		bytesPerComparison +=
			size + Buffer.byteLength(environment.relativePath, "utf-8")
	}

	// The action bounds base and head together. Requiring two copies of the
	// installed state ensures even an unchanged comparison starts within bounds.
	if (bytesPerComparison * 2 > ENVIRONMENT_DIFF_LIMITS.maxTotalBytes) {
		throw new Error(
			"Encrypted environments exceed the GitHub diff action's combined input limit.",
		)
	}
}

const parseRepositoryInfo = (output: string): RepositoryInfo => {
	let parsed: unknown
	try {
		parsed = JSON.parse(output)
	} catch {
		throw new Error("GitHub CLI returned invalid repository metadata.")
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!("nameWithOwner" in parsed) ||
		typeof parsed.nameWithOwner !== "string" ||
		!("isFork" in parsed) ||
		typeof parsed.isFork !== "boolean" ||
		!("url" in parsed) ||
		typeof parsed.url !== "string" ||
		!REPOSITORY_NAME.test(parsed.nameWithOwner)
	) {
		throw new Error("GitHub CLI returned invalid repository metadata.")
	}
	let repositoryUrl: URL
	try {
		repositoryUrl = new URL(parsed.url)
	} catch {
		throw new Error("GitHub CLI returned invalid repository metadata.")
	}
	if (
		repositoryUrl.protocol !== "https:" ||
		repositoryUrl.hostname.toLowerCase() !== "github.com" ||
		repositoryUrl.username ||
		repositoryUrl.password ||
		repositoryUrl.search ||
		repositoryUrl.hash ||
		repositoryUrl.pathname
			.replace(/^\//, "")
			.replace(/\/$/, "")
			.toLowerCase() !== parsed.nameWithOwner.toLowerCase()
	) {
		throw new Error(
			"The GitHub diff installer currently supports GitHub.com repositories only.",
		)
	}
	return {
		isFork: parsed.isFork,
		nameWithOwner: parsed.nameWithOwner,
	}
}

const listSecretNames = async (
	repository: string,
	gitRoot: string,
	runGh: InstallGithubDiffsDependencies["runGh"],
): Promise<Set<string>> => {
	const output = await runGh(
		[
			"secret",
			"list",
			"--repo",
			repository,
			"--app",
			"actions",
			"--json",
			"name",
		],
		{ cwd: gitRoot },
	)
	let parsed: unknown
	try {
		parsed = JSON.parse(output)
	} catch {
		throw new Error("GitHub CLI returned invalid secret metadata.")
	}
	if (
		!Array.isArray(parsed) ||
		!parsed.every(
			(item) =>
				typeof item === "object" &&
				item !== null &&
				"name" in item &&
				typeof item.name === "string",
		)
	) {
		throw new Error("GitHub CLI returned invalid secret metadata.")
	}
	return new Set(parsed.map((item) => item.name))
}

const resolveActionCommit = async (
	actionRef: string | undefined,
	interactive: boolean,
	gitRoot: string,
	runGh: InstallGithubDiffsDependencies["runGh"],
): Promise<string> => {
	let commit = actionRef
	if (!commit) {
		if (!interactive) {
			throw new Error(
				"Non-interactive installation requires --action-ref with a reviewed 40-character commit SHA.",
			)
		}
		try {
			commit = (
				await runGh(
					[
						"api",
						`repos/${OFFICIAL_ACTION_REPOSITORY}/commits/${OFFICIAL_ACTION_REF}`,
						"--hostname",
						"github.com",
						"--jq",
						".sha",
					],
					{ cwd: gitRoot },
				)
			).trim()
		} catch {
			throw new Error(
				"Could not resolve the official dotenc diff action v1 commit with GitHub CLI.",
			)
		}
	}

	if (!FULL_COMMIT_SHA.test(commit)) {
		throw new Error(
			"--action-ref must be a full 40-character hexadecimal commit SHA.",
		)
	}
	commit = commit.toLowerCase()

	try {
		await runGh(
			[
				"api",
				`repos/${OFFICIAL_ACTION_REPOSITORY}/contents/actions/diff/action.yml?ref=${commit}`,
				"--hostname",
				"github.com",
				"--silent",
			],
			{ cwd: gitRoot },
		)
	} catch {
		throw new Error(
			"The reviewed commit does not expose the official actions/diff implementation.",
		)
	}

	return commit
}

export const renderGithubDiffWorkflow = (actionRef: string): string => {
	if (!FULL_COMMIT_SHA.test(actionRef)) {
		throw new Error("A full 40-character commit SHA is required.")
	}
	return `# Generated by dotenc tools install-github-diffs.
# This pull_request_target job has repository secrets. Never add checkout,
# install, build, cache, or run steps that consume pull-request-controlled code.
name: Redacted dotenc diff

on:
  pull_request_target:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: dotenc-diff-\${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  dotenc-diff:
    name: Redacted dotenc environment diff
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Compare encrypted environments
        uses: dotenc/dotenc/actions/diff@${actionRef.toLowerCase()}
        with:
          github-token: \${{ github.token }}
          fail-on-error: "true"
        env:
          DOTENC_PRIVATE_KEY_BASE64: \${{ secrets.${GITHUB_DIFF_SECRET_NAME} }}
`
}

const validateEnvironmentForAction = async (
	environment: SelectedEnvironment,
): Promise<void> => {
	const report = await createEnvironmentDiffReport(
		{
			base: [],
			head: [
				{
					content: environment.content,
					path: environment.relativePath,
				},
			],
		},
		{ decryptEnvironment: async () => environment.plaintext },
	)
	const entry = report.environments[0]
	if (
		!entry ||
		entry.access.status !== "available" ||
		entry.variables.status !== "available"
	) {
		throw new Error(
			`Environment is not compatible with a complete redacted report: ${environment.relativePath}.`,
		)
	}
}

const createGeneratedPublicKeyEntry = (
	name: string,
	publicKey: crypto.KeyObject,
): PublicKeyEntry => {
	const der = publicKey.export({ type: "spki", format: "der" }) as Buffer
	return {
		algorithm: "ed25519",
		fingerprint: getKeyFingerprint(publicKey),
		name,
		publicKey,
		rawPublicKey: Buffer.from(der.subarray(der.byteLength - 32)),
	}
}

const buildGrantedEnvironment = async (
	selected: SelectedEnvironment,
	availablePublicKeys: PublicKeyEntry[],
	generatedKey: PublicKeyEntry,
): Promise<Buffer> => {
	if (
		selected.environment.keys.some(
			(key) =>
				key.name === generatedKey.name ||
				key.fingerprint === generatedKey.fingerprint,
		)
	) {
		throw new Error(
			`Environment already contains a recipient that collides with ${generatedKey.name}: ${selected.relativePath}.`,
		)
	}
	if (
		selected.environment.keys.length + 1 >
		ENVIRONMENT_DIFF_LIMITS.maxRecipientsPerEnvironment
	) {
		throw new Error(
			`Environment has no room for another recipient: ${selected.relativePath}.`,
		)
	}

	const byFingerprint = new Map(
		availablePublicKeys.map((key) => [key.fingerprint, key]),
	)
	const dataKey = createDataKey()
	try {
		const keys: Environment["keys"] = selected.environment.keys.map((key) => {
			const publicKey = byFingerprint.get(key.fingerprint)
			if (!publicKey) {
				throw new Error(
					`A public key required by ${selected.relativePath} is missing from its .dotenc directory.`,
				)
			}
			return {
				algorithm: publicKey.algorithm,
				encryptedDataKey: encryptDataKey(publicKey, dataKey).toString("base64"),
				fingerprint: key.fingerprint,
				name: key.name,
			}
		})
		keys.push({
			algorithm: generatedKey.algorithm,
			encryptedDataKey: encryptDataKey(generatedKey, dataKey).toString(
				"base64",
			),
			fingerprint: generatedKey.fingerprint,
			name: generatedKey.name,
		})

		const encryptedContent = await encryptData(
			dataKey,
			selected.plaintext,
			Buffer.from(selected.name, "utf-8"),
		)
		return Buffer.from(
			JSON.stringify(
				{
					version: 2,
					keys,
					encryptedContent: encryptedContent.toString("base64"),
				} satisfies Environment,
				null,
				2,
			),
			"utf-8",
		)
	} finally {
		dataKey.fill(0)
	}
}

const hash = (content: Buffer): string =>
	createHash("sha256").update(content).digest("hex")

const writeTemporaryFile = async (
	target: string,
	content: Buffer,
	mode: number,
): Promise<string> => {
	const temporary = path.join(
		path.dirname(target),
		`.${path.basename(target)}.dotenc-${process.pid}-${randomUUID()}.tmp`,
	)
	await fs.writeFile(temporary, content, { flag: "wx", mode })
	try {
		// writeFile creation honors the process umask; restore the requested bits
		// explicitly so replacement and rollback preserve the original mode.
		await fs.chmod(temporary, mode)
		return temporary
	} catch (error) {
		await fs.unlink(temporary).catch(() => {})
		throw error
	}
}

const atomicCreateFile = async (
	target: string,
	content: Buffer,
	mode: number,
): Promise<void> => {
	const temporary = await writeTemporaryFile(target, content, mode)
	try {
		await fs.link(temporary, target)
	} finally {
		await fs.unlink(temporary).catch(() => {})
	}
}

const atomicReplaceFile = async (
	target: string,
	content: Buffer,
	mode: number,
): Promise<void> => {
	const temporary = await writeTemporaryFile(target, content, mode)
	try {
		await fs.rename(temporary, target)
	} catch (error) {
		await fs.unlink(temporary).catch(() => {})
		throw error
	}
}

const applyCreate = async (
	filePath: string,
	content: Buffer,
	mode: number,
	changes: LocalChange[],
): Promise<void> => {
	await atomicCreateFile(filePath, content, mode)
	changes.push({ afterHash: hash(content), before: null, filePath, mode })
}

const applyReplacement = async (
	filePath: string,
	before: Buffer,
	after: Buffer,
	mode: number,
	changes: LocalChange[],
): Promise<void> => {
	const current = await fs.readFile(filePath)
	if (hash(current) !== hash(before)) {
		throw new Error(`File changed during installation: ${filePath}.`)
	}
	await atomicReplaceFile(filePath, after, mode)
	changes.push({ afterHash: hash(after), before, filePath, mode })
}

const rollbackChanges = async (
	changes: LocalChange[],
	createdDirectories: string[],
): Promise<boolean> => {
	let complete = true
	for (const change of [...changes].reverse()) {
		try {
			const current = await fs.readFile(change.filePath)
			if (hash(current) !== change.afterHash) {
				complete = false
				continue
			}
			if (change.before === null) {
				await fs.unlink(change.filePath)
			} else {
				await atomicReplaceFile(change.filePath, change.before, change.mode)
			}
		} catch {
			complete = false
		}
	}

	for (const directory of [...createdDirectories].reverse()) {
		try {
			await fs.rmdir(directory)
		} catch (error) {
			if (
				!(
					error instanceof Error &&
					"code" in error &&
					(error.code === "ENOENT" || error.code === "ENOTEMPTY")
				)
			) {
				complete = false
			}
		}
	}
	return complete
}

const createWorkflowDirectories = async (
	gitRoot: string,
	createdDirectories: string[],
): Promise<void> => {
	for (const relative of [".github", ".github/workflows"]) {
		const directory = path.join(gitRoot, ...relative.split("/"))
		const existing = await lstatIfPresent(directory)
		if (existing) {
			if (existing.isSymbolicLink() || !existing.isDirectory()) {
				throw new Error(
					`Installer directory must be a real directory: ${directory}.`,
				)
			}
			continue
		}
		await fs.mkdir(directory, { mode: 0o755 })
		createdDirectories.push(directory)
	}
}

const decodeUtf8 = (content: Buffer, relativePath: string): string => {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(content)
	} catch {
		throw new Error(
			`Encrypted environment is not valid UTF-8: ${relativePath}.`,
		)
	}
}

const prepareSelectedEnvironments = async (
	selected: TrackedEnvironment[],
	gitRoot: string,
	deps: InstallGithubDiffsDependencies,
): Promise<SelectedEnvironment[]> => {
	const status = await deps.runGit(
		[
			"status",
			"--porcelain=v1",
			"-z",
			"--untracked-files=all",
			"--",
			...selected.map((environment) =>
				literalGitPathspec(environment.relativePath),
			),
		],
		{ cwd: gitRoot },
	)
	if (status.length > 0) {
		throw new Error(
			"Selected encrypted environments must be tracked and clean before installation.",
		)
	}

	const prepared: SelectedEnvironment[] = []
	for (const environment of selected) {
		const stat = await fs.lstat(environment.absolutePath)
		if (stat.isSymbolicLink() || !stat.isFile()) {
			throw new Error(
				`Selected environment must be a real file: ${environment.relativePath}.`,
			)
		}
		const realPath = await deps.realpath(environment.absolutePath)
		if (path.resolve(realPath) !== path.resolve(environment.absolutePath)) {
			throw new Error(
				`Selected environment may not traverse a symbolic link: ${environment.relativePath}.`,
			)
		}

		const originalBytes = await fs.readFile(environment.absolutePath)
		const content = decodeUtf8(originalBytes, environment.relativePath)
		let parsed: Environment
		try {
			parsed = environmentSchema.parse(JSON.parse(content))
		} catch {
			throw new Error(
				`Selected environment is not a valid dotenc file: ${environment.relativePath}.`,
			)
		}
		let plaintext: string
		try {
			plaintext = await deps.decryptEnvironmentData(environment.name, parsed)
		} catch {
			throw new Error(
				`Could not decrypt selected environment: ${environment.relativePath}.`,
			)
		}

		let projectRoot: string
		try {
			projectRoot = await deps.realpath(
				resolveProjectRoot(environment.dir, deps.existsSync),
			)
		} catch {
			throw new Error(
				`Could not resolve a dotenc project for ${environment.relativePath}.`,
			)
		}
		if (!isWithin(gitRoot, projectRoot)) {
			throw new Error(
				`The dotenc project for ${environment.relativePath} escapes the Git repository.`,
			)
		}
		await assertSafeDirectory(path.join(projectRoot, ".dotenc"))

		const item: SelectedEnvironment = {
			...environment,
			content,
			environment: parsed,
			originalBytes,
			originalMode: stat.mode & 0o777,
			plaintext,
			projectRoot,
		}
		await validateEnvironmentForAction(item)
		prepared.push(item)
	}
	return prepared
}

const chooseEnvironments = async (
	options: InstallGithubDiffsOptions,
	candidates: TrackedEnvironment[],
	interactive: boolean,
	deps: InstallGithubDiffsDependencies,
): Promise<TrackedEnvironment[]> => {
	const requested = options.environment ?? []
	if (options.all && requested.length > 0) {
		throw new Error("Options --all and --environment are mutually exclusive.")
	}

	let paths: string[]
	if (options.all) {
		paths = candidates.map((candidate) => candidate.relativePath)
	} else if (requested.length > 0) {
		paths = requested.map(normalizeEnvironmentArgument)
	} else {
		if (!interactive) {
			throw new Error(
				"Non-interactive installation requires --environment <path> or --all.",
			)
		}
		paths = await deps.promptMultiSelect(
			"Which encrypted environments may expose redacted diffs to pull-request authors?",
			{
				initial: [],
				nonInteractiveError:
					"Pass --environment <path> or --all in non-interactive mode.",
				options: candidates.map((candidate) => ({
					label: candidate.relativePath,
					value: candidate.relativePath,
				})),
				required: true,
			},
		)
	}

	const uniquePaths = [...new Set(paths)]
	if (uniquePaths.length === 0) {
		throw new Error("Select at least one encrypted environment.")
	}
	const byPath = new Map(
		candidates.map((candidate) => [candidate.relativePath, candidate]),
	)
	return uniquePaths.map((relativePath) => {
		assertActionPath(relativePath)
		const environment = byPath.get(relativePath)
		if (!environment) {
			throw new Error(
				`Encrypted environment is not tracked in this dotenc project: ${relativePath}.`,
			)
		}
		return environment
	})
}

export const installGithubDiffs = async (
	options: InstallGithubDiffsOptions = {},
	dependencyOverrides: Partial<InstallGithubDiffsDependencies> = {},
): Promise<InstallGithubDiffsResult> => {
	const deps = { ...defaultDependencies, ...dependencyOverrides }
	const interactive = deps.isInteractive()
	if (!interactive && !options.yes) {
		throw new Error("Non-interactive installation requires --yes.")
	}

	const keyName = options.keyName ?? GITHUB_DIFF_DEFAULT_KEY_NAME
	const keyValidation = validateKeyName(keyName)
	if (!keyValidation.valid) throw new Error(keyValidation.reason)
	if (options.repo && !REPOSITORY_NAME.test(options.repo)) {
		throw new Error("--repo must use the owner/repository format.")
	}

	const cwd = await deps.realpath(options.cwd ?? process.cwd())
	let projectRoot: string
	try {
		projectRoot = await deps.realpath(resolveProjectRoot(cwd, deps.existsSync))
	} catch {
		throw new Error('Not in a dotenc project. Run "dotenc init" first.')
	}
	await assertSafeDirectory(path.join(projectRoot, ".dotenc"))

	let gitRoot: string
	try {
		const resolved = (
			await deps.runGit(["rev-parse", "--show-toplevel"], { cwd })
		).trim()
		gitRoot = await deps.realpath(resolved)
	} catch {
		throw new Error("Could not resolve the containing Git repository.")
	}
	if (!isWithin(gitRoot, projectRoot)) {
		throw new Error(
			"The dotenc project is not inside the resolved Git repository.",
		)
	}

	let tracked: TrackedEnvironment[]
	try {
		const index = await deps.runGit(
			[
				"ls-files",
				"--stage",
				"-z",
				"--",
				":(glob).env.*.enc",
				":(glob)**/.env.*.enc",
			],
			{ cwd: gitRoot },
		)
		tracked = await loadIndexSizes(
			parseTrackedEnvironments(index, gitRoot),
			gitRoot,
			deps.runGit,
		)
	} catch (error) {
		if (error instanceof Error) throw error
		throw new Error("Could not inspect encrypted environments in Git.")
	}
	assertRepositoryLimits(tracked)

	const candidates = tracked.filter((environment) =>
		isWithin(projectRoot, environment.absolutePath),
	)
	if (candidates.length === 0) {
		throw new Error(
			"No tracked encrypted environments were found in this project.",
		)
	}
	const selectedTracked = await chooseEnvironments(
		options,
		candidates,
		interactive,
		deps,
	)
	const selected = await prepareSelectedEnvironments(
		selectedTracked,
		gitRoot,
		deps,
	)

	const projectRoots = [...new Set(selected.map((item) => item.projectRoot))]
	const keyPaths = projectRoots.map((root) =>
		path.join(root, ".dotenc", `${keyName}.pub`),
	)
	const workflowPath = path.join(
		gitRoot,
		...GITHUB_DIFF_WORKFLOW_PATH.split("/"),
	)
	await assertInstallTargetsAbsentFromGit(
		[
			...keyPaths.map((keyPath) =>
				toRepositoryPath(path.relative(gitRoot, keyPath)),
			),
			GITHUB_DIFF_WORKFLOW_PATH,
		],
		gitRoot,
		deps.runGit,
	)
	for (const keyPath of keyPaths) {
		if (await lstatIfPresent(keyPath)) {
			throw new Error(
				`Public key already exists; refusing to overwrite it: ${keyPath}.`,
			)
		}
	}

	const publicKeysByRoot = new Map<string, PublicKeyEntry[]>()
	for (const root of projectRoots) {
		const publicKeys = await deps.getPublicKeys(path.join(root, ".dotenc"))
		publicKeysByRoot.set(root, publicKeys)
	}
	for (const environment of selected) {
		const fingerprints = new Set(
			(publicKeysByRoot.get(environment.projectRoot) ?? []).map(
				(key) => key.fingerprint,
			),
		)
		if (
			environment.environment.keys.some(
				(recipient) => !fingerprints.has(recipient.fingerprint),
			)
		) {
			throw new Error(
				`A current recipient public key is missing for ${environment.relativePath}; installation would revoke access.`,
			)
		}
	}

	await assertSafeDirectory(path.join(gitRoot, ".github"))
	await assertSafeDirectory(path.join(gitRoot, ".github", "workflows"))
	if (await lstatIfPresent(workflowPath)) {
		throw new Error(
			`Workflow already exists; refusing to overwrite it: ${GITHUB_DIFF_WORKFLOW_PATH}.`,
		)
	}

	let repositoryInfo: RepositoryInfo
	let repositoryMetadata: string
	try {
		repositoryMetadata = await deps.runGh(
			["repo", "view", "--json", "nameWithOwner,isFork,url"],
			{
				cwd: gitRoot,
			},
		)
	} catch {
		throw new Error(
			"Could not resolve the authenticated GitHub repository. Install and authenticate gh, then retry.",
		)
	}
	repositoryInfo = parseRepositoryInfo(repositoryMetadata)
	if (
		options.repo &&
		options.repo.toLowerCase() !== repositoryInfo.nameWithOwner.toLowerCase()
	) {
		throw new Error(
			`--repo does not match the repository resolved from this Git checkout (${repositoryInfo.nameWithOwner}).`,
		)
	}
	if (repositoryInfo.isFork && !options.allowFork) {
		throw new Error(
			"The GitHub repository is a fork. Pass --allow-fork only if secrets should be available to pull requests targeting this fork.",
		)
	}

	let secretNames: Set<string>
	try {
		secretNames = await listSecretNames(
			repositoryInfo.nameWithOwner,
			gitRoot,
			deps.runGh,
		)
	} catch {
		throw new Error(
			"Could not inspect GitHub Actions repository secrets. Repository administration access is required.",
		)
	}
	if (secretNames.has(GITHUB_DIFF_SECRET_NAME)) {
		throw new Error(
			`GitHub Actions secret ${GITHUB_DIFF_SECRET_NAME} already exists; refusing to overwrite it.`,
		)
	}

	const actionRef = await resolveActionCommit(
		options.actionRef,
		interactive,
		gitRoot,
		deps.runGh,
	)
	const workflow = Buffer.from(renderGithubDiffWorkflow(actionRef), "utf-8")

	deps.log("")
	deps.log(`GitHub repository: ${repositoryInfo.nameWithOwner}`)
	deps.log(`Workflow: ${GITHUB_DIFF_WORKFLOW_PATH}`)
	deps.log(`Dedicated secret: ${GITHUB_DIFF_SECRET_NAME}`)
	deps.log(`Public identity: ${keyName}`)
	deps.log("Environments granted redacted-diff access:")
	for (const environment of selected)
		deps.log(`  - ${environment.relativePath}`)
	deps.log(`Action commit: ${actionRef}`)
	deps.log(
		`Review: https://github.com/${OFFICIAL_ACTION_REPOSITORY}/commit/${actionRef}`,
	)
	deps.log(
		"Security note: pull-request authors can observe variable names, access changes, and a changed/unchanged equality signal for granted environments.",
	)

	if (!options.yes) {
		const confirmed = await deps.promptConfirm(
			"Install this dedicated GitHub diff identity and workflow?",
			{
				initial: false,
				nonInteractiveError: "Pass --yes in non-interactive mode.",
			},
		)
		if (!confirmed) return { status: "cancelled" }
	}

	const { privateKey, publicKey } = deps.createKeyPair()
	if (publicKey.asymmetricKeyType !== "ed25519") {
		throw new Error(
			"The installer key generator did not return an Ed25519 key.",
		)
	}
	const publicPem = Buffer.from(
		publicKey.export({ type: "spki", format: "pem" }).toString(),
		"utf-8",
	)
	const privatePem = Buffer.from(
		privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		"utf-8",
	)
	const encodedPrivateKey = Buffer.from(privatePem.toString("base64"), "ascii")
	const generatedPublicKey = createGeneratedPublicKeyEntry(keyName, publicKey)
	const environmentOutputs = new Map<string, Buffer>()
	const sizeOverrides = new Map<string, number>()
	try {
		for (const environment of selected) {
			const output = await buildGrantedEnvironment(
				environment,
				publicKeysByRoot.get(environment.projectRoot) ?? [],
				generatedPublicKey,
			)
			environmentOutputs.set(environment.relativePath, output)
			sizeOverrides.set(environment.relativePath, output.byteLength)
		}
		assertRepositoryLimits(tracked, sizeOverrides)

		const changes: LocalChange[] = []
		const createdDirectories: string[] = []
		let secretUploadStarted = false
		try {
			for (const keyPath of keyPaths) {
				await applyCreate(keyPath, publicPem, 0o644, changes)
			}
			for (const environment of selected) {
				const output = environmentOutputs.get(environment.relativePath)
				if (!output) throw new Error("Missing prepared environment output.")
				await applyReplacement(
					environment.absolutePath,
					environment.originalBytes,
					output,
					environment.originalMode,
					changes,
				)
			}
			await createWorkflowDirectories(gitRoot, createdDirectories)
			await applyCreate(workflowPath, workflow, 0o644, changes)

			let currentSecrets: Set<string>
			try {
				currentSecrets = await listSecretNames(
					repositoryInfo.nameWithOwner,
					gitRoot,
					deps.runGh,
				)
			} catch {
				throw new Error(
					"Could not recheck GitHub Actions secrets before upload.",
				)
			}
			if (currentSecrets.has(GITHUB_DIFF_SECRET_NAME)) {
				throw new Error(
					`GitHub Actions secret ${GITHUB_DIFF_SECRET_NAME} appeared during installation; refusing to overwrite it.`,
				)
			}

			secretUploadStarted = true
			await deps.runGh(
				[
					"secret",
					"set",
					GITHUB_DIFF_SECRET_NAME,
					"--repo",
					repositoryInfo.nameWithOwner,
					"--app",
					"actions",
				],
				{
					cwd: gitRoot,
					input: encodedPrivateKey,
					sensitiveInput: true,
				},
			)

			return {
				actionRef,
				environments: selected.map((item) => item.relativePath),
				keyPaths: keyPaths.map((keyPath) =>
					toRepositoryPath(path.relative(gitRoot, keyPath)),
				),
				repository: repositoryInfo.nameWithOwner,
				secretName: GITHUB_DIFF_SECRET_NAME,
				status: "installed",
				workflowPath: GITHUB_DIFF_WORKFLOW_PATH,
			}
		} catch (error) {
			if (secretUploadStarted) {
				try {
					const secretsAfterFailure = await listSecretNames(
						repositoryInfo.nameWithOwner,
						gitRoot,
						deps.runGh,
					)
					if (secretsAfterFailure.has(GITHUB_DIFF_SECRET_NAME)) {
						throw new Error(
							`GitHub did not confirm the upload, but ${GITHUB_DIFF_SECRET_NAME} now exists. Local changes were preserved because the remote secret value cannot be verified; rotate or remove that secret before retrying.`,
						)
					}
				} catch (verificationError) {
					if (
						verificationError instanceof Error &&
						verificationError.message.includes("now exists")
					) {
						throw verificationError
					}
					throw new Error(
						`GitHub did not confirm the ${GITHUB_DIFF_SECRET_NAME} upload and its remote state is unknown. Local changes were preserved; inspect the repository secret before retrying.`,
					)
				}
			}

			const rolledBack = await rollbackChanges(changes, createdDirectories)
			if (!rolledBack) {
				throw new Error(
					"GitHub diff installation failed and rollback could not safely restore every local path. Inspect the reported files before retrying.",
				)
			}
			throw error
		}
	} finally {
		privatePem.fill(0)
		encodedPrivateKey.fill(0)
	}
}
