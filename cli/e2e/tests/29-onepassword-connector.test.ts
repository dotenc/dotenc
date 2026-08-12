import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { generateEd25519Key, runCli } from "../helpers/cli"

const TIMEOUT = 30_000
const ACCOUNT_A = "A".repeat(26)
const ACCOUNT_B = "B".repeat(26)
const VAULT_A = "V".repeat(26)
const VAULT_B = "W".repeat(26)
const ITEM_A = "I".repeat(26)
const ITEM_B = "J".repeat(26)
const SELECTOR_A = `1password:${ACCOUNT_A}:${VAULT_A}:${ITEM_A}`
const SELECTOR_B = `1password:${ACCOUNT_B}:${VAULT_B}:${ITEM_B}`

describe("1Password connector", () => {
	let root: string
	let home: string
	let workspace: string
	let providerStore: string
	let fakeBin: string
	let logPath: string
	let setupLog: string
	let env: Record<string, string>

	beforeAll(() => {
		root = mkdtempSync(path.join(os.tmpdir(), "e2e-29-onepassword-"))
		home = path.join(root, "home")
		workspace = path.join(root, "workspace")
		providerStore = path.join(root, "provider")
		fakeBin = path.join(root, "bin")
		mkdirSync(home)
		mkdirSync(workspace)
		mkdirSync(providerStore)
		mkdirSync(fakeBin)
		generateEd25519Key(providerStore, { fileName: "key-a" })
		generateEd25519Key(providerStore, { fileName: "key-b" })

		const fixtures = path.join(root, "fixtures")
		mkdirSync(fixtures)
		const keyAPath = path.join(providerStore, ".ssh", "key-a")
		const keyBPath = path.join(providerStore, ".ssh", "key-b")
		writeFileSync(
			path.join(fixtures, "accounts.json"),
			JSON.stringify([
				{ account_uuid: ACCOUNT_A, url: "personal.example" },
				{ account_uuid: ACCOUNT_B, url: "company.example" },
			]),
		)
		writeFileSync(
			path.join(fixtures, "list-a.json"),
			JSON.stringify([
				{
					id: ITEM_A,
					title: "GitHub",
					vault: { id: VAULT_A, name: "Private" },
				},
			]),
		)
		writeFileSync(
			path.join(fixtures, "list-b.json"),
			JSON.stringify([
				{
					id: ITEM_B,
					title: "GitHub",
					vault: { id: VAULT_B, name: "Private" },
				},
			]),
		)
		writeFileSync(
			path.join(fixtures, "item-a.json"),
			JSON.stringify({
				fields: [
					{
						type: "SSHKEY",
						details: {
							publicKey: readFileSync(`${keyAPath}.pub`, "utf8").trim(),
						},
					},
				],
			}),
		)
		writeFileSync(
			path.join(fixtures, "item-b.json"),
			JSON.stringify({
				fields: [
					{
						type: "SSHKEY",
						details: {
							publicKey: readFileSync(`${keyBPath}.pub`, "utf8").trim(),
						},
					},
				],
			}),
		)

		logPath = path.join(root, "op.log")
		writeFileSync(logPath, "")
		const opPath = path.join(fakeBin, "op")
		writeFileSync(
			opPath,
			`#!/bin/sh
printf '%s\\n' "$*" >> "$DOTENC_OP_LOG"
if [ "$1" = "--version" ]; then printf '2.35.0\\n'; exit 0; fi
if [ "$1" = "account" ]; then cat "$DOTENC_OP_FIXTURES/accounts.json"; exit 0; fi
if [ "$1" = "item" ] && [ "$2" = "list" ]; then
  case "$*" in *"${ACCOUNT_A}"*) cat "$DOTENC_OP_FIXTURES/list-a.json";; *) cat "$DOTENC_OP_FIXTURES/list-b.json";; esac
  exit 0
fi
if [ "$1" = "item" ] && [ "$2" = "get" ]; then
  case "$3" in "${ITEM_A}") cat "$DOTENC_OP_FIXTURES/item-a.json";; *) cat "$DOTENC_OP_FIXTURES/item-b.json";; esac
  exit 0
fi
if [ "$1" = "read" ]; then
  case "$*" in *"${ITEM_A}"*) cat "$DOTENC_OP_KEY_A";; *) cat "$DOTENC_OP_KEY_B";; esac
  exit 0
fi
exit 1
`,
		)
		chmodSync(opPath, 0o755)

		env = {
			PATH: `${fakeBin}:${process.env.PATH}`,
			DOTENC_OP_LOG: logPath,
			DOTENC_OP_FIXTURES: fixtures,
			DOTENC_OP_KEY_A: keyAPath,
			DOTENC_OP_KEY_B: keyBPath,
		}

		writeFileSync(
			path.join(workspace, ".env"),
			"ONEPASSWORD_E2E=provider-value\n",
		)
		const initialized = runCli(
			home,
			workspace,
			["init", "--name", "alice", "--private-key", SELECTOR_A],
			env,
		)
		expect(initialized.exitCode).toBe(0)

		const added = runCli(
			home,
			workspace,
			["key", "add", "bob", "--from-private-key", SELECTOR_B],
			env,
		)
		expect(added.exitCode).toBe(0)
		setupLog = readFileSync(logPath, "utf8")
	})

	afterAll(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("init and key add use ID-qualified public candidates without exporting private keys", () => {
		expect(existsSync(path.join(workspace, ".dotenc", "alice.pub"))).toBe(
			true,
		)
		expect(existsSync(path.join(workspace, ".dotenc", "bob.pub"))).toBe(true)
		expect(setupLog).not.toContain("read --account")
	}, TIMEOUT)

	test("run lazily retrieves one matching private key and does not forward it", () => {
		writeFileSync(logPath, "")
		const result = runCli(
			home,
			workspace,
			[
				"run",
				"-e",
				"development",
				"--",
				"sh",
				"-c",
				"printf '%s:%s' \"$ONEPASSWORD_E2E\" \"${DOTENC_PRIVATE_KEY:-not-forwarded}\"",
			],
			env,
		)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("provider-value:not-forwarded")
		const reads = readFileSync(logPath, "utf8")
			.split("\n")
			.filter((line) => line.startsWith("read --account"))
		expect(reads).toEqual([
			`read --account ${ACCOUNT_A} op://${VAULT_A}/${ITEM_A}/private key?ssh-format=openssh`,
		])
	}, TIMEOUT)

	test("dev resolves the project identity from 1Password public metadata", () => {
		writeFileSync(logPath, "")
		const result = runCli(
			home,
			workspace,
			[
				"dev",
				"--identity",
				"alice",
				"sh",
				"-c",
				"printf '%s' \"$ONEPASSWORD_E2E\"",
			],
			env,
		)
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("provider-value")
	}, TIMEOUT)
})
