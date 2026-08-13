import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { generateEd25519Key, generatePassphraseEd25519Key, runCli } from "../helpers/cli"

const TIMEOUT = 30_000

describe("Passphrase-protected key errors", () => {
	let passphraseHome: string
	let aliceHome: string
	let workspace: string

	beforeAll(() => {
		passphraseHome = mkdtempSync(path.join(os.tmpdir(), "e2e-12-passphrase-"))
		aliceHome = mkdtempSync(path.join(os.tmpdir(), "e2e-12-alice-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-12-workspace-"))

		generatePassphraseEd25519Key(passphraseHome)
		generateEd25519Key(aliceHome)

		// Set up a project with alice so we can test whoami and key add
		runCli(aliceHome, workspace, ["init", "--name", "alice"])
	})

	afterAll(() => {
		rmSync(passphraseHome, { recursive: true, force: true })
		rmSync(aliceHome, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
	})

	test("init shows passphrase error when only passphrase keys exist", () => {
		const emptyWorkspace = mkdtempSync(path.join(os.tmpdir(), "e2e-12-init-"))
		try {
			const result = runCli(passphraseHome, emptyWorkspace, ["init", "--name", "test"])
			expect(result.stderr).toContain("passphrase-protected")
			expect(result.stderr).toContain("DOTENC_PRIVATE_KEY_PASSPHRASE")
			expect(result.stderr).toContain("id_ed25519")
		} finally {
			rmSync(emptyWorkspace, { recursive: true, force: true })
		}
	}, TIMEOUT)

	test("init succeeds non-interactively when DOTENC_PRIVATE_KEY_PASSPHRASE is set", () => {
		const workspaceWithPassphrase = mkdtempSync(
			path.join(os.tmpdir(), "e2e-12-init-passphrase-"),
		)
		try {
			const result = runCli(
				passphraseHome,
				workspaceWithPassphrase,
				["init", "--name", "test"],
				{ DOTENC_PRIVATE_KEY_PASSPHRASE: "secret" },
			)
			expect(result.exitCode).toBe(0)
			expect(result.stdout).toContain("Initialization complete")

			const whoamiResult = runCli(
				passphraseHome,
				workspaceWithPassphrase,
				["whoami"],
				{ DOTENC_PRIVATE_KEY_PASSPHRASE: "secret" },
			)
			expect(whoamiResult.exitCode).toBe(0)
			expect(whoamiResult.stdout).toContain("Name: test")
			expect(whoamiResult.stdout).toContain("Active SSH key: id_ed25519")
		} finally {
			rmSync(workspaceWithPassphrase, { recursive: true, force: true })
		}
	}, TIMEOUT)

	test("key add --from-ssh shows passphrase error for protected key", () => {
		const keyPath = path.join(passphraseHome, ".ssh", "id_ed25519")
		const result = runCli(aliceHome, workspace, ["key", "add", "test", "--from-ssh", keyPath])
		expect(result.stderr).toContain("passphrase-protected")
		expect(result.stderr).toContain("DOTENC_PRIVATE_KEY_PASSPHRASE")
	}, TIMEOUT)

	test("key add --from-file shows passphrase error for protected key", () => {
		const keyPath = path.join(passphraseHome, ".ssh", "id_ed25519")
		const result = runCli(aliceHome, workspace, ["key", "add", "test", "--from-file", keyPath])
		expect(result.stderr).toContain("passphrase-protected")
		expect(result.stderr).toContain("DOTENC_PRIVATE_KEY_PASSPHRASE")
	}, TIMEOUT)

	test("key add --from-ssh supports passphrase-protected key when DOTENC_PRIVATE_KEY_PASSPHRASE is set", () => {
		const keyPath = path.join(passphraseHome, ".ssh", "id_ed25519")
		const result = runCli(
			aliceHome,
			workspace,
			["key", "add", "test-passphrase", "--from-ssh", keyPath],
			{ DOTENC_PRIVATE_KEY_PASSPHRASE: "secret" },
		)
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("added successfully")
	}, TIMEOUT)

	test("DOTENC_PRIVATE_KEY shows passphrase error for protected key", () => {
		const privateKey = readFileSync(path.join(passphraseHome, ".ssh", "id_ed25519"), "utf-8")
		const result = runCli(aliceHome, workspace, ["run", "-e", "development", "--", "echo", "test"], {
			DOTENC_PRIVATE_KEY: privateKey,
		})
		expect(result.stderr).toContain("passphrase-protected")
		expect(result.stderr).toContain("DOTENC_PRIVATE_KEY_PASSPHRASE")
	}, TIMEOUT)

	test("DOTENC_PRIVATE_KEY supports passphrase-protected key when DOTENC_PRIVATE_KEY_PASSPHRASE is set", () => {
		const workspaceWithPassphrase = mkdtempSync(
			path.join(os.tmpdir(), "e2e-12-dotenc-key-passphrase-"),
		)
		try {
			const initResult = runCli(
				passphraseHome,
				workspaceWithPassphrase,
				["init", "--name", "passphrase-user"],
				{ DOTENC_PRIVATE_KEY_PASSPHRASE: "secret" },
			)
			expect(initResult.exitCode).toBe(0)

			const privateKey = readFileSync(
				path.join(passphraseHome, ".ssh", "id_ed25519"),
				"utf-8",
			)
			const whoamiResult = runCli(
				passphraseHome,
				workspaceWithPassphrase,
				["whoami"],
				{
					DOTENC_PRIVATE_KEY: privateKey,
					DOTENC_PRIVATE_KEY_PASSPHRASE: "secret",
				},
			)
			expect(whoamiResult.exitCode).toBe(0)
			expect(whoamiResult.stdout).toContain("Name: passphrase-user")
		} finally {
			rmSync(workspaceWithPassphrase, { recursive: true, force: true })
		}
	}, TIMEOUT)

	test("whoami shows passphrase error when only passphrase keys exist", () => {
		const result = runCli(passphraseHome, workspace, ["whoami"])
		expect(result.stderr).toContain("passphrase-protected")
		expect(result.stderr).toContain("DOTENC_PRIVATE_KEY_PASSPHRASE")
		expect(result.stderr).toContain("id_ed25519")
	}, TIMEOUT)

	test("run shows passphrase error when only passphrase keys exist", () => {
		const result = runCli(passphraseHome, workspace, ["run", "-e", "development", "--", "echo", "test"])
		expect(result.stderr).toContain("passphrase-protected")
		expect(result.stderr).toContain("DOTENC_PRIVATE_KEY_PASSPHRASE")
	}, TIMEOUT)

	test("run works with passphrase-protected key when DOTENC_PRIVATE_KEY_PASSPHRASE is set", () => {
		const workspaceWithPassphrase = mkdtempSync(
			path.join(os.tmpdir(), "e2e-12-run-passphrase-"),
		)
		try {
			const initResult = runCli(
				passphraseHome,
				workspaceWithPassphrase,
				["init", "--name", "passphrase-user"],
				{ DOTENC_PRIVATE_KEY_PASSPHRASE: "secret" },
			)
			expect(initResult.exitCode).toBe(0)

			const runResult = runCli(
				passphraseHome,
				workspaceWithPassphrase,
				["run", "-e", "development", "--", "echo", "test"],
				{ DOTENC_PRIVATE_KEY_PASSPHRASE: "secret" },
			)
			expect(runResult.exitCode).toBe(0)
			expect(runResult.stdout).toContain("test")
		} finally {
			rmSync(workspaceWithPassphrase, { recursive: true, force: true })
		}
	}, TIMEOUT)
})
