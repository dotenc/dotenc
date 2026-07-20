import { isUtf8 } from "node:buffer"
import crypto from "node:crypto"

/**
 * Creates a new data key
 */
export const createDataKey = () => crypto.randomBytes(32)

// AES-256-GCM constants
const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12 // 96 bits, recommended for GCM
const AUTH_TAG_LENGTH = 16 // 128 bits, standard for GCM

/**
 * Encrypts a file using AES-256-GCM.
 * @param {Buffer} key - The encryption key (must be 32 bytes for AES-256).
 * @param {string} input - The input string to encrypt.
 * @param {Buffer} [aad] - Optional Additional Authenticated Data bound to the ciphertext.
 */
export async function encryptData(key: Buffer, input: string, aad?: Buffer) {
	if (key.length !== 32) {
		throw new Error("Key must be 32 bytes (256 bits) for AES-256-GCM.")
	}

	// Generate a random IV
	const iv = crypto.randomBytes(IV_LENGTH)

	// Create the cipher
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
	if (aad) {
		cipher.setAAD(aad)
	}

	// Encrypt the data
	const encrypted = Buffer.concat([cipher.update(input), cipher.final()])

	// Get the auth tag
	const authTag = cipher.getAuthTag()

	// Combine IV + encrypted content + auth tag
	return Buffer.concat([iv, encrypted, authTag])
}

/**
 * Decrypts a file using AES-256-GCM.
 * @param {Buffer} key - The decryption key (must be 32 bytes for AES-256).
 * @param {Buffer} input - The encrypted content to decrypt.
 * @param {Buffer} [aad] - Optional Additional Authenticated Data that must match what was used during encryption.
 */
export async function decryptData(key: Buffer, input: Buffer, aad?: Buffer) {
	if (key.length !== 32) {
		throw new Error("Key must be 32 bytes (256 bits) for AES-256-GCM.")
	}

	if (input.length < IV_LENGTH + AUTH_TAG_LENGTH) {
		throw new Error(
			`Encrypted input is too short (${input.length} bytes). Expected at least ${IV_LENGTH + AUTH_TAG_LENGTH} bytes.`,
		)
	}

	// Extract the IV from the start of the file
	const iv = input.subarray(0, IV_LENGTH)

	// Extract the auth tag from the end of the file
	const authTag = input.subarray(input.length - AUTH_TAG_LENGTH)

	// Extract the ciphertext (everything between IV and auth tag)
	const ciphertext = input.subarray(IV_LENGTH, input.length - AUTH_TAG_LENGTH)

	try {
		// Create the decipher
		const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
		decipher.setAuthTag(authTag)
		if (aad) {
			decipher.setAAD(aad)
		}

		// Decrypt the ciphertext
		const decrypted = Buffer.concat([
			decipher.update(ciphertext),
			decipher.final(),
		])
		try {
			if (!isUtf8(decrypted)) {
				throw new Error("Decrypted content is not valid UTF-8.")
			}
			return decrypted.toString("utf-8")
		} finally {
			decrypted.fill(0)
		}
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("unable to authenticate")
		) {
			throw new Error(
				"Failed to decrypt file. This could be because:\n" +
					"1. The encryption key may be incorrect\n" +
					"2. The encrypted file may be corrupted\n" +
					"3. The encrypted file may have been tampered with",
			)
		}
		throw error
	}
}
