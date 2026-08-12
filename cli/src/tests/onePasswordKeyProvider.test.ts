import { describe, expect, mock, test } from "bun:test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { getKeyFingerprint } from "../helpers/getKeyFingerprint"
import {
	discoverOnePasswordKeyCandidates,
	loadCachedOnePasswordPrivateKey,
	OnePasswordProviderError,
	type RunOpCommand,
	runOpCommand,
} from "../helpers/onePasswordKeyProvider"
import { parseOpenSSHPublicKey } from "../helpers/parseOpenSSHPublicKey"

const ACCOUNT_A = "A".repeat(26)
const ACCOUNT_B = "B".repeat(26)
const VAULT_A = "V".repeat(26)
const VAULT_B = "W".repeat(26)
const ITEM_A = "I".repeat(26)
const ITEM_B = "J".repeat(26)

function generateKey(type: "ed25519" | "rsa" = "ed25519") {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dotenc-op-test-"))
	const keyPath = path.join(directory, "key")
	const args = ["-t", type, "-f", keyPath, "-N", "", "-q"]
	if (type === "rsa") args.push("-b", "2048")
	execFileSync("ssh-keygen", args)
	return {
		directory,
		privateKey: fs.readFileSync(keyPath),
		publicKey: fs.readFileSync(`${keyPath}.pub`, "utf8").trim(),
	}
}

function json(value: unknown): Buffer {
	return Buffer.from(JSON.stringify(value))
}

function item(id: string, vaultId: string) {
	return { id, title: "GitHub", vault: { id: vaultId, name: "Private" } }
}

function accountId(args: string[]): string | undefined {
	const index = args.indexOf("--account")
	return index >= 0 ? args[index + 1] : undefined
}

