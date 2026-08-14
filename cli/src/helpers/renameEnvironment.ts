import { createHash, randomUUID } from "node:crypto"
import { constants, existsSync, type Stats } from "node:fs"
import type { FileHandle } from "node:fs/promises"
import fs from "node:fs/promises"
import path from "node:path"
import type { Environment } from "../schemas/environment"
import { ENVIRONMENT_DIFF_LIMITS } from "../schemas/environmentDiffReport"
import { buildAncestorChain } from "./buildAncestorChain"
import {
	createDecryptEnvironmentDataContext,
	type DecryptEnvironmentDataContext,
	decryptEnvironmentData,
	reencryptEnvironmentData,
} from "./decryptEnvironment"
import { parseEnvironmentDocument } from "./parseEnvironmentDocument"
import { resolveProjectRoot } from "./resolveProjectRoot"
import { validateEnvironmentName } from "./validateEnvironmentName"

type FileSnapshot = {
	bytes: Buffer
	device: number
	hash: string
	inode: number
	mode: number
}

type EnvironmentSnapshot = FileSnapshot & {
	environment: Environment
}

type PreparedRenameLayer = {
	sourcePath: string
	targetPath: string
	sourceDevice: number
	sourceHash: string
	sourceInode: number
	sourceMode: number
	targetDevice?: number
	targetInode?: number
	plaintext: string
	targetEnvironment: Environment
	targetBytes: Buffer
	targetHash: string
	targetRecovery?: QuarantinedObject
}

export type EnvironmentRenameLayer = {
	sourcePath: string
	targetPath: string
}

export type RenameTargetVerification = {
	targetPath: string
	destinationName: string
	expectedEnvironment: Environment
	expectedPlaintext: string
	expectedHash: string
	expectedMode: number
}

export type RenameEnvironmentDependencies = {
	cwd: () => string
	platform: NodeJS.Platform
	existsSync: typeof existsSync
	lstat: typeof fs.lstat
	open: typeof fs.open
	chmod: typeof fs.chmod
	link: typeof fs.link
	mkdtemp: typeof fs.mkdtemp
	rename: typeof fs.rename
	rmdir: typeof fs.rmdir
	unlink: typeof fs.unlink
	randomUUID: typeof randomUUID
	buildAncestorChain: typeof buildAncestorChain
	resolveProjectRoot: typeof resolveProjectRoot
	parseEnvironmentDocument: typeof parseEnvironmentDocument
	createDecryptEnvironmentDataContext: typeof createDecryptEnvironmentDataContext
	decryptEnvironmentData: typeof decryptEnvironmentData
	reencryptEnvironmentData: typeof reencryptEnvironmentData
	syncDirectory?: (directory: string) => Promise<void>
	verifyTarget?: (
		verification: RenameTargetVerification,
		context: DecryptEnvironmentDataContext,
	) => Promise<void>
}

export type PrepareEnvironmentRenameOptions = {
	sourceName: string
	destinationName: string
	allLayers?: boolean
	invocationDir?: string
}

export type PreparedEnvironmentRename = {
	layers: readonly EnvironmentRenameLayer[]
	projectRoot: string
	commit: () => Promise<void>
	dispose: () => void
}

const defaultDependencies: Omit<
	RenameEnvironmentDependencies,
	"syncDirectory" | "verifyTarget"
> = {
	cwd: () => process.cwd(),
	platform: process.platform,
	existsSync,
	lstat: fs.lstat,
	open: fs.open,
	chmod: fs.chmod,
	link: fs.link,
	mkdtemp: fs.mkdtemp,
	rename: fs.rename,
	rmdir: fs.rmdir,
	unlink: fs.unlink,
	randomUUID,
	buildAncestorChain,
	resolveProjectRoot,
	parseEnvironmentDocument,
	createDecryptEnvironmentDataContext,
	decryptEnvironmentData,
	reencryptEnvironmentData,
}

const hashBytes = (bytes: Buffer): string =>
	createHash("sha256").update(bytes).digest("hex")

const isMissing = (error: unknown): boolean =>
	error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT"

const lstatIfPresent = async (
	filePath: string,
	deps: RenameEnvironmentDependencies,
): Promise<Stats | undefined> => {
	try {
		return await deps.lstat(filePath)
	} catch (error) {
		if (isMissing(error)) return undefined
		throw error
	}
}

