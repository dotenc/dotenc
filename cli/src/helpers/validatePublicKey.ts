import type { KeyObject } from "node:crypto"

type ValidationResult = { valid: true } | { valid: false; reason: string }

export function validatePublicKey(key: KeyObject): ValidationResult {
	const keyType = key.asymmetricKeyType

	switch (keyType) {
		case "rsa": {
			const modulusLength = key.asymmetricKeyDetails?.modulusLength
			if (
				typeof modulusLength !== "number" ||
				!Number.isSafeInteger(modulusLength)
			) {
				return {
					valid: false,
					reason: "Could not determine the RSA modulus length.",
				}
			}
			if (modulusLength < 2048) {
				return {
					valid: false,
					reason: `RSA key is ${modulusLength} bits, minimum is 2048 bits.`,
				}
			}
			return { valid: true }
		}
		case "ed25519":
			return { valid: true }
		case "dsa":
			return {
				valid: false,
				reason: "DSA keys are not supported. Use Ed25519 or RSA (2048+ bits).",
			}
		case "ec":
			return {
				valid: false,
				reason:
					"ECDSA keys are not supported. Use Ed25519 or RSA (2048+ bits).",
			}
		default:
			return {
				valid: false,
				reason: `Unsupported key type: ${keyType}. Use Ed25519 or RSA (2048+ bits).`,
			}
	}
}
