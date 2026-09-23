import { constants, type Dirent, type Stats } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { brotliDecompressSync, gunzipSync } from "node:zlib"
import { isSafeDoctorRelativePath } from "./doctorGit"

export const ARTIFACT_DOCTOR_REPORT_SCHEMA_VERSION = 1 as const

const KNOWN_BOOTSTRAP_NAMES = [
	"DOTENC_PRIVATE_KEY_BASE64",
	"DOTENC_PRIVATE_KEY",
	"DOTENC_PRIVATE_KEY_PASSPHRASE",
	"DOTENC_DIFF_PRIVATE_KEY_BASE64",
	"DOTENC_DIFF_PRIVATE_KEY_PASSPHRASE",
] as const

const PRIVATE_KEY_HEADERS = [
	"-----BEGIN OPENSSH PRIVATE KEY-----",
	"-----BEGIN PRIVATE KEY-----",
	"-----BEGIN ENCRYPTED PRIVATE KEY-----",
	"-----BEGIN RSA PRIVATE KEY-----",
	"-----BEGIN EC PRIVATE KEY-----",
	"-----BEGIN DSA PRIVATE KEY-----",
] as const

const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const PLAINTEXT_TEMPLATE_SUFFIX = /\.(?:example|sample|template)$/i
const MIN_SECRET_VALUE_BYTES = 8
const MAX_SECRET_VALUE_BYTES = 1024 * 1024
const MAX_SECRET_NAMES = 128
const READ_CHUNK_BYTES = 64 * 1024
const MAX_PATTERN_BYTES = 16 * 1024 * 1024

export type ArtifactDoctorSeverity = "error" | "warning"

export type ArtifactDoctorFindingId =
	| "invocation.invalid"
	| "artifact.plaintext-env"
	| "artifact.private-key"
	| "artifact.bootstrap-name"
	| "artifact.bootstrap-value"
	| "artifact.secret-name"
	| "artifact.secret-value"
	| "scan.incomplete"

export type ArtifactDoctorFinding = {
	id: ArtifactDoctorFindingId
	severity: ArtifactDoctorSeverity
	subject: string
	message: string
	count: number
	paths?: string[]
}

export type ArtifactDoctorPassedCheck = {
	id: "artifacts.scanned"
	subject: "artifacts"
	message: string
}

export type ArtifactDoctorReport = {
	schemaVersion: typeof ARTIFACT_DOCTOR_REPORT_SCHEMA_VERSION
	command: "doctor artifacts"
	complete: boolean
	scope: {
		directory: "."
		selectedSecrets: number
	}
	findings: ArtifactDoctorFinding[]
	passed: ArtifactDoctorPassedCheck[]
	summary: {
		errors: number
		warnings: number
		filesScanned: number
		directoriesScanned: number
		bytesScanned: number
	}
	exitCode: 0 | 1 | 2
}

export type ArtifactDoctorOptions = {
	invocationDir?: string
	secretNames?: string[]
	strict?: boolean
}

export type ArtifactDoctorLimits = {
	maxDirectories: number
	maxDirectoryEntries: number
	maxEntries: number
	maxFiles: number
	maxFileBytes: number
	maxTotalBytes: number
	maxReportedPaths: number
	maxCompressedFileBytes: number
	maxDecompressedFileBytes: number
}

export const DEFAULT_ARTIFACT_DOCTOR_LIMITS: ArtifactDoctorLimits = {
	maxDirectories: 10_000,
	maxDirectoryEntries: 25_000,
	maxEntries: 100_000,
	maxFiles: 50_000,
	maxFileBytes: 128 * 1024 * 1024,
	maxTotalBytes: 512 * 1024 * 1024,
	maxReportedPaths: 256,
	maxCompressedFileBytes: 16 * 1024 * 1024,
	maxDecompressedFileBytes: 32 * 1024 * 1024,
}

export type ArtifactDoctorDependencies = {
	environment: NodeJS.ProcessEnv
	limits: ArtifactDoctorLimits
}