const readBounded = async (handle: FileHandle): Promise<Buffer> => {
	const input = Buffer.alloc(ENVIRONMENT_DIFF_LIMITS.maxFileBytes + 1)
	let offset = 0
	try {
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
		if (offset > ENVIRONMENT_DIFF_LIMITS.maxFileBytes) {
			throw new Error("Encrypted environment exceeds the file-size limit.")
		}
		return Buffer.from(input.subarray(0, offset))
	} finally {
		input.fill(0)
	}
}

const sameFileIdentity = (left: Stats, right: Stats): boolean =>
	left.dev === right.dev && left.ino === right.ino

const sameStableStat = (left: Stats, right: Stats): boolean =>
	sameFileIdentity(left, right) &&
	left.size === right.size &&
	left.mtimeMs === right.mtimeMs &&
	left.ctimeMs === right.ctimeMs

const readRegularFileSnapshot = async (
	filePath: string,
	deps: RenameEnvironmentDependencies,
): Promise<FileSnapshot> => {
	const pathStat = await deps.lstat(filePath)
	if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
		throw new Error(
			"Encrypted environment must be a regular, non-symlink file.",
		)
	}

	const noFollow = deps.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0)
	let handle: FileHandle
	try {
		handle = await deps.open(filePath, constants.O_RDONLY | noFollow)
	} catch {
		throw new Error("Encrypted environment could not be opened safely.")
	}

	try {
		const beforeRead = await handle.stat()
		if (!beforeRead.isFile() || !sameFileIdentity(pathStat, beforeRead)) {
			throw new Error("Encrypted environment changed during validation.")
		}
		if (beforeRead.size > ENVIRONMENT_DIFF_LIMITS.maxFileBytes) {
			throw new Error("Encrypted environment exceeds the file-size limit.")
		}

		const bytes = await readBounded(handle)
		const afterRead = await handle.stat()
		if (!sameStableStat(beforeRead, afterRead)) {
			bytes.fill(0)
			throw new Error("Encrypted environment changed during validation.")
		}

		return {
			bytes,
			device: beforeRead.dev,
			hash: hashBytes(bytes),
			inode: beforeRead.ino,
			mode: beforeRead.mode & 0o777,
		}
	} finally {
		await handle.close().catch(() => {})
	}
}

const parseSnapshot = (
	snapshot: FileSnapshot,
	deps: RenameEnvironmentDependencies,
): EnvironmentSnapshot => {
	let source: string
	try {
		source = new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes)
	} catch {
		throw new Error("Encrypted environment is not valid UTF-8 JSON.")
	}

	return {
		...snapshot,
		environment: deps.parseEnvironmentDocument(source),
	}
}

const syncDirectoryDefault = async (
	directory: string,
	deps: RenameEnvironmentDependencies,
): Promise<void> => {
	if (deps.platform === "win32") return
	const directoryFlag = constants.O_DIRECTORY ?? 0
	const handle = await deps.open(directory, constants.O_RDONLY | directoryFlag)
	try {
		await handle.sync()
	} finally {
		await handle.close().catch(() => {})
	}
}

const recipientsEqual = (
	left: Environment["keys"],
	right: Environment["keys"],
): boolean =>
	left.length === right.length &&
	left.every((recipient, index) => {
		const other = right[index]
		return (
			other !== undefined &&
			recipient.name === other.name &&
			recipient.fingerprint === other.fingerprint &&
			recipient.encryptedDataKey === other.encryptedDataKey &&
			recipient.algorithm === other.algorithm
		)
	})

const verifyTargetDefault = async (
	verification: RenameTargetVerification,
	context: DecryptEnvironmentDataContext,
	deps: RenameEnvironmentDependencies,
): Promise<void> => {
	const snapshot = await readRegularFileSnapshot(verification.targetPath, deps)
	try {
		const targetSnapshot = parseSnapshot(snapshot, deps)
		if (
			targetSnapshot.hash !== verification.expectedHash ||
			targetSnapshot.environment.version !== 2 ||
			(deps.platform !== "win32" &&
				targetSnapshot.mode !== verification.expectedMode) ||
			!recipientsEqual(
				targetSnapshot.environment.keys,
				verification.expectedEnvironment.keys,
			)
		) {
			throw new Error(
				"Created destination did not match the prepared envelope.",
			)
		}

		const plaintext = await deps.decryptEnvironmentData(
			verification.destinationName,
			targetSnapshot.environment,
			context,
		)
		if (plaintext !== verification.expectedPlaintext) {
			throw new Error("Created destination plaintext verification failed.")
		}
	} finally {
		snapshot.bytes.fill(0)
	}
}

