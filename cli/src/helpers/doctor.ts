import crypto from "node:crypto"
import { constants, type Dirent } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Environment } from "../schemas/environment"
import { ENVIRONMENT_DIFF_LIMITS } from "../schemas/environmentDiffReport"
import { buildAncestorChain } from "./buildAncestorChain"
import { decryptDataKey } from "./decryptDataKey"
import {
	createEnvironmentAccessProbeContext,
	type EnvironmentAccessProbeContext,
	type EnvironmentAccessProbeResult,
	environmentDataKeysEqual,
	probeEnvironmentAccess,
} from "./decryptEnvironment"
import {
	type DoctorGitDeletion,
	DoctorGitInspector,
	isSafeDoctorRelativePath,
} from "./doctorGit"
import {
	addEnvironmentLayer,
	encryptedEnvironmentNameFromFileName,
	isPersonalEnvironmentName,
} from "./environmentProfileSemantics"
import { DOTENC_RECURSIVE_IGNORED_DIRS } from "./findEnvironmentsRecursive"
import { getKeyFingerprint } from "./getKeyFingerprint"
import { type GetPrivateKeysResult, getPrivateKeys } from "./getPrivateKeys"
import { homeConfigSchema } from "./homeConfig"
import {
	type OnePasswordLocatorProbeResult,
	probeOnePasswordLocator,
} from "./onePasswordLocatorCache"
import { parseEnvironmentDocument } from "./parseEnvironmentDocument"
import { parseSpkiPublicKey } from "./parseSpkiPublicKey"
import {
	DOTENC_DIFF_CACHE_TEXTCONV,
	DOTENC_DIFF_TEXTCONV,
} from "./setupGitDiff"
import { validateEnvironmentName } from "./validateEnvironmentName"
import { validateKeyName } from "./validateKeyName"
import { validatePublicKey } from "./validatePublicKey"

export const DOCTOR_REPORT_SCHEMA_VERSION = 1 as const

const MAX_PUBLIC_KEY_BYTES = 64 * 1024
const MAX_PRIVATE_KEY_BYTES = 1024 * 1024
const MAX_PROJECT_PUBLIC_KEYS = 512
const MAX_DIRECTORY_ENTRIES = 10_000
const MAX_EFFECTIVE_DIRECTORIES = 64
const MAX_RECURSIVE_DIRECTORIES = 10_000
const MAX_RECURSIVE_ENTRIES = 50_000
const MAX_DOCTOR_ENVELOPES = ENVIRONMENT_DIFF_LIMITS.maxFilesPerSide
const MAX_DOCTOR_PLAINTEXT_PATHS = ENVIRONMENT_DIFF_LIMITS.maxFilesPerSide
const MAX_PROVIDER_LOCATOR_PROBES = 1024
const MAX_HISTORY_PATHS = 8
const PERSONAL_FILE_PATTERN = /^\.env\.(personal\.(.+))\.enc$/
const PLAINTEXT_TEMPLATE_SUFFIX = /\.(?:example|sample|template)$/i

export type DoctorSeverity = "error" | "warning" | "info"

export type DoctorFindingId =
	| "invocation.invalid"
	| "project.not-found"
	| "project.invalid-dotenc-directory"
	| "scan.incomplete"
	| "key.none"
	| "key.invalid"
	| "key.duplicate-fingerprint"
	| "key.no-active-match"
	| "key.private-unusable"
	| "key.provider-cached"
	| "development.missing"
	| "development.corrupt"
	| "development.inaccessible"
	| "development.local-key-inconclusive"
	| "development.provider-inconclusive"
	| "personal.none"
	| "personal.multiple-accessible"
	| "personal.deleted"
	| "personal.missing"
	| "personal.corrupt"
	| "personal.inaccessible"
	| "personal.local-key-inconclusive"
	| "personal.provider-inconclusive"
	| "legacy.candidate"
	| "legacy.partial-rename"
	| "legacy.collision"
	| "git.unavailable"
	| "git.status-incomplete"
	| "git.history-unavailable"
	| "git.diff-driver"
	| "git.textconv-cache"
	| "git.attributes"
	| "plaintext.tracked"
	| "plaintext.unignored"
	| "plaintext.present"
	| "plaintext.unsafe"
	| "config.unsafe"
	| "config.permissions"
	| "config.invalid"
	| "config.permissions-unverified"
	| "repository.envelope-invalid"
	| "repository.recipient-orphaned"
	| "repository.recipient-stale-alias"
	| "repository.recipient-algorithm"

export type DoctorFinding = {
	id: DoctorFindingId
	severity: DoctorSeverity
	subject: string
	message: string
	paths?: string[]
	commands?: string[][]
}

export type DoctorPassedCheck = {
	id: string
	subject: string
	message: string
	paths?: string[]
}

export type DoctorReport = {
	schemaVersion: typeof DOCTOR_REPORT_SCHEMA_VERSION
	command: "doctor"
	complete: boolean
	scope: {
		mode: "effective" | "local" | "all"
		profile?: string
	}
	project?: {
		root: "."
		invocation: string
	}
	findings: DoctorFinding[]
	passed: DoctorPassedCheck[]
	summary: {
		errors: number
		warnings: number
		info: number
		passed: number
	}
	exitCode: 0 | 1 | 2
}

export type DoctorOptions = {
	invocationDir?: string
	profile?: string
	localOnly?: boolean
	all?: boolean
	strict?: boolean
}

type DoctorGit = Pick<
	DoctorGitInspector,
	| "isRepository"
	| "isShallow"
	| "deletedPaths"
	| "configValues"
	| "configBooleanValues"
	| "attributeValues"
	| "trackedPaths"
	| "ignoredPaths"
	| "latestValidRevision"
>

export type DoctorProjectResolution =
	| { status: "found"; projectRoot: string }
	| { status: "not-found" }
	| { status: "incomplete" }

const resolveDoctorProjectRoot = async (
	startDir: string,
	homeDir: string,
): Promise<DoctorProjectResolution> => {
	let dir = path.resolve(startDir)
	const normalizedHome = path.resolve(homeDir)
	while (true) {
		if (dir !== normalizedHome) {
			try {
				await fs.lstat(path.join(dir, ".dotenc"))
				return { status: "found", projectRoot: dir }
			} catch (error) {
				if (
					!(
						error instanceof Error &&
						"code" in error &&
						(error as NodeJS.ErrnoException).code === "ENOENT"
					)
				) {
					return { status: "incomplete" }
				}
			}
		}
		const parent = path.dirname(dir)
		if (parent === dir) return { status: "not-found" }
		dir = parent
	}
}

export type DoctorDependencies = {
	resolveProjectRoot: (
		startDir: string,
		homeDir: string,
	) => Promise<DoctorProjectResolution>
	buildAncestorChain: typeof buildAncestorChain
	getPrivateKeys: typeof getPrivateKeys
	probeEnvironmentAccess: typeof probeEnvironmentAccess
	probeOnePasswordLocator: typeof probeOnePasswordLocator
	createGitInspector: (projectRoot: string) => DoctorGit
	homedir: () => string
	platform: NodeJS.Platform
}

const defaultDependencies: DoctorDependencies = {
	resolveProjectRoot: resolveDoctorProjectRoot,
	buildAncestorChain,
	getPrivateKeys,
	probeEnvironmentAccess,
	probeOnePasswordLocator,
	createGitInspector: (projectRoot) => new DoctorGitInspector(projectRoot),
	homedir: os.homedir,
	platform: process.platform,
}

export class DoctorInvocationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "DoctorInvocationError"
	}
}

type ProjectPublicKey = {
	alias: string
	filePath: string
	fingerprint: string
	algorithm: "rsa" | "ed25519"
}

type EnvelopeInspection =
	| { status: "valid"; environment: Environment }
	| { status: "invalid" }
	| { status: "incomplete" }

type EnvelopeInspectionCache = {
	entries: Map<string, Promise<EnvelopeInspection>>
	files: number
	bytes: number
}

type BoundedReadResult =
	| { status: "ok"; data: Buffer }
	| { status: "missing" }
	| { status: "unsafe" }
	| { status: "too-large" }
	| { status: "io-failure" }

type ScopeFiles = {
	layersByName: Map<string, string[]>
	invalidEnvironmentPaths: Set<string>
	plaintextPaths: Set<string>
	unsafePlaintextPaths: Set<string>
	complete: boolean
}

type RecursiveScan = ScopeFiles & {
	environmentPaths: Set<string>
	incompletePaths: string[]
	limitExceeded: boolean
}

type ReportState = {
	complete: boolean
	findings: DoctorFinding[]
	passed: DoctorPassedCheck[]
}

const finding = (
	state: ReportState,
	id: DoctorFindingId,
	severity: DoctorSeverity,
	subject: string,
	message: string,
	options: Pick<DoctorFinding, "paths" | "commands"> = {},
) => {
	state.findings.push({ id, severity, subject, message, ...options })
}

const passed = (
	state: ReportState,
	id: string,
	subject: string,
	message: string,
	paths?: string[],
) => {
	state.passed.push({ id, subject, message, ...(paths ? { paths } : {}) })
}

const markIncomplete = (
	state: ReportState,
	message: string,
	paths?: string[],
) => {
	state.complete = false
	finding(state, "scan.incomplete", "warning", "scan", message, { paths })
}

const normalizeRelativePath = (projectRoot: string, filePath: string) => {
	const relative = path
		.relative(projectRoot, filePath)
		.split(path.sep)
		.join("/")
	if (!relative) return "."
	return isSafeDoctorRelativePath(relative) ? relative : undefined
}

