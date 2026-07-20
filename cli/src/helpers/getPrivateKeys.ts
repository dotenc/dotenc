import crypto from "node:crypto"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { getKeyFingerprint } from "./getKeyFingerprint"
import { isPassphraseProtected } from "./isPassphraseProtected"
import { parseOpenSSHPrivateKey } from "./parseOpenSSHKey"
import { parsePassphraseProtectedPrivateKey } from "./parsePassphraseProtectedPrivateKey"

export type PrivateKeyEntry = {
	name: string
	privateKey: crypto.KeyObject
	fingerprint: string
	algorithm: "rsa" | "ed25519"
	rawPublicKey?: Buffer
}

export type UnsupportedPrivateKeyEntry = {
	name: string
	reason: string
}

const SSH_KEY_FILES = ["id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"]
const DOTENC_PRIVATE_KEY_BASE64_ENV = "DOTENC_PRIVATE_KEY_BASE64"
const DOTENC_PRIVATE_KEY_ENV = "DOTENC_PRIVATE_KEY"

type EnvironmentPrivateKey =
	| {
			name: typeof DOTENC_PRIVATE_KEY_BASE64_ENV | typeof DOTENC_PRIVATE_KEY_ENV
			content: string
	  }
	| {
			name: typeof DOTENC_PRIVATE_KEY_BASE64_ENV
			error: "invalid-base64"
	  }

function extractEd25519RawKeys(privateKey: crypto.KeyObject): {
	rawPublicKey: Buffer
} {
	const publicKey = crypto.createPublicKey(privateKey)
	const pubDer = publicKey.export({ type: "spki", format: "der" })
	const rawPublicKey = Buffer.from(pubDer.subarray(pubDer.length - 32))

	return { rawPublicKey }
}

function detectAlgorithm(
	privateKey: crypto.KeyObject,
): "rsa" | "ed25519" | null {
	const keyType = privateKey.asymmetricKeyType
	if (keyType === "rsa") return "rsa"
	if (keyType === "ed25519") return "ed25519"
	return null
}

function tryParsePrivateKey(keyContent: string): crypto.KeyObject | null {
	try {
		return crypto.createPrivateKey(keyContent)
	} catch {
		// Fallback: parse OpenSSH format that Node/OpenSSL can't handle natively
		return parseOpenSSHPrivateKey(keyContent)
	}
}

function decodePrivateKeyBase64(value: string): string | null {
	const normalized = value.replace(/\s/g, "")
	if (!normalized) return null
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null
	if (normalized.length % 4 === 1) return null

	const decoded = Buffer.from(normalized, "base64").toString("utf-8")
	const normalizedInput = normalized.replace(/=+$/, "")
	const normalizedRoundTrip = Buffer.from(decoded, "utf-8")
		.toString("base64")
		.replace(/=+$/, "")

	if (normalizedInput !== normalizedRoundTrip) return null

	return decoded
}

function getEnvironmentPrivateKey(): EnvironmentPrivateKey | null {
	const base64PrivateKey = process.env[DOTENC_PRIVATE_KEY_BASE64_ENV]
	if (base64PrivateKey) {
		const content = decodePrivateKeyBase64(base64PrivateKey)
		if (!content) {
			return {
				name: DOTENC_PRIVATE_KEY_BASE64_ENV,
				error: "invalid-base64",
			}
		}

		return {
			name: DOTENC_PRIVATE_KEY_BASE64_ENV,
			content,
		}
	}

	const rawPrivateKey = process.env[DOTENC_PRIVATE_KEY_ENV]
	if (rawPrivateKey) {
		return {
			name: DOTENC_PRIVATE_KEY_ENV,
			content: rawPrivateKey,
		}
	}

	return null
}

function describeUnsupportedAlgorithm(
	keyType: crypto.KeyObject["asymmetricKeyType"] | string | undefined,
) {
	return `unsupported algorithm: ${String(keyType ?? "unknown")}`
}

function readLengthPrefixedBytes(
	buffer: Buffer,
	offset: number,
): { bytes: Buffer; nextOffset: number } | null {
	if (offset + 4 > buffer.length) return null
	const length = buffer.readUInt32BE(offset)
	const start = offset + 4
	const end = start + length
	if (end > buffer.length) return null
	return { bytes: buffer.subarray(start, end), nextOffset: end }
}

function readLengthPrefixedString(
	buffer: Buffer,
	offset: number,
): { value: string; nextOffset: number } | null {
	const bytes = readLengthPrefixedBytes(buffer, offset)
	if (!bytes) return null
	return { value: bytes.bytes.toString("ascii"), nextOffset: bytes.nextOffset }
}

