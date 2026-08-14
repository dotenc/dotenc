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
			path.join(fixtures, "public-a.txt"),
			readFileSync(`${keyAPath}.pub`),
		)
		writeFileSync(
			path.join(fixtures, "public-b.txt"),
			readFileSync(`${keyBPath}.pub`),
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
	if [ "\${DOTENC_OP_EMPTY_ITEMS:-}" = "1" ]; then printf '[]'; exit 0; fi
	case "$*" in *"${ACCOUNT_A}"*) cat "$DOTENC_OP_FIXTURES/list-a.json";; *) cat "$DOTENC_OP_FIXTURES/list-b.json";; esac
	exit 0
fi
if [ "$1" = "read" ]; then
  case "$*" in
    *"${ITEM_A}/public_key"*) cat "$DOTENC_OP_FIXTURES/public-a.txt";;
    *"${ITEM_B}/public_key"*) cat "$DOTENC_OP_FIXTURES/public-b.txt";;
    *"${ITEM_A}/private_key"*) cat "$DOTENC_OP_KEY_A";;
    *"${ITEM_B}/private_key"*) cat "$DOTENC_OP_KEY_B";;
    *) exit 1;;
  esac
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

		const granted = runCli(
			home,
			workspace,
			["auth", "grant", "development", "bob"],
			env,
		)
		expect(granted.exitCode).toBe(0)
	})

	afterAll(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("init and key add use ID-qualified public candidates without exporting private keys", () => {
		expect(existsSync(path.join(workspace, ".dotenc", "alice.pub"))).toBe(
			true,
		)
		expect(existsSync(path.join(workspace, ".dotenc", "bob.pub"))).toBe(true)
		expect(setupLog).toContain(
			`read --account ${ACCOUNT_A} op://${VAULT_A}/${ITEM_A}/public_key`,
		)
		expect(setupLog).not.toContain("/private_key")
		expect(setupLog).not.toContain("item get")
	}, TIMEOUT)

	test("non-interactive init with one local key does not invoke 1Password", () => {
		const localHome = mkdtempSync(path.join(os.tmpdir(), "e2e-29-local-home-"))
		const localWorkspace = mkdtempSync(
			path.join(os.tmpdir(), "e2e-29-local-workspace-"),
		)

		try {
			generateEd25519Key(localHome)
			writeFileSync(path.join(localWorkspace, ".env"), "LOCAL_MATCH=local\n")
			writeFileSync(logPath, "")
			const initialized = runCli(
				localHome,
				localWorkspace,
				["init", "--name", "local"],
				env,
			)
			const result = runCli(
				localHome,
				localWorkspace,
				["run", "-e", "development", "--", "sh", "-c", "printf '%s' \"$LOCAL_MATCH\""],
				env,
			)

			expect(initialized.exitCode).toBe(0)
			expect(result.exitCode).toBe(0)
			expect(result.stdout).toContain("local")
			expect(readFileSync(logPath, "utf8")).toBe("")
		} finally {
			rmSync(localHome, { recursive: true, force: true })
			rmSync(localWorkspace, { recursive: true, force: true })
		}
	}, TIMEOUT)

	test("textconv uses a warm locator without running discovery", () => {
		writeFileSync(logPath, "")
		const encryptedPath = path.join(workspace, ".env.development.enc")
		const result = runCli(
			home,
			workspace,
			["textconv", encryptedPath],
			env,
		)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("ONEPASSWORD_E2E=provider-value")
		expect(readFileSync(logPath, "utf8").trim().split("\n")).toEqual([
			`read --account ${ACCOUNT_A} op://${VAULT_A}/${ITEM_A}/private_key?ssh-format=openssh`,
		])
	}, TIMEOUT)

	test("textconv with a cold cache returns encrypted content without discovery", () => {
		const coldHome = mkdtempSync(path.join(os.tmpdir(), "e2e-29-cold-home-"))
		writeFileSync(logPath, "")
		const encryptedPath = path.join(workspace, ".env.development.enc")

		try {
			const result = runCli(
				coldHome,
				workspace,
				["textconv", encryptedPath],
				env,
			)

			expect(result.exitCode).toBe(0)
			expect(result.stdout).toBe(readFileSync(encryptedPath, "utf8"))
			expect(readFileSync(logPath, "utf8")).toBe("")
		} finally {
			rmSync(coldHome, { recursive: true, force: true })
		}
	}, TIMEOUT)

	test("available accounts without supported keys preserve no-key guidance", () => {
		const coldHome = mkdtempSync(path.join(os.tmpdir(), "e2e-29-empty-home-"))
		writeFileSync(logPath, "")
		try {
			const result = runCli(
				coldHome,
				workspace,
				["run", "-e", "development", "--", "true"],
				{ ...env, DOTENC_OP_EMPTY_ITEMS: "1" },
			)

			expect(result.exitCode).toBe(1)
			expect(result.stderr).toContain("No private keys found")
			expect(result.stderr).not.toContain("Access denied to the environment")
			expect(readFileSync(logPath, "utf8")).not.toContain("read --account")
		} finally {
			rmSync(coldHome, { recursive: true, force: true })
		}
	}, TIMEOUT)

	test("run uses one cached read and does not forward the private key", () => {
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
			`read --account ${ACCOUNT_A} op://${VAULT_A}/${ITEM_A}/private_key?ssh-format=openssh`,
		])
		expect(readFileSync(logPath, "utf8")).not.toContain("item list")
		expect(readFileSync(logPath, "utf8")).not.toContain("item get")
	}, TIMEOUT)

	test("whoami resolves a 1Password-only identity from public metadata", () => {
		writeFileSync(logPath, "")
		const result = runCli(home, workspace, ["whoami"], env)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("Name: alice")
		expect(result.stdout).toContain("1Password - personal.example")
		expect(result.stdout).toContain("GitHub")
		expect(readFileSync(logPath, "utf8")).not.toContain("/private_key")
	}, TIMEOUT)

	test("dev reuses one cached private key across different recipient sets", () => {
		writeFileSync(logPath, "")
		const result = runCli(
			home,
			workspace,
			[
				"dev",
				"--profile",
				"alice",
				"sh",
				"-c",
				"printf '%s' \"$ONEPASSWORD_E2E\"",
			],
			env,
		)
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("provider-value")
		const commands = readFileSync(logPath, "utf8").split("\n")
		expect(commands.filter((line) => line === "--version")).toHaveLength(0)
		expect(commands.filter((line) => line.includes("/private_key"))).toEqual([
			`read --account ${ACCOUNT_A} op://${VAULT_A}/${ITEM_A}/private_key?ssh-format=openssh`,
		])
	}, TIMEOUT)
})