const normalizeReportPaths = (
	projectRoot: string,
	filePaths: string[],
	state: ReportState,
	message: string,
) => {
	const relativePaths = filePaths
		.map((filePath) => normalizeRelativePath(projectRoot, filePath))
		.filter((filePath): filePath is string => filePath !== undefined)
	if (relativePaths.length !== filePaths.length) markIncomplete(state, message)
	return relativePaths
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
	`${count} ${count === 1 ? singular : pluralForm}`

const isPlaintextEnvironmentFile = (fileName: string) => {
	if (fileName === ".env") return true
	if (!fileName.startsWith(".env.") || fileName.endsWith(".enc")) return false
	return !PLAINTEXT_TEMPLATE_SUFFIX.test(fileName)
}

const hasErrnoCode = (error: unknown, code: string) =>
	error instanceof Error &&
	"code" in error &&
	(error as NodeJS.ErrnoException).code === code

const readBoundedRegularFile = async (
	filePath: string,
	maximumBytes: number,
): Promise<BoundedReadResult> => {
	let pathStat: Awaited<ReturnType<typeof fs.lstat>>
	try {
		pathStat = await fs.lstat(filePath)
	} catch (error) {
		return hasErrnoCode(error, "ENOENT")
			? { status: "missing" }
			: { status: "io-failure" }
	}
	if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
		return { status: "unsafe" }
	}
	if (pathStat.size > maximumBytes) return { status: "too-large" }

	const noFollow = constants.O_NOFOLLOW ?? 0
	const nonBlock = constants.O_NONBLOCK ?? 0
	let handle: Awaited<ReturnType<typeof fs.open>>
	try {
		handle = await fs.open(filePath, constants.O_RDONLY | noFollow | nonBlock)
	} catch {
		return { status: "io-failure" }
	}

	const input = Buffer.alloc(maximumBytes + 1)
	let offset = 0
	try {
		try {
			const openedStat = await handle.stat()
			if (
				!openedStat.isFile() ||
				openedStat.dev !== pathStat.dev ||
				openedStat.ino !== pathStat.ino
			) {
				return { status: "unsafe" }
			}
			if (openedStat.size > maximumBytes) return { status: "too-large" }
			while (offset < input.byteLength) {
				const { bytesRead } = await handle.read(
					input,
					offset,
					input.byteLength - offset,
					null,
				)
				if (bytesRead === 0) break
				offset += bytesRead
			}
		} catch {
			return { status: "io-failure" }
		}
		if (offset > maximumBytes) return { status: "too-large" }
		return { status: "ok", data: Buffer.from(input.subarray(0, offset)) }
	} finally {
		input.fill(0)
		try {
			await handle.close()
		} catch {}
	}
}

type BoundedDirectoryResult =
	| { status: "ok"; entries: Dirent<string>[] }
	| { status: "incomplete"; entries: [] }

const hasKnownDirentType = (entry: Dirent<string>) =>
	entry.isFile() ||
	entry.isDirectory() ||
	entry.isSymbolicLink() ||
	entry.isBlockDevice() ||
	entry.isCharacterDevice() ||
	entry.isFIFO() ||
	entry.isSocket()

const readBoundedDirectory = async (
	directory: string,
	maximumEntries: number,
): Promise<BoundedDirectoryResult> => {
	let handle: Awaited<ReturnType<typeof fs.opendir>>
	try {
		handle = await fs.opendir(directory)
	} catch {
		return { status: "incomplete", entries: [] }
	}

	const entries: Dirent<string>[] = []
	try {
		while (entries.length <= maximumEntries) {
			const entry = await handle.read()
			if (!entry) break
			if (entries.length === maximumEntries) {
				return { status: "incomplete", entries: [] }
			}
			entries.push(entry)
		}
	} catch {
		return { status: "incomplete", entries: [] }
	} finally {
		try {
			await handle.close()
		} catch {}
	}

	return {
		status: "ok",
		entries: entries.sort((left, right) => left.name.localeCompare(right.name)),
	}
}

const inspectEnvelope = async (
	filePath: string,
	cache: EnvelopeInspectionCache,
): Promise<EnvelopeInspection> => {
	const input = await readBoundedRegularFile(
		filePath,
		ENVIRONMENT_DIFF_LIMITS.maxFileBytes,
	)
	if (input.status === "missing" || input.status === "io-failure") {
		return { status: "incomplete" }
	}
	if (input.status === "too-large") return { status: "incomplete" }
	if (input.status !== "ok") return { status: "invalid" }
	if (
		cache.files >= MAX_DOCTOR_ENVELOPES ||
		cache.bytes + input.data.byteLength > ENVIRONMENT_DIFF_LIMITS.maxTotalBytes
	) {
		input.data.fill(0)
		return { status: "incomplete" }
	}
	cache.files += 1
	cache.bytes += input.data.byteLength
	try {
		const source = new TextDecoder("utf-8", { fatal: true }).decode(input.data)
		return { status: "valid", environment: parseEnvironmentDocument(source) }
	} catch {
		return { status: "invalid" }
	} finally {
		input.data.fill(0)
	}
}

const inspectCachedEnvelope = (
	filePath: string,
	cache: EnvelopeInspectionCache,
) => {
	let inspection = cache.entries.get(filePath)
	if (!inspection) {
		inspection = inspectEnvelope(filePath, cache)
		cache.entries.set(filePath, inspection)
	}
	return inspection
}

const inspectPublicKeys = async (
	projectRoot: string,
	state: ReportState,
): Promise<{ keys: ProjectPublicKey[]; complete: boolean }> => {
	const dotencDir = path.join(projectRoot, ".dotenc")
	const directory = await readBoundedDirectory(dotencDir, MAX_DIRECTORY_ENTRIES)
	if (directory.status === "incomplete") {
		markIncomplete(state, "Project public keys could not be inspected.")
		return { keys: [], complete: false }
	}

	const publicKeyEntries = directory.entries.filter((entry) =>
		entry.name.endsWith(".pub"),
	)
	if (publicKeyEntries.length > MAX_PROJECT_PUBLIC_KEYS) {
		markIncomplete(
			state,
			`Project public-key count exceeds the diagnostic limit of ${MAX_PROJECT_PUBLIC_KEYS}.`,
		)
		return { keys: [], complete: false }
	}

	const keys: ProjectPublicKey[] = []
	let complete = true
	for (const entry of publicKeyEntries) {
		const alias = entry.name.slice(0, -4)
		const relativePath = `.dotenc/${entry.name}`
		if (!isSafeDoctorRelativePath(relativePath)) {
			complete = false
			markIncomplete(
				state,
				"A project public-key filename cannot be rendered safely.",
			)
			finding(
				state,
				"key.invalid",
				"error",
				"public key",
				"A project public-key filename cannot be rendered safely.",
			)
			continue
		}
		if (!validateKeyName(alias).valid) {
			complete = false
			finding(
				state,
				"key.invalid",
				"error",
				alias || "public key",
				"Project public key has an invalid alias.",
				{ paths: [relativePath] },
			)
			continue
		}

		const input = await readBoundedRegularFile(
			path.join(dotencDir, entry.name),
			MAX_PUBLIC_KEY_BYTES,
		)
		if (input.status === "missing" || input.status === "io-failure") {
			complete = false
			markIncomplete(
				state,
				"A project public key could not be read completely.",
				[relativePath],
			)
			continue
		}
		if (input.status === "too-large") {
			complete = false
			markIncomplete(
				state,
				"A project public key exceeds the diagnostic size limit.",
				[relativePath],
			)
			continue
		}
		if (input.status !== "ok") {
			complete = false
			finding(
				state,
				"key.invalid",
				"error",
				alias,
				"Project public key is unreadable, unsafe, or exceeds the size limit.",
				{ paths: [relativePath] },
			)
			continue
		}

		try {
			const publicKey = parseSpkiPublicKey(
				new TextDecoder("utf-8", { fatal: true }).decode(input.data),
			)
			const validation = validatePublicKey(publicKey)
			if (!validation.valid) {
				complete = false
				finding(state, "key.invalid", "error", alias, validation.reason, {
					paths: [relativePath],
				})
				continue
			}
			const algorithm = publicKey.asymmetricKeyType
			if (algorithm !== "rsa" && algorithm !== "ed25519") {
				complete = false
				finding(
					state,
					"key.invalid",
					"error",
					alias,
					"Project public key uses an unsupported algorithm.",
					{ paths: [relativePath] },
				)
				continue
			}
			keys.push({
				alias,
				filePath: relativePath,
				fingerprint: getKeyFingerprint(publicKey),
				algorithm,
			})
		} catch {
			complete = false
			finding(
				state,
				"key.invalid",
				"error",
				alias,
				"Project public key is not a canonical public SPKI key.",
				{ paths: [relativePath] },
			)
		} finally {
			input.data.fill(0)
		}
	}

	if (publicKeyEntries.length === 0) {
		finding(
			state,
			"key.none",
			"error",
			"project keys",
			"No project public keys were found.",
		)
	} else if (complete && keys.length > 0) {
		passed(
			state,
			"keys.valid",
			"project keys",
			`${plural(keys.length, "valid public key")}.`,
		)
	}

	const aliasesByFingerprint = new Map<string, ProjectPublicKey[]>()
	for (const key of keys) {
		const aliases = aliasesByFingerprint.get(key.fingerprint) ?? []
		aliases.push(key)
		aliasesByFingerprint.set(key.fingerprint, aliases)
	}
	for (const duplicateAliases of [...aliasesByFingerprint.values()]
		.filter((aliases) => aliases.length > 1)
		.sort((left, right) => left[0].alias.localeCompare(right[0].alias))) {
		finding(
			state,
			"key.duplicate-fingerprint",
			"info",
			duplicateAliases.map((key) => key.alias).join(", "),
			"Public-key aliases share one fingerprint; aliases remain display metadata only.",
			{ paths: duplicateAliases.map((key) => key.filePath).sort() },
		)
	}

	return { keys, complete }
}

