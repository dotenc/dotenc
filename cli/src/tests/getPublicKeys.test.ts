import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"
import crypto from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { getPublicKeys } from "../helpers/getPublicKeys"

describe("getPublicKeys (subfolder resolution)", () => {
	let rootDir: string
	let subDir: string
	let cwdSpy: ReturnType<typeof spyOn>

	beforeAll(() => {
		rootDir = mkdtempSync(path.join(os.tmpdir(), "test-pubkeys-root-"))
		subDir = path.join(rootDir, "packages", "web")
		mkdirSync(path.join(rootDir, ".dotenc"))
		mkdirSync(subDir, { recursive: true })

		const ed = crypto.generateKeyPairSync("ed25519")
		writeFileSync(
			path.join(rootDir, ".dotenc", "alice.pub"),
			ed.publicKey.export({ type: "spki", format: "pem" }).toString(),
			"utf-8",
		)

		cwdSpy = spyOn(process, "cwd").mockReturnValue(subDir)
	})

	afterAll(() => {
		cwdSpy.mockRestore()
		rmSync(rootDir, { recursive: true, force: true })
	})

	test("finds keys in ancestor .dotenc/ when called from a subfolder", async () => {
		const keys = await getPublicKeys()
		expect(keys).toHaveLength(1)
		expect(keys[0].name).toBe("alice")
	})
})

describe("getPublicKeys", () => {
	let tmpDir: string
	let cwdSpy: ReturnType<typeof spyOn>

	beforeAll(() => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), "test-pubkeys-"))
		mkdirSync(path.join(tmpDir, ".dotenc"))

		// Write valid Ed25519 public key
		const ed = crypto.generateKeyPairSync("ed25519")
		writeFileSync(
			path.join(tmpDir, ".dotenc", "alice.pub"),
			ed.publicKey.export({ type: "spki", format: "pem" }).toString(),
			"utf-8",
		)

		// Write valid RSA public key
		const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
		writeFileSync(
			path.join(tmpDir, ".dotenc", "bob.pub"),
			rsa.publicKey.export({ type: "spki", format: "pem" }).toString(),
			"utf-8",
		)

		// Write unsupported ECDSA public key (should be ignored)
		const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
		writeFileSync(
			path.join(tmpDir, ".dotenc", "carol.pub"),
			ec.publicKey.export({ type: "spki", format: "pem" }).toString(),
			"utf-8",
		)

		// Write invalid .pub content (should be ignored)
		writeFileSync(
			path.join(tmpDir, ".dotenc", "broken.pub"),
			"definitely-not-a-valid-public-key",
			"utf-8",
		)

		const weakRsa = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 })
		writeFileSync(
			path.join(tmpDir, ".dotenc", "weak.pub"),
			weakRsa.publicKey.export({ type: "spki", format: "pem" }).toString(),
			"utf-8",
		)

		writeFileSync(
			path.join(tmpDir, ".dotenc", "private.pub"),
			ed.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
			"utf-8",
		)

		// Write a non-.pub file (should be ignored)
		writeFileSync(path.join(tmpDir, ".dotenc", "readme.txt"), "hi", "utf-8")

		cwdSpy = spyOn(process, "cwd").mockReturnValue(tmpDir)
	})

	afterAll(() => {
		cwdSpy.mockRestore()
		rmSync(tmpDir, { recursive: true, force: true })
	})

	test("finds all .pub keys in .dotenc/", async () => {
		const keys = await getPublicKeys()
		expect(keys).toHaveLength(2)
		const names = keys.map((k) => k.name)
		expect(names).toContain("alice")
		expect(names).toContain("bob")
	})

	test("detects correct algorithms", async () => {
		const keys = await getPublicKeys()
		const alice = keys.find((k) => k.name === "alice")
		const bob = keys.find((k) => k.name === "bob")
		expect(alice?.algorithm).toBe("ed25519")
		expect(bob?.algorithm).toBe("rsa")
	})

	test("each key has required fields", async () => {
		const keys = await getPublicKeys()
		for (const key of keys) {
			expect(key.name).toBeDefined()
			expect(key.publicKey).toBeDefined()
			expect(key.fingerprint).toBeDefined()
			expect(["rsa", "ed25519"]).toContain(key.algorithm)
		}
	})

	test("returns empty array when .dotenc/ does not exist", async () => {
		const emptyDir = mkdtempSync(path.join(os.tmpdir(), "test-pubkeys-empty-"))
		cwdSpy.mockReturnValue(emptyDir)
		const keys = await getPublicKeys()
		expect(keys).toHaveLength(0)
		cwdSpy.mockReturnValue(tmpDir)
		rmSync(emptyDir, { recursive: true, force: true })
	})

	test("ignores invalid PEM public keys and logs an error", async () => {
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})
		const keys = await getPublicKeys()
		expect(keys.find((k) => k.name === "broken")).toBeUndefined()

		const messages = errorSpy.mock.calls.map((c) => String(c[0]))
		expect(
			messages.some((m) =>
				m.includes("Invalid public key format in broken.pub"),
			),
		).toBe(true)
		errorSpy.mockRestore()
	})

	test("ignores unsupported key types and logs an error", async () => {
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})
		const keys = await getPublicKeys()
		expect(keys.find((k) => k.name === "carol")).toBeUndefined()

		const messages = errorSpy.mock.calls.map((c) => String(c[0]))
		expect(
			messages.some((m) => m.includes("Unsupported key type in carol.pub")),
		).toBe(true)
		errorSpy.mockRestore()
	})

	test("rejects weak RSA and private material stored in .pub files", async () => {
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})
		const keys = await getPublicKeys()
		expect(keys.find((key) => key.name === "weak")).toBeUndefined()
		expect(keys.find((key) => key.name === "private")).toBeUndefined()

		const messages = errorSpy.mock.calls.map((call) => String(call[0]))
		expect(messages.some((message) => message.includes("weak.pub"))).toBe(true)
		expect(messages.some((message) => message.includes("private.pub"))).toBe(
			true,
		)
		errorSpy.mockRestore()
	})
})