describe("discoverOnePasswordKeyCandidates", () => {
	test("groups duplicate titles and retrieves a selected private key by stable IDs", async () => {
		const keyA = generateKey()
		const keyB = generateKey("rsa")
		const calls: string[][] = []
		const rememberLocator = mock(async () => true)
		const runOpCommand: RunOpCommand = mock(async (args) => {
			calls.push(args)
			if (args[0] === "--version") return Buffer.from("2.35.0\n")
			if (args[0] === "account") {
				return json([
					{ account_uuid: ACCOUNT_B, url: "company.1password.com" },
					{ account_uuid: ACCOUNT_A, url: "personal.1password.com" },
				])
			}
			if (args[0] === "item" && args[1] === "list") {
				return json([
					accountId(args) === ACCOUNT_A
						? item(ITEM_A, VAULT_A)
						: item(ITEM_B, VAULT_B),
				])
			}
			if (args[0] === "item" && args[1] === "get") {
				return json({
					fields: [
						{
							type: "SSHKEY",
							details: {
								publicKey:
									accountId(args) === ACCOUNT_A
										? keyA.publicKey
										: keyB.publicKey,
							},
						},
					],
				})
			}
			if (args[0] === "read") {
				return Buffer.from(
					accountId(args) === ACCOUNT_A ? keyA.privateKey : keyB.privateKey,
				)
			}
			throw new Error(`unexpected command: ${args[0]}`)
		})

		try {
			const result = await discoverOnePasswordKeyCandidates({
				runOpCommand,
				rememberLocator,
			})
			expect(result.status).toBe("available")
			expect(result.keys).toHaveLength(2)
			expect(result.keys.map((key) => key.name)).toEqual(["GitHub", "GitHub"])
			expect(result.keys.map((key) => key.algorithm)).toEqual([
				"rsa",
				"ed25519",
			])
			expect(result.keys.map((key) => key.group.id)).toEqual([
				`1password:${ACCOUNT_B}`,
				`1password:${ACCOUNT_A}`,
			])
			expect(result.keys.map((key) => key.selector)).toEqual([
				`1password:${ACCOUNT_B}:${VAULT_B}:${ITEM_B}`,
				`1password:${ACCOUNT_A}:${VAULT_A}:${ITEM_A}`,
			])
			expect(calls.some((args) => args[0] === "read")).toBe(false)

			const selected = result.keys[0]
			const privateKey = await selected.loadPrivateKey()
			expect(privateKey.fingerprint).toBe(selected.fingerprint)
			const readCalls = calls.filter((args) => args[0] === "read")
			expect(readCalls).toEqual([
				[
					"read",
					"--account",
					ACCOUNT_B,
					`op://${VAULT_B}/${ITEM_B}/private_key?ssh-format=openssh`,
				],
			])
			expect(rememberLocator).toHaveBeenCalledWith(selected.fingerprint, {
				accountId: ACCOUNT_B,
				vaultId: VAULT_B,
				itemId: ITEM_B,
			})
			const exported = await selected.exportPrivateKey?.()
			expect(exported?.toString("utf8")).toContain("BEGIN OPENSSH PRIVATE KEY")
			expect(calls.filter((args) => args[0] === "read")).toHaveLength(2)
			exported?.fill(0)
		} finally {
			fs.rmSync(keyA.directory, { recursive: true, force: true })
			fs.rmSync(keyB.directory, { recursive: true, force: true })
		}
	})

	test("keeps authorized accounts when another account is declined", async () => {
		const key = generateKey()
		const runOpCommand: RunOpCommand = async (args) => {
			if (args[0] === "--version") return Buffer.from("2.35.0")
			if (args[0] === "account") {
				return json([
					{ account_uuid: ACCOUNT_A, url: "a.example" },
					{ account_uuid: ACCOUNT_B, url: "b.example" },
				])
			}
			if (args[0] === "item" && args[1] === "list") {
				if (accountId(args) === ACCOUNT_A) {
					throw new OnePasswordProviderError("declined", "command-failed")
				}
				return json([item(ITEM_B, VAULT_B)])
			}
			return json({ publicKey: key.publicKey })
		}

		try {
			const result = await discoverOnePasswordKeyCandidates({ runOpCommand })
			expect(result.keys).toHaveLength(1)
			expect(result.unavailableAccounts).toEqual([
				{
					label: `1Password - a.example [AAAA...AAAA]`,
					reason: "authorization-or-access-failed",
				},
			])
		} finally {
			fs.rmSync(key.directory, { recursive: true, force: true })
		}
	})

	test("is silent when op is not installed", async () => {
		const result = await discoverOnePasswordKeyCandidates({
			runOpCommand: async () => {
				throw new OnePasswordProviderError("not installed", "not-installed")
			},
		})
		expect(result).toEqual({
			status: "not-installed",
			keys: [],
			unsupportedKeys: [],
			unavailableAccounts: [],
		})
	})

	test("reports unsupported op major versions distinctly", async () => {
		const calls: string[][] = []
		const result = await discoverOnePasswordKeyCandidates({
			runOpCommand: async (args) => {
				calls.push(args)
				return Buffer.from("3.0.0")
			},
		})

		expect(result).toEqual({
			status: "unsupported-version",
			keys: [],
			unsupportedKeys: [],
			unavailableAccounts: [],
		})
		expect(calls).toEqual([["--version"]])
	})

	test("bounds concurrent item discovery while preserving item order", async () => {
		const key = generateKey()
		const items = ["C", "D", "E", "F", "G", "H"].map((letter) =>
			item(letter.repeat(26), VAULT_A),
		)
		let activeItemGets = 0
		let maxActiveItemGets = 0
		const runOpCommand: RunOpCommand = async (args) => {
			if (args[0] === "--version") return Buffer.from("2.35.0")
			if (args[0] === "account") {
				return json([{ account_uuid: ACCOUNT_A, extra: "accepted" }])
			}
			if (args[0] === "item" && args[1] === "list") return json(items)

			activeItemGets += 1
			maxActiveItemGets = Math.max(maxActiveItemGets, activeItemGets)
			await new Promise((resolve) => setTimeout(resolve, 5))
			activeItemGets -= 1
			return json({ publicKey: key.publicKey, extra: "accepted" })
		}

		try {
			const result = await discoverOnePasswordKeyCandidates({
				runOpCommand,
				itemConcurrency: 2,
			})
			expect(maxActiveItemGets).toBe(2)
			expect(result.keys.map((candidate) => candidate.selector)).toEqual(
				items.map((entry) => `1password:${ACCOUNT_A}:${VAULT_A}:${entry.id}`),
			)
		} finally {
			fs.rmSync(key.directory, { recursive: true, force: true })
		}
	})

	test("stops scheduling items at the discovery deadline and reports the account", async () => {
		const key = generateKey()
		const items = [ITEM_A, ITEM_B, "K".repeat(26)].map((id) =>
			item(id, VAULT_A),
		)
		let clock = 0
		const itemGetCalls: string[] = []
		const runOpCommand: RunOpCommand = async (args) => {
			if (args[0] === "--version") return Buffer.from("2.35.0")
			if (args[0] === "account") {
				return json([{ account_uuid: ACCOUNT_A, url: "a.example" }])
			}
			if (args[0] === "item" && args[1] === "list") return json(items)

			itemGetCalls.push(args[2])
			clock = itemGetCalls.length === 1 ? 5 : 11
			return json({ publicKey: key.publicKey })
		}

		try {
			const result = await discoverOnePasswordKeyCandidates({
				runOpCommand,
				discoveryTimeoutMs: 10,
				itemConcurrency: 1,
				now: () => clock,
			})
			expect(result.keys).toHaveLength(1)
			expect(itemGetCalls).toEqual([ITEM_A, ITEM_B])
			expect(result.unavailableAccounts).toEqual([
				{
					label: `1Password - a.example [AAAA...AAAA]`,
					reason: "discovery-timeout",
				},
			])
		} finally {
			fs.rmSync(key.directory, { recursive: true, force: true })
		}
	})

	test("rejects a private key whose fingerprint changed after discovery", async () => {
		const publicFixture = generateKey()
		const privateFixture = generateKey()
		const runOpCommand: RunOpCommand = async (args) => {
			if (args[0] === "--version") return Buffer.from("2.35.0")
			if (args[0] === "account") {
				return json([{ account_uuid: ACCOUNT_A, url: "a.example" }])
			}
			if (args[0] === "item" && args[1] === "list") {
				return json([item(ITEM_A, VAULT_A)])
			}
			if (args[0] === "item")
				return json({ publicKey: publicFixture.publicKey })
			return Buffer.from(privateFixture.privateKey)
		}

		try {
			const result = await discoverOnePasswordKeyCandidates({ runOpCommand })
			await expect(result.keys[0].loadPrivateKey()).rejects.toMatchObject({
				code: "fingerprint-mismatch",
			})
		} finally {
			fs.rmSync(publicFixture.directory, { recursive: true, force: true })
			fs.rmSync(privateFixture.directory, { recursive: true, force: true })
		}
	})
})