const usablePrivateKeys = (
	privateKeys: GetPrivateKeysResult,
): GetPrivateKeysResult => {
	const fingerprints = new Set<string>()
	const keys = privateKeys.keys.filter((entry) => {
		if (fingerprints.has(entry.fingerprint)) return false
		if (!validatePublicKey(crypto.createPublicKey(entry.privateKey)).valid) {
			return false
		}
		fingerprints.add(entry.fingerprint)
		return true
	})
	return { ...privateKeys, keys }
}

const inspectEffectiveFiles = async (
	dirs: string[],
	state: ReportState,
): Promise<ScopeFiles> => {
	const layersByName = new Map<string, string[]>()
	const invalidEnvironmentPaths = new Set<string>()
	const plaintextPaths = new Set<string>()
	const unsafePlaintextPaths = new Set<string>()
	let environmentCount = 0
	let plaintextCount = 0
	let complete = true
	let environmentLimitReported = false
	let plaintextLimitReported = false

	for (const dir of dirs) {
		const directory = await readBoundedDirectory(dir, MAX_DIRECTORY_ENTRIES)
		if (directory.status === "incomplete") {
			markIncomplete(state, "An effective environment directory is unreadable.")
			complete = false
			continue
		}

		for (const entry of directory.entries) {
			const filePath = path.join(dir, entry.name)
			const environmentName = encryptedEnvironmentNameFromFileName(entry.name)
			if (environmentName) {
				environmentCount += 1
				if (environmentCount > MAX_DOCTOR_ENVELOPES) {
					complete = false
					if (!environmentLimitReported) {
						environmentLimitReported = true
						markIncomplete(
							state,
							`Effective environment count exceeds the diagnostic limit of ${MAX_DOCTOR_ENVELOPES}.`,
						)
					}
					continue
				}
				if (!isSafeDoctorRelativePath(entry.name)) {
					complete = false
					markIncomplete(
						state,
						"An encrypted environment filename cannot be rendered safely.",
					)
					continue
				}
				if (!validateEnvironmentName(environmentName).valid) {
					invalidEnvironmentPaths.add(filePath)
					continue
				}
				addEnvironmentLayer(layersByName, environmentName, filePath)
				continue
			}
			if (!isPlaintextEnvironmentFile(entry.name)) continue
			plaintextCount += 1
			if (plaintextCount > MAX_DOCTOR_PLAINTEXT_PATHS) {
				complete = false
				if (!plaintextLimitReported) {
					plaintextLimitReported = true
					markIncomplete(
						state,
						`Plaintext environment path count exceeds the diagnostic limit of ${MAX_DOCTOR_PLAINTEXT_PATHS}.`,
					)
				}
				continue
			}
			let regularFile = entry.isFile()
			if (!hasKnownDirentType(entry)) {
				try {
					regularFile = (await fs.lstat(filePath)).isFile()
				} catch {
					complete = false
					markIncomplete(
						state,
						"A plaintext environment path type could not be inspected.",
					)
					continue
				}
			}
			if (regularFile) plaintextPaths.add(filePath)
			else unsafePlaintextPaths.add(filePath)
		}
	}

	return {
		layersByName,
		invalidEnvironmentPaths,
		plaintextPaths,
		unsafePlaintextPaths,
		complete,
	}
}

const scanRepository = async (projectRoot: string): Promise<RecursiveScan> => {
	const environmentPaths = new Set<string>()
	const plaintextPaths = new Set<string>()
	const unsafePlaintextPaths = new Set<string>()
	const layersByName = new Map<string, string[]>()
	const invalidEnvironmentPaths = new Set<string>()
	const incompletePaths: string[] = []
	let directoryCount = 0
	let entryCount = 0
	let limitExceeded = false
	const recordIncompletePath = (filePath: string) => {
		if (incompletePaths.length >= MAX_DOCTOR_PLAINTEXT_PATHS) {
			limitExceeded = true
			return
		}
		const relative = normalizeRelativePath(projectRoot, filePath)
		if (relative) incompletePaths.push(relative)
		else limitExceeded = true
	}

	const walk = async (dir: string): Promise<void> => {
		if (limitExceeded) return
		directoryCount += 1
		if (directoryCount > MAX_RECURSIVE_DIRECTORIES) {
			limitExceeded = true
			return
		}

		const directory = await readBoundedDirectory(dir, MAX_DIRECTORY_ENTRIES)
		if (directory.status === "incomplete") {
			recordIncompletePath(dir)
			return
		}

		for (const entry of directory.entries) {
			if (limitExceeded) return
			entryCount += 1
			if (entryCount > MAX_RECURSIVE_ENTRIES) {
				limitExceeded = true
				return
			}
			const filePath = path.join(dir, entry.name)
			const environmentName = encryptedEnvironmentNameFromFileName(entry.name)
			let directoryEntry = entry.isDirectory()
			let regularFile = entry.isFile()
			if (!hasKnownDirentType(entry)) {
				try {
					const entryStat = await fs.lstat(filePath)
					directoryEntry = entryStat.isDirectory()
					regularFile = entryStat.isFile()
				} catch {
					recordIncompletePath(filePath)
					continue
				}
			}
			if (directoryEntry) {
				if (environmentName) {
					if (environmentPaths.size >= MAX_DOCTOR_ENVELOPES) {
						limitExceeded = true
						return
					}
					environmentPaths.add(filePath)
					if (validateEnvironmentName(environmentName).valid) {
						addEnvironmentLayer(layersByName, environmentName, filePath)
					} else {
						invalidEnvironmentPaths.add(filePath)
					}
				}
				if (isPlaintextEnvironmentFile(entry.name)) {
					if (
						plaintextPaths.size + unsafePlaintextPaths.size >=
						MAX_DOCTOR_PLAINTEXT_PATHS
					) {
						limitExceeded = true
						return
					}
					unsafePlaintextPaths.add(filePath)
				}
				if (!DOTENC_RECURSIVE_IGNORED_DIRS.has(entry.name)) {
					await walk(filePath)
					if (limitExceeded) return
				}
				continue
			}
			if (environmentName) {
				if (environmentPaths.size >= MAX_DOCTOR_ENVELOPES) {
					limitExceeded = true
					return
				}
				environmentPaths.add(filePath)
				if (validateEnvironmentName(environmentName).valid) {
					addEnvironmentLayer(layersByName, environmentName, filePath)
				} else {
					invalidEnvironmentPaths.add(filePath)
				}
				continue
			}
			if (isPlaintextEnvironmentFile(entry.name) && !regularFile) {
				if (
					plaintextPaths.size + unsafePlaintextPaths.size >=
					MAX_DOCTOR_PLAINTEXT_PATHS
				) {
					limitExceeded = true
					return
				}
				unsafePlaintextPaths.add(filePath)
				continue
			}
			if (!isPlaintextEnvironmentFile(entry.name)) continue
			if (
				plaintextPaths.size + unsafePlaintextPaths.size >=
				MAX_DOCTOR_PLAINTEXT_PATHS
			) {
				limitExceeded = true
				return
			}
			if (regularFile) plaintextPaths.add(filePath)
			else unsafePlaintextPaths.add(filePath)
		}
	}

	await walk(projectRoot)
	return {
		layersByName,
		invalidEnvironmentPaths,
		plaintextPaths,
		unsafePlaintextPaths,
		complete: !limitExceeded && incompletePaths.length === 0,
		environmentPaths,
		incompletePaths: incompletePaths.sort(),
		limitExceeded,
	}
}

const inspectInvalidEnvironmentNames = (
	projectRoot: string,
	paths: Set<string>,
	state: ReportState,
) => {
	for (const filePath of [...paths].sort()) {
		const relative = normalizeRelativePath(projectRoot, filePath)
		if (!relative) {
			markIncomplete(
				state,
				"An invalid encrypted environment filename cannot be rendered safely.",
			)
			continue
		}
		finding(
			state,
			"repository.envelope-invalid",
			"error",
			"encrypted environment",
			"An encrypted environment filename contains an invalid environment name.",
			{ paths: [relative] },
		)
	}
}

const findProviderLocator = async (
	environment: Environment,
	deps: DoctorDependencies,
): Promise<"present" | "absent" | "incomplete"> => {
	let incomplete = false
	for (const fingerprint of [
		...new Set(environment.keys.map((key) => key.fingerprint)),
	].sort()) {
		const result = await deps.probeOnePasswordLocator(fingerprint)
		if (result.status === "present") return "present"
		if (result.status === "incomplete") incomplete = true
	}
	return incomplete ? "incomplete" : "absent"
}

class DoctorEvidenceIncompleteError extends Error {}

