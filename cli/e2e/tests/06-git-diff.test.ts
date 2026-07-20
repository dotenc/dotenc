import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { generateEd25519Key, runCli, createMockEditor } from "../helpers/cli"

const CLI_PATH = "/app/cli/src/cli.ts"
const TIMEOUT = 30_000

function git(workspace: string, args: string[], env?: Record<string, string>): { stdout: string; stderr: string; exitCode: number } {
	const result = Bun.spawnSync(["git", ...args], {
		cwd: workspace,
		env: { ...process.env, ...env },
	})
	return {
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
		exitCode: result.exitCode,
	}
}

describe("Git Diff Textconv", () => {
	let home: string
	let workspace: string

	beforeAll(() => {
		home = mkdtempSync(path.join(os.tmpdir(), "e2e-06-alice-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-06-workspace-"))
		generateEd25519Key(home)

		// Init git repo
		git(workspace, ["init", "--quiet"])
		git(workspace, ["config", "user.email", "test@dotenc.dev"])
		git(workspace, ["config", "user.name", "Test"])
	})

	afterAll(() => {
		rmSync(home, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
	})

	test("init creates .gitattributes with dotenc diff driver", () => {
		runCli(home, workspace, ["init", "--name", "alice"])
		const gitattributes = path.join(workspace, ".gitattributes")
		expect(existsSync(gitattributes)).toBe(true)

		const content = readFileSync(gitattributes, "utf-8")
		expect(content).toContain("*.enc diff=dotenc")
	}, TIMEOUT)

	test("init configures an existing clone without changing project data", () => {
		const developmentPath = path.join(workspace, ".env.development.enc")
		const personalPath = path.join(workspace, ".env.alice.enc")
		const plaintextPath = path.join(workspace, ".env")
		const developmentBefore = readFileSync(developmentPath, "utf-8")
		const personalBefore = readFileSync(personalPath, "utf-8")
		const plaintextContent = "LOCAL_ONLY=preserve-me\n"
		writeFileSync(plaintextPath, plaintextContent, "utf-8")

		git(workspace, ["config", "--unset-all", "diff.dotenc.textconv"])
		const statusBefore = git(workspace, ["status", "--short"]).stdout

		const result = runCli(home, workspace, ["init"])

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("Existing dotenc project detected")
		expect(result.stdout).toContain("Git diff driver configured for this clone")
		expect(result.stdout).toContain("No keys or environments were changed")
		expect(readFileSync(developmentPath, "utf-8")).toBe(developmentBefore)
		expect(readFileSync(personalPath, "utf-8")).toBe(personalBefore)
		expect(readFileSync(plaintextPath, "utf-8")).toBe(plaintextContent)
		expect(git(workspace, ["status", "--short"]).stdout).toBe(statusBefore)
		expect(
			git(workspace, ["config", "--get", "diff.dotenc.textconv"]).stdout.trim(),
		).toBe("dotenc textconv")
	}, TIMEOUT)

	test("create and edit environment", () => {
		runCli(home, workspace, ["env", "create", "staging", "alice"])

		const editor = createMockEditor("MY_SECRET=hunter2")
		runCli(home, workspace, ["env", "edit", "staging"], { EDITOR: editor })
	}, TIMEOUT)

	test("commit encrypted file", () => {
		git(workspace, ["add", ".env.staging.enc", ".gitattributes", ".dotenc/"])
		const result = git(workspace, ["commit", "-m", "initial", "--quiet"])
		expect(result.exitCode).toBe(0)
	}, TIMEOUT)

	test("edit with new content", () => {
		const editor = createMockEditor("MY_SECRET=changed")
		runCli(home, workspace, ["env", "edit", "staging"], { EDITOR: editor })
	}, TIMEOUT)

	test("textconv outputs decrypted content", () => {
		const result = runCli(home, workspace, ["textconv", ".env.staging.enc"])
		expect(result.stdout).toContain("MY_SECRET=changed")
	}, TIMEOUT)

	test("git diff shows plaintext changes via textconv", () => {
		git(workspace, ["config", "diff.dotenc.textconv", `HOME=${home} bun ${CLI_PATH} textconv`])

		const result = git(workspace, ["diff", ".env.staging.enc"], { HOME: home })
		expect(result.stdout).toContain("-MY_SECRET=hunter2")
		expect(result.stdout).toContain("+MY_SECRET=changed")
	}, TIMEOUT)
})
