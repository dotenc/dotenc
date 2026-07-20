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

const TIMEOUT = 30_000

describe("Ed25519 Lifecycle", () => {
	let home: string
	let workspace: string

	beforeAll(() => {
		home = mkdtempSync(path.join(os.tmpdir(), "e2e-01-alice-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-01-workspace-"))
		generateEd25519Key(home)
	})

	afterAll(() => {
		rmSync(home, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
	})

	test("init creates project files", () => {
		const migratedContent = "MIGRATED_SECRET=fake-e2e-value\n"
		writeFileSync(path.join(workspace, ".env"), migratedContent, "utf-8")

		const result = runCli(home, workspace, ["init", "--name", "alice"])

		expect(result.exitCode).toBe(0)
		expect(existsSync(path.join(workspace, ".dotenc", "alice.pub"))).toBe(true)
		expect(existsSync(path.join(workspace, ".env.alice.enc"))).toBe(true)
		expect(existsSync(path.join(workspace, ".env"))).toBe(false)
		expect(
			runCli(home, workspace, [
				"textconv",
				".env.development.enc",
			]).stdout,
		).toBe(migratedContent)
	}, TIMEOUT)

	test("create generates encrypted env with ed25519 key", () => {
		runCli(home, workspace, ["env", "create", "staging", "alice"])
		const encPath = path.join(workspace, ".env.staging.enc")
		expect(existsSync(encPath)).toBe(true)

		const env = JSON.parse(readFileSync(encPath, "utf-8"))
		expect(env.keys[0].algorithm).toBe("ed25519")
	}, TIMEOUT)

	test("edit changes the encrypted file", () => {
		const editor = createMockEditor("MY_SECRET=hunter2")
		const encPath = path.join(workspace, ".env.staging.enc")

		const before = readFileSync(encPath, "utf-8")
		runCli(home, workspace, ["env", "edit", "staging"], { EDITOR: editor })
		const after = readFileSync(encPath, "utf-8")

		expect(after).not.toBe(before)
	}, TIMEOUT)

	test("run decrypts and exposes env vars", () => {
		const result = runCli(home, workspace, ["run", "-e", "staging", "--", "sh", "-c", "echo $MY_SECRET"])
		expect(result.stdout).toContain("hunter2")
	}, TIMEOUT)
})
