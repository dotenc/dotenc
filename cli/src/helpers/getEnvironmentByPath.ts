import { constants } from "node:fs"
import type { FileHandle } from "node:fs/promises"
import fs from "node:fs/promises"
import type { Environment } from "../schemas/environment"
import { ENVIRONMENT_DIFF_LIMITS } from "../schemas/environmentDiffReport"
import { parseEnvironmentDocument } from "./parseEnvironmentDocument"

const readBoundedEnvironmentFile = async (
	handle: FileHandle,
): Promise<string> => {
	const stat = await handle.stat()
	if (!stat.isFile() || stat.size > ENVIRONMENT_DIFF_LIMITS.maxFileBytes) {
		throw new Error("Encrypted environment exceeds the file-size limit.")
	}

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
		return new TextDecoder("utf-8", { fatal: true }).decode(
			input.subarray(0, offset),
		)
	} finally {
		input.fill(0)
	}
}

export const readEncryptedEnvironmentFileByPath = async (
	filePath: string,
): Promise<string> => {
	let pathStat: Awaited<ReturnType<typeof fs.lstat>>
	try {
		pathStat = await fs.lstat(filePath)
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ENOENT"
		) {
			throw new Error(`Environment file not found: ${filePath}`)
		}
		throw new Error("Encrypted environment could not be inspected safely.")
	}
	if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
		throw new Error(
			"Encrypted environment must be a regular, non-symbolic link file.",
		)
	}

	let handle: FileHandle
	try {
		handle = await fs.open(
			filePath,
			constants.O_RDONLY |
				(constants.O_NOFOLLOW ?? 0) |
				(constants.O_NONBLOCK ?? 0),
		)
	} catch {
		throw new Error("Encrypted environment could not be opened safely.")
	}

	try {
		const openedStat = await handle.stat()
		if (
			!openedStat.isFile() ||
			openedStat.dev !== pathStat.dev ||
			openedStat.ino !== pathStat.ino
		) {
			throw new Error("Encrypted environment changed during validation.")
		}
		try {
			return await readBoundedEnvironmentFile(handle)
		} catch {
			throw new Error(
				"Failed to parse the environment file. Please ensure it is a valid JSON file.",
			)
		}
	} finally {
		await handle.close().catch(() => {})
	}
}

export const getEnvironmentByPath = async (
	filePath: string,
): Promise<Environment> => {
	const raw = await readEncryptedEnvironmentFileByPath(filePath)
	try {
		return parseEnvironmentDocument(raw)
	} catch {
		throw new Error(
			"Failed to parse the environment file. Please ensure it is a valid JSON file.",
		)
	}
}