describe("loadCachedOnePasswordPrivateKey", () => {
	test("loads a fingerprint-matched key with one direct op read", async () => {
		const key = generateKey()
		const fingerprint = getKeyFingerprint(
			parseOpenSSHPublicKey(key.publicKey) as NonNullable<
				ReturnType<typeof parseOpenSSHPublicKey>
			>,
		)
		const calls: string[][] = []
		const removeLocator = mock(async () => {})

		try {
			const result = await loadCachedOnePasswordPrivateKey([fingerprint], {
				runOpCommand: async (args) => {
					calls.push(args)
					return Buffer.from(key.privateKey)
				},
				readLocator: async () => ({
					accountId: ACCOUNT_A,
					vaultId: VAULT_A,
					itemId: ITEM_A,
				}),
				removeLocator,
			})

			expect(result?.fingerprint).toBe(fingerprint)
			expect(calls).toEqual([
				[
					"read",
					"--account",
					ACCOUNT_A,
					`op://${VAULT_A}/${ITEM_A}/private_key?ssh-format=openssh`,
				],
			])
			expect(removeLocator).not.toHaveBeenCalled()
		} finally {
			fs.rmSync(key.directory, { recursive: true, force: true })
		}
	})

	test("evicts a stale locator when the returned fingerprint differs", async () => {
		const expected = generateKey()
		const stale = generateKey()
		const fingerprint = getKeyFingerprint(
			parseOpenSSHPublicKey(expected.publicKey) as NonNullable<
				ReturnType<typeof parseOpenSSHPublicKey>
			>,
		)
		const removeLocator = mock(async () => {})

		try {
			expect(
				await loadCachedOnePasswordPrivateKey([fingerprint], {
					runOpCommand: async () => Buffer.from(stale.privateKey),
					readLocator: async () => ({
						accountId: ACCOUNT_A,
						vaultId: VAULT_A,
						itemId: ITEM_A,
					}),
					removeLocator,
				}),
			).toBeUndefined()
			expect(removeLocator).toHaveBeenCalledWith(fingerprint)
		} finally {
			fs.rmSync(expected.directory, { recursive: true, force: true })
			fs.rmSync(stale.directory, { recursive: true, force: true })
		}
	})
})

describe("runOpCommand", () => {
	test("enforces output limits without exposing provider output", async () => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), "dotenc-op-process-"),
		)
		const opPath = path.join(directory, "op")
		fs.writeFileSync(
			opPath,
			"#!/bin/sh\nprintf 'private-provider-output-that-must-not-escape'\n",
		)
		fs.chmodSync(opPath, 0o755)
		const originalPath = process.env.PATH
		process.env.PATH = `${directory}:${originalPath ?? ""}`

		try {
			let error: unknown
			try {
				await runOpCommand(["test"], { maxOutputBytes: 4 })
			} catch (caught) {
				error = caught
			}
			expect(error).toBeInstanceOf(OnePasswordProviderError)
			expect(error).toMatchObject({ code: "output-limit" })
			expect((error as Error).message).not.toContain("private-provider-output")
		} finally {
			process.env.PATH = originalPath
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})

	test("maps nonzero exits to a safe error without echoing stderr", async () => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), "dotenc-op-process-"),
		)
		const opPath = path.join(directory, "op")
		fs.writeFileSync(
			opPath,
			"#!/bin/sh\nprintf 'private-error-output' >&2\nexit 23\n",
		)
		fs.chmodSync(opPath, 0o755)
		const originalPath = process.env.PATH
		process.env.PATH = `${directory}:${originalPath ?? ""}`

		try {
			await expect(runOpCommand(["test"])).rejects.toMatchObject({
				code: "command-failed",
				message: expect.not.stringContaining("private-error-output"),
			})
		} finally {
			process.env.PATH = originalPath
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})
})
