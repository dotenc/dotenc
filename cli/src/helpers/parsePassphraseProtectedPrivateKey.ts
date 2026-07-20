import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseOpenSSHPrivateKey } from "./parseOpenSSHKey"

type ParsePassphraseProtectedPrivateKeyDeps = {
	createPrivateKey: typeof crypto.createPrivateKey
	parseOpenSSHPrivateKey: typeof parseOpenSSHPrivateKey
	mkdtemp: typeof fs.mkdtemp
	writeFile: typeof fs.writeFile
	readFile: typeof fs.readFile
	rm: typeof fs.rm
	tmpdir: typeof os.tmpdir
	spawnSync: typeof spawnSync
}

const defaultParsePassphraseProtectedPrivateKeyDeps: ParsePassphraseProtectedPrivateKeyDeps =
	{
		createPrivateKey: crypto.createPrivateKey,
		parseOpenSSHPrivateKey,
		mkdtemp: fs.mkdtemp,
		writeFile: fs.writeFile,
		readFile: fs.readFile,
		rm: fs.rm,
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
		const tempKeyPath = path.join(tempDir, "key")
		const passphraseFilePath = path.join(tempDir, "pp")
		const askpassPath = path.join(tempDir, "askpass.sh")
		await deps.writeFile(tempKeyPath, keyContent, {
			encoding: "utf-8",
			mode: 0o600,
		})
		// Write passphrase to a file so it is never exposed in process arguments.
		await deps.writeFile(passphraseFilePath, passphrase, {
			encoding: "utf-8",
			mode: 0o600,
		})
		const escapedPassphrasePath = passphraseFilePath.replace(/'/g, "'\\''")
		await deps.writeFile(
			askpassPath,
			`#!/bin/sh\ncat '${escapedPassphrasePath}'\n`,
			{ encoding: "utf-8", mode: 0o700 },
		)

		// Keep unrelated workflow secrets out of the trusted ssh-keygen fallback.
		// The key and passphrase are already available through restricted temp files.
		const childEnvironment: NodeJS.ProcessEnv = {
			DISPLAY: process.env.DISPLAY || ":0",
			PATH: process.env.PATH || "/usr/bin:/bin",
			SSH_ASKPASS: askpassPath,
			SSH_ASKPASS_REQUIRE: "prefer",
		}
		for (const name of ["SystemRoot", "WINDIR", "PATHEXT"] as const) {
			if (process.env[name]) childEnvironment[name] = process.env[name]
		}

		const result = deps.spawnSync(
			"ssh-keygen",
			["-p", "-N", "", "-f", tempKeyPath, "-q"],
			{
				stdio: "pipe",
				encoding: "utf-8",
				// DISPLAY supports older OpenSSH; SSH_ASKPASS_REQUIRE supports >= 8.4.
				env: childEnvironment,
			},
		)
		if (result.error || result.status !== 0) {
			return null
		}

		const unlockedKeyContent = await deps.readFile(tempKeyPath, "utf-8")
		try {
			return deps.createPrivateKey(unlockedKeyContent)
		} catch {
			return deps.parseOpenSSHPrivateKey(unlockedKeyContent)
		}
	} finally {
		if (tempDir) {
			await deps.rm(tempDir, { recursive: true, force: true }).catch(() => {})
		}
	}
}