export type ArtifactDoctorDependencyOverrides = {
	environment?: NodeJS.ProcessEnv
	limits?: Partial<ArtifactDoctorLimits>
}

const defaultDependencies: ArtifactDoctorDependencies = {
	environment: process.env,
	limits: DEFAULT_ARTIFACT_DOCTOR_LIMITS,
}

export class ArtifactDoctorInvocationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ArtifactDoctorInvocationError"
	}
}

type Pattern = {
	bytes: Buffer
	id:
		| "artifact.private-key"
		| "artifact.bootstrap-name"
		| "artifact.bootstrap-value"
		| "artifact.secret-name"
		| "artifact.secret-value"
}

type FindingAccumulator = {
	count: number
	paths: Set<string>
}

type ScanState = {
	complete: boolean
	filesSeen: number
	filesScanned: number
	directoriesScanned: number
	entriesSeen: number
	bytesScanned: number
	bytesCharged: number
	findings: Map<ArtifactDoctorFindingId, FindingAccumulator>
}

type FileScanResult =
	| { status: "ok"; findingIds: Set<Pattern["id"]>; bytesScanned: number }
	| {
			status: "incomplete"
			bytesScanned: number
			findingIds?: Set<Pattern["id"]>
			bytesCharged?: number
	  }

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
	`${count} ${count === 1 ? singular : pluralForm}`

const hasErrnoCode = (error: unknown, code: string) =>
	error instanceof Error &&
	"code" in error &&
	(error as NodeJS.ErrnoException).code === code

const isPlaintextEnvironmentFile = (fileName: string) => {
	if (fileName === ".env") return true
	if (!fileName.startsWith(".env.") || fileName.endsWith(".enc")) return false
	return !PLAINTEXT_TEMPLATE_SUFFIX.test(fileName)
}

const normalizeArtifactPath = (root: string, entryPath: string) => {
	const relative = path.relative(root, entryPath).split(path.sep).join("/")
	if (!relative || !isSafeDoctorRelativePath(relative)) return undefined
	return relative
}

const recordFinding = (
	state: ScanState,
	id: ArtifactDoctorFindingId,
	relativePath?: string,
) => {
	const entry = state.findings.get(id) ?? { count: 0, paths: new Set<string>() }
	entry.count += 1
	if (relativePath) entry.paths.add(relativePath)
	state.findings.set(id, entry)
}

const markIncomplete = (state: ScanState, relativePath?: string) => {
	state.complete = false
	recordFinding(state, "scan.incomplete", relativePath)
}

const readDirectory = async (
	directoryPath: string,
	maximumEntries: number,
): Promise<Dirent<string>[] | undefined> => {
	try {
		const entries: Dirent<string>[] = []
		const directory = await fs.opendir(directoryPath)
		for await (const entry of directory) {
			if (entries.length >= maximumEntries) return undefined
			entries.push(entry)
		}
		return entries.sort((left, right) => left.name.localeCompare(right.name))
	} catch {
		return undefined
	}
}

// These containers need archive-aware inspection. Never call their raw bytes a
// complete scan. Brotli has no reliable magic number and is selected by suffix.
const unsupportedContainer = (name: string, bytes: Buffer) => {
	if (/\.(?:zip|jar|war|7z|rar|tar|tgz|tbz2?|txz|bz2|xz|zst|zstd)$/i.test(name))
		return true
	const signatures = [
		"504b0304",
		"504b0506",
		"504b0708",
		"377abcaf271c",
		"526172211a07",
		"425a68",
		"fd377a585a00",
		"28b52ffd",
	]
	return (
		signatures.some((hex) =>
			bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex, "hex")),
		) || bytes.subarray(257, 262).toString("ascii") === "ustar"
	)
}

const compressedFormat = (name: string, bytes: Buffer) => {
	if (
		/\.gz$/i.test(name) ||
		bytes.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))
	)
		return "gzip"
	if (/\.br$/i.test(name)) return "brotli"
	return undefined
}