function detectUnsupportedOpenSSHAlgorithm(keyContent: string): string | null {
	if (!keyContent.includes("BEGIN OPENSSH PRIVATE KEY")) return null

	const lines = keyContent.split("\n")
	const startIdx = lines.findIndex((line) =>
		line.trim().startsWith("-----BEGIN OPENSSH PRIVATE KEY-----"),
	)
	const endIdx = lines.findIndex((line) =>
		line.trim().startsWith("-----END OPENSSH PRIVATE KEY-----"),
	)
	if (startIdx === -1 || endIdx === -1) return null

	const base64 = lines
		.slice(startIdx + 1, endIdx)
		.map((line) => line.trim())
		.join("")
	const buffer = Buffer.from(base64, "base64")

	const MAGIC = "openssh-key-v1\0"
	if (buffer.length < MAGIC.length) return null
	const magic = buffer.subarray(0, MAGIC.length).toString("ascii")
	if (magic !== MAGIC) return null

	let offset = MAGIC.length

	const ciphername = readLengthPrefixedString(buffer, offset)
	if (!ciphername) return null
	offset = ciphername.nextOffset

	const kdfname = readLengthPrefixedString(buffer, offset)
	if (!kdfname) return null
	offset = kdfname.nextOffset

	const kdfoptions = readLengthPrefixedBytes(buffer, offset)
	if (!kdfoptions) return null
	offset = kdfoptions.nextOffset

	if (offset + 4 > buffer.length) return null
	const keyCount = buffer.readUInt32BE(offset)
	offset += 4
	if (keyCount < 1) return null

	const publicBlob = readLengthPrefixedBytes(buffer, offset)
	if (!publicBlob) return null

	const publicBlobType = readLengthPrefixedString(publicBlob.bytes, 0)
	if (!publicBlobType) return null

	if (publicBlobType.value === "ssh-rsa") return null
	if (publicBlobType.value === "ssh-ed25519") return null

	return publicBlobType.value
}

export type GetPrivateKeysResult = {
	keys: PrivateKeyEntry[]
	passphraseProtectedKeys: string[]
	unsupportedKeys?: UnsupportedPrivateKeyEntry[]
}

export type GetPrivateKeysOptions = {
	/** Only consider DOTENC_PRIVATE_KEY_BASE64 / DOTENC_PRIVATE_KEY. */
	environmentOnly?: boolean
	/** Preserve the interactive CLI behavior by default; library callers can collect. */
	environmentKeyErrorMode?: "exit" | "collect"
	/** Allows non-interactive callers to suppress otherwise-safe diagnostics. */
	logError?: (message: string) => void
}