const probeOfflineAccess = async (
	environment: Environment,
	privateFingerprints: Set<string>,
	privateInventoryComplete: boolean,
	context: EnvironmentAccessProbeContext,
	deps: DoctorDependencies,
): Promise<EnvironmentAccessProbeResult> => {
	const hasKnownLocalRecipient = environment.keys.some((recipient) =>
		privateFingerprints.has(recipient.fingerprint),
	)
	if (!hasKnownLocalRecipient) {
		if (!privateInventoryComplete) {
			return {
				status: "local-key-inconclusive",
				reason: "key-inventory-incomplete",
			}
		}
		const locator = await findProviderLocator(environment, deps)
		if (locator === "incomplete") throw new DoctorEvidenceIncompleteError()
		if (locator === "present") {
			return {
				status: "provider-inconclusive",
				provider: "1password",
				reason: "cached-key-unavailable",
			}
		}
	}
	const result = await deps.probeEnvironmentAccess(environment, context)
	if (result.status === "accessible") return result
	if (
		!privateInventoryComplete &&
		(result.status === "inaccessible" || result.status === "corrupt-data-key")
	) {
		return {
			status: "local-key-inconclusive",
			reason: "key-inventory-incomplete",
		}
	}
	if (
		result.status === "inaccessible" ||
		result.status === "corrupt-data-key"
	) {
		const locator = await findProviderLocator(environment, deps)
		if (locator === "incomplete") throw new DoctorEvidenceIncompleteError()
		if (locator === "present") {
			return {
				status: "provider-inconclusive",
				provider: "1password",
				reason: "cached-key-unavailable",
			}
		}
	}
	return result
}

const inspectLayerAccess = async (
	paths: string[],
	envelopeCache: EnvelopeInspectionCache,
	privateFingerprints: Set<string>,
	privateInventoryComplete: boolean,
	context: EnvironmentAccessProbeContext,
	deps: DoctorDependencies,
): Promise<{
	status:
		| "accessible"
		| "incomplete"
		| "invalid-envelope"
		| "corrupt-data-key"
		| "inaccessible"
		| "local-key-inconclusive"
		| "provider-inconclusive"
	paths: string[]
}> => {
	const statuses: Array<{
		status:
			| "accessible"
			| "incomplete"
			| "invalid-envelope"
			| "corrupt-data-key"
			| "inaccessible"
			| "local-key-inconclusive"
			| "provider-inconclusive"
		path: string
	}> = []

	for (const filePath of paths) {
		const inspection = await inspectCachedEnvelope(filePath, envelopeCache)
		if (inspection.status === "incomplete") {
			statuses.push({ status: "incomplete", path: filePath })
			continue
		}
		if (inspection.status === "invalid") {
			statuses.push({ status: "invalid-envelope", path: filePath })
			continue
		}
		const access = await probeOfflineAccess(
			inspection.environment,
			privateFingerprints,
			privateInventoryComplete,
			context,
			deps,
		)
		statuses.push({ status: access.status, path: filePath })
	}

	for (const status of [
		"incomplete",
		"invalid-envelope",
		"local-key-inconclusive",
		"provider-inconclusive",
		"corrupt-data-key",
		"inaccessible",
	] as const) {
		const matching = statuses.filter((entry) => entry.status === status)
		if (matching.length > 0) {
			return { status, paths: matching.map((entry) => entry.path) }
		}
	}
	return { status: "accessible", paths }
}

const personalDeletion = (filePath: string): string | undefined => {
	const fileName = filePath.split("/").at(-1) ?? ""
	const environmentName = PERSONAL_FILE_PATTERN.exec(fileName)?.[1]
	return environmentName && isPersonalEnvironmentName(environmentName)
		? environmentName
		: undefined
}

const deletionInScope = (
	deletion: DoctorGitDeletion,
	effectiveRelativeDirs: Set<string>,
	all: boolean,
) => {
	if (all) return true
	const dir = path.posix.dirname(deletion.path)
	return effectiveRelativeDirs.has(dir === "." ? "" : dir)
}

const recoveryForDeletion = async (
	deletion: DoctorGitDeletion,
	gitCommandPrefix: string[],
	projectRoot: string,
	state: ReportState,
): Promise<string[][]> => {
	if (deletion.indexDeleted) {
		const commands = [
			[
				...gitCommandPrefix,
				"--literal-pathspecs",
				"restore",
				"--staged",
				"--",
				deletion.path,
			],
		]
		try {
			await fs.lstat(path.join(projectRoot, ...deletion.path.split("/")))
		} catch (error) {
			if (hasErrnoCode(error, "ENOENT")) {
				commands.push([
					...gitCommandPrefix,
					"--literal-pathspecs",
					"restore",
					"--",
					deletion.path,
				])
			} else {
				markIncomplete(
					state,
					"A staged deletion worktree path could not be inspected safely.",
					[deletion.path],
				)
			}
		}
		return commands
	}
	return [
		[
			...gitCommandPrefix,
			"--literal-pathspecs",
			"restore",
			"--",
			deletion.path,
		],
	]
}

const validHistoricalEnvelope = (source: string) => {
	try {
		parseEnvironmentDocument(source)
		return true
	} catch {
		return false
	}
}

type HistoricalRecovery = {
	status: "complete" | "incomplete" | "unavailable"
	commands: string[][]
}

type HistoricalRecoveryBudget = { remainingPaths: number }

const historicalRecoveryCommands = (
	git: DoctorGit | undefined,
	paths: string[],
	gitCommandPrefix: string[],
	budget: HistoricalRecoveryBudget,
): HistoricalRecovery => {
	if (!git) return { status: "unavailable", commands: [] }
	if (paths.length > budget.remainingPaths) {
		budget.remainingPaths = 0
		return { status: "incomplete", commands: [] }
	}
	const commands: string[][] = []
	for (const filePath of paths) {
		budget.remainingPaths -= 1
		const result = git.latestValidRevision(filePath, validHistoricalEnvelope)
		if (result.status === "incomplete") {
			return { status: "incomplete", commands: [] }
		}
		if (result.status === "found") {
			commands.push([
				...gitCommandPrefix,
				"--literal-pathspecs",
				"restore",
				`--source=${result.revision}`,
				"--",
				filePath,
			])
		}
	}
	return { status: "complete", commands }
}

const inspectDevelopment = async (
	paths: string[],
	projectRoot: string,
	state: ReportState,
	envelopeCache: EnvelopeInspectionCache,
	privateFingerprints: Set<string>,
	privateInventoryComplete: boolean,
	context: EnvironmentAccessProbeContext,
	deps: DoctorDependencies,
) => {
	if (paths.length === 0) {
		finding(
			state,
			"development.missing",
			"error",
			"development",
			"The required development environment was not found in the effective scope.",
		)
		return
	}

	let result: Awaited<ReturnType<typeof inspectLayerAccess>>
	try {
		result = await inspectLayerAccess(
			paths,
			envelopeCache,
			privateFingerprints,
			privateInventoryComplete,
			context,
			deps,
		)
	} catch {
		markIncomplete(
			state,
			"Development access could not be tested without exposing provider errors.",
		)
		return
	}
	const relativePaths = normalizeReportPaths(
		projectRoot,
		result.paths,
		state,
		"A development environment path cannot be rendered safely.",
	)
	if (result.status === "accessible") {
		passed(
			state,
			"development.decryptable",
			"development",
			`${plural(paths.length, "layer")}, data key decryptable.`,
			relativePaths,
		)
		return
	}
	if (result.status === "incomplete") {
		markIncomplete(
			state,
			"A required development envelope could not be read completely.",
			relativePaths,
		)
		return
	}
	if (result.status === "provider-inconclusive") {
		finding(
			state,
			"development.provider-inconclusive",
			"warning",
			"development",
			"Offline access is inconclusive because a matching cached provider locator exists; no provider command was run.",
			{ paths: relativePaths },
		)
		return
	}
	if (result.status === "local-key-inconclusive") {
		finding(
			state,
			"development.local-key-inconclusive",
			"warning",
			"development",
			"Offline access is inconclusive because one or more local keys could not be inspected without mutation or prompting.",
			{ paths: relativePaths },
		)
		return
	}
	if (result.status === "inaccessible") {
		finding(
			state,
			"development.inaccessible",
			"error",
			"development",
			"The required development environment is not accessible with active local keys.",
			{ paths: relativePaths },
		)
		return
	}
	finding(
		state,
		"development.corrupt",
		"error",
		"development",
		result.status === "invalid-envelope"
			? "A required development envelope is invalid or unsafe."
			: "A required development wrapped data key is corrupt.",
		{ paths: relativePaths },
	)
}