const findPatterns = (
	bytes: Buffer,
	patterns: Pattern[],
	findings: Set<Pattern["id"]>,
) => {
	for (const pattern of patterns) {
		if (!findings.has(pattern.id) && bytes.indexOf(pattern.bytes) !== -1)
			findings.add(pattern.id)
	}
}

const scanRegularFile = async (
	filePath: string,
	initialStat: Stats,
	patterns: Pattern[],
	maximumFileBytes: number,
	remainingTotalBytes: number,
	limits: ArtifactDoctorLimits,
): Promise<FileScanResult> => {
	if (
		initialStat.size > maximumFileBytes ||
		initialStat.size > remainingTotalBytes
	) {
		return { status: "incomplete", bytesScanned: 0 }
	}

	const noFollow = constants.O_NOFOLLOW ?? 0
	const nonBlock = constants.O_NONBLOCK ?? 0
	let handle: Awaited<ReturnType<typeof fs.open>>
	try {
		handle = await fs.open(filePath, constants.O_RDONLY | noFollow | nonBlock)
	} catch {
		return { status: "incomplete", bytesScanned: 0 }
	}

	const maximumPatternBytes = Math.max(
		1,
		...patterns.map((pattern) => pattern.bytes.byteLength),
	)
	const chunk = Buffer.alloc(READ_CHUNK_BYTES)
	let overlap = Buffer.alloc(0)
	let bytesScanned = 0
	const findingIds = new Set<Pattern["id"]>()
	const compressedChunks: Buffer[] = []
	let format: ReturnType<typeof compressedFormat>
	let unsupported = unsupportedContainer(filePath, Buffer.alloc(0))
	let decodedBytes = 0

	try {
		let openedStat: Stats
		try {
			openedStat = await handle.stat()
		} catch {
			return { status: "incomplete", bytesScanned }
		}
		if (
			!openedStat.isFile() ||
			openedStat.dev !== initialStat.dev ||
			openedStat.ino !== initialStat.ino ||
			openedStat.size > maximumFileBytes ||
			openedStat.size > remainingTotalBytes
		) {
			return { status: "incomplete", bytesScanned }
		}

		// Empty files with a compressed suffix are malformed, not clean.
		format = compressedFormat(filePath, Buffer.alloc(0))
		if (format && openedStat.size === 0)
			return { status: "incomplete", bytesScanned }
		while (bytesScanned < openedStat.size) {
			let bytesRead: number
			try {
				;({ bytesRead } = await handle.read(
					chunk,
					0,
					Math.min(chunk.byteLength, openedStat.size - bytesScanned),
					null,
				))
			} catch {
				return { status: "incomplete", bytesScanned }
			}
			if (bytesRead === 0) break
			if (bytesScanned === 0) {
				const prefix = chunk.subarray(0, bytesRead)
				format = compressedFormat(filePath, prefix)
				unsupported ||= unsupportedContainer(filePath, prefix)
			}
			bytesScanned += bytesRead
			if (format && !unsupported) {
				if (openedStat.size > limits.maxCompressedFileBytes)
					return { status: "incomplete", bytesScanned }
				compressedChunks.push(Buffer.from(chunk.subarray(0, bytesRead)))
			}
			if (
				bytesScanned > maximumFileBytes ||
				bytesScanned > remainingTotalBytes
			) {
				return { status: "incomplete", bytesScanned }
			}

			const window = Buffer.concat([overlap, chunk.subarray(0, bytesRead)])
			findPatterns(window, patterns, findingIds)

			const overlapBytes = Math.min(maximumPatternBytes - 1, window.byteLength)
			const nextOverlap = Buffer.from(
				window.subarray(window.byteLength - overlapBytes),
			)
			overlap.fill(0)
			window.fill(0)
			chunk.fill(0)
			overlap = nextOverlap
		}

		let finalStat: Stats
		try {
			finalStat = await handle.stat()
		} catch {
			return { status: "incomplete", bytesScanned }
		}
		if (
			!finalStat.isFile() ||
			finalStat.dev !== openedStat.dev ||
			finalStat.ino !== openedStat.ino ||
			finalStat.size !== openedStat.size ||
			finalStat.size !== bytesScanned ||
			finalStat.mtimeMs !== openedStat.mtimeMs ||
			finalStat.ctimeMs !== openedStat.ctimeMs
		) {
			return { status: "incomplete", bytesScanned }
		}

		if (format && !unsupported) {
			const maximumOutput = Math.min(
				limits.maxDecompressedFileBytes,
				maximumFileBytes,
				remainingTotalBytes - bytesScanned,
			)
			if (maximumOutput <= 0)
				return { status: "incomplete", bytesScanned, findingIds }
			const compressed = Buffer.concat(compressedChunks)
			let decoded: Buffer | undefined
			try {
				const decode = format === "gzip" ? gunzipSync : brotliDecompressSync
				decoded = decode(compressed, { maxOutputLength: maximumOutput })
				decodedBytes = decoded.byteLength
				findPatterns(decoded, patterns, findingIds)
				const innerName = filePath.replace(/\.(?:gz|br)$/i, "")
				unsupported =
					unsupportedContainer(innerName, decoded) ||
					compressedFormat(innerName, decoded) !== undefined
			} catch {
				// A failed decoder may have expanded up to its allowance. Charge
				// that allowance so repeated bombs cannot bypass the shared budget.
				return {
					status: "incomplete",
					bytesScanned,
					findingIds,
					bytesCharged: bytesScanned + maximumOutput,
				}
			} finally {
				compressed.fill(0)
				decoded?.fill(0)
			}
		}
		if (unsupported)
			return {
				status: "incomplete",
				findingIds,
				bytesScanned: bytesScanned + decodedBytes,
			}
		return {
			status: "ok",
			findingIds,
			bytesScanned: bytesScanned + decodedBytes,
		}
	} finally {
		chunk.fill(0)
		overlap.fill(0)
		for (const bytes of compressedChunks) bytes.fill(0)
		try {
			await handle.close()
		} catch {}
	}
}

