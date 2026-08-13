import type crypto from "node:crypto"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { extractEd25519PublicKey } from "./ed25519Der"
import { getKeyFingerprint } from "./getKeyFingerprint"
import { parseSpkiPublicKey } from "./parseSpkiPublicKey"
import { resolveProjectRoot } from "./resolveProjectRoot"
import { validatePublicKey } from "./validatePublicKey"

export type PublicKeyEntry = {
	name: string
	publicKey: crypto.KeyObject
	fingerprint: string
	algorithm: "rsa" | "ed25519"
	rawPublicKey?: Buffer
}

function detectAlgorithm(
	publicKey: crypto.KeyObject,
): "rsa" | "ed25519" | null {
	const keyType = publicKey.asymmetricKeyType
	if (keyType === "rsa") return "rsa"
	if (keyType === "ed25519") return "ed25519"
	return null
}

function extractEd25519RawPublicKey(publicKey: crypto.KeyObject): Buffer {
	const pubDer = publicKey.export({ type: "spki", format: "der" })
	return extractEd25519PublicKey(Buffer.from(pubDer))
}

export const getPublicKeys = async (dotencDir?: string) => {
	let resolvedDotencDir: string
	if (dotencDir !== undefined) {
		resolvedDotencDir = dotencDir
	} else {
		try {
			const projectRoot = resolveProjectRoot(process.cwd(), existsSync)
			resolvedDotencDir = path.join(projectRoot, ".dotenc")
		} catch {
			return []
		}
	}

	if (!existsSync(resolvedDotencDir)) {
		return []
	}

	const files = await fs.readdir(resolvedDotencDir)

	const publicKeys: PublicKeyEntry[] = []
	for (const fileName of files) {
		if (!fileName.endsWith(".pub")) {
			continue
		}

		const keyInput = await fs.readFile(
			path.join(resolvedDotencDir, fileName),
			"utf-8",
		)
		let publicKey: crypto.KeyObject
		try {
			publicKey = parseSpkiPublicKey(keyInput)
		} catch {
			console.error(
				`Invalid public key format in ${fileName}. Please provide a valid PEM formatted public key.`,
			)
			continue
		}

		const algorithm = detectAlgorithm(publicKey)
		if (!algorithm) {
			console.error(
				`Unsupported key type in ${fileName}: ${publicKey.asymmetricKeyType}. Only RSA and Ed25519 are supported.`,
			)
			continue
		}

		const validation = validatePublicKey(publicKey)
		if (!validation.valid) {
			console.error(`Invalid public key in ${fileName}: ${validation.reason}`)
			continue
		}

		const entry: PublicKeyEntry = {
			name: fileName.replace(".pub", ""),
			publicKey,
			fingerprint: getKeyFingerprint(publicKey),
			algorithm,
		}

		if (algorithm === "ed25519") {
			entry.rawPublicKey = extractEd25519RawPublicKey(publicKey)
		}

		publicKeys.push(entry)
	}

	return publicKeys
}
