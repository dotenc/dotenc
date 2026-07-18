import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { generateEd25519Key, runCli, runCliWithStdin } from "../helpers/cli"

const TIMEOUT = 30_000

describe("tools install-agent-skill", () => {
	let home: string
	let workspace: string
	let fakeBinDir: string
	let fakeNpxLogPath: string

	beforeAll(() => {
		home = mkdtempSync(path.join(os.tmpdir(), "e2e-18-skill-home-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-18-skill-ws-"))
		fakeBinDir = mkdtempSync(path.join(os.tmpdir(), "e2e-18-fake-bin-"))
		fakeNpxLogPath = path.join(fakeBinDir, "npx-invocations.log")
		const fakeNpxPath = path.join(fakeBinDir, "npx")
		writeFileSync(
			fakeNpxPath,
			`#!/bin/sh
if [ -n "$DOTENC_FAKE_NPX_FAIL" ]; then
  exit "$DOTENC_FAKE_NPX_FAIL"
fi
printf '%s\n' "$*" >> "${fakeNpxLogPath}"
exit 0
`,
			"utf-8",
		)
		chmodSync(fakeNpxPath, 0o755)
		generateEd25519Key(home)
	})

	afterAll(() => {
		rmSync(home, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
		rmSync(fakeBinDir, { recursive: true, force: true })
	})

	test("runs npx skills add locally when first option selected", () => {
		// Send newline to select first option ("Locally") in the list prompt
		const result = runCliWithStdin(
			home,
			workspace,
			["tools", "install-agent-skill"],
			"\n",
			{
				PATH: `${fakeBinDir}:${process.env.PATH}`,
			},
		)
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("Agent skill installation completed")
		expect(existsSync(fakeNpxLogPath)).toBe(true)
		const log = readFileSync(fakeNpxLogPath, "utf-8")
		expect(log).toContain("skills add dotenc/skills --skill dotenc")
	}, TIMEOUT)

	test("passes -y when --force is provided", () => {
		const result = runCliWithStdin(
			home,
			workspace,
			["tools", "install-agent-skill", "--force"],
			"\n",
			{
				PATH: `${fakeBinDir}:${process.env.PATH}`,
			},
		)
		expect(result.exitCode).toBe(0)
		const log = readFileSync(fakeNpxLogPath, "utf-8")
		expect(log).toContain("skills add dotenc/skills --skill dotenc -y")
	}, TIMEOUT)

	test("exits with npx command exit code on failure", () => {
		const result = runCliWithStdin(
			home,
			workspace,
			["tools", "install-agent-skill"],
			"\n",
			{
				PATH: `${fakeBinDir}:${process.env.PATH}`,
				DOTENC_FAKE_NPX_FAIL: "9",
			},
		)
		expect(result.exitCode).toBe(9)
		expect(result.stderr).toContain("exited with code 9")
	}, TIMEOUT)
})

describe("tools install-vscode-extension", () => {
	let home: string
	let workspace: string
	let freshWorkspace: string

	beforeAll(() => {
		home = mkdtempSync(path.join(os.tmpdir(), "e2e-18-vscode-home-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-18-vscode-ws-"))
		freshWorkspace = mkdtempSync(path.join(os.tmpdir(), "e2e-18-vscode-fresh-"))
		generateEd25519Key(home)
	})

	afterAll(() => {
		rmSync(home, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
		rmSync(freshWorkspace, { recursive: true, force: true })
	})

	test("creates .vscode/extensions.json with dotenc recommendation", () => {
		const result = runCli(home, workspace, ["tools", "install-vscode-extension"])
		expect(result.exitCode).toBe(0)

		const jsonPath = path.join(workspace, ".vscode", "extensions.json")
		expect(existsSync(jsonPath)).toBe(true)

		const json = JSON.parse(
			require("node:fs").readFileSync(jsonPath, "utf-8"),
		)
		expect(json.recommendations).toContain("dotenc.dotenc")
	}, TIMEOUT)

	test("is idempotent — no duplicate on second run", () => {
		runCli(home, workspace, ["tools", "install-vscode-extension"])

		const jsonPath = path.join(workspace, ".vscode", "extensions.json")
		const json = JSON.parse(
			require("node:fs").readFileSync(jsonPath, "utf-8"),
		)
		expect(
			json.recommendations.filter((x: string) => x === "dotenc.dotenc"),
		).toHaveLength(1)
	}, TIMEOUT)

	test("prints fallback VS Code URL when no editor is detected", () => {
		// Uses a fresh workspace with no .vscode/ dir so no editor is detected
		const result = runCli(home, freshWorkspace, ["tools", "install-vscode-extension"])
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("vscode:extension/dotenc.dotenc")
	}, TIMEOUT)
})