const inspectPersonalProfiles = async (
	layersByName: Map<string, string[]>,
	requestedEnvironment: string | undefined,
	projectRoot: string,
	effectiveDirs: string[],
	deletions: DoctorGitDeletion[],
	git: DoctorGit | undefined,
	gitCommandPrefix: string[],
	historyBudget: HistoricalRecoveryBudget,
	state: ReportState,
	envelopeCache: EnvelopeInspectionCache,
	privateFingerprints: Set<string>,
	privateInventoryComplete: boolean,
	context: EnvironmentAccessProbeContext,
	deps: DoctorDependencies,
	all: boolean,
) => {
	const profiles = [...layersByName.entries()]
		.filter(([name]) => isPersonalEnvironmentName(name))
		.sort(([left], [right]) => left.localeCompare(right))
	const deletedNames = new Set<string>()

	for (const deletion of deletions) {
		const environmentName = personalDeletion(deletion.path)
		if (!environmentName) continue
		deletedNames.add(environmentName)
		finding(
			state,
			"personal.deleted",
			"warning",
			environmentName,
			"A tracked personal profile was deleted from the working tree.",
			{
				paths: [deletion.path],
				commands: await recoveryForDeletion(
					deletion,
					gitCommandPrefix,
					projectRoot,
					state,
				),
			},
		)
	}

	const accessible: string[] = []
	for (const [environmentName, paths] of profiles) {
		let result: Awaited<ReturnType<typeof inspectLayerAccess>>
		try {
			result = await inspectLayerAccess(
				paths,
				envelopeCache,
				privateFingerprints,
				privateInventoryComplete,
				context,
				deps,
			)
		} catch {
			markIncomplete(
				state,
				"A personal profile access check could not complete.",
			)
			continue
		}
		const relativePaths = normalizeReportPaths(
			projectRoot,
			result.paths,
			state,
			"A personal profile path cannot be rendered safely.",
		)
		if (result.status === "accessible") {
			accessible.push(environmentName)
			passed(
				state,
				"personal.decryptable",
				environmentName,
				`${plural(paths.length, "layer")}, data key decryptable.`,
				relativePaths,
			)
			continue
		}
		if (result.status === "incomplete") {
			markIncomplete(
				state,
				"A personal profile envelope could not be read completely.",
				relativePaths,
			)
			continue
		}
		if (result.status === "provider-inconclusive") {
			finding(
				state,
				"personal.provider-inconclusive",
				"warning",
				environmentName,
				"Offline access is inconclusive because a matching cached provider locator exists; no provider command was run.",
				{ paths: relativePaths },
			)
			continue
		}
		if (result.status === "local-key-inconclusive") {
			finding(
				state,
				"personal.local-key-inconclusive",
				"warning",
				environmentName,
				"Offline access is inconclusive because one or more local keys could not be inspected without mutation or prompting.",
				{ paths: relativePaths },
			)
			continue
		}
		if (result.status === "inaccessible") {
			finding(
				state,
				"personal.inaccessible",
				"warning",
				environmentName,
				"The personal profile is not accessible with active local keys. Ask a project member to grant the matching key fingerprint.",
				{
					paths: relativePaths,
					commands: [["dotenc", "auth", "grant", environmentName]],
				},
			)
			continue
		}
		const recovery = historicalRecoveryCommands(
			git,
			relativePaths,
			gitCommandPrefix,
			historyBudget,
		)
		if (recovery.status === "incomplete") {
			markIncomplete(
				state,
				"Local Git recovery history could not be inspected completely.",
				relativePaths,
			)
		}
		finding(
			state,
			"personal.corrupt",
			"warning",
			environmentName,
			result.status === "invalid-envelope"
				? "A personal profile envelope is invalid or unsafe."
				: "A personal profile wrapped data key is corrupt.",
			{
				paths: relativePaths,
				commands:
					recovery.status === "complete" ? recovery.commands : undefined,
			},
		)
	}

	if (accessible.length > 1) {
		finding(
			state,
			"personal.multiple-accessible",
			"info",
			"personal profiles",
			`${accessible.join(", ")} are accessible; dotenc dev will prompt in an interactive terminal.`,
		)
	}

	if (requestedEnvironment && !layersByName.has(requestedEnvironment)) {
		if (!deletedNames.has(requestedEnvironment)) {
			const expectedPaths = effectiveDirs
				.map((dir) =>
					normalizeRelativePath(
						projectRoot,
						path.join(dir, `.env.${requestedEnvironment}.enc`),
					),
				)
				.filter((filePath): filePath is string => filePath !== undefined)
			if (expectedPaths.length !== effectiveDirs.length) {
				markIncomplete(
					state,
					"One or more expected personal-profile paths cannot be represented safely.",
				)
				finding(
					state,
					"personal.missing",
					"warning",
					requestedEnvironment,
					"The requested personal profile is missing, but local recovery evidence is incomplete. No recovery or creation command is suggested.",
				)
				return new Set(accessible)
			}
			const recovery = historicalRecoveryCommands(
				git,
				expectedPaths,
				gitCommandPrefix,
				historyBudget,
			)
			const shallow = git?.isShallow()
			if (recovery.status === "incomplete" || (git && shallow === undefined)) {
				markIncomplete(
					state,
					"Local Git recovery history could not be inspected completely.",
					expectedPaths,
				)
			}
			const restorable =
				recovery.status === "complete" && recovery.commands.length > 0
			const canStartFresh =
				recovery.status === "complete" &&
				recovery.commands.length === 0 &&
				shallow === false
			const createCommand = ["dotenc", "env", "create", requestedEnvironment]
			finding(
				state,
				"personal.missing",
				"warning",
				requestedEnvironment,
				restorable
					? "The requested personal profile is missing; a valid local revision can restore it."
					: canStartFresh
						? "The requested personal profile is missing and local recovery was not found. Creating it starts empty and cannot recover old values."
						: "The requested personal profile is missing, but local recovery evidence is unavailable or incomplete. No creation command is suggested.",
				{
					commands: restorable
						? recovery.commands
						: canStartFresh
							? [createCommand]
							: undefined,
				},
			)
			if (!restorable && (!git || shallow === true || shallow === undefined)) {
				finding(
					state,
					"git.history-unavailable",
					"warning",
					requestedEnvironment,
					git && shallow === true
						? "Local history is shallow; doctor did not fetch remote history."
						: "Local Git recovery evidence is unavailable or incomplete; doctor did not fetch remote history.",
				)
			}
		}
	} else if (profiles.length === 0 && deletedNames.size === 0) {
		finding(
			state,
			"personal.none",
			"info",
			"personal profiles",
			all
				? "No personal profiles are present in the effective root-to-invocation chain; recursive envelopes are audited separately."
				: "No personal profiles are present; personal overlays are optional.",
		)
	}

	return new Set(accessible)
}

const legacyRenameCommand = (
	source: string,
	destination: string,
	requiresAllLayers: boolean,
) => [
	"dotenc",
	"env",
	"rename",
	...(requiresAllLayers ? ["--all-layers"] : []),
	"--",
	source,
	destination,
]

const inspectLegacyCandidates = async (
	layersByName: Map<string, string[]>,
	publicKeys: ProjectPublicKey[],
	requestedProfile: string | undefined,
	invocationDir: string,
	projectRoot: string,
	state: ReportState,
	envelopeCache: EnvelopeInspectionCache,
	privateFingerprints: Set<string>,
	privateInventoryComplete: boolean,
	context: EnvironmentAccessProbeContext,
	deps: DoctorDependencies,
) => {
	const aliases = publicKeys
		.filter((key) => {
			if (key.alias === "development" || key.alias.startsWith("personal.")) {
				return false
			}
			return requestedProfile === undefined || key.alias === requestedProfile
		})
		.sort((left, right) => left.alias.localeCompare(right.alias))

	for (const alias of aliases) {
		const sourcePaths = layersByName.get(alias.alias) ?? []
		if (sourcePaths.length === 0) continue
		const sourceEnvironments: Array<{
			path: string
			environment: Environment
		}> = []
		let verified = true
		for (const sourcePath of sourcePaths) {
			const inspection = await inspectCachedEnvelope(sourcePath, envelopeCache)
			if (inspection.status === "incomplete") {
				const relative = normalizeRelativePath(projectRoot, sourcePath)
				markIncomplete(
					state,
					"A possible legacy environment could not be read completely.",
					relative ? [relative] : undefined,
				)
				verified = false
				break
			}
			if (
				inspection.status !== "valid" ||
				!inspection.environment.keys.some(
					(recipient) => recipient.fingerprint === alias.fingerprint,
				)
			) {
				verified = false
				break
			}
			let access: EnvironmentAccessProbeResult
			try {
				access = await probeOfflineAccess(
					inspection.environment,
					privateFingerprints,
					privateInventoryComplete,
					context,
					deps,
				)
			} catch {
				const relative = normalizeRelativePath(projectRoot, sourcePath)
				markIncomplete(
					state,
					"A possible legacy environment access check could not complete.",
					relative ? [relative] : undefined,
				)
				verified = false
				break
			}
			if (access.status !== "accessible") {
				verified = false
				break
			}
			sourceEnvironments.push({
				path: sourcePath,
				environment: inspection.environment,
			})
		}
		if (!verified) continue

		const destination = `personal.${alias.alias}`
		const destinationPaths = layersByName.get(destination) ?? []
		const relativeSourcePaths = normalizeReportPaths(
			projectRoot,
			sourcePaths,
			state,
			"A possible legacy environment path cannot be rendered safely.",
		)
		const requiresAllLayers = sourcePaths.some(
			(filePath) =>
				path.resolve(path.dirname(filePath)) !== path.resolve(invocationDir),
		)

		if (destinationPaths.length === 0) {
			finding(
				state,
				"legacy.candidate",
				"warning",
				alias.alias,
				"A fingerprint-correlated possible legacy personal profile was found. It was not loaded or changed.",
				{
					paths: relativeSourcePaths,
					commands: [
						legacyRenameCommand(alias.alias, destination, requiresAllLayers),
					],
				},
			)
			continue
		}

		const verifiedDestinations: string[] = []
		for (const source of sourceEnvironments) {
			const sameDirectoryDestination = destinationPaths.find(
				(destinationPath) =>
					path.resolve(path.dirname(destinationPath)) ===
					path.resolve(path.dirname(source.path)),
			)
			if (!sameDirectoryDestination) continue
			const destinationInspection = await inspectCachedEnvelope(
				sameDirectoryDestination,
				envelopeCache,
			)
			if (destinationInspection.status === "incomplete") {
				const relative = normalizeRelativePath(
					projectRoot,
					sameDirectoryDestination,
				)
				markIncomplete(
					state,
					"A possible legacy rename destination could not be read completely.",
					relative ? [relative] : undefined,
				)
				continue
			}
			if (destinationInspection.status !== "valid") continue
			try {
				if (
					await environmentDataKeysEqual(
						source.environment,
						destinationInspection.environment,
						context,
					)
				) {
					const relative = normalizeRelativePath(
						projectRoot,
						sameDirectoryDestination,
					)
					if (relative) verifiedDestinations.push(relative)
				}
			} catch {
				// A destination that cannot be compared is a collision, never proof.
			}
		}

		const uniqueVerifiedDestinations = [...new Set(verifiedDestinations)].sort()
		if (
			uniqueVerifiedDestinations.length > 0 &&
			uniqueVerifiedDestinations.length === destinationPaths.length
		) {
			finding(
				state,
				"legacy.partial-rename",
				"warning",
				alias.alias,
				"Legacy source layers remain beside destinations with the same unwrapped data key. Review cleanup or restore tracked sources before removing destinations.",
				{
					paths: [...relativeSourcePaths, ...uniqueVerifiedDestinations].sort(),
				},
			)
		} else {
			const relativeDestinations = normalizeReportPaths(
				projectRoot,
				destinationPaths,
				state,
				"A possible legacy destination path cannot be rendered safely.",
			)
			finding(
				state,
				"legacy.collision",
				"warning",
				alias.alias,
				"A namespaced destination already exists but could not be verified as the same cryptographic rename. No rename command is suggested.",
				{ paths: [...relativeSourcePaths, ...relativeDestinations].sort() },
			)
		}
	}
}