type FileIdentity = {
	device: number
	inode: number
}

type QuarantinedObject = {
	directory: string
	moved: boolean
	originalPath: string
	path: string
}

type SourceQuarantine = QuarantinedObject & {
	layer: PreparedRenameLayer
}

const snapshotMatches = (
	snapshot: FileSnapshot,
	expected: FileIdentity & { hash: string; mode: number },
	checkMode = true,
): boolean =>
	snapshot.device === expected.device &&
	snapshot.inode === expected.inode &&
	snapshot.hash === expected.hash &&
	(!checkMode || snapshot.mode === expected.mode)

const createTarget = async (
	layer: PreparedRenameLayer,
	onCreated: (identity: FileIdentity, recovery: QuarantinedObject) => void,
	deps: RenameEnvironmentDependencies,
	syncDirectory: (directory: string) => Promise<void>,
): Promise<void> => {
	const directory = path.dirname(layer.targetPath)
	const recovery = await createPrivateQuarantine(
		layer.targetPath,
		deps,
		syncDirectory,
	)
	let handle: FileHandle | undefined
	let handedOff = false
	try {
		handle = await deps.open(recovery.path, "wx", layer.sourceMode)
		recovery.moved = true
		await handle.writeFile(layer.targetBytes)
		await handle.chmod(layer.sourceMode)
		await handle.sync()
		const recoveryStat = await handle.stat()
		if (!recoveryStat.isFile()) {
			throw new Error("Prepared destination is not a regular file.")
		}
		await handle.close()
		handle = undefined
		await syncDirectory(recovery.directory)

		// Publish the already-synced recovery inode without replacing an existing
		// destination. The private link remains until source cleanup is complete,
		// closing the path-disappearance window around destructive source removal.
		await deps.link(recovery.path, layer.targetPath)
		onCreated({ device: recoveryStat.dev, inode: recoveryStat.ino }, recovery)
		handedOff = true
		await syncDirectory(directory)
	} finally {
		await handle?.close().catch(() => {})
		if (!handedOff) {
			if (recovery.moved) {
				await deps.unlink(recovery.path).catch(() => {})
				recovery.moved = Boolean(
					await lstatIfPresent(recovery.path, deps).catch(() => true),
				)
			}
			await cleanupEmptyQuarantine(recovery, deps, syncDirectory)
		}
	}
}

const cleanupEmptyQuarantine = async (
	quarantine: QuarantinedObject,
	deps: RenameEnvironmentDependencies,
	syncDirectory: (directory: string) => Promise<void>,
): Promise<void> => {
	if (quarantine.moved) return
	try {
		await deps.rmdir(quarantine.directory)
		await syncDirectory(path.dirname(quarantine.directory))
	} catch {
		// The directory may still contain a recovery object or may already be gone.
	}
}

const createPrivateQuarantine = async (
	originalPath: string,
	deps: RenameEnvironmentDependencies,
	syncDirectory: (directory: string) => Promise<void>,
): Promise<QuarantinedObject> => {
	const parent = path.dirname(originalPath)
	const directory = await deps.mkdtemp(
		path.join(parent, `.dotenc-rename-quarantine-${process.pid}-`),
	)
	const quarantine: QuarantinedObject = {
		directory,
		moved: false,
		originalPath,
		path: path.join(directory, "entry"),
	}

	try {
		if (deps.platform === "win32") {
			await deps.chmod(directory, 0o700)
			const directoryStat = await deps.lstat(directory)
			if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
				throw new Error("Rename quarantine is not a private directory.")
			}
		} else {
			const pathStat = await deps.lstat(directory)
			const directoryHandle = await deps.open(
				directory,
				constants.O_RDONLY |
					(constants.O_DIRECTORY ?? 0) |
					(constants.O_NOFOLLOW ?? 0),
			)
			try {
				const openedStat = await directoryHandle.stat()
				if (
					pathStat.isSymbolicLink() ||
					!openedStat.isDirectory() ||
					!sameFileIdentity(pathStat, openedStat)
				) {
					throw new Error("Rename quarantine is not a private directory.")
				}
				await directoryHandle.chmod(0o700)
			} finally {
				await directoryHandle.close().catch(() => {})
			}
		}
		await syncDirectory(parent)
		return quarantine
	} catch (error) {
		await cleanupEmptyQuarantine(quarantine, deps, syncDirectory)
		throw error
	}
}

