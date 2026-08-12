import crypto from "node:crypto"

type ReadResult<T> = { value: T; nextOffset: number } | null

function readBytes(buffer: Buffer, offset: number): ReadResult<Buffer> {
	if (offset + 4 > buffer.length) return null
	const length = buffer.readUInt32BE(offset)
	const start = offset + 4
	const end = start + length
	if (end > buffer.length) return null
	return { value: buffer.subarray(start, end), nextOffset: end }
}

function readString(buffer: Buffer, offset: number): ReadResult<string> {
	const bytes = readBytes(buffer, offset)
	if (!bytes) return null
	return {
		value: bytes.value.toString("ascii"),
		nextOffset: bytes.nextOffset,
	}
}

function stripMpintPadding(value: Buffer): Buffer {
	let offset = 0
	while (offset < value.length - 1 && value[offset] === 0) {
		offset += 1
	}
	return value.subarray(offset)
}

function parseEd25519(buffer: Buffer, offset: number): crypto.KeyObject | null {
	const rawPublicKey = readBytes(buffer, offset)
	if (!rawPublicKey || rawPublicKey.value.length !== 32) return null
	if (rawPublicKey.nextOffset !== buffer.length) return null

	// RFC 8410 SubjectPublicKeyInfo prefix for an Ed25519 32-byte public key.
	const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex")
	const der = Buffer.concat([spkiPrefix, rawPublicKey.value])

	try {
		return crypto.createPublicKey({ key: der, format: "der", type: "spki" })
	} catch {
		return null
	} finally {
		der.fill(0)
	}
}

function parseRsa(buffer: Buffer, offset: number): crypto.KeyObject | null {
	const exponent = readBytes(buffer, offset)
	if (!exponent) return null
	const modulus = readBytes(buffer, exponent.nextOffset)
	if (!modulus || modulus.nextOffset !== buffer.length) return null

	try {
		return crypto.createPublicKey({
			key: {
				kty: "RSA",
				e: stripMpintPadding(exponent.value).toString("base64url"),
				n: stripMpintPadding(modulus.value).toString("base64url"),
			},
			format: "jwk",
		})
	} catch {
		return null
	}
}

/**
 * Parses one OpenSSH authorized-key line into a Node public KeyObject.
 *
 * Only the algorithms accepted by dotenc are supported. Options placed before
 * the key type (as allowed in authorized_keys files) are intentionally rejected
 * because 1Password exposes plain public-key lines without those options.
 */
export function parseOpenSSHPublicKey(
	content: string,
): crypto.KeyObject | null {
	const trimmed = content.trim()
	if (!trimmed || trimmed.includes("\n") || trimmed.includes("\r")) return null

	const [declaredType, base64] = trimmed.split(/\s+/, 3)
	if (
		(declaredType !== "ssh-ed25519" && declaredType !== "ssh-rsa") ||
		!base64 ||
		!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
	) {
		return null
	}

	const buffer = Buffer.from(base64, "base64")
	try {
		const embeddedType = readString(buffer, 0)
		if (!embeddedType || embeddedType.value !== declaredType) return null

		if (declaredType === "ssh-ed25519") {
			return parseEd25519(buffer, embeddedType.nextOffset)
		}

		return parseRsa(buffer, embeddedType.nextOffset)
	} finally {
		buffer.fill(0)
	}
}