const inspectGitIntegration = (
	git: DoctorGit | undefined,
	environmentPaths: string[],
	projectRoot: string,
	state: ReportState,
	scopeComplete: boolean,
) => {
	if (!git) {
		finding(
			state,
			"git.unavailable",
			"warning",
			"Git",
			"This dotenc project is not inside an inspectable local Git worktree.",
		)
		return
	}

	const textconv = git.configValues("diff.dotenc.textconv")
	if (textconv === undefined) {
		markIncomplete(state, "Clone-local Git diff configuration is unreadable.")
	} else if (textconv.length !== 1 || textconv[0] !== DOTENC_DIFF_TEXTCONV) {
		finding(
			state,
			"git.diff-driver",
			"warning",
			"Git diff driver",
			"Effective clone-local diff.dotenc.textconv is missing, conflicting, or differs from the expected command.",
			{
				commands:
					textconv.length === 0
						? [
								[
									"git",
									"config",
									"--local",
									"diff.dotenc.textconv",
									DOTENC_DIFF_TEXTCONV,
								],
							]
						: undefined,
			},
		)
	} else {
		passed(
			state,
			"git.diff-driver",
			"Git diff driver",
			"Clone-local textconv command is configured.",
		)
	}

	const cacheTextconv = git.configBooleanValues("diff.dotenc.cachetextconv")
	if (cacheTextconv === undefined) {
		markIncomplete(
			state,
			"Clone-local Git textconv cache configuration is unreadable.",
		)
	} else if (cacheTextconv.length !== 1 || cacheTextconv[0] !== false) {
		finding(
			state,
			"git.textconv-cache",
			"warning",
			"Git textconv cache",
			"Effective clone-local textconv plaintext caching is missing, conflicting, or not explicitly disabled.",
			{
				commands:
					cacheTextconv.length === 0
						? [
								[
									"git",
									"config",
									"--local",
									"diff.dotenc.cachetextconv",
									DOTENC_DIFF_CACHE_TEXTCONV,
								],
							]
						: undefined,
			},
		)
	} else {
		passed(
			state,
			"git.textconv-cache",
			"Git textconv cache",
			"Clone-local textconv caching is disabled.",
		)
	}

	const candidates =
		environmentPaths.length > 0
			? environmentPaths
			: scopeComplete
				? [path.join(projectRoot, ".env.development.enc")]
				: []
	if (candidates.length === 0) return
	const relativeCandidates = candidates
		.map((filePath) => normalizeRelativePath(projectRoot, filePath))
		.filter((filePath): filePath is string => filePath !== undefined)
	if (relativeCandidates.length !== candidates.length) {
		markIncomplete(
			state,
			"One or more encrypted environment paths cannot be rendered safely.",
		)
	}
	const attributeValues = git.attributeValues(relativeCandidates, "diff")
	if (!attributeValues) {
		markIncomplete(
			state,
			"Effective Git attributes could not be inspected completely.",
			relativeCandidates,
		)
		return
	}
	const invalidAttributes = relativeCandidates.filter(
		(filePath) => attributeValues.get(filePath) !== "dotenc",
	)
	if (invalidAttributes.length > 0) {
		finding(
			state,
			"git.attributes",
			"warning",
			"Git attributes",
			"The effective diff attribute is not dotenc for every encrypted environment path.",
			{ paths: invalidAttributes, commands: [["dotenc", "init"]] },
		)
	} else if (scopeComplete && relativeCandidates.length === candidates.length) {
		passed(
			state,
			"git.attributes",
			"Git attributes",
			"Encrypted environment paths use the dotenc diff attribute.",
		)
	}
}

const inspectPlaintextHygiene = (
	projectRoot: string,
	plaintextPaths: Set<string>,
	unsafePaths: Set<string>,
	git: DoctorGit | undefined,
	gitCommandPrefix: string[],
	state: ReportState,
	scopeComplete: boolean,
	gitCommandsSafe: boolean,
) => {
	for (const filePath of [...unsafePaths].sort()) {
		const relative = normalizeRelativePath(projectRoot, filePath)
		if (!relative) {
			markIncomplete(
				state,
				"An unsafe plaintext environment path cannot be rendered safely.",
			)
		}
		finding(
			state,
			"plaintext.unsafe",
			"error",
			"plaintext environment",
			"A plaintext environment path is a symlink or non-regular file and was not read.",
			{ paths: relative ? [relative] : undefined },
		)
	}

	const relativePaths = [...plaintextPaths]
		.sort()
		.map((filePath) => normalizeRelativePath(projectRoot, filePath))
		.filter((filePath): filePath is string => filePath !== undefined)
	if (relativePaths.length !== plaintextPaths.size) {
		markIncomplete(
			state,
			"A plaintext environment path cannot be rendered safely.",
		)
	}
	const trackedPaths = git?.trackedPaths(relativePaths)
	if (git && !trackedPaths) {
		markIncomplete(
			state,
			"Plaintext Git tracking evidence could not be inspected.",
			relativePaths,
		)
	}
	const untrackedPaths = trackedPaths
		? relativePaths.filter((filePath) => !trackedPaths.has(filePath))
		: []
	const ignoredPaths = git?.ignoredPaths(untrackedPaths)
	if (git && trackedPaths && !ignoredPaths) {
		markIncomplete(
			state,
			"Plaintext Git ignore evidence could not be inspected.",
			untrackedPaths,
		)
	}

	for (const relative of relativePaths) {
		if (!git || !trackedPaths) {
			finding(
				state,
				"plaintext.present",
				"warning",
				"plaintext environment",
				"A plaintext environment file exists, but its Git state is unavailable or incomplete; its contents were not read.",
				{ paths: [relative] },
			)
			continue
		}
		if (trackedPaths.has(relative)) {
			finding(
				state,
				"plaintext.tracked",
				"error",
				"plaintext environment",
				"A plaintext environment file is tracked by Git; its contents were not read.",
				{
					paths: [relative],
					commands: gitCommandsSafe
						? [
								[
									...gitCommandPrefix,
									"--literal-pathspecs",
									"rm",
									"--cached",
									"--",
									relative,
								],
							]
						: undefined,
				},
			)
			continue
		}
		if (!ignoredPaths) {
			finding(
				state,
				"plaintext.present",
				"warning",
				"plaintext environment",
				"A plaintext environment file exists, but its Git ignore state is incomplete; its contents were not read.",
				{ paths: [relative] },
			)
		} else if (!ignoredPaths.has(relative)) {
			finding(
				state,
				"plaintext.unignored",
				"warning",
				"plaintext environment",
				"A plaintext environment file exists and is not ignored by Git; its contents were not read.",
				{ paths: [relative] },
			)
		} else {
			finding(
				state,
				"plaintext.present",
				"info",
				"plaintext environment",
				"An ignored plaintext environment file exists; its contents were not read.",
				{ paths: [relative] },
			)
		}
	}

	if (scopeComplete && plaintextPaths.size === 0 && unsafePaths.size === 0) {
		passed(
			state,
			"plaintext.clean",
			"plaintext hygiene",
			"No plaintext environment files were found in scope.",
		)
	}
}

