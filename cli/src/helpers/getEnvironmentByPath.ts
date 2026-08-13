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

export const getEnvironmentByPath = async (
	filePath: string,
): Promise<Environment> => {
	let handle: FileHandle
	try {
		handle = await fs.open(filePath, "r")
	} catch {
		throw new Error(`Environment file not found: ${filePath}`)
	}

	try {
		return parseEnvironmentDocument(await readBoundedEnvironmentFile(handle))
	} catch {
		throw new Error(
			"Failed to parse the environment file. Please ensure it is a valid JSON file.",
		)
	} finally {
		await handle.close().catch(() => {})
	}
}
