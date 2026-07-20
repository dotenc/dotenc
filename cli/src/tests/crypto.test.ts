import { describe, expect, test } from "bun:test"
import crypto from "node:crypto"
import { decryptData, encryptData } from "../helpers/crypto"
import { decryptDataKey } from "../helpers/decryptDataKey"
import { encryptDataKey } from "../helpers/encryptDataKey"

const key = crypto.randomBytes(32)
const wrongKey = crypto.randomBytes(32)
const message = "Hello, dotenc!"

const encryptBytes = (dataKey: Buffer, input: Buffer): Buffer => {
	const iv = crypto.randomBytes(12)
	const cipher = crypto.createCipheriv("aes-256-gcm", dataKey, iv)
	const encrypted = Buffer.concat([cipher.update(input), cipher.final()])
	return Buffer.concat([iv, encrypted, cipher.getAuthTag()])
}

describe("crypto helpers", () => {
	test("encrypt and decrypt returns original message", async () => {
		const encrypted = await encryptData(key, message)
		const decrypted = await decryptData(key, encrypted)
		expect(decrypted).toBe(message)
	})

	test("decrypt with wrong key throws error", async () => {
		const encrypted = await encryptData(key, message)
		await expect(decryptData(wrongKey, encrypted)).rejects.toThrow(
			/Failed to decrypt file/,
		)
	})

	test("rethrows non-authentication decrypt errors", async () => {
		const encrypted = await encryptData(key, message)
		const invalidKey = { length: 32 } as Buffer

		try {
			await decryptData(invalidKey, encrypted)
			throw new Error("Expected decryptData to throw")
		} catch (error) {
			expect(error).toBeInstanceOf(Error)
			expect((error as Error).message).not.toContain("Failed to decrypt file")
		}
	})

	test("decrypt rejects too-short input", async () => {
		const shortInput = Buffer.alloc(10)
		await expect(decryptData(key, shortInput)).rejects.toThrow(
			/Encrypted input is too short/,
		)
	})

	test("decrypt rejects authenticated plaintext that is not valid UTF-8", async () => {
		const encrypted = encryptBytes(
			key,
			Buffer.from([0x54, 0x4f, 0x4b, 0x45, 0x4e, 0x3d, 0x80]),
		)
		await expect(decryptData(key, encrypted)).rejects.toThrow(/valid UTF-8/)
	})

	test("encrypt and decrypt with AAD returns original message", async () => {
		const aad = Buffer.from("production", "utf-8")
		const encrypted = await encryptData(key, message, aad)
		const decrypted = await decryptData(key, encrypted, aad)
		expect(decrypted).toBe(message)
	})

	test("decrypt with wrong AAD fails authentication", async () => {
		const aad = Buffer.from("production", "utf-8")
		const wrongAad = Buffer.from("staging", "utf-8")
		const encrypted = await encryptData(key, message, aad)
		await expect(decryptData(key, encrypted, wrongAad)).rejects.toThrow(
			/Failed to decrypt file/,
		)
	})

	test("decrypt without AAD fails when encrypted with AAD", async () => {
		const aad = Buffer.from("production", "utf-8")
		const encrypted = await encryptData(key, message, aad)
		await expect(decryptData(key, encrypted)).rejects.toThrow(
			/Failed to decrypt file/,
		)
	})

	test("key must be 32 bytes", async () => {
		const shortKey = crypto.randomBytes(16)
		await expect(encryptData(shortKey, message)).rejects.toThrow(
			/Key must be 32 bytes/,
		)
		const encrypted = await encryptData(key, message)
		await expect(decryptData(shortKey, encrypted)).rejects.toThrow(
			/Key must be 32 bytes/,
		)
	})
})

describe("RSA data key encryption", () => {
	const rsaKeyPair = crypto.generateKeyPairSync("rsa", {
		modulusLength: 2048,
	})

	test("encrypt and decrypt data key round-trip", () => {
		const dataKey = crypto.randomBytes(32)
		const encrypted = encryptDataKey(
			{
				algorithm: "rsa",
				publicKey: rsaKeyPair.publicKey,
			},
			dataKey,
		)
		const decrypted = decryptDataKey(
			{
				algorithm: "rsa",
				privateKey: rsaKeyPair.privateKey,
			},
			encrypted,
		)
		expect(Buffer.compare(decrypted, dataKey)).toBe(0)
	})
})

describe("Ed25519 data key encryption", () => {
	const ed25519KeyPair = crypto.generateKeyPairSync("ed25519")
	const pubDer = ed25519KeyPair.publicKey.export({
		type: "spki",
		format: "der",
	})
	const rawPublicKey = Buffer.from(pubDer.subarray(pubDer.length - 32))

	test("encrypt and decrypt data key round-trip", () => {
		const dataKey = crypto.randomBytes(32)
		const encrypted = encryptDataKey(
			{
				algorithm: "ed25519",
				publicKey: ed25519KeyPair.publicKey,
				rawPublicKey,
			},
			dataKey,
		)
		const decrypted = decryptDataKey(
			{
				algorithm: "ed25519",
				privateKey: ed25519KeyPair.privateKey,
			},
			encrypted,
		)
		expect(Buffer.compare(decrypted, dataKey)).toBe(0)
	})

	test("throws without raw public key for ed25519 encryption", () => {
		const dataKey = crypto.randomBytes(32)
		expect(() =>
			encryptDataKey(
				{
					algorithm: "ed25519",
					publicKey: ed25519KeyPair.publicKey,
				},
				dataKey,
			),
		).toThrow(/Raw public key bytes are required/)
	})
})
