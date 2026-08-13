import { describe, expect, test } from "bun:test"
import crypto from "node:crypto"
import { validatePublicKey } from "../helpers/validatePublicKey"

describe("validatePublicKey", () => {
	test("accepts RSA 2048-bit key", () => {
		const { publicKey } = crypto.generateKeyPairSync("rsa", {
			modulusLength: 2048,
		})
		const result = validatePublicKey(publicKey)
		expect(result.valid).toBe(true)
	})

	test("accepts RSA 4096-bit key", () => {
		const { publicKey } = crypto.generateKeyPairSync("rsa", {
			modulusLength: 4096,
		})
		const result = validatePublicKey(publicKey)
		expect(result.valid).toBe(true)
	})

	test("rejects RSA 1024-bit key", () => {
		const { publicKey } = crypto.generateKeyPairSync("rsa", {
			modulusLength: 1024,
		})
		const result = validatePublicKey(publicKey)
		expect(result.valid).toBe(false)
		if (!result.valid) {
			expect(result.reason).toContain("1024 bits")
			expect(result.reason).toContain("minimum is 2048")
		}
	})

	test("rejects RSA keys when modulus length cannot be determined", () => {
		const fakeRsaKey = {
			asymmetricKeyType: "rsa",
			asymmetricKeyDetails: undefined,
		} as unknown as crypto.KeyObject
		const result = validatePublicKey(fakeRsaKey)
		expect(result.valid).toBe(false)
		if (!result.valid) {
			expect(result.reason).toContain("Could not determine")
		}
	})

	test("accepts Ed25519 key", () => {
		const { publicKey } = crypto.generateKeyPairSync("ed25519")
		const result = validatePublicKey(publicKey)
		expect(result.valid).toBe(true)
	})

	test("rejects ECDSA key", () => {
		const { publicKey } = crypto.generateKeyPairSync("ec", {
			namedCurve: "P-256",
		})
		const result = validatePublicKey(publicKey)
		expect(result.valid).toBe(false)
		if (!result.valid) {
			expect(result.reason).toContain("ECDSA keys are not supported")
		}
	})

	test("rejects DSA key type", () => {
		const fakeDsaKey = {
			asymmetricKeyType: "dsa",
		} as unknown as crypto.KeyObject
		const result = validatePublicKey(fakeDsaKey)
		expect(result.valid).toBe(false)
		if (!result.valid) {
			expect(result.reason).toContain("DSA keys are not supported")
		}
	})

	test("rejects unknown key types", () => {
		const fakeUnknownKey = {
			asymmetricKeyType: "x25519",
		} as unknown as crypto.KeyObject
		const result = validatePublicKey(fakeUnknownKey)
		expect(result.valid).toBe(false)
		if (!result.valid) {
			expect(result.reason).toContain("Unsupported key type: x25519")
		}
	})
})