const moveToQuarantine = async (
	quarantine: QuarantinedObject,
	deps: RenameEnvironmentDependencies,
	syncDirectory: (directory: string) => Promise<void>,
): Promise<void> => {
	await deps.rename(quarantine.originalPath, quarantine.path)
	quarantine.moved = true
	await syncDirectory(path.dirname(quarantine.originalPath))
	await syncDirectory(quarantine.directory)
}

const retainedQuarantinePaths = async (
	quarantine: QuarantinedObject,
	deps: RenameEnvironmentDependencies,
): Promise<string[]> => {
	if (!quarantine.moved) return []
	try {
		return (await lstatIfPresent(quarantine.path, deps))
			? [quarantine.path]
			: []
	} catch {
		return [quarantine.path]
	}
}

/** Restore by exclusive hard link so a concurrently-created path is never replaced. */
const restoreQuarantinedObject = async (
	quarantine: QuarantinedObject,
	deps: RenameEnvironmentDependencies,
	syncDirectory: (directory: string) => Promise<void>,
): Promise<string[]> => {
	if (!quarantine.moved) {
		await cleanupEmptyQuarantine(quarantine, deps, syncDirectory)
		return []
	}

	try {
		await deps.link(quarantine.path, quarantine.originalPath)
		await syncDirectory(path.dirname(quarantine.originalPath))
	} catch {
		const retained = await retainedQuarantinePaths(quarantine, deps)
		// An unexpectedly missing quarantine object is still an unresolved source
		// state. Keep verified destinations instead of treating restoration as
		// successful and deleting the only remaining recovery copy.
		return retained.length > 0 ? retained : [quarantine.path]
	}

	try {
		await deps.unlink(quarantine.path)
		quarantine.moved = false
		await syncDirectory(quarantine.directory)
	} catch {
		return retainedQuarantinePaths(quarantine, deps)
	}
	await cleanupEmptyQuarantine(quarantine, deps, syncDirectory)
	return []
}

const deleteVerifiedQuarantine = async (
	quarantine: QuarantinedObject,
	deps: RenameEnvironmentDependencies,
	syncDirectory: (directory: string) => Promise<void>,
): Promise<void> => {
	await deps.unlink(quarantine.path)
	quarantine.moved = false
	await syncDirectory(quarantine.directory)
	await cleanupEmptyQuarantine(quarantine, deps, syncDirectory)
}

const expectedTargetIdentity = (
	layer: PreparedRenameLayer,
): (FileIdentity & { hash: string; mode: number }) | undefined =>
	layer.targetDevice === undefined || layer.targetInode === undefined
		? undefined
		: {
				device: layer.targetDevice,
				hash: layer.targetHash,
				inode: layer.targetInode,
				mode: layer.sourceMode,
			}

const discardTargetRecovery = async (
	layer: PreparedRenameLayer,
	deps: RenameEnvironmentDependencies,
	syncDirectory: (directory: string) => Promise<void>,
): Promise<string[]> => {
	const recovery = layer.targetRecovery
	if (!recovery) return []
	if (!recovery.moved) {
		await cleanupEmptyQuarantine(recovery, deps, syncDirectory)
		return []
	}

	const expected = expectedTargetIdentity(layer)
	if (!expected) return [recovery.path]
	let snapshot: FileSnapshot | undefined
	try {
		snapshot = await readRegularFileSnapshot(recovery.path, deps)
		if (!snapshotMatches(snapshot, expected, deps.platform !== "win32")) {
			return [recovery.path]
		}
		await deleteVerifiedQuarantine(recovery, deps, syncDirectory)
		return []
	} catch (error) {
		if (isMissing(error)) {
			recovery.moved = false
			await cleanupEmptyQuarantine(recovery, deps, syncDirectory)
			return []
		}
		return [recovery.path]
	} finally {
		snapshot?.bytes.fill(0)
	}
}

