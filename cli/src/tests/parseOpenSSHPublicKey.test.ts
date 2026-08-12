import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import type crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { getKeyFingerprint } from "../helpers/getKeyFingerprint"
import { parseOpenSSHPrivateKey } from "../helpers/parseOpenSSHKey"
import { parseOpenSSHPublicKey } from "../helpers/parseOpenSSHPublicKey"

function generateKey(type: "ed25519" | "rsa") {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dotenc-public-key-"))
	const privateKeyPath = path.join(directory, "key")
	const args = ["-t", type, "-f", privateKeyPath, "-N", "", "-q"]
	if (type === "rsa") args.push("-b", "2048")
	execFileSync("ssh-keygen", args)

	return {
		directory,
		privateKey: fs.readFileSync(privateKeyPath, "utf8"),
		publicKey: fs.readFileSync(`${privateKeyPath}.pub`, "utf8"),
	}
}

describe("parseOpenSSHPublicKey", () => {
	test.each([
		"ed25519",
		"rsa",
	] as const)("parses an OpenSSH %s public key and preserves its fingerprint", (type) => {
		const fixture = generateKey(type)
		try {
			const parsed = parseOpenSSHPublicKey(fixture.publicKey)
			expect(parsed).not.toBeNull()
			expect(parsed?.asymmetricKeyType).toBe(type)

			const privateKey = parseOpenSSHPrivateKey(fixture.privateKey)
			expect(privateKey).not.toBeNull()
			expect(getKeyFingerprint(parsed as crypto.KeyObject)).toBe(
				getKeyFingerprint(privateKey as crypto.KeyObject),
			)
		} finally {
			fs.rmSync(fixture.directory, { recursive: true, force: true })
		}
	})

	test("rejects malformed, mismatched, multiline, and unsupported keys", () => {
		const fixture = generateKey("ed25519")
		try {
			const [, base64] = fixture.publicKey.trim().split(/\s+/)
			expect(parseOpenSSHPublicKey("not-a-key")).toBeNull()
			expect(parseOpenSSHPublicKey(`ssh-rsa ${base64}`)).toBeNull()
			expect(
				parseOpenSSHPublicKey(`${fixture.publicKey.trim()}\nssh-ed25519 AAAA`),
			).toBeNull()
			expect(parseOpenSSHPublicKey(`ecdsa-sha2-nistp256 ${base64}`)).toBeNull()
			expect(
				parseOpenSSHPublicKey(`no-pty ${fixture.publicKey.trim()}`),
			).toBeNull()

			const blob = Buffer.from(base64 as string, "base64")
			const padded = Buffer.concat([blob, Buffer.alloc(4)]).toString("base64")
			expect(parseOpenSSHPublicKey(`ssh-ed25519 ${padded}`)).toBeNull()

			const truncated = blob.subarray(0, -1).toString("base64")
			expect(parseOpenSSHPublicKey(`ssh-ed25519 ${truncated}`)).toBeNull()
			expect(parseOpenSSHPublicKey("ssh-ed25519 AAAA")).toBeNull()
		} finally {
			fs.rmSync(fixture.directory, { recursive: true, force: true })
		}
	})
})
