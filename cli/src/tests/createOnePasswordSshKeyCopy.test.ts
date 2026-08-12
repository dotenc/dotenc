import { afterEach, describe, expect, mock, test } from "bun:test"
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
	_resolveOnePasswordSshKeyCopyPath,
	createOnePasswordSshKeyCopy,
} from "../helpers/createOnePasswordSshKeyCopy"
import { getKeyFingerprint } from "../helpers/getKeyFingerprint"
import type { KeyCandidate } from "../helpers/keyCandidate"
import { parseOpenSSHPublicKey } from "../helpers/parseOpenSSHPublicKey"

const temporaryDirectories: string[] = []

async function makeTemporaryHome() {
	const directory = await fs.mkdtemp(
		path.join(os.tmpdir(), "dotenc-1password-copy-test-"),
	)
	temporaryDirectories.push(directory)
	return directory
}

function providerCandidate(
	algorithm: "ed25519" | "rsa" = "ed25519",
): KeyCandidate {
	const { publicKey, privateKey } =
		algorithm === "ed25519"
			? crypto.generateKeyPairSync("ed25519")
			: crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
	const fingerprint = getKeyFingerprint(publicKey)
	return {
		source: "1password",
		selector: `1password:${"A".repeat(26)}:${"V".repeat(26)}:${"I".repeat(26)}`,
		name: "Production / unsafe title",
		hint: `${algorithm} - Private`,
		group: { id: "1password", label: "1Password" },
		publicKey,
		fingerprint,
		algorithm,
		loadPrivateKey: async () => ({
			name: "Production / unsafe title",
			privateKey,
			fingerprint,
			algorithm,
		}),
		exportPrivateKey: async () => {
			const exported = privateKey.export({ type: "pkcs8", format: "pem" })
			return Buffer.from(exported)
		},
	}
}

async function openSshProviderCandidate(
	algorithm: "ed25519" | "rsa",
): Promise<KeyCandidate> {
	const directory = await makeTemporaryHome()
	const keyPath = path.join(directory, `provider-${algorithm}`)
	const args = ["-t", algorithm, "-f", keyPath, "-N", "", "-q"]
	if (algorithm === "rsa") args.push("-b", "2048")
	execFileSync("ssh-keygen", args)
	const publicKey = parseOpenSSHPublicKey(
		(await fs.readFile(`${keyPath}.pub`, "utf8")).trim(),
	)
	if (!publicKey) throw new Error("failed to parse generated public key")
	const fingerprint = getKeyFingerprint(publicKey)

	return {
		source: "1password",
		selector: `1password:${"A".repeat(26)}:${"V".repeat(26)}:${"I".repeat(26)}`,
		name: `Provider ${algorithm}`,
		hint: `${algorithm} - Private`,
		group: { id: "1password", label: "1Password" },
		publicKey,
		fingerprint,
		algorithm,
		loadPrivateKey: async () => {
			throw new Error("not used by the copy helper")
		},
		exportPrivateKey: () => fs.readFile(keyPath),
	}
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			fs.rm(directory, {
				recursive: true,
				force: true,
			}),
		),
	)
})