/**
 * Keep or restore the exact verified destination inode before releasing its
 * private recovery link. Exclusive linking never overwrites a concurrent path.
 */
const finalizeTargetRecovery = async (
	layer: PreparedRenameLayer,
	deps: RenameEnvironmentDependencies,
	syncDirectory: (directory: string) => Promise<void>,
): Promise<string[]> => {
	const recovery = layer.targetRecovery
	const expected = expectedTargetIdentity(layer)
	if (!recovery || !recovery.moved || !expected) {
		return [layer.targetPath, ...(recovery?.moved ? [recovery.path] : [])]
	}

	let recoverySnapshot: FileSnapshot | undefined
	try {
		recoverySnapshot = await readRegularFileSnapshot(recovery.path, deps)
		if (
			!snapshotMatches(recoverySnapshot, expected, deps.platform !== "win32")
		) {
			return [layer.targetPath, recovery.path]
		}
	} catch {
		return [layer.targetPath, recovery.path]
	} finally {
		recoverySnapshot?.bytes.fill(0)
	}

	let targetSnapshot: FileSnapshot | undefined
	try {
		try {
			targetSnapshot = await readRegularFileSnapshot(layer.targetPath, deps)
		} catch (error) {
			if (!isMissing(error)) return [layer.targetPath, recovery.path]

			try {
				await deps.link(recovery.path, layer.targetPath)
				await syncDirectory(path.dirname(layer.targetPath))
			} catch {
				// A writer may have won the exclusive-create race. Inspect that path
				// below; never overwrite it.
			}
			targetSnapshot = await readRegularFileSnapshot(layer.targetPath, deps)
		}

		if (!snapshotMatches(targetSnapshot, expected, deps.platform !== "win32")) {
			return [layer.targetPath, recovery.path]
		}
	} catch {
		return [layer.targetPath, recovery.path]
	} finally {
		targetSnapshot?.bytes.fill(0)
	}

	const retainedRecovery = await discardTargetRecovery(
		layer,
		deps,
		syncDirectory,
	)
	return retainedRecovery
}

const finalizeTargetRecoveries = async (
	layers: PreparedRenameLayer[],
	deps: RenameEnvironmentDependencies,
	syncDirectory: (directory: string) => Promise<void>,
): Promise<string[]> => {
	const retained: string[] = []
	for (const layer of layers) {
		retained.push(...(await finalizeTargetRecovery(layer, deps, syncDirectory)))
	}
	return [...new Set(retained)]
}

const rollbackCreatedTargets = async (
	created: PreparedRenameLayer[],
	deps: RenameEnvironmentDependencies,
	syncDirectory: (directory: string) => Promise<void>,
): Promise<string[]> => {
	const retained: string[] = []
	for (const layer of [...created].reverse()) {
		let quarantine: QuarantinedObject | undefined
		let snapshot: FileSnapshot | undefined
		try {
			if (layer.targetDevice === undefined || layer.targetInode === undefined) {
				retained.push(layer.targetPath)
				continue
			}
			quarantine = await createPrivateQuarantine(
				layer.targetPath,
				deps,
				syncDirectory,
			)
			await moveToQuarantine(quarantine, deps, syncDirectory)
			snapshot = await readRegularFileSnapshot(quarantine.path, deps)
			if (
				!snapshotMatches(
					snapshot,
					{
						device: layer.targetDevice,
						hash: layer.targetHash,
						inode: layer.targetInode,
						mode: layer.sourceMode,
					},
					deps.platform !== "win32",
				)
			) {
				retained.push(layer.targetPath)
				retained.push(
					...(await restoreQuarantinedObject(quarantine, deps, syncDirectory)),
				)
				continue
			}
			await deleteVerifiedQuarantine(quarantine, deps, syncDirectory)
			try {
				if (await lstatIfPresent(layer.targetPath, deps)) {
					retained.push(layer.targetPath)
				}
			} catch {
				retained.push(layer.targetPath)
			}
		} catch (error) {
			if (quarantine?.moved) {
				retained.push(layer.targetPath)
				retained.push(
					...(await restoreQuarantinedObject(quarantine, deps, syncDirectory)),
				)
			} else if (!isMissing(error)) {
				retained.push(layer.targetPath)
			}
		} finally {
			snapshot?.bytes.fill(0)
			if (quarantine && !quarantine.moved) {
				await cleanupEmptyQuarantine(quarantine, deps, syncDirectory)
			}
		}
	}
	for (const layer of [...created].reverse()) {
		retained.push(...(await discardTargetRecovery(layer, deps, syncDirectory)))
	}
	return [...new Set(retained)]
}