// Generate a finite set of common build-time representations; no recursive
// decoding or execution of artifact JavaScript. Strings follow runtime GC.
const valueRepresentations = function* (value: string) {
	yield value
	yield JSON.stringify(value).slice(1, -1)
	yield value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")
	const encoded = encodeURIComponent(value)
	yield encoded
	yield encoded.replace(/%[0-9A-F]{2}/g, (match) => match.toLowerCase())
	const unicode = Array.from(
		{ length: value.length },
		(_, index) => `\\u${value.charCodeAt(index).toString(16).padStart(4, "0")}`,
	).join("")
	yield unicode
	yield unicode.replace(
		/\\u([0-9a-f]{4})/g,
		(_, hex: string) => `\\u${hex.toUpperCase()}`,
	)
	const bytes = Buffer.from(value)
	try {
		yield bytes.toString("base64")
		yield bytes.toString("base64").replace(/=+$/, "")
		yield bytes.toString("base64url")
		yield bytes.toString("hex")
		yield bytes.toString("hex").toUpperCase()
	} finally {
		bytes.fill(0)
	}
}

const createPatterns = (
	secretNames: string[],
	environment: NodeJS.ProcessEnv,
) => {
	const buffers: Buffer[] = []
	const patterns: Pattern[] = []
	let patternBytes = 0
	const addPattern = (value: string, id: Pattern["id"]) => {
		if (patternBytes + Buffer.byteLength(value) > MAX_PATTERN_BYTES) {
			throw new ArtifactDoctorInvocationError(
				"The selected values exceed the total pattern budget.",
			)
		}
		const bytes = Buffer.from(value)
		if (
			patterns.some(
				(pattern) => pattern.id === id && pattern.bytes.equals(bytes),
			)
		) {
			bytes.fill(0)
			return
		}
		patternBytes += bytes.byteLength
		buffers.push(bytes)
		patterns.push({ bytes, id })
	}

	try {
		for (const header of PRIVATE_KEY_HEADERS) {
			addPattern(header, "artifact.private-key")
		}
		for (const name of KNOWN_BOOTSTRAP_NAMES) {
			addPattern(name, "artifact.bootstrap-name")
			const value = environment[name]
			if (!value) continue
			const byteLength = Buffer.byteLength(value)
			if (
				byteLength < MIN_SECRET_VALUE_BYTES ||
				byteLength > MAX_SECRET_VALUE_BYTES
			) {
				for (const buffer of buffers) buffer.fill(0)
				throw new ArtifactDoctorInvocationError(
					"An active dotenc bootstrap value cannot be scanned safely because its size is outside the supported range.",
				)
			}
			for (const variant of valueRepresentations(value))
				addPattern(variant, "artifact.bootstrap-value")
		}

		const knownBootstrapNames = new Set<string>(KNOWN_BOOTSTRAP_NAMES)
		for (const name of secretNames) {
			if (!knownBootstrapNames.has(name)) {
				addPattern(name, "artifact.secret-name")
			}
			const value = environment[name]
			if (value === undefined || value === "") {
				for (const buffer of buffers) buffer.fill(0)
				throw new ArtifactDoctorInvocationError(
					"Every selected secret name must identify a non-empty environment value.",
				)
			}
			const byteLength = Buffer.byteLength(value)
			if (
				byteLength < MIN_SECRET_VALUE_BYTES ||
				byteLength > MAX_SECRET_VALUE_BYTES
			) {
				for (const buffer of buffers) buffer.fill(0)
				throw new ArtifactDoctorInvocationError(
					"A selected secret value cannot be scanned safely because its size is outside the supported range.",
				)
			}
			for (const variant of valueRepresentations(value)) {
				addPattern(
					variant,
					knownBootstrapNames.has(name)
						? "artifact.bootstrap-value"
						: "artifact.secret-value",
				)
			}
		}

		return { patterns, buffers }
	} catch (error) {
		for (const buffer of buffers) buffer.fill(0)
		throw error
	}
}