describe("createOnePasswordSshKeyCopy", () => {
	test("uses a safe fingerprint-backed filename and avoids existing paths", async () => {
		const home = await makeTemporaryHome()
		const candidate = providerCandidate()
		const deps = {
			homedir: () => home,
			existsSync: (filePath: import("node:fs").PathLike) =>
				!/_1(?:\.pub)?$/.test(String(filePath)),
		}

		const resolved = _resolveOnePasswordSshKeyCopyPath(candidate, deps)
		expect(resolved).toStartWith(
			path.join(home, ".ssh", "id_ed25519_1password_"),
		)
		expect(resolved).toEndWith("_1")
		expect(resolved).not.toContain("Production")
	})

	test("writes a fingerprint-matched OpenSSH private key with private modes", async () => {
		const home = await makeTemporaryHome()
		const candidate = await openSshProviderCandidate("ed25519")
		const keyPath = path.join(home, ".ssh", "id_ed25519_1password_test")

		const created = await createOnePasswordSshKeyCopy(candidate, {
			mkdir: fs.mkdir,
			chmod: fs.chmod,
			writeFile: fs.writeFile,
			unlink: fs.unlink,
			resolvePath: () => keyPath,
		})

		expect(created).toEqual({
			name: "id_ed25519_1password_test",
			path: keyPath,
		})
		expect((await fs.stat(path.dirname(keyPath))).mode & 0o777).toBe(0o700)
		expect((await fs.stat(keyPath)).mode & 0o777).toBe(0o600)
		const written = await fs.readFile(keyPath)
		expect(written.toString("utf8")).toContain("BEGIN OPENSSH PRIVATE KEY")
		expect(
			execFileSync("ssh-keygen", ["-y", "-f", keyPath], {
				encoding: "utf8",
			}),
		).toStartWith("ssh-ed25519 ")
	})

	test("rejects mismatched retrieved keys before writing", async () => {
		const candidate = providerCandidate()
		const different = crypto.generateKeyPairSync("ed25519").privateKey
		candidate.exportPrivateKey = async () =>
			Buffer.from(different.export({ type: "pkcs8", format: "pem" }))
		const writeFile = mock(async () => {})

		await expect(
			createOnePasswordSshKeyCopy(candidate, {
				mkdir: mock(async () => undefined) as never,
				chmod: mock(async () => {}) as never,
				writeFile: writeFile as never,
				unlink: mock(async () => {}) as never,
				resolvePath: () => "/tmp/should-not-exist",
			}),
		).rejects.toThrow("fingerprint did not match")
		expect(writeFile).not.toHaveBeenCalled()
	})

	test("writes an SSH-compatible RSA copy", async () => {
		const home = await makeTemporaryHome()
		const candidate = await openSshProviderCandidate("rsa")
		const keyPath = path.join(home, ".ssh", "id_rsa_1password_test")

		await createOnePasswordSshKeyCopy(candidate, {
			mkdir: fs.mkdir,
			chmod: fs.chmod,
			writeFile: fs.writeFile,
			unlink: fs.unlink,
			resolvePath: () => keyPath,
		})

		expect(
			execFileSync("ssh-keygen", ["-y", "-f", keyPath], {
				encoding: "utf8",
			}),
		).toStartWith("ssh-rsa ")
	})

	test("never deletes an existing file when exclusive creation loses a race", async () => {
		const candidate = providerCandidate()
		const unlink = mock(async () => {})

		await expect(
			createOnePasswordSshKeyCopy(candidate, {
				mkdir: mock(async () => undefined) as never,
				chmod: mock(async () => {}) as never,
				writeFile: mock(async () => {
					const error = new Error("exists") as NodeJS.ErrnoException
					error.code = "EEXIST"
					throw error
				}) as never,
				unlink: unlink as never,
				resolvePath: () => "/tmp/existing",
			}),
		).rejects.toThrow("Failed to create local 1Password SSH key copy")
		expect(unlink).not.toHaveBeenCalled()
	})

	test("removes a file left by a failed exclusive write", async () => {
		const candidate = providerCandidate()
		const unlink = mock(async () => {})

		await expect(
			createOnePasswordSshKeyCopy(candidate, {
				mkdir: mock(async () => undefined) as never,
				chmod: mock(async () => {}) as never,
				writeFile: mock(async () => {
					const error = new Error("partial write") as NodeJS.ErrnoException
					error.code = "EIO"
					throw error
				}) as never,
				unlink: unlink as never,
				resolvePath: () => "/tmp/partial",
			}),
		).rejects.toThrow("Failed to create local 1Password SSH key copy")
		expect(unlink).toHaveBeenCalledWith("/tmp/partial")
	})
})
