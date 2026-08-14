import fs from "node:fs/promises"

/** Best-effort logical overwrite. Flash storage and snapshots may retain old blocks. */
export const secureEraseFile = async (filePath: string): Promise<void> => {
	let handle: Awaited<ReturnType<typeof fs.open>> | undefined
	const zeros = Buffer.alloc(64 * 1024)
	try {
		handle = await fs.open(filePath, "r+")
		const stat = await handle.stat()
		if (!stat.isFile()) return

		let offset = 0
		while (offset < stat.size) {
			const length = Math.min(zeros.byteLength, stat.size - offset)
			const { bytesWritten } = await handle.write(zeros, 0, length, offset)
			if (bytesWritten <= 0) break
			offset += bytesWritten
		}
		await handle.sync()
	} catch {
		// Best effort: the caller still removes the restricted temporary directory.
	} finally {
		zeros.fill(0)
		await handle?.close().catch(() => {})
	}
}