const restoreSourceQuarantines = async (
	quarantines: SourceQuarantine[],
	deps: RenameEnvironmentDependencies,
	syncDirectory: (directory: string) => Promise<void>,
): Promise<string[]> => {
	const retained: string[] = []
	for (const quarantine of [...quarantines].reverse()) {
		retained.push(
			...(await restoreQuarantinedObject(quarantine, deps, syncDirectory)),
		)
	}
	return [...new Set(retained)]
}

const quotePaths = (paths: string[]): string =>
	paths.length > 0
		? paths.map((filePath) => JSON.stringify(filePath)).join(", ")
		: "(none)"

const describeIncompleteCleanup = async (
	layers: PreparedRenameLayer[],
	deps: RenameEnvironmentDependencies,
	quarantines: SourceQuarantine[] = [],
	targetRecoveryPaths: string[] = [],
): Promise<string> => {
	const removed: string[] = []
	const remaining: string[] = []
	const unknown: string[] = []
	for (const layer of layers) {
		try {
			const stat = await lstatIfPresent(layer.sourcePath, deps)
			if (stat) remaining.push(layer.sourcePath)
			else removed.push(layer.sourcePath)
		} catch {
			unknown.push(layer.sourcePath)
		}
	}
	const retainedQuarantines: string[] = []
	for (const quarantine of quarantines) {
		retainedQuarantines.push(
			...(await retainedQuarantinePaths(quarantine, deps)),
		)
	}

	return [
		"Environment rename cleanup is incomplete. Verified destination files were kept for recovery.",
		`Removed source layers: ${quotePaths(removed)}.`,
		`Remaining source layers: ${quotePaths(remaining)}.`,
		`Source layers with unknown state: ${quotePaths(unknown)}.`,
		`Retained source quarantines: ${quotePaths([...new Set(retainedQuarantines)])}.`,
		`Verified destination layers: ${quotePaths(layers.map((layer) => layer.targetPath))}.`,
		`Destination recovery paths requiring attention: ${quotePaths([...new Set(targetRecoveryPaths)])}.`,
	].join("\n")
}

const validateRenameNames = (sourceName: string, destinationName: string) => {
	for (const [label, name] of [
		["source", sourceName],
		["destination", destinationName],
	] as const) {
		const validation = validateEnvironmentName(name)
		if (!validation.valid) {
			throw new Error(`Invalid ${label} environment: ${validation.reason}`)
		}
	}
	if (sourceName === destinationName) {
		throw new Error("Source and destination environments must be different.")
	}
}