const validateSecretNames = (secretNames: string[]) => {
	const uniqueNames = [...new Set(secretNames)]
	if (uniqueNames.length > MAX_SECRET_NAMES) {
		throw new ArtifactDoctorInvocationError(
			`At most ${MAX_SECRET_NAMES} secret names can be selected.`,
		)
	}
	if (uniqueNames.some((name) => !SECRET_NAME_PATTERN.test(name))) {
		throw new ArtifactDoctorInvocationError(
			"Secret names must use environment-variable identifier syntax.",
		)
	}
	return uniqueNames
}

const findingDetails: Record<
	Exclude<ArtifactDoctorFindingId, "invocation.invalid" | "scan.incomplete">,
	{
		severity: ArtifactDoctorSeverity
		subject: string
		message: (count: number) => string
	}
> = {
	"artifact.plaintext-env": {
		severity: "error",
		subject: "plaintext environment",
		message: (count) =>
			`${plural(count, "plaintext environment file")} present in the artifact directory.`,
	},
	"artifact.private-key": {
		severity: "error",
		subject: "private key",
		message: (count) =>
			`Private-key material appears in ${plural(count, "artifact file")}.`,
	},
	"artifact.bootstrap-value": {
		severity: "error",
		subject: "bootstrap value",
		message: (count) =>
			`An active dotenc bootstrap value appears in ${plural(count, "artifact file")}.`,
	},
	"artifact.secret-value": {
		severity: "error",
		subject: "selected secret value",
		message: (count) =>
			`An explicitly selected environment value appears in ${plural(count, "artifact file")}.`,
	},
	"artifact.bootstrap-name": {
		severity: "warning",
		subject: "bootstrap variable name",
		message: (count) =>
			`A dotenc bootstrap variable name appears in ${plural(count, "artifact file")}; confirm that no value is embedded.`,
	},
	"artifact.secret-name": {
		severity: "warning",
		subject: "selected secret name",
		message: (count) =>
			`An explicitly selected secret name appears in ${plural(count, "artifact file")}; confirm that the runtime reference is intentional.`,
	},
}