const inspectHomeConfiguration = async (
	state: ReportState,
	deps: DoctorDependencies,
) => {
	const verifyPosixPermissions = deps.platform !== "win32"
	if (!verifyPosixPermissions) {
		finding(
			state,
			"config.permissions-unverified",
			"info",
			"local configuration",
			"POSIX configuration permissions are not applicable on Windows and no path was changed.",
		)
	}

	let homeDir: string
	try {
		homeDir = await fs.realpath(deps.homedir())
	} catch {
		markIncomplete(
			state,
			"The operating-system home directory could not be inspected.",
		)
		return
	}
	const configDir = path.join(homeDir, ".dotenc")
	let directoryStat: Awaited<ReturnType<typeof fs.lstat>>
	try {
		directoryStat = await fs.lstat(configDir)
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ENOENT"
		) {
			passed(
				state,
				"config.absent",
				"local configuration",
				"No home configuration is present.",
			)
			return
		}
		markIncomplete(state, "Home configuration metadata could not be inspected.")
		return
	}

	if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
		finding(
			state,
			"config.unsafe",
			"error",
			"local configuration",
			"The dotenc home configuration directory is a symlink or non-directory.",
		)
		return
	}
	if (verifyPosixPermissions && (directoryStat.mode & 0o777) !== 0o700) {
		finding(
			state,
			"config.permissions",
			"warning",
			"local configuration",
			"The dotenc home configuration directory mode differs from required 0700; doctor did not chmod it.",
		)
	}

	const configPath = path.join(configDir, "config.json")
	let configStat: Awaited<ReturnType<typeof fs.lstat>>
	try {
		configStat = await fs.lstat(configPath)
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ENOENT"
		) {
			if (verifyPosixPermissions && (directoryStat.mode & 0o777) === 0o700) {
				passed(
					state,
					"config.permissions",
					"local configuration",
					"Home configuration directory permissions are 0700.",
				)
			}
			return
		}
		markIncomplete(
			state,
			"Home configuration file metadata could not be inspected.",
		)
		return
	}

	if (configStat.isSymbolicLink() || !configStat.isFile()) {
		finding(
			state,
			"config.unsafe",
			"error",
			"local configuration",
			"The dotenc home configuration file is a symlink or non-regular file.",
		)
		return
	}
	if (verifyPosixPermissions && (configStat.mode & 0o777) !== 0o600) {
		finding(
			state,
			"config.permissions",
			"warning",
			"local configuration",
			"The dotenc home configuration file mode differs from required 0600; doctor did not chmod it.",
		)
	}

	const input = await readBoundedRegularFile(configPath, 64 * 1024)
	if (input.status === "missing" || input.status === "io-failure") {
		markIncomplete(state, "Home configuration content could not be read.")
		return
	}
	if (input.status === "too-large") {
		markIncomplete(
			state,
			"Home configuration exceeds the diagnostic size limit.",
		)
		return
	}
	if (input.status !== "ok") {
		finding(
			state,
			"config.invalid",
			"warning",
			"local configuration",
			"The home configuration is unreadable, unsafe, or exceeds the size limit.",
		)
		return
	}
	try {
		const parsed = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(input.data),
		)
		if (!homeConfigSchema.safeParse(parsed).success) {
			throw new Error("invalid")
		}
		if (
			verifyPosixPermissions &&
			(directoryStat.mode & 0o777) === 0o700 &&
			(configStat.mode & 0o777) === 0o600
		) {
			passed(
				state,
				"config.permissions",
				"local configuration",
				"Home configuration permissions are 0700/0600.",
			)
		}
	} catch {
		finding(
			state,
			"config.invalid",
			"warning",
			"local configuration",
			"The home configuration is not a valid JSON object.",
		)
	} finally {
		input.data.fill(0)
	}
}

const inspectAllEnvelopes = async (
	paths: Set<string>,
	projectRoot: string,
	publicKeys: ProjectPublicKey[],
	publicKeyInventoryComplete: boolean,
	state: ReportState,
	envelopeCache: EnvelopeInspectionCache,
) => {
	const aliasesByFingerprint = new Map<string, ProjectPublicKey[]>()
	for (const key of publicKeys) {
		const aliases = aliasesByFingerprint.get(key.fingerprint) ?? []
		aliases.push(key)
		aliasesByFingerprint.set(key.fingerprint, aliases)
	}

	for (const filePath of [...paths].sort()) {
		const relative = normalizeRelativePath(projectRoot, filePath)
		if (!relative) {
			markIncomplete(
				state,
				"An encrypted environment path cannot be rendered safely.",
			)
			continue
		}
		const inspection = await inspectCachedEnvelope(filePath, envelopeCache)
		if (inspection.status === "incomplete") {
			markIncomplete(
				state,
				"An encrypted environment could not be read completely.",
				[relative],
			)
			continue
		}
		if (inspection.status === "invalid") {
			finding(
				state,
				"repository.envelope-invalid",
				"error",
				"encrypted environment",
				"Envelope is invalid, unsafe, or exceeds a diagnostic bound.",
				{ paths: [relative] },
			)
			continue
		}
		passed(
			state,
			"repository.envelope-valid",
			"encrypted environment",
			"Envelope is bounded and structurally valid.",
			[relative],
		)

		const orphaned = publicKeyInventoryComplete
			? inspection.environment.keys.filter(
					(recipient) => !aliasesByFingerprint.has(recipient.fingerprint),
				)
			: []
		if (orphaned.length > 0) {
			finding(
				state,
				"repository.recipient-orphaned",
				"warning",
				"recipient metadata",
				`${plural(orphaned.length, "recipient")} have no matching current project public-key fingerprint.`,
				{ paths: [relative] },
			)
		}

		const staleAliases = publicKeyInventoryComplete
			? inspection.environment.keys.filter((recipient) => {
					const keys = aliasesByFingerprint.get(recipient.fingerprint)
					return keys && !keys.some((key) => key.alias === recipient.name)
				})
			: []
		if (staleAliases.length > 0) {
			finding(
				state,
				"repository.recipient-stale-alias",
				"info",
				"recipient metadata",
				`${plural(staleAliases.length, "recipient")} use stale display aliases; authorization still follows fingerprints.`,
				{ paths: [relative] },
			)
		}

		const algorithmMismatches = publicKeyInventoryComplete
			? inspection.environment.keys.filter((recipient) => {
					const keys = aliasesByFingerprint.get(recipient.fingerprint)
					return (
						keys && !keys.some((key) => key.algorithm === recipient.algorithm)
					)
				})
			: []
		if (algorithmMismatches.length > 0) {
			finding(
				state,
				"repository.recipient-algorithm",
				"error",
				"recipient metadata",
				`${plural(algorithmMismatches.length, "recipient")} declare an algorithm inconsistent with the matching project key.`,
				{ paths: [relative] },
			)
		}
	}
}

const summarize = (
	state: ReportState,
	strict: boolean,
): Pick<DoctorReport, "summary" | "exitCode"> => {
	const errors = state.findings.filter(
		(entry) => entry.severity === "error",
	).length
	const warnings = state.findings.filter(
		(entry) => entry.severity === "warning",
	).length
	const info = state.findings.filter(
		(entry) => entry.severity === "info",
	).length
	const exitCode: 0 | 1 | 2 = !state.complete
		? 2
		: errors > 0 || (strict && warnings > 0)
			? 1
			: 0
	return {
		summary: { errors, warnings, info, passed: state.passed.length },
		exitCode,
	}
}

