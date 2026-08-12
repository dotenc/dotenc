import crypto, { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { getKeyFingerprint } from "./getKeyFingerprint"
import type { KeyCandidate } from "./keyCandidate"
import { parseOpenSSHPrivateKey } from "./parseOpenSSHKey"

const MAX_COPY_SUFFIX = 999

type ResolveOnePasswordSshKeyCopyPathDeps = {
	existsSync: typeof existsSync
	homedir: typeof os.homedir
}

const defaultResolvePathDeps: ResolveOnePasswordSshKeyCopyPathDeps = {
	existsSync,
	homedir: os.homedir,
}

export function _resolveOnePasswordSshKeyCopyPath(
	candidate: KeyCandidate,
	deps: ResolveOnePasswordSshKeyCopyPathDeps = defaultResolvePathDeps,
): string {
	const fingerprintId = createHash("sha256")
		.update(candidate.fingerprint)
		.digest("hex")
		.slice(0, 12)
	const baseName = `id_${candidate.algorithm}_1password_${fingerprintId}`
	const sshDirectory = path.join(deps.homedir(), ".ssh")

	for (let index = 0; index <= MAX_COPY_SUFFIX; index += 1) {
		const suffix = index === 0 ? "" : `_${index}`
		const candidatePath = path.join(sshDirectory, `${baseName}${suffix}`)
		if (
			!deps.existsSync(candidatePath) &&
			!deps.existsSync(`${candidatePath}.pub`)
		) {
			return candidatePath
		}
	}

	throw new Error("Could not determine an available SSH key path in ~/.ssh.")
}

type CreateOnePasswordSshKeyCopyDeps = {
	mkdir: typeof fs.mkdir
	chmod: typeof fs.chmod
	writeFile: typeof fs.writeFile
	unlink: typeof fs.unlink
	resolvePath: (candidate: KeyCandidate) => string
}

const defaultCreateCopyDeps: CreateOnePasswordSshKeyCopyDeps = {
	mkdir: fs.mkdir,
	chmod: fs.chmod,
	writeFile: fs.writeFile,
	unlink: fs.unlink,
	resolvePath: _resolveOnePasswordSshKeyCopyPath,
}

export async function createOnePasswordSshKeyCopy(
	candidate: KeyCandidate,
	deps: CreateOnePasswordSshKeyCopyDeps = defaultCreateCopyDeps,
): Promise<{ name: string; path: string }> {
	if (candidate.source !== "1password") {
		throw new Error("Only a 1Password key can be exported to a local SSH copy.")
	}
	if (!candidate.exportPrivateKey) {
		throw new Error("The selected 1Password key cannot be exported.")
	}

	const keyBytes = await candidate.exportPrivateKey()
	let parsedPrivateKey: ReturnType<typeof parseOpenSSHPrivateKey>
	try {
		try {
			parsedPrivateKey = crypto.createPrivateKey(keyBytes)
		} catch {
			parsedPrivateKey = parseOpenSSHPrivateKey(keyBytes)
		}
	} catch (error) {
		keyBytes.fill(0)
		throw error
	}
	if (
		!parsedPrivateKey ||
		getKeyFingerprint(parsedPrivateKey) !== candidate.fingerprint
	) {
		keyBytes.fill(0)
		throw new Error("The retrieved 1Password key fingerprint did not match.")
	}

	const keyPath = deps.resolvePath(candidate)
	const keyDirectory = path.dirname(keyPath)
	let created = false
	let writeStarted = false

	try {
		await deps.mkdir(keyDirectory, { recursive: true, mode: 0o700 })
		await deps.chmod(keyDirectory, 0o700)
		writeStarted = true
		await deps.writeFile(keyPath, keyBytes, { flag: "wx", mode: 0o600 })
		created = true
		await deps.chmod(keyPath, 0o600)
		return { name: path.basename(keyPath), path: keyPath }
	} catch (error) {
		const errorCode =
			error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
		if (created || (writeStarted && errorCode !== "EEXIST")) {
			await deps.unlink(keyPath).catch(() => {})
		}
		throw new Error(
			`Failed to create local 1Password SSH key copy: ${error instanceof Error ? error.message : String(error)}`,
		)
	} finally {
		keyBytes.fill(0)
	}
}
