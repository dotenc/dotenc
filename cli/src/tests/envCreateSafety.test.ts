import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import crypto from "node:crypto"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createCommand } from "../commands/env/create"
import { decryptData } from "../helpers/crypto"
import { decryptDataKey } from "../helpers/decryptDataKey"

describe("createCommand safety", () => {
	let tmpDir: string
	let cwdSpy: ReturnType<typeof spyOn>
	let exitSpy: ReturnType<typeof spyOn>
	let errorSpy: ReturnType<typeof spyOn>
	let logSpy: ReturnType<typeof spyOn>
	let privateKey: crypto.KeyObject

	beforeEach(() => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), "dotenc-create-safety-"))
		mkdirSync(path.join(tmpDir, ".dotenc"), { recursive: true })
		cwdSpy = spyOn(process, "cwd").mockReturnValue(tmpDir)
		exitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
			throw new Error(`process.exit(${code})`)
		})
		errorSpy = spyOn(console, "error").mockImplementation(() => {})
		logSpy = spyOn(console, "log").mockImplementation(() => {})

		const keyPair = crypto.generateKeyPairSync("ed25519")
		privateKey = keyPair.privateKey
		const { publicKey } = keyPair
		const pem = publicKey
			.export({ type: "spki", format: "pem" })
			.toString("utf-8")
		writeFileSync(path.join(tmpDir, ".dotenc", "alice.pub"), pem, "utf-8")
	})

	afterEach(() => {
		cwdSpy.mockRestore()
		exitSpy.mockRestore()
		errorSpy.mockRestore()
		logSpy.mockRestore()
		rmSync(tmpDir, { recursive: true, force: true })
	})

	test("aborts when selected key does not exist", async () => {
		await expect(createCommand("staging", "missing")).rejects.toThrow(
			"process.exit(1)",
		)
		expect(exitSpy).toHaveBeenCalledWith(1)
		expect(existsSync(path.join(tmpDir, ".env.staging.enc"))).toBe(false)
	})

	test("creates environment with at least one valid recipient", async () => {
		await createCommand("staging", "alice")

		const envPath = path.join(tmpDir, ".env.staging.enc")
		expect(existsSync(envPath)).toBe(true)

		const parsed = JSON.parse(readFileSync(envPath, "utf-8")) as {
			version: number
			keys: {
				name: string
				encryptedDataKey: string
				algorithm: "ed25519"
			}[]
			encryptedContent: string
		}
		expect(parsed.version).toBe(2)
		expect(parsed.keys.length).toBe(1)
		expect(parsed.keys[0].name).toBe("alice")
		const dataKey = decryptDataKey(
			{ algorithm: "ed25519", privateKey },
			Buffer.from(parsed.keys[0].encryptedDataKey, "base64"),
		)
		await expect(
			decryptData(
				dataKey,
				Buffer.from(parsed.encryptedContent, "base64"),
				Buffer.from("staging", "utf-8"),
			),
		).resolves.toBe("# staging environment\n")
		await expect(
			decryptData(
				dataKey,
				Buffer.from(parsed.encryptedContent, "base64"),
				Buffer.from("production", "utf-8"),
			),
		).rejects.toThrow()
		dataKey.fill(0)
	})

	test("uses an exclusive write so a concurrent file cannot be overwritten", async () => {
		const collision = Object.assign(new Error("already exists"), {
			code: "EEXIST",
		})
		const writeFileSpy = spyOn(fs, "writeFile").mockRejectedValue(collision)

		try {
			await expect(createCommand("staging", "alice")).rejects.toThrow(
				"process.exit(1)",
			)
			expect(writeFileSpy).toHaveBeenCalledTimes(1)
			expect(writeFileSpy.mock.calls[0]?.[2]).toMatchObject({
				encoding: "utf-8",
				flag: "wx",
			})
			expect(exitSpy).toHaveBeenCalledWith(1)
		} finally {
			writeFileSpy.mockRestore()
		}
	})
})
