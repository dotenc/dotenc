import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createMockEditor, generateEd25519Key, runCli } from "../helpers/cli"

const TIMEOUT = 30_000

/**
 * Regression test: dotenc run/dev from a subfolder that has no env files
 * of its own — only the project root has them. Previously, dev would fail
 * with "could not resolve your identity" because getPublicKeys() defaulted
 * to process.cwd()/.dotenc (missing in the subfolder).
 */
describe("run/dev from subfolder with envs only at root", () => {
	let aliceHome: string
	let workspace: string
	let subdir: string

	beforeAll(() => {
		aliceHome = mkdtempSync(path.join(os.tmpdir(), "e2e-28-alice-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-28-workspace-"))
		subdir = path.join(workspace, "packages", "api")
		mkdirSync(subdir, { recursive: true })
		generateEd25519Key(aliceHome)
	})

	afterAll(() => {
		rmSync(aliceHome, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
	})

	test("setup: init workspace and create envs only at root", () => {
		runCli(aliceHome, workspace, ["init", "--name", "alice"])

		runCli(aliceHome, workspace, ["env", "create", "staging", "alice"])
		const stagingEditor = createMockEditor("STAGING_VAR=from-root")
		const stagingResult = runCli(
			aliceHome,
			workspace,
			["env", "edit", "staging"],
			{ EDITOR: stagingEditor },
		)
		expect(stagingResult.exitCode).toBe(0)

		runCli(aliceHome, workspace, ["env", "create", "development", "alice"])
		const devEditor = createMockEditor("SHARED_SECRET=shared123")
		const devResult = runCli(
			aliceHome,
			workspace,
			["env", "edit", "development"],
			{ EDITOR: devEditor },
		)
		expect(devResult.exitCode).toBe(0)

		const personalEditor = createMockEditor("PERSONAL_SECRET=personal456")
		const personalResult = runCli(
			aliceHome,
			workspace,
			["env", "edit", "personal.alice"],
			{ EDITOR: personalEditor },
		)
		expect(personalResult.exitCode).toBe(0)
	}, TIMEOUT)

	test("run from subfolder (no local env files) loads root env", () => {
		const result = runCli(aliceHome, subdir, [
			"run",
			"-e",
			"staging",
			"printenv",
			"STAGING_VAR",
		])
		expect(result.exitCode).toBe(0)
		expect(result.stdout.trim()).toBe("from-root")
	}, TIMEOUT)

	test("dev from subfolder (no local env files) resolves identity and loads root envs", () => {
		const result = runCli(aliceHome, subdir, [
			"dev",
			"--",
			"sh",
			"-c",
			"echo $SHARED_SECRET $PERSONAL_SECRET",
		])
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("shared123")
		expect(result.stdout).toContain("personal456")
	}, TIMEOUT)
})
