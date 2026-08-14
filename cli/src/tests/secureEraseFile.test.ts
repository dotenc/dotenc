import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { secureEraseFile } from "../helpers/secureEraseFile"

describe("secureEraseFile", () => {
	test("overwrites every byte across multiple write chunks", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "dotenc-erase-"))
		const filePath = path.join(tempDir, "key")
		const original = Buffer.alloc(64 * 1024 + 17, 0xa5)

		try {
			await writeFile(filePath, original, { mode: 0o600 })
			await secureEraseFile(filePath)

			const overwritten = await readFile(filePath)
			expect(overwritten.byteLength).toBe(original.byteLength)
			expect(overwritten.every((byte) => byte === 0)).toBe(true)
		} finally {
			original.fill(0)
			await rm(tempDir, { recursive: true, force: true })
		}
	})

	test("silently tolerates a missing file", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "dotenc-erase-"))

		try {
			await expect(
				secureEraseFile(path.join(tempDir, "missing")),
			).resolves.toBeUndefined()
		} finally {
			await rm(tempDir, { recursive: true, force: true })
		}
	})
})
