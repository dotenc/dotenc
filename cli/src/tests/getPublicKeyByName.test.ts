import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"
import crypto from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { getPublicKeyByName } from "../helpers/getPublicKeyByName"

describe("getPublicKeyByName", () => {
	let tmpDir: string
	let cwdSpy: ReturnType<typeof spyOn>

	beforeAll(() => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), "test-pubkeyname-"))
		mkdirSync(path.join(tmpDir, ".dotenc"))

		// Write a valid public key
		const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
		const pem = publicKey.export({ type: "spki", format: "pem" }).toString()
		writeFileSync(path.join(tmpDir, ".dotenc", "alice.pub"), pem, "utf-8")

		// Write an invalid public key
		writeFileSync(path.join(tmpDir, ".dotenc", "bad.pub"), "not a key", "utf-8")

		const weakRsa = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 })
		writeFileSync(
			path.join(tmpDir, ".dotenc", "weak.pub"),
			weakRsa.publicKey.export({ type: "spki", format: "pem" }).toString(),
			"utf-8",
		)
		writeFileSync(
			path.join(tmpDir, ".dotenc", "private.pub"),
			privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
			"utf-8",
		)

		cwdSpy = spyOn(process, "cwd").mockReturnValue(tmpDir)
	})

	afterAll(() => {
		cwdSpy.mockRestore()
		rmSync(tmpDir, { recursive: true, force: true })
	})

	test("returns a KeyObject for a valid public key", async () => {
		const key = await getPublicKeyByName("alice")
		expect(key.type).toBe("public")
		expect(key.asymmetricKeyType).toBe("ed25519")
	})

	test("throws when key file does not exist", async () => {
		await expect(getPublicKeyByName("nonexistent")).rejects.toThrow(
			/No public key found with name nonexistent/,
		)
	})

	test("throws when key name is invalid", async () => {
		await expect(getPublicKeyByName("../alice")).rejects.toThrow(
			/Invalid key name/,
		)
	})

	test("throws when key file has invalid PEM", async () => {
		await expect(getPublicKeyByName("bad")).rejects.toThrow(
			/Invalid public key format for bad/,
		)
	})

	test("rejects weak RSA public keys", async () => {
		await expect(getPublicKeyByName("weak")).rejects.toThrow(
			/Invalid public key format for weak/,
		)
	})

	test("rejects private material stored in a .pub file", async () => {
		await expect(getPublicKeyByName("private")).rejects.toThrow(
			/Invalid public key format for private/,
		)
	})
})