const orderedFindingIds: ArtifactDoctorFindingId[] = [
	"artifact.plaintext-env",
	"artifact.private-key",
	"artifact.bootstrap-value",
	"artifact.secret-value",
	"artifact.bootstrap-name",
	"artifact.secret-name",
	"scan.incomplete",
]

const renderFindings = (
	state: ScanState,
	limits: ArtifactDoctorLimits,
): ArtifactDoctorFinding[] => {
	const findings: ArtifactDoctorFinding[] = []
	for (const id of orderedFindingIds) {
		const accumulated = state.findings.get(id)
		if (!accumulated) continue
		const paths = [...accumulated.paths]
			.sort((left, right) => left.localeCompare(right))
			.slice(0, limits.maxReportedPaths)
		const omitted = Math.max(0, accumulated.paths.size - paths.length)
		if (id === "scan.incomplete") {
			findings.push({
				id,
				severity: "warning",
				subject: "scan",
				message: `${plural(accumulated.count, "artifact entry")} could not be scanned safely.${omitted > 0 ? ` ${plural(omitted, "path")} omitted from this bounded report.` : ""}`,
				count: accumulated.count,
				...(paths.length > 0 ? { paths } : {}),
			})
			continue
		}
		if (id === "invocation.invalid") continue
		const details = findingDetails[id]
		findings.push({
			id,
			severity: details.severity,
			subject: details.subject,
			message: `${details.message(accumulated.count)}${omitted > 0 ? ` ${plural(omitted, "path")} omitted from this bounded report.` : ""}`,
			count: accumulated.count,
			...(paths.length > 0 ? { paths } : {}),
		})
	}
	return findings
}

