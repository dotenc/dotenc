import { describe, expect, test } from "bun:test"
import crypto from "node:crypto"
import { extractEd25519PrivateSeed } from "../helpers/ed25519Der"

describe("Ed25519 PKCS#8 extraction", () => {
	test("extracts the nested private seed when RFC 8410 public bytes trail it", () => {
		const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519")
		const canonical = privateKey.export({
			type: "pkcs8",
			format: "der",
		}) as Buffer
		const publicDer = publicKey.export({
			type: "spki",
			format: "der",
		}) as Buffer
		const publicBytes = publicDer.subarray(publicDer.length - 32)
		const withPublicKey = Buffer.concat([
			Buffer.from([0x30, 0x51, 0x02, 0x01, 0x01]),
			canonical.subarray(5),
			Buffer.from([0x81, 0x21, 0x00]),
			publicBytes,
		])

		const canonicalSeed = extractEd25519PrivateSeed(canonical)
		const extendedSeed = extractEd25519PrivateSeed(withPublicKey)
		expect(extendedSeed.equals(canonicalSeed)).toBe(true)
		expect(extendedSeed.equals(withPublicKey.subarray(-32))).toBe(false)
		canonicalSeed.fill(0)
		extendedSeed.fill(0)
	})

	test("rejects malformed or unexpected PKCS#8 structures", () => {
		expect(() => extractEd25519PrivateSeed(Buffer.from([0x30, 0x00]))).toThrow(
			/Invalid Ed25519 DER encoding/,
		)
	})

	test("rejects version 1 PKCS#8 without the required public key field", () => {
		const { privateKey } = crypto.generateKeyPairSync("ed25519")
		const pkcs8 = Buffer.from(
			privateKey.export({ type: "pkcs8", format: "der" }) as Buffer,
		)
		// Node exports the canonical RFC 8410 version 0 structure. Changing only
		// the INTEGER value creates a version 1 structure with no [1] public key.
		expect(pkcs8.subarray(2, 5)).toEqual(Buffer.from([0x02, 0x01, 0x00]))
		pkcs8[4] = 1

		expect(() => extractEd25519PrivateSeed(pkcs8)).toThrow(
			/Invalid Ed25519 DER encoding/,
		)
	})
})