export const createDoctorReport = async (
	options: DoctorOptions = {},
	dependencyOverrides: Partial<DoctorDependencies> = {},
): Promise<DoctorReport> => {
	if (options.localOnly && options.all) {
		throw new DoctorInvocationError(
			"--local-only cannot be combined with --all.",
		)
	}
	if (options.profile !== undefined && options.all) {
		throw new DoctorInvocationError("--profile cannot be combined with --all.")
	}
	const requestedEnvironment =
		options.profile === undefined ? undefined : `personal.${options.profile}`
	if (
		options.profile !== undefined &&
		(!options.profile ||
			!validateEnvironmentName(requestedEnvironment ?? "").valid)
	) {
		throw new DoctorInvocationError("Invalid personal profile name.")
	}

	const mergedDeps = { ...defaultDependencies, ...dependencyOverrides }
	const providerLocatorCache = new Map<
		string,
		Promise<OnePasswordLocatorProbeResult>
	>()
	let providerLocatorProbeCount = 0
	const deps: DoctorDependencies = {
		...mergedDeps,
		probeOnePasswordLocator: (fingerprint) => {
			let cached = providerLocatorCache.get(fingerprint)
			if (!cached) {
				if (providerLocatorProbeCount >= MAX_PROVIDER_LOCATOR_PROBES) {
					cached = Promise.resolve({ status: "incomplete" })
				} else {
					providerLocatorProbeCount += 1
					cached = mergedDeps.probeOnePasswordLocator(fingerprint)
				}
				providerLocatorCache.set(fingerprint, cached)
			}
			return cached
		},
	}
	const invocationDir = path.resolve(options.invocationDir ?? process.cwd())
	const state: ReportState = { complete: true, findings: [], passed: [] }
	const scope = {
		mode: options.all
			? ("all" as const)
			: options.localOnly
				? ("local" as const)
				: ("effective" as const),
		...(requestedEnvironment ? { profile: requestedEnvironment } : {}),
	}

	let resolution: DoctorProjectResolution
	try {
		resolution = await deps.resolveProjectRoot(invocationDir, deps.homedir())
	} catch {
		resolution = { status: "incomplete" }
	}
	if (resolution.status !== "found") {
		if (resolution.status === "incomplete") {
			markIncomplete(
				state,
				"Project resolution could not complete without exposing filesystem errors.",
			)
		} else {
			finding(
				state,
				"project.not-found",
				"error",
				"project",
				"No dotenc project could be resolved from the invocation directory.",
			)
		}
		return {
			schemaVersion: DOCTOR_REPORT_SCHEMA_VERSION,
			command: "doctor",
			complete: state.complete,
			scope,
			findings: state.findings,
			passed: state.passed,
			...summarize(state, options.strict ?? false),
		}
	}
	const projectRoot = resolution.projectRoot
	const gitWorkingDirectory = path.relative(invocationDir, projectRoot) || "."
	const gitCommandPrefix = ["git", "-C", gitWorkingDirectory]

	const invocationRelative = normalizeRelativePath(projectRoot, invocationDir)
	if (!invocationRelative) {
		markIncomplete(state, "The invocation path cannot be represented safely.")
	}
	const project = { root: "." as const, invocation: invocationRelative ?? "." }
	let dotencStat: Awaited<ReturnType<typeof fs.lstat>>
	try {
		dotencStat = await fs.lstat(path.join(projectRoot, ".dotenc"))
	} catch {
		markIncomplete(
			state,
			"The project .dotenc path could not be inspected completely.",
		)
		return {
			schemaVersion: DOCTOR_REPORT_SCHEMA_VERSION,
			command: "doctor",
			complete: state.complete,
			scope,
			project,
			findings: state.findings,
			passed: state.passed,
			...summarize(state, options.strict ?? false),
		}
	}
	if (dotencStat.isSymbolicLink() || !dotencStat.isDirectory()) {
		finding(
			state,
			"project.invalid-dotenc-directory",
			"error",
			"project",
			"The project .dotenc path is a symlink or non-directory.",
		)
		return {
			schemaVersion: DOCTOR_REPORT_SCHEMA_VERSION,
			command: "doctor",
			complete: state.complete,
			scope,
			project,
			findings: state.findings,
			passed: state.passed,
			...summarize(state, options.strict ?? false),
		}
	}
	passed(
		state,
		"project.resolved",
		"project",
		"Project root and invocation scope resolved.",
	)

	let effectiveDirs: string[]
	let effectiveChainComplete = true
	try {
		effectiveDirs = options.localOnly
			? [invocationDir]
			: deps.buildAncestorChain(projectRoot, invocationDir)
	} catch {
		effectiveChainComplete = false
		markIncomplete(
			state,
			"The effective project nesting chain could not be built.",
		)
		effectiveDirs = [invocationDir]
	}
	if (effectiveDirs.length > MAX_EFFECTIVE_DIRECTORIES) {
		effectiveChainComplete = false
		markIncomplete(
			state,
			`The effective nesting chain exceeds the diagnostic limit of ${MAX_EFFECTIVE_DIRECTORIES} directories.`,
		)
		effectiveDirs = []
	}
	const effectiveRelativeDirs = new Set(
		effectiveDirs
			.map((dir) => normalizeRelativePath(projectRoot, dir))
			.filter((dir): dir is string => dir !== undefined)
			.map((dir) => (dir === "." ? "" : dir)),
	)
	if (effectiveRelativeDirs.size !== effectiveDirs.length) {
		effectiveChainComplete = false
		markIncomplete(
			state,
			"One or more effective scope directories cannot be represented safely.",
		)
	}

	const publicKeyInventory = await inspectPublicKeys(projectRoot, state)
	const publicKeys = publicKeyInventory.keys
	let privateKeyResult: GetPrivateKeysResult
	let privateInventoryComplete = true
	try {
		privateKeyResult = usablePrivateKeys(
			await deps.getPrivateKeys({
				environmentKeyErrorMode: "collect",
				logError: () => {},
				decryptPassphraseProtected: false,
				maxKeyBytes: MAX_PRIVATE_KEY_BYTES,
				diagnosticReadOnly: true,
			}),
		)
	} catch {
		privateInventoryComplete = false
		markIncomplete(state, "Local private-key metadata could not be inspected.")
		privateKeyResult = {
			keys: [],
			passphraseProtectedKeys: [],
			unsupportedKeys: [],
		}
	}
	if ((privateKeyResult.incompleteKeys ?? 0) > 0) {
		privateInventoryComplete = false
		markIncomplete(
			state,
			"One or more local private-key inputs could not be inspected safely; private paths are omitted.",
		)
	}
	const privateFingerprintInventoryComplete =
		privateInventoryComplete &&
		privateKeyResult.passphraseProtectedKeys.length === 0
	const privateFingerprints = new Set(
		privateKeyResult.keys.map((key) => key.fingerprint),
	)
	const projectFingerprints = new Set(publicKeys.map((key) => key.fingerprint))
	const activeMatches = privateKeyResult.keys.filter((key) =>
		projectFingerprints.has(key.fingerprint),
	).length
	if (activeMatches > 0) {
		passed(
			state,
			"keys.active-match",
			"active keys",
			`${plural(activeMatches, "local private-key fingerprint match")}.`,
		)
	} else if (
		publicKeys.length > 0 &&
		publicKeyInventory.complete &&
		privateFingerprintInventoryComplete
	) {
		finding(
			state,
			"key.no-active-match",
			"warning",
			"active keys",
			"No active local private-key fingerprint matches a current project public key.",
		)
	}
	const unusablePrivateKeyCount = new Set([
		...(privateKeyResult.unsupportedKeys ?? []).map((entry) => entry.name),
		...privateKeyResult.passphraseProtectedKeys,
	]).size
	if (unusablePrivateKeyCount > 0) {
		finding(
			state,
			"key.private-unusable",
			"info",
			"local private keys",
			`${plural(unusablePrivateKeyCount, "private-key input")} could not be used without mutation or prompting; private paths are omitted.`,
		)
	}
	let providerMatchCount = 0
	for (const fingerprint of [...projectFingerprints].sort()) {
		let locator: OnePasswordLocatorProbeResult
		try {
			locator = await deps.probeOnePasswordLocator(fingerprint)
		} catch {
			markIncomplete(
				state,
				"Configured provider locator metadata could not be inspected completely.",
			)
			continue
		}
		if (locator.status === "present") providerMatchCount += 1
		if (locator.status === "incomplete") {
			markIncomplete(
				state,
				"Configured provider locator metadata could not be inspected completely.",
			)
		}
	}
	if (providerMatchCount > 0) {
		finding(
			state,
			"key.provider-cached",
			"info",
			"configured provider",
			`${plural(providerMatchCount, "project fingerprint")} have cached provider locators. Doctor did not invoke the provider.`,
		)
	}

	const safePrivateKeys = Promise.resolve(privateKeyResult)
	const probeContext = createEnvironmentAccessProbeContext({
		getPrivateKeys: () => safePrivateKeys,
		decryptDataKey,
	})
	const envelopeCache: EnvelopeInspectionCache = {
		entries: new Map(),
		files: 0,
		bytes: 0,
	}
	const historyBudget: HistoricalRecoveryBudget = {
		remainingPaths: MAX_HISTORY_PATHS,
	}
	try {
		const effectiveFiles = await inspectEffectiveFiles(effectiveDirs, state)
		const gitCandidate = deps.createGitInspector(projectRoot)
		const repositoryStatus = gitCandidate.isRepository()
		if (repositoryStatus === undefined) {
			markIncomplete(state, "The local Git worktree could not be inspected.")
		}
		const git = repositoryStatus === true ? gitCandidate : undefined
		let recoveryGit = git
		let deletions: DoctorGitDeletion[] = []
		if (git) {
			const statusDeletions = git.deletedPaths()
			if (statusDeletions === undefined) {
				recoveryGit = undefined
				markIncomplete(
					state,
					"Tracked Git deletion evidence could not be inspected.",
				)
			} else {
				deletions = statusDeletions.filter((deletion) =>
					deletionInScope(
						deletion,
						effectiveRelativeDirs,
						options.all ?? false,
					),
				)
			}
		}

		const effectiveScopeComplete =
			effectiveChainComplete && effectiveFiles.complete
		if (effectiveScopeComplete) {
			await inspectDevelopment(
				effectiveFiles.layersByName.get("development") ?? [],
				projectRoot,
				state,
				envelopeCache,
				privateFingerprints,
				privateFingerprintInventoryComplete,
				probeContext,
				deps,
			)
			await inspectPersonalProfiles(
				effectiveFiles.layersByName,
				requestedEnvironment,
				projectRoot,
				effectiveDirs,
				deletions,
				recoveryGit,
				gitCommandPrefix,
				historyBudget,
				state,
				envelopeCache,
				privateFingerprints,
				privateFingerprintInventoryComplete,
				probeContext,
				deps,
				options.all ?? false,
			)
			await inspectLegacyCandidates(
				effectiveFiles.layersByName,
				publicKeys,
				options.profile,
				invocationDir,
				projectRoot,
				state,
				envelopeCache,
				privateFingerprints,
				privateFingerprintInventoryComplete,
				probeContext,
				deps,
			)
		}

		let environmentPaths = new Set([
			...[...effectiveFiles.layersByName.values()].flat(),
			...effectiveFiles.invalidEnvironmentPaths,
		])
		let invalidEnvironmentPaths = effectiveFiles.invalidEnvironmentPaths
		let plaintextPaths = effectiveFiles.plaintextPaths
		let unsafePlaintextPaths = effectiveFiles.unsafePlaintextPaths
		let scannedScopeComplete = effectiveScopeComplete
		if (options.all) {
			const recursive = await scanRepository(projectRoot)
			environmentPaths = recursive.environmentPaths
			invalidEnvironmentPaths = recursive.invalidEnvironmentPaths
			plaintextPaths = recursive.plaintextPaths
			unsafePlaintextPaths = recursive.unsafePlaintextPaths
			scannedScopeComplete = recursive.complete
			if (recursive.limitExceeded) {
				markIncomplete(
					state,
					"The recursive repository scan exceeded its directory or entry limit.",
				)
			}
			if (recursive.incompletePaths.length > 0) {
				markIncomplete(
					state,
					"One or more repository directories could not be inspected.",
					recursive.incompletePaths,
				)
			}
			await inspectAllEnvelopes(
				environmentPaths,
				projectRoot,
				publicKeys,
				publicKeyInventory.complete,
				state,
				envelopeCache,
			)
		}
		inspectInvalidEnvironmentNames(projectRoot, invalidEnvironmentPaths, state)

		inspectGitIntegration(
			git,
			[...environmentPaths].sort(),
			projectRoot,
			state,
			scannedScopeComplete,
		)
		inspectPlaintextHygiene(
			projectRoot,
			plaintextPaths,
			unsafePlaintextPaths,
			git,
			gitCommandPrefix,
			state,
			scannedScopeComplete,
			recoveryGit !== undefined,
		)
		await inspectHomeConfiguration(state, deps)
	} finally {
		probeContext.dispose()
	}

	return {
		schemaVersion: DOCTOR_REPORT_SCHEMA_VERSION,
		command: "doctor",
		complete: state.complete,
		scope,
		project,
		findings: state.findings,
		passed: state.passed,
		...summarize(state, options.strict ?? false),
	}
}