export const createArtifactDoctorReport = async (
	directory: string,
	options: ArtifactDoctorOptions = {},
	dependencyOverrides: ArtifactDoctorDependencyOverrides = {},
): Promise<ArtifactDoctorReport> => {
	const dependencies = {
		...defaultDependencies,
		...(dependencyOverrides.environment
			? { environment: dependencyOverrides.environment }
			: {}),
	}
	const limits = {
		...DEFAULT_ARTIFACT_DOCTOR_LIMITS,
		...dependencyOverrides.limits,
	}
	const secretNames = validateSecretNames(options.secretNames ?? [])
	const invocationDir = path.resolve(options.invocationDir ?? process.cwd())
	const root = path.resolve(invocationDir, directory)

	let rootStat: Stats
	try {
		rootStat = await fs.lstat(root)
	} catch (error) {
		throw new ArtifactDoctorInvocationError(
			hasErrnoCode(error, "ENOENT")
				? "The artifact directory does not exist."
				: "The artifact directory could not be inspected.",
		)
	}
	if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
		throw new ArtifactDoctorInvocationError(
			"The artifact path must be a real directory, not a file or symbolic link.",
		)
	}

	const { patterns, buffers } = createPatterns(
		secretNames,
		dependencies.environment,
	)
	const state: ScanState = {
		complete: true,
		filesSeen: 0,
		filesScanned: 0,
		directoriesScanned: 0,
		entriesSeen: 0,
		bytesScanned: 0,
		bytesCharged: 0,
		findings: new Map(),
	}
	const directories = [root]
	const reportPath = (entryPath: string) => {
		const relative = normalizeArtifactPath(root, entryPath)
		if (!relative) return undefined
		const bytes = Buffer.from(relative)
		try {
			return patterns.some((pattern) => bytes.indexOf(pattern.bytes) !== -1)
				? undefined
				: relative
		} finally {
			bytes.fill(0)
		}
	}

	try {
		while (directories.length > 0) {
			if (state.directoriesScanned >= limits.maxDirectories) {
				markIncomplete(state)
				break
			}
			const currentDirectory = directories.pop()
			if (!currentDirectory) break
			let currentDirectoryStat: Stats
			try {
				currentDirectoryStat = await fs.lstat(currentDirectory)
			} catch {
				markIncomplete(state, reportPath(currentDirectory))
				continue
			}
			if (
				currentDirectoryStat.isSymbolicLink() ||
				!currentDirectoryStat.isDirectory()
			) {
				markIncomplete(state, reportPath(currentDirectory))
				continue
			}
			const entries = await readDirectory(
				currentDirectory,
				limits.maxDirectoryEntries,
			)
			if (!entries) {
				markIncomplete(state, reportPath(currentDirectory))
				continue
			}
			state.directoriesScanned += 1

			for (const entry of entries) {
				state.entriesSeen += 1
				if (state.entriesSeen > limits.maxEntries) {
					markIncomplete(state)
					directories.length = 0
					break
				}

				const entryPath = path.join(currentDirectory, entry.name)
				const relativePath = normalizeArtifactPath(root, entryPath)
				if (!relativePath) {
					markIncomplete(state)
					continue
				}
				let entryStat: Stats
				try {
					entryStat = await fs.lstat(entryPath)
				} catch {
					markIncomplete(state, reportPath(entryPath))
					continue
				}
				if (entryStat.isSymbolicLink()) {
					markIncomplete(state, reportPath(entryPath))
					continue
				}
				if (entryStat.isDirectory()) {
					directories.push(entryPath)
					continue
				}
				if (!entryStat.isFile()) {
					markIncomplete(state, reportPath(entryPath))
					continue
				}
				if (
					isPlaintextEnvironmentFile(entry.name.replace(/\.(?:gz|br)$/i, ""))
				) {
					recordFinding(state, "artifact.plaintext-env", reportPath(entryPath))
				}
				state.filesSeen += 1
				if (state.filesSeen > limits.maxFiles) {
					markIncomplete(state)
					directories.length = 0
					break
				}

				const result = await scanRegularFile(
					entryPath,
					entryStat,
					patterns,
					limits.maxFileBytes,
					limits.maxTotalBytes - state.bytesCharged,
					limits,
				)
				state.bytesScanned += result.bytesScanned
				state.bytesCharged +=
					(result.status === "incomplete" ? result.bytesCharged : undefined) ??
					result.bytesScanned
				for (const id of result.findingIds ?? []) {
					recordFinding(state, id, reportPath(entryPath))
				}
				if (result.status === "incomplete") {
					markIncomplete(state, reportPath(entryPath))
					continue
				}
				state.filesScanned += 1
			}
		}
	} finally {
		for (const buffer of buffers) buffer.fill(0)
	}

	const findings = renderFindings(state, limits)
	const errors = findings.filter((entry) => entry.severity === "error").length
	const warnings = findings.filter(
		(entry) => entry.severity === "warning",
	).length
	const exitCode: 0 | 1 | 2 = !state.complete
		? 2
		: errors > 0 || (options.strict === true && warnings > 0)
			? 1
			: 0

	return {
		schemaVersion: ARTIFACT_DOCTOR_REPORT_SCHEMA_VERSION,
		command: "doctor artifacts",
		complete: state.complete,
		scope: { directory: ".", selectedSecrets: secretNames.length },
		findings,
		passed: state.complete
			? [
					{
						id: "artifacts.scanned",
						subject: "artifacts",
						message: `Scanned ${plural(state.filesScanned, "file")} across ${plural(state.directoriesScanned, "directory", "directories")}.`,
					},
				]
			: [],
		summary: {
			errors,
			warnings,
			filesScanned: state.filesScanned,
			directoriesScanned: state.directoriesScanned,
			bytesScanned: state.bytesScanned,
		},
		exitCode,
	}
}
