import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseOpenSSHPrivateKey } from "./parseOpenSSHKey"
import { secureEraseFile } from "./secureEraseFile"

type ParsePassphraseProtectedPrivateKeyDeps = {
	createPrivateKey: typeof crypto.createPrivateKey
	parseOpenSSHPrivateKey: typeof parseOpenSSHPrivateKey
	mkdtemp: typeof fs.mkdtemp
	chmod: typeof fs.chmod
	writeFile: typeof fs.writeFile
	readFile: typeof fs.readFile
	rm: typeof fs.rm
	secureEraseFile: typeof secureEraseFile
	tmpdir: typeof os.tmpdir
	spawnSync: typeof spawnSync
}

const defaultParsePassphraseProtectedPrivateKeyDeps: ParsePassphraseProtectedPrivateKeyDeps =
	{
		createPrivateKey: crypto.createPrivateKey,
		parseOpenSSHPrivateKey,
		mkdtemp: fs.mkdtemp,
		chmod: fs.chmod,
		writeFile: fs.writeFile,
		readFile: fs.readFile,
		rm: fs.rm,
		secureEraseFile,
		tmpdir: os.tmpdir,
		spawnSync,
	}

export const parsePassphraseProtectedPrivateKey = async (
	keyContent: string,
	passphrase: string,
	deps: ParsePassphraseProtectedPrivateKeyDeps = defaultParsePassphraseProtectedPrivateKeyDeps,
): Promise<crypto.KeyObject | null> => {
	try {
		return deps.createPrivateKey({
			key: keyContent,
			passphrase,
		})
	} catch {
		// Continue to OpenSSH fallback below.
	}

	if (!keyContent.includes("BEGIN OPENSSH PRIVATE KEY")) {
		return null
	}

	let tempDir: string | undefined
	try {
		tempDir = await deps.mkdtemp(path.join(deps.tmpdir(), "dotenc-passphrase-"))
		await deps.chmod(tempDir, 0o700)
		const tempKeyPath = path.join(tempDir, "key")
		const askpassPath = path.join(tempDir, "askpass.sh")
		await deps.writeFile(tempKeyPath, keyContent, {
			encoding: "utf-8",
			mode: 0o600,
		})
		await deps.writeFile(askpassPath, "#!/bin/sh\ncat\n", {
			encoding: "utf-8",
			mode: 0o700,
		})

		// Keep unrelated workflow secrets out of the trusted ssh-keygen fallback.
		// The key is in a restricted temp file; the passphrase arrives through stdin.
		const childEnvironment: NodeJS.ProcessEnv = {
			DISPLAY: process.env.DISPLAY || ":0",
			PATH: process.env.PATH || "/usr/bin:/bin",
			SSH_ASKPASS: askpassPath,
			SSH_ASKPASS_REQUIRE: "force",
		}
		for (const name of ["SystemRoot", "WINDIR", "PATHEXT"] as const) {
			if (process.env[name]) childEnvironment[name] = process.env[name]
		}

		const passphraseInput = Buffer.from(passphrase, "utf-8")
		try {
			const result = deps.spawnSync(
				"ssh-keygen",
				["-p", "-N", "", "-f", tempKeyPath, "-q"],
				{
					stdio: ["pipe", "ignore", "ignore"],
					input: passphraseInput,
					// DISPLAY supports older OpenSSH; SSH_ASKPASS_REQUIRE supports >= 8.4.
					env: childEnvironment,
				},
			)
			if (result.error || result.status !== 0) {
				return null
			}
		} finally {
			passphraseInput.fill(0)
		}

		const unlockedKeyContent = await deps.readFile(tempKeyPath)
		try {
			return deps.createPrivateKey(unlockedKeyContent)
		} catch {
			return deps.parseOpenSSHPrivateKey(unlockedKeyContent)
		} finally {
			unlockedKeyContent.fill(0)
		}
	} finally {
		if (tempDir) {
			await Promise.all([
				deps.secureEraseFile(path.join(tempDir, "key")),
				deps.secureEraseFile(path.join(tempDir, "askpass.sh")),
			])
			await deps.rm(tempDir, { recursive: true, force: true }).catch(() => {})
		}
	}
}
