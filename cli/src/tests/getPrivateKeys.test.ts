import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"
import crypto from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { getPrivateKeys } from "../helpers/getPrivateKeys"

const encodeLengthPrefixed = (bytes: Buffer): Buffer => {
	const length = Buffer.alloc(4)
	length.writeUInt32BE(bytes.length)
	return Buffer.concat([length, bytes])
}

const buildFakeUnsupportedOpenSshPrivateKey = (algorithm: string): string => {
	const magic = Buffer.from("openssh-key-v1\0", "ascii")
	const publicBlob = encodeLengthPrefixed(Buffer.from(algorithm, "ascii"))
	const payload = Buffer.concat([
		magic,
		encodeLengthPrefixed(Buffer.from("none", "ascii")),
		encodeLengthPrefixed(Buffer.from("none", "ascii")),
		encodeLengthPrefixed(Buffer.alloc(0)),
		Buffer.from([0, 0, 0, 1]),
		encodeLengthPrefixed(publicBlob),
	])
	const base64 = payload.toString("base64")

	return [
		"-----BEGIN OPENSSH PRIVATE KEY-----",
		base64,
		"-----END OPENSSH PRIVATE KEY-----",
	].join("\n")
}

describe("getPrivateKeys", () => {
	let tmpDir: string
	let ed25519PrivateKeyPem: string
	let encryptedEd25519PrivateKeyPem: string
	let rsaPrivateKeyPem: string
	let ecdsaPrivateKeyPem: string
	const originalDotencKeyBase64 = process.env.DOTENC_PRIVATE_KEY_BASE64
	const originalDotencKey = process.env.DOTENC_PRIVATE_KEY
	const originalDotencKeyPassphrase = process.env.DOTENC_PRIVATE_KEY_PASSPHRASE
	let homeSpy: ReturnType<typeof spyOn>

	beforeAll(() => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), "test-privkeys-"))
		mkdirSync(path.join(tmpDir, ".ssh"), { recursive: true })

		// Generate keys using crypto (portable, no ssh-keygen dependency)
		const ed = crypto.generateKeyPairSync("ed25519")
		ed25519PrivateKeyPem = ed.privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString()
		encryptedEd25519PrivateKeyPem = ed.privateKey
			.export({
				type: "pkcs8",
				format: "pem",
				cipher: "aes-256-cbc",
				passphrase: "secret",
			})
			.toString()

		const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
		rsaPrivateKeyPem = rsa.privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString()

		const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
		ecdsaPrivateKeyPem = ec.privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString()

		// Write keys to SSH dir for the homedir scan
		writeFileSync(
			path.join(tmpDir, ".ssh", "id_ed25519"),
			ed25519PrivateKeyPem,
			"utf-8",
		)
		writeFileSync(
			path.join(tmpDir, ".ssh", "id_rsa"),
			rsaPrivateKeyPem,
			"utf-8",
		)

		// Mock homedir to isolate from runner's SSH keys
		homeSpy = spyOn(os, "homedir").mockReturnValue(tmpDir)
	})

	afterAll(() => {
		homeSpy.mockRestore()
		if (originalDotencKeyBase64)
			process.env.DOTENC_PRIVATE_KEY_BASE64 = originalDotencKeyBase64
		else delete process.env.DOTENC_PRIVATE_KEY_BASE64
		if (originalDotencKey) process.env.DOTENC_PRIVATE_KEY = originalDotencKey
		else delete process.env.DOTENC_PRIVATE_KEY
		if (originalDotencKeyPassphrase)
			process.env.DOTENC_PRIVATE_KEY_PASSPHRASE = originalDotencKeyPassphrase
		else delete process.env.DOTENC_PRIVATE_KEY_PASSPHRASE
		rmSync(tmpDir, { recursive: true, force: true })
	})

	const encodePrivateKey = (keyContent: string) =>
		Buffer.from(keyContent, "utf-8").toString("base64")

	test("parses Ed25519 key from DOTENC_PRIVATE_KEY_BASE64", async () => {
		delete process.env.DOTENC_PRIVATE_KEY
		process.env.DOTENC_PRIVATE_KEY_BASE64 =
			encodePrivateKey(ed25519PrivateKeyPem)

		const { keys } = await getPrivateKeys()
		expect(keys.map((k) => k.name)).toContain("env.DOTENC_PRIVATE_KEY_BASE64")
		const envKey = keys.find((k) => k.name === "env.DOTENC_PRIVATE_KEY_BASE64")
		if (!envKey) {
			throw new Error("Expected env.DOTENC_PRIVATE_KEY_BASE64 to be present")
		}
		expect(envKey.algorithm).toBe("ed25519")
		expect(envKey.fingerprint).toBeDefined()

		delete process.env.DOTENC_PRIVATE_KEY_BASE64
	})

	test("parses passphrase-protected DOTENC_PRIVATE_KEY_BASE64 when DOTENC_PRIVATE_KEY_PASSPHRASE is set", async () => {
		delete process.env.DOTENC_PRIVATE_KEY
		process.env.DOTENC_PRIVATE_KEY_BASE64 = encodePrivateKey(
			encryptedEd25519PrivateKeyPem,
		)
		process.env.DOTENC_PRIVATE_KEY_PASSPHRASE = "secret"

		const { keys } = await getPrivateKeys()
		const envKey = keys.find((k) => k.name === "env.DOTENC_PRIVATE_KEY_BASE64")

		expect(envKey).toBeDefined()
		expect(envKey?.algorithm).toBe("ed25519")

		delete process.env.DOTENC_PRIVATE_KEY_BASE64
		delete process.env.DOTENC_PRIVATE_KEY_PASSPHRASE
	})

	test("prefers DOTENC_PRIVATE_KEY_BASE64 over legacy DOTENC_PRIVATE_KEY", async () => {
		process.env.DOTENC_PRIVATE_KEY_BASE64 =
			encodePrivateKey(ed25519PrivateKeyPem)
		process.env.DOTENC_PRIVATE_KEY = rsaPrivateKeyPem

		const { keys } = await getPrivateKeys()
		const base64EnvKey = keys.find(
			(k) => k.name === "env.DOTENC_PRIVATE_KEY_BASE64",
		)
		const rawEnvKey = keys.find((k) => k.name === "env.DOTENC_PRIVATE_KEY")

		expect(base64EnvKey).toBeDefined()
		expect(base64EnvKey?.algorithm).toBe("ed25519")
		expect(rawEnvKey).toBeUndefined()

		delete process.env.DOTENC_PRIVATE_KEY_BASE64
		delete process.env.DOTENC_PRIVATE_KEY
	})

	test("does not fall back to legacy DOTENC_PRIVATE_KEY when DOTENC_PRIVATE_KEY_BASE64 is invalid", async () => {
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})
		process.env.DOTENC_PRIVATE_KEY_BASE64 = "not base64!"
		process.env.DOTENC_PRIVATE_KEY = ed25519PrivateKeyPem

		const { keys, unsupportedKeys } = await getPrivateKeys()
		expect(
			keys.find((k) => k.name === "env.DOTENC_PRIVATE_KEY_BASE64"),
		).toBeUndefined()
		expect(
			keys.find((k) => k.name === "env.DOTENC_PRIVATE_KEY"),
		).toBeUndefined()
		expect(
			unsupportedKeys?.some(
				(k) =>
					k.name === "env.DOTENC_PRIVATE_KEY_BASE64" &&
					k.reason === "invalid base64 private key",
			),
		).toBe(true)

		delete process.env.DOTENC_PRIVATE_KEY_BASE64
		delete process.env.DOTENC_PRIVATE_KEY
		errorSpy.mockRestore()
	})

	test("parses Ed25519 key from DOTENC_PRIVATE_KEY", async () => {
		delete process.env.DOTENC_PRIVATE_KEY_BASE64
		process.env.DOTENC_PRIVATE_KEY = ed25519PrivateKeyPem
		const { keys } = await getPrivateKeys()
		expect(keys.map((k) => k.name)).toContain("env.DOTENC_PRIVATE_KEY")
		const envKey = keys.find((k) => k.name === "env.DOTENC_PRIVATE_KEY")
		if (!envKey) {
			throw new Error("Expected env.DOTENC_PRIVATE_KEY to be present")
		}
		expect(envKey.algorithm).toBe("ed25519")
		expect(envKey.fingerprint).toBeDefined()
		delete process.env.DOTENC_PRIVATE_KEY
	})

	test("parses RSA key from DOTENC_PRIVATE_KEY", async () => {
		delete process.env.DOTENC_PRIVATE_KEY_BASE64
		process.env.DOTENC_PRIVATE_KEY = rsaPrivateKeyPem
		const { keys } = await getPrivateKeys()
		expect(keys.map((k) => k.name)).toContain("env.DOTENC_PRIVATE_KEY")
		const envKey = keys.find((k) => k.name === "env.DOTENC_PRIVATE_KEY")
		if (!envKey) {
			throw new Error("Expected env.DOTENC_PRIVATE_KEY to be present")
		}
		expect(envKey.algorithm).toBe("rsa")
		expect(envKey.fingerprint).toBeDefined()
		delete process.env.DOTENC_PRIVATE_KEY
	})

	test("environment-only mode does not scan ~/.ssh", async () => {
		delete process.env.DOTENC_PRIVATE_KEY_BASE64
		process.env.DOTENC_PRIVATE_KEY = ed25519PrivateKeyPem

		const { keys } = await getPrivateKeys({ environmentOnly: true })

		expect(keys.map((key) => key.name)).toEqual(["env.DOTENC_PRIVATE_KEY"])
		expect(keys.some((key) => key.name === "id_ed25519")).toBe(false)
		expect(keys.some((key) => key.name === "id_rsa")).toBe(false)
		delete process.env.DOTENC_PRIVATE_KEY
	})

	test("collect mode makes an unusable environment key silent and nonfatal", async () => {
		const exitSpy = spyOn(process, "exit").mockImplementation(() => {
			throw new Error("unexpected exit")
		})
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})
		try {
			delete process.env.DOTENC_PRIVATE_KEY_BASE64
			process.env.DOTENC_PRIVATE_KEY = [
				"-----BEGIN ENCRYPTED PRIVATE KEY-----",
				"ZmFrZQ==",
				"-----END ENCRYPTED PRIVATE KEY-----",
			].join("\n")
			delete process.env.DOTENC_PRIVATE_KEY_PASSPHRASE

			const result = await getPrivateKeys({
				environmentOnly: true,
				environmentKeyErrorMode: "collect",
				logError: () => {},
			})

			expect(result.keys).toEqual([])
			expect(result.passphraseProtectedKeys).toEqual(["env.DOTENC_PRIVATE_KEY"])
			expect(result.unsupportedKeys).toContainEqual({
				name: "env.DOTENC_PRIVATE_KEY",
				reason: "passphrase-protected",
			})
			expect(exitSpy).not.toHaveBeenCalled()
			expect(errorSpy).not.toHaveBeenCalled()
		} finally {
			delete process.env.DOTENC_PRIVATE_KEY
			errorSpy.mockRestore()
			exitSpy.mockRestore()
		}
	})

	test("ignores invalid DOTENC_PRIVATE_KEY", async () => {
		const spy = spyOn(console, "error").mockImplementation(() => {})
		delete process.env.DOTENC_PRIVATE_KEY_BASE64
		process.env.DOTENC_PRIVATE_KEY = "not a key"
		const { keys } = await getPrivateKeys()
		const envKey = keys.find((k) => k.name === "env.DOTENC_PRIVATE_KEY")
		expect(envKey).toBeUndefined()
		delete process.env.DOTENC_PRIVATE_KEY
		spy.mockRestore()
	})

	test("each key entry has required fields", async () => {
		delete process.env.DOTENC_PRIVATE_KEY_BASE64
		process.env.DOTENC_PRIVATE_KEY = ed25519PrivateKeyPem
		const { keys } = await getPrivateKeys()
		for (const key of keys) {
			expect(typeof key.name).toBe("string")
			expect(key.privateKey).toBeDefined()
			expect(typeof key.fingerprint).toBe("string")
			expect(["rsa", "ed25519"]).toContain(key.algorithm)
		}
		delete process.env.DOTENC_PRIVATE_KEY
	})

	test("returns keys, passphraseProtectedKeys and unsupportedKeys properties", async () => {
		delete process.env.DOTENC_PRIVATE_KEY
		const result = await getPrivateKeys()
		expect(result).toHaveProperty("keys")
		expect(result).toHaveProperty("passphraseProtectedKeys")
		expect(result).toHaveProperty("unsupportedKeys")
		expect(Array.isArray(result.keys)).toBe(true)
		expect(Array.isArray(result.passphraseProtectedKeys)).toBe(true)
		expect(Array.isArray(result.unsupportedKeys)).toBe(true)
	})

	test("ignores unsupported key types in DOTENC_PRIVATE_KEY", async () => {
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})
		delete process.env.DOTENC_PRIVATE_KEY_BASE64
		process.env.DOTENC_PRIVATE_KEY = ecdsaPrivateKeyPem

		const { keys, unsupportedKeys } = await getPrivateKeys()
		expect(
			keys.find((k) => k.name === "env.DOTENC_PRIVATE_KEY"),
		).toBeUndefined()
		expect(
			unsupportedKeys?.some((k) => k.name === "env.DOTENC_PRIVATE_KEY"),
		).toBe(true)
		expect(
			unsupportedKeys?.some(
				(k) =>
					k.name === "env.DOTENC_PRIVATE_KEY" &&
					k.reason.includes("unsupported algorithm"),
			),
		).toBe(true)

		const messages = errorSpy.mock.calls.map((c) => String(c[0]))
		expect(
			messages.some((m) =>
				m.includes("Unsupported key type in DOTENC_PRIVATE_KEY"),
			),
		).toBe(true)

		delete process.env.DOTENC_PRIVATE_KEY
		errorSpy.mockRestore()
	})

	test("exits for passphrase-protected DOTENC_PRIVATE_KEY", async () => {
		const exitSpy = spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit(1)")
		})
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})
		delete process.env.DOTENC_PRIVATE_KEY_BASE64
		process.env.DOTENC_PRIVATE_KEY = [
			"-----BEGIN ENCRYPTED PRIVATE KEY-----",
			"ZmFrZQ==",
			"-----END ENCRYPTED PRIVATE KEY-----",
		].join("\n")
		delete process.env.DOTENC_PRIVATE_KEY_PASSPHRASE

		await expect(getPrivateKeys()).rejects.toThrow("process.exit(1)")
		expect(exitSpy).toHaveBeenCalledWith(1)

		delete process.env.DOTENC_PRIVATE_KEY
		errorSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("parses passphrase-protected DOTENC_PRIVATE_KEY when DOTENC_PRIVATE_KEY_PASSPHRASE is set", async () => {
		delete process.env.DOTENC_PRIVATE_KEY_BASE64
		process.env.DOTENC_PRIVATE_KEY = encryptedEd25519PrivateKeyPem
		process.env.DOTENC_PRIVATE_KEY_PASSPHRASE = "secret"

		const { keys } = await getPrivateKeys()
		const envKey = keys.find((k) => k.name === "env.DOTENC_PRIVATE_KEY")

		expect(envKey).toBeDefined()
		expect(envKey?.algorithm).toBe("ed25519")

		delete process.env.DOTENC_PRIVATE_KEY
		delete process.env.DOTENC_PRIVATE_KEY_PASSPHRASE
	})

	test("loads passphrase-protected ~/.ssh key when DOTENC_PRIVATE_KEY_PASSPHRASE is set", async () => {
		writeFileSync(
			path.join(tmpDir, ".ssh", "id_protected_decryptable"),
			encryptedEd25519PrivateKeyPem,
			"utf-8",
		)

		delete process.env.DOTENC_PRIVATE_KEY
		process.env.DOTENC_PRIVATE_KEY_PASSPHRASE = "secret"

		const result = await getPrivateKeys()
		expect(
			result.keys.some((key) => key.name === "id_protected_decryptable"),
		).toBe(true)
		expect(result.passphraseProtectedKeys).not.toContain(
			"id_protected_decryptable",
		)

		delete process.env.DOTENC_PRIVATE_KEY_PASSPHRASE
	})

	test("keeps passphrase-protected ~/.ssh key classified as unsupported when passphrase is wrong", async () => {
		writeFileSync(
			path.join(tmpDir, ".ssh", "id_protected_wrong_pass"),
			encryptedEd25519PrivateKeyPem,
			"utf-8",
		)

		delete process.env.DOTENC_PRIVATE_KEY
		process.env.DOTENC_PRIVATE_KEY_PASSPHRASE = "wrong-pass"

		const result = await getPrivateKeys()
		expect(result.passphraseProtectedKeys).toContain("id_protected_wrong_pass")
		expect(
			result.unsupportedKeys?.some(
				(k) =>
					k.name === "id_protected_wrong_pass" &&
					k.reason.includes("failed to decrypt"),
			),
		).toBe(true)

		delete process.env.DOTENC_PRIVATE_KEY_PASSPHRASE
	})

	test("tracks passphrase-protected keys found in ~/.ssh", async () => {
		writeFileSync(
			path.join(tmpDir, ".ssh", "id_protected"),
			[
				"-----BEGIN ENCRYPTED PRIVATE KEY-----",
				"ZmFrZQ==",
				"-----END ENCRYPTED PRIVATE KEY-----",
			].join("\n"),
			"utf-8",
		)

		delete process.env.DOTENC_PRIVATE_KEY
		const result = await getPrivateKeys()
		expect(result.passphraseProtectedKeys).toContain("id_protected")
		expect(
			result.unsupportedKeys?.some(
				(k) => k.name === "id_protected" && k.reason === "passphrase-protected",
			),
		).toBe(true)
	})

	test("tracks unsupported private key algorithms found in ~/.ssh", async () => {
		writeFileSync(
			path.join(tmpDir, ".ssh", "id_ecdsa"),
			ecdsaPrivateKeyPem,
			"utf-8",
		)

		delete process.env.DOTENC_PRIVATE_KEY
		const result = await getPrivateKeys()
		expect(
			result.unsupportedKeys?.some(
				(k) =>
					k.name === "id_ecdsa" &&
					k.reason.includes("unsupported algorithm") &&
					k.reason.includes("ec"),
			),
		).toBe(true)
	})

	test("classifies unsupported OpenSSH private key algorithms in ~/.ssh", async () => {
		writeFileSync(
			path.join(tmpDir, ".ssh", "id_ed448"),
			buildFakeUnsupportedOpenSshPrivateKey("ssh-ed448"),
			"utf-8",
		)

		delete process.env.DOTENC_PRIVATE_KEY
		const result = await getPrivateKeys()
		expect(
			result.unsupportedKeys?.some(
				(entry) =>
					entry.name === "id_ed448" &&
					entry.reason.includes("unsupported algorithm") &&
					entry.reason.includes("ssh-ed448"),
			),
		).toBe(true)
		expect(result.passphraseProtectedKeys).not.toContain("id_ed448")
	})

	test("skips ssh entries when stat or readFile fails during scan", async () => {
		const statFailPath = path.join(tmpDir, ".ssh", "id_stat_fail")
		const readFailPath = path.join(tmpDir, ".ssh", "id_read_fail")
		writeFileSync(statFailPath, "ignored", "utf-8")
		writeFileSync(readFailPath, "-----BEGIN PRIVATE KEY-----\nabc\n", "utf-8")

		const originalStat = fsPromises.stat
		const originalReadFile = fsPromises.readFile

		const statSpy = spyOn(fsPromises, "stat").mockImplementation((async (
			...args: unknown[]
		) => {
			const [filePath] = args
			if (String(filePath) === statFailPath) {
				throw new Error("stat failed")
			}
			return Reflect.apply(originalStat, fsPromises, args)
		}) as unknown as typeof fsPromises.stat)
		const readFileSpy = spyOn(fsPromises, "readFile").mockImplementation(
			(async (...args: unknown[]) => {
				const [filePath] = args
				if (String(filePath) === readFailPath) {
					throw new Error("read failed")
				}
				return Reflect.apply(originalReadFile, fsPromises, args)
			}) as unknown as typeof fsPromises.readFile,
		)

		try {
			delete process.env.DOTENC_PRIVATE_KEY
			const result = await getPrivateKeys()

			expect(statSpy).toHaveBeenCalled()
			expect(readFileSpy).toHaveBeenCalled()
			expect(
				result.keys.some(
					(key) => key.name === "id_stat_fail" || key.name === "id_read_fail",
				),
			).toBe(false)
			expect(
				result.unsupportedKeys?.some(
					(entry) =>
						entry.name === "id_stat_fail" || entry.name === "id_read_fail",
				),
			).toBe(false)
		} finally {
			statSpy.mockRestore()
			readFileSpy.mockRestore()
		}
	})

	test("returns empty result when ~/.ssh does not exist", async () => {
		const emptyHome = mkdtempSync(
			path.join(os.tmpdir(), "test-privkeys-empty-"),
		)
		homeSpy.mockReturnValue(emptyHome)
		delete process.env.DOTENC_PRIVATE_KEY

		const result = await getPrivateKeys()
		expect(result.keys).toHaveLength(0)
		expect(result.passphraseProtectedKeys).toHaveLength(0)

		homeSpy.mockReturnValue(tmpDir)
		rmSync(emptyHome, { recursive: true, force: true })
	})
})
