import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
	createMockEditor,
	generateEd25519Key,
	generateRsaKey,
	runCli,
} from "../helpers/cli"

const TIMEOUT = 30_000

describe("Mixed keyring init/dev/run flow", () => {
	let home: string
	let workspace: string

	beforeAll(() => {
		home = mkdtempSync(path.join(os.tmpdir(), "e2e-19-home-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-19-workspace-"))

		// Valid keys
		generateEd25519Key(home, { fileName: "id_ed25519" })
		generateRsaKey(home, { fileName: "id_rsa", bits: 2048 })

		// Invalid/unsupported keys
		generateEd25519Key(home, {
			fileName: "id_ed25519_locked",
			passphrase: "secret",
		})
		generateRsaKey(home, { fileName: "id_rsa_weak", bits: 1024 })
	})

	afterAll(() => {
		rmSync(home, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
	})

	test("init succeeds and creates development + personal envs with supported identity", () => {
		const initResult = runCli(home, workspace, [
			"init",
			"--name",
			"alice",
			"--private-key",
			"id_ed25519",
		])
		expect(initResult.exitCode).toBe(0)
		expect(initResult.stdout).toContain("Initialization complete")

		const devEnv = JSON.parse(
			readFileSync(path.join(workspace, ".env.development.enc"), "utf-8"),
		)
		const personalEnv = JSON.parse(
			readFileSync(path.join(workspace, ".env.alice.enc"), "utf-8"),
		)

		expect(devEnv.keys).toHaveLength(1)
		expect(personalEnv.keys).toHaveLength(1)
		expect(devEnv.keys[0].name).toBe("alice")
		expect(personalEnv.keys[0].name).toBe("alice")
		expect(["ed25519", "rsa"]).toContain(devEnv.keys[0].algorithm)
		expect(["ed25519", "rsa"]).toContain(personalEnv.keys[0].algorithm)
	}, TIMEOUT)

	test("dev and run keep working when invalid keys are present in ~/.ssh", () => {
		const devEditor = createMockEditor("SHARED_SECRET=shared-19")
		const personalEditor = createMockEditor("PERSONAL_SECRET=personal-19")

		runCli(home, workspace, ["env", "edit", "development"], { EDITOR: devEditor })
		runCli(home, workspace, ["env", "edit", "alice"], { EDITOR: personalEditor })
		runCli(home, workspace, ["env", "create", "staging", "alice"])

		const stagingEditor = createMockEditor("STAGING_SECRET=staging-19")
		runCli(home, workspace, ["env", "edit", "staging"], { EDITOR: stagingEditor })

		const devResult = runCli(home, workspace, [
			"dev",
			"--",
			"sh",
			"-c",
			"echo $SHARED_SECRET $PERSONAL_SECRET",
		])
		expect(devResult.exitCode).toBe(0)
		expect(devResult.stdout).toContain("shared-19")
		expect(devResult.stdout).toContain("personal-19")

		const runResult = runCli(home, workspace, [
			"run",
			"-e",
			"staging",
			"--",
			"sh",
			"-c",
			"echo $STAGING_SECRET",
		])
		expect(runResult.exitCode).toBe(0)
		expect(runResult.stdout).toContain("staging-19")
	}, TIMEOUT)
})

describe("Mixed keyring prefers a valid key over weak RSA during init", () => {
	let home: string
	let workspace: string

	beforeAll(() => {
		home = mkdtempSync(path.join(os.tmpdir(), "e2e-19-weak-home-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-19-weak-ws-"))

		// Weak key appears in a well-known slot and used to break init in non-interactive mode.
		generateRsaKey(home, { fileName: "id_rsa", bits: 1024 })
		generateEd25519Key(home, { fileName: "id_ed25519_alt" })
		generateEd25519Key(home, {
			fileName: "id_ed25519_locked",
			passphrase: "secret",
		})
	})

	afterAll(() => {
		rmSync(home, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
	})

	test("init succeeds by selecting a supported key", () => {
		const result = runCli(home, workspace, ["init", "--name", "alice"])
		expect(result.exitCode).toBe(0)
		expect(result.stderr).not.toContain("minimum is 2048")

		const personalEnv = JSON.parse(
			readFileSync(path.join(workspace, ".env.alice.enc"), "utf-8"),
		)
		expect(personalEnv.keys).toHaveLength(1)
		expect(personalEnv.keys[0].algorithm).toBe("ed25519")
	}, TIMEOUT)
})