export const getPrivateKeys = async (
	options: GetPrivateKeysOptions = {},
): Promise<GetPrivateKeysResult> => {
	const privateKeys: PrivateKeyEntry[] = []
	const passphraseProtectedKeys: string[] = []
	const unsupportedKeys: UnsupportedPrivateKeyEntry[] = []
	const privateKeyPassphrase = process.env.DOTENC_PRIVATE_KEY_PASSPHRASE
	const environmentKeyErrorMode = options.environmentKeyErrorMode ?? "exit"
	const logError =
		options.logError ?? ((message: string) => console.error(message))

	// Check environment-provided bootstrap keys before scanning ~/.ssh.
	const environmentPrivateKey = getEnvironmentPrivateKey()
	if (environmentPrivateKey) {
		const envName = environmentPrivateKey.name
		const entryName = `env.${envName}`

		if ("error" in environmentPrivateKey) {
			logError(
				`Invalid ${envName} value. Please provide base64-encoded private key content.`,
			)
			unsupportedKeys.push({
				name: entryName,
				reason: "invalid base64 private key",
			})
		} else {
			const dotencPrivateKey = environmentPrivateKey.content
			const dotencPrivateKeyPassphraseProtected =
				isPassphraseProtected(dotencPrivateKey)

			const privateKey: crypto.KeyObject | null =
				dotencPrivateKeyPassphraseProtected
					? privateKeyPassphrase !== undefined
						? await parsePassphraseProtectedPrivateKey(
								dotencPrivateKey,
								privateKeyPassphrase,
							)
						: null
					: tryParsePrivateKey(dotencPrivateKey)

			if (privateKey) {
				const algorithm = detectAlgorithm(privateKey)

				if (algorithm) {
					const entry: PrivateKeyEntry = {
						name: entryName,
						privateKey,
						fingerprint: getKeyFingerprint(privateKey),
						algorithm,
					}

					if (algorithm === "ed25519") {
						const { rawPublicKey } = extractEd25519RawKeys(privateKey)
						entry.rawPublicKey = rawPublicKey
					}

					privateKeys.push(entry)
				} else {
					unsupportedKeys.push({
						name: entryName,
						reason: describeUnsupportedAlgorithm(privateKey.asymmetricKeyType),
					})
					logError(
						`Unsupported key type in ${envName}: ${privateKey.asymmetricKeyType}. Only RSA and Ed25519 are supported.`,
					)
				}
			} else if (dotencPrivateKeyPassphraseProtected) {
				if (privateKeyPassphrase !== undefined) {
					logError(
						`Error: failed to decrypt the key in ${envName} with DOTENC_PRIVATE_KEY_PASSPHRASE. Please verify the passphrase.`,
					)
					if (environmentKeyErrorMode === "exit") {
						process.exit(1)
					}
					unsupportedKeys.push({
						name: entryName,
						reason: "passphrase-protected (failed to decrypt)",
					})
				} else {
					logError(
						`Error: the key in ${envName} is passphrase-protected. Set DOTENC_PRIVATE_KEY_PASSPHRASE to use it, or provide a passwordless key.`,
					)
					if (environmentKeyErrorMode === "exit") {
						process.exit(1)
					}
					passphraseProtectedKeys.push(entryName)
					unsupportedKeys.push({
						name: entryName,
						reason: "passphrase-protected",
					})
				}
			} else {
				logError(
					`Invalid private key format in ${envName} environment variable. Please provide a valid private key (PEM or OpenSSH format).`,
				)
				unsupportedKeys.push({
					name: entryName,
					reason: "invalid private key format",
				})
			}
		}
	}

	if (options.environmentOnly) {
		return { keys: privateKeys, passphraseProtectedKeys, unsupportedKeys }
	}

	// Scan ~/.ssh/ for SSH key files
	const sshDir = path.join(os.homedir(), ".ssh")
	if (!existsSync(sshDir)) {
		return { keys: privateKeys, passphraseProtectedKeys, unsupportedKeys }
	}

	const files = await fs.readdir(sshDir)

	// First check well-known key names, then any other files that look like private keys
	const knownFiles = SSH_KEY_FILES.filter((f) => files.includes(f))
	const otherFiles = files.filter(
		(f) =>
			!SSH_KEY_FILES.includes(f) &&
			!f.endsWith(".pub") &&
			!f.startsWith("known_hosts") &&
			!f.startsWith("authorized_keys") &&
			f !== "config",
	)

	for (const fileName of [...knownFiles, ...otherFiles]) {
		const filePath = path.join(sshDir, fileName)

		let stat: Awaited<ReturnType<typeof fs.stat>>
		try {
			stat = await fs.stat(filePath)
		} catch {
			continue
		}

		if (!stat.isFile()) continue

		let keyContent: string
		try {
			keyContent = await fs.readFile(filePath, "utf-8")
		} catch {
			continue
		}

		// Quick check: must look like a private key file
		if (!keyContent.includes("PRIVATE KEY")) continue

		// Check passphrase protection before attempting to parse. On Bun, calling
		// crypto.createPrivateKey() on a legacy encrypted RSA PEM (Proc-Type: 4,ENCRYPTED)
		// leaves the OpenSSL error queue dirty, which then breaks all subsequent
		// PKCS#8 DER imports (e.g. Ed25519) for the rest of the process lifetime.
		if (isPassphraseProtected(keyContent)) {
			if (privateKeyPassphrase === undefined) {
				passphraseProtectedKeys.push(fileName)
				unsupportedKeys.push({
					name: fileName,
					reason: "passphrase-protected",
				})
				continue
			}

			const decryptedPrivateKey = await parsePassphraseProtectedPrivateKey(
				keyContent,
				privateKeyPassphrase,
			)
			if (!decryptedPrivateKey) {
				passphraseProtectedKeys.push(fileName)
				unsupportedKeys.push({
					name: fileName,
					reason:
						"passphrase-protected (failed to decrypt with DOTENC_PRIVATE_KEY_PASSPHRASE)",
				})
				continue
			}

			const algorithm = detectAlgorithm(decryptedPrivateKey)
			if (!algorithm) {
				unsupportedKeys.push({
					name: fileName,
					reason: describeUnsupportedAlgorithm(
						decryptedPrivateKey.asymmetricKeyType,
					),
				})
				continue
			}

			const entry: PrivateKeyEntry = {
				name: fileName,
				privateKey: decryptedPrivateKey,
				fingerprint: getKeyFingerprint(decryptedPrivateKey),
				algorithm,
			}

			if (algorithm === "ed25519") {
				const { rawPublicKey } = extractEd25519RawKeys(decryptedPrivateKey)
				entry.rawPublicKey = rawPublicKey
			}

			privateKeys.push(entry)
			continue
		}

		const privateKey = tryParsePrivateKey(keyContent)

		if (!privateKey) {
			const unsupportedOpenSSHType =
				detectUnsupportedOpenSSHAlgorithm(keyContent)
			unsupportedKeys.push({
				name: fileName,
				reason: unsupportedOpenSSHType
					? describeUnsupportedAlgorithm(unsupportedOpenSSHType)
					: "invalid private key format",
			})
			continue
		}

		const algorithm = detectAlgorithm(privateKey)
		if (!algorithm) {
			unsupportedKeys.push({
				name: fileName,
				reason: describeUnsupportedAlgorithm(privateKey.asymmetricKeyType),
			})
			continue
		}

		const entry: PrivateKeyEntry = {
			name: fileName,
			privateKey,
			fingerprint: getKeyFingerprint(privateKey),
			algorithm,
		}

		if (algorithm === "ed25519") {
			const { rawPublicKey } = extractEd25519RawKeys(privateKey)
			entry.rawPublicKey = rawPublicKey
		}

		privateKeys.push(entry)
	}

	return { keys: privateKeys, passphraseProtectedKeys, unsupportedKeys }
}
