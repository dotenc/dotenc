import crypto from "node:crypto"
import { eciesDecrypt } from "./ecies"
import { extractEd25519PrivateSeed } from "./ed25519Der"

type PrivateKeyInfo = {
	algorithm: "rsa" | "ed25519"
	privateKey: crypto.KeyObject
}

/**
 * Decrypts a data key using the appropriate algorithm for the given private key.
 * RSA: uses crypto.privateDecrypt with PKCS1 padding.
 * Ed25519: uses ECIES (eciesjs) with raw 32-byte seed extracted at call time and
 *          zeroed immediately after use to minimise key material lifetime in memory.
 */
export const decryptDataKey = (
	keyInfo: PrivateKeyInfo,
	encryptedDataKey: Buffer,
): Buffer => {
	if (keyInfo.algorithm === "rsa") {
		return crypto.privateDecrypt(
			{
				key: keyInfo.privateKey,
				padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
				oaepHash: "sha256",
			},
			encryptedDataKey,
		)
	}

	// Extract the raw 32-byte seed from the PKCS#8 DER encoding at the moment of
	// decryption, then zero both the seed and the full DER buffer immediately after
	// use to minimise sensitive key material lifetime in process memory.
	const privDer = keyInfo.privateKey.export({
		type: "pkcs8",
		format: "der",
	}) as Buffer
	const rawSeed = extractEd25519PrivateSeed(privDer)
	try {
		return eciesDecrypt(rawSeed, encryptedDataKey)
	} finally {
		rawSeed.fill(0)
		privDer.fill(0)
	}
}