export const prepareEnvironmentRename = async (
	options: PrepareEnvironmentRenameOptions,
	overrides: Partial<RenameEnvironmentDependencies> = {},
): Promise<PreparedEnvironmentRename> => {
	validateRenameNames(options.sourceName, options.destinationName)
	const deps: RenameEnvironmentDependencies = {
		...defaultDependencies,
		...overrides,
	}
	const invocationDir = path.resolve(options.invocationDir ?? deps.cwd())
	const projectRoot = options.allLayers
		? deps.resolveProjectRoot(invocationDir, deps.existsSync)
		: invocationDir
	const directories = options.allLayers
		? deps.buildAncestorChain(projectRoot, invocationDir)
		: [invocationDir]

	const sourcePaths: string[] = []
	for (const directory of directories) {
		const sourcePath = path.join(directory, `.env.${options.sourceName}.enc`)
		const targetPath = path.join(
			directory,
			`.env.${options.destinationName}.enc`,
		)
		let sourceStat: Stats | undefined
		let targetStat: Stats | undefined
		try {
			;[sourceStat, targetStat] = await Promise.all([
				lstatIfPresent(sourcePath, deps),
				lstatIfPresent(targetPath, deps),
			])
		} catch {
			throw new Error(
				"Environment rename preflight could not inspect all paths.",
			)
		}
		if (targetStat) {
			throw new Error(`Destination environment already exists: ${targetPath}`)
		}
		if (sourceStat) sourcePaths.push(sourcePath)
	}

	if (sourcePaths.length === 0) {
		throw new Error(`Source environment not found: ${options.sourceName}`)
	}

	const context = deps.createDecryptEnvironmentDataContext()
	const prepared: PreparedRenameLayer[] = []
	try {
		for (const sourcePath of sourcePaths) {
			let sourceSnapshot: EnvironmentSnapshot
			let sourceFileSnapshot: FileSnapshot | undefined
			try {
				sourceFileSnapshot = await readRegularFileSnapshot(sourcePath, deps)
				sourceSnapshot = parseSnapshot(sourceFileSnapshot, deps)
			} catch {
				throw new Error(
					`Environment rename preflight rejected source: ${sourcePath}`,
				)
			} finally {
				sourceFileSnapshot?.bytes.fill(0)
			}

			let plaintext: string
			let encryptedContent: Buffer
			try {
				;({ encryptedContent, plaintext } = await deps.reencryptEnvironmentData(
					options.sourceName,
					options.destinationName,
					sourceSnapshot.environment,
					context,
				))
			} catch {
				throw new Error(
					`Environment rename preflight could not decrypt source with its current name: ${sourcePath}`,
				)
			}

			const targetEnvironment: Environment = {
				version: 2,
				keys: sourceSnapshot.environment.keys.map((recipient) => ({
					...recipient,
				})),
				encryptedContent: encryptedContent.toString("base64"),
			}
			encryptedContent.fill(0)
			const targetBytes = Buffer.from(
				JSON.stringify(targetEnvironment, null, 2),
				"utf-8",
			)
			prepared.push({
				sourcePath,
				targetPath: path.join(
					path.dirname(sourcePath),
					`.env.${options.destinationName}.enc`,
				),
				sourceDevice: sourceSnapshot.device,
				sourceHash: sourceSnapshot.hash,
				sourceInode: sourceSnapshot.inode,
				sourceMode: sourceSnapshot.mode,
				plaintext,
				targetEnvironment,
				targetBytes,
				targetHash: hashBytes(targetBytes),
			})
		}
	} catch (error) {
		context.dispose()
		for (const layer of prepared) {
			layer.plaintext = ""
			layer.targetBytes.fill(0)
		}
		throw error
	}

	let state: "prepared" | "applying" | "finished" | "disposed" = "prepared"
	const syncDirectory =
		deps.syncDirectory ?? ((directory) => syncDirectoryDefault(directory, deps))
	const verifyTarget =
		deps.verifyTarget ??
		((verification, verificationContext) =>
			verifyTargetDefault(verification, verificationContext, deps))

	const dispose = () => {
		if (state === "disposed") return
		context.dispose()
		for (const layer of prepared) {
			layer.plaintext = ""
			layer.targetBytes.fill(0)
		}
		state = "disposed"
	}

	return {
		layers: prepared.map(({ sourcePath, targetPath }) => ({
			sourcePath,
			targetPath,
		})),
		projectRoot,
		commit: async () => {
			if (state !== "prepared") {
				throw new Error("Environment rename transaction is no longer usable.")
			}
			state = "applying"
			const created: PreparedRenameLayer[] = []
			const sourceQuarantines: SourceQuarantine[] = []
			const unresolvedSourcePaths: string[] = []

			try {
				for (const layer of prepared) {
					await createTarget(
						layer,
						(identity, recovery) => {
							layer.targetDevice = identity.device
							layer.targetInode = identity.inode
							layer.targetRecovery = recovery
							created.push(layer)
						},
						deps,
						syncDirectory,
					)
				}

				for (const layer of prepared) {
					await verifyTarget(
						{
							targetPath: layer.targetPath,
							destinationName: options.destinationName,
							expectedEnvironment: layer.targetEnvironment,
							expectedPlaintext: layer.plaintext,
							expectedHash: layer.targetHash,
							expectedMode: layer.sourceMode,
						},
						context,
					)
				}

				// Move every source out of the live namespace before deleting any source
				// inode. Verification is performed against the quarantined inode, so a
				// concurrent path replacement cannot be mistaken for the preflight object.
				for (const layer of prepared) {
					const quarantine = {
						...(await createPrivateQuarantine(
							layer.sourcePath,
							deps,
							syncDirectory,
						)),
						layer,
					}
					sourceQuarantines.push(quarantine)
					try {
						await moveToQuarantine(quarantine, deps, syncDirectory)
					} catch (error) {
						if (isMissing(error)) unresolvedSourcePaths.push(layer.sourcePath)
						throw error
					}
					let snapshot: FileSnapshot | undefined
					try {
						snapshot = await readRegularFileSnapshot(quarantine.path, deps)
						if (
							!snapshotMatches(snapshot, {
								device: layer.sourceDevice,
								hash: layer.sourceHash,
								inode: layer.sourceInode,
								mode: layer.sourceMode,
							})
						) {
							throw new Error("A source environment changed after preflight.")
						}
					} finally {
						snapshot?.bytes.fill(0)
					}
				}

				// A writer may have recreated a source pathname after its inode was moved.
				// Never overwrite or delete that new object while restoring or cleaning up.
				for (const quarantine of sourceQuarantines) {
					if (await lstatIfPresent(quarantine.originalPath, deps)) {
						throw new Error(
							"A source environment path changed during quarantine.",
						)
					}
				}

				// Re-prove every published destination after all sources are safely out of
				// the live namespace, immediately before source inode deletion begins.
				for (const layer of prepared) {
					await verifyTarget(
						{
							targetPath: layer.targetPath,
							destinationName: options.destinationName,
							expectedEnvironment: layer.targetEnvironment,
							expectedPlaintext: layer.plaintext,
							expectedHash: layer.targetHash,
							expectedMode: layer.sourceMode,
						},
						context,
					)
				}
			} catch {
				const retainedSourceQuarantines = await restoreSourceQuarantines(
					sourceQuarantines,
					deps,
					syncDirectory,
				)
				// If any source exists only in quarantine or vanished before it could be
				// quarantined, retain every verified target as an independent encrypted
				// recovery copy. Otherwise rollback is safe.
				const preserveTargets =
					retainedSourceQuarantines.length > 0 ||
					unresolvedSourcePaths.length > 0
				const retainedTargetRecoveries = preserveTargets
					? await finalizeTargetRecoveries(created, deps, syncDirectory)
					: []
				const retained = preserveTargets
					? [
							...created.map((layer) => layer.targetPath),
							...retainedTargetRecoveries,
						]
					: await rollbackCreatedTargets(created, deps, syncDirectory)
				state = "finished"
				if (
					retained.length > 0 ||
					retainedSourceQuarantines.length > 0 ||
					unresolvedSourcePaths.length > 0
				) {
					const retainedDestinationMessage =
						retained.length > 0
							? `Source files were preserved when possible, but changed or unremovable destination files were retained: ${quotePaths(retained)}.`
							: "No destination files were retained."
					throw new Error(
						[
							"Environment rename failed before source removal.",
							retainedDestinationMessage,
							`Source layers without a verified original copy: ${quotePaths(unresolvedSourcePaths)}.`,
							`Source quarantine paths requiring recovery: ${quotePaths(retainedSourceQuarantines)}.`,
							`Destination recovery paths requiring attention: ${quotePaths(retainedTargetRecoveries)}.`,
						].join("\n"),
					)
				}
				throw new Error(
					"Environment rename failed before source removal. No source files were changed.",
				)
			}

			for (const [index, quarantine] of sourceQuarantines.entries()) {
				try {
					await deleteVerifiedQuarantine(quarantine, deps, syncDirectory)
					if (await lstatIfPresent(quarantine.originalPath, deps)) {
						throw new Error("A source environment path changed during cleanup.")
					}
				} catch {
					await restoreSourceQuarantines(
						sourceQuarantines.slice(index),
						deps,
						syncDirectory,
					)
					const retainedTargetRecoveries = await finalizeTargetRecoveries(
						created,
						deps,
						syncDirectory,
					)
					state = "finished"
					throw new Error(
						await describeIncompleteCleanup(
							prepared,
							deps,
							sourceQuarantines,
							retainedTargetRecoveries,
						),
					)
				}
			}

			const retainedTargetRecoveries = await finalizeTargetRecoveries(
				created,
				deps,
				syncDirectory,
			)
			if (retainedTargetRecoveries.length > 0) {
				state = "finished"
				throw new Error(
					await describeIncompleteCleanup(
						prepared,
						deps,
						sourceQuarantines,
						retainedTargetRecoveries,
					),
				)
			}

			state = "finished"
		},
		dispose,
	}
}
