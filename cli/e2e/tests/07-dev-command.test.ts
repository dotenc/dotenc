import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
	createMockEditor,
	generateEd25519Key,
	runCli,
} from "../helpers/cli"

const TIMEOUT = 30_000

describe("Dev Command", () => {
	let home: string
	let workspace: string

	beforeAll(() => {
		home = mkdtempSync(path.join(os.tmpdir(), "e2e-07-alice-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-07-workspace-"))
		generateEd25519Key(home)
	})

	afterAll(() => {
		rmSync(home, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
	})

	test("Alice inits with personal identity", () => {
		runCli(home, workspace, ["init", "--name", "alice"])
	}, TIMEOUT)

	test("Create development environment with shared secrets", () => {
		runCli(home, workspace, ["env", "create", "development", "alice"])
		const editor = createMockEditor("SHARED_SECRET=shared123")
		runCli(home, workspace, ["env", "edit", "development"], { EDITOR: editor })
	}, TIMEOUT)

	test("Edit Alice's personal env with personal secrets", () => {
		const editor = createMockEditor("PERSONAL_SECRET=personal456")
		runCli(home, workspace, ["env", "edit", "personal.alice"], {
			EDITOR: editor,
		})
	}, TIMEOUT)

	test("dev command merges development and personal environments", () => {
		const result = runCli(home, workspace, ["dev", "--", "sh", "-c", "echo $SHARED_SECRET $PERSONAL_SECRET"])
		expect(result.stdout).toContain("shared123")
		expect(result.stdout).toContain("personal456")
	}, TIMEOUT)

	test("run blocks runtime-loader injection before spawn unless explicitly allowed", () => {
		const markerPath = path.join(workspace, "runtime-loader-executed")
		const preloadPath = path.join(workspace, "runtime-loader.sh")
		writeFileSync(
			preloadPath,
			`printf '%s' executed > ${JSON.stringify(markerPath)}\n`,
		)

		const created = runCli(home, workspace, [
			"env",
			"create",
			"runtime-policy",
			"alice",
		])
		expect(created.exitCode).toBe(0)
		const editor = createMockEditor(`BASH_ENV=${preloadPath}`)
		const edited = runCli(
			home,
			workspace,
			["env", "edit", "runtime-policy"],
			{ EDITOR: editor },
		)
		expect(edited.exitCode).toBe(0)

		const blocked = runCli(home, workspace, [
			"run",
			"-e",
			"runtime-policy",
			"--",
			"bash",
			"-c",
			"printf '%s' child-started",
		])
		expect(blocked.exitCode).toBe(1)
		expect(blocked.stderr).toContain("BASH_ENV")
		expect(blocked.stdout).not.toContain("child-started")
		expect(existsSync(markerPath)).toBe(false)

		const allowed = runCli(home, workspace, [
			"run",
			"-e",
			"runtime-policy",
			"--allow-process-env",
			"BASH_ENV",
			"--",
			"bash",
			"-c",
			"printf '%s' child-started",
		])
		expect(allowed.exitCode).toBe(0)
		expect(allowed.stdout).toContain("child-started")
		expect(existsSync(markerPath)).toBe(true)
	}, TIMEOUT)

	test("dev command requires --profile in non-interactive mode when multiple profiles match", () => {
		// Add the same SSH key under a second name
		runCli(home, workspace, [
			"key",
			"add",
			"alice-deploy",
			"--from-ssh",
			path.join(home, ".ssh", "id_ed25519"),
		])
		// Create personal environment for alice-deploy
		runCli(home, workspace, [
			"env",
			"create",
			"personal.alice-deploy",
			"alice-deploy",
		])

		const missingProfile = runCli(home, workspace, [
			"dev",
			"--",
			"sh",
			"-c",
			"echo $SHARED_SECRET",
		])
		expect(missingProfile.exitCode).toBe(1)
		expect(missingProfile.stderr).toContain("--profile")

		const result = runCli(home, workspace, [
			"dev",
			"--profile",
			"alice",
			"--",
			"sh",
			"-c",
			"echo $SHARED_SECRET",
		])
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("shared123")
	}, TIMEOUT)
})
