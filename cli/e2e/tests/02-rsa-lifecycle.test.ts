import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { generateRsaKey, runCli, createMockEditor } from "../helpers/cli"

const TIMEOUT = 30_000

describe("RSA Lifecycle", () => {
	let home: string
	let workspace: string

	beforeAll(() => {
		home = mkdtempSync(path.join(os.tmpdir(), "e2e-02-alice-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-02-workspace-"))
		generateRsaKey(home)
	})

	afterAll(() => {
		rmSync(home, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
	})

	test("init creates project files", () => {
		runCli(home, workspace, ["init", "--name", "alice"])
		expect(existsSync(path.join(workspace, ".dotenc", "alice.pub"))).toBe(true)
		expect(existsSync(path.join(workspace, ".env.personal.alice.enc"))).toBe(
			true,
		)
	}, TIMEOUT)

	test("create generates encrypted env with rsa key", () => {
		runCli(home, workspace, ["env", "create", "staging", "alice"])
		const encPath = path.join(workspace, ".env.staging.enc")
		expect(existsSync(encPath)).toBe(true)

		const env = JSON.parse(readFileSync(encPath, "utf-8"))
		expect(env.keys[0].algorithm).toBe("rsa")
	}, TIMEOUT)

	test("edit changes the encrypted file", () => {
		const editor = createMockEditor("DB_PASSWORD=s3cure")
		const encPath = path.join(workspace, ".env.staging.enc")

		const before = readFileSync(encPath, "utf-8")
		runCli(home, workspace, ["env", "edit", "staging"], { EDITOR: editor })
		const after = readFileSync(encPath, "utf-8")

		expect(after).not.toBe(before)
	}, TIMEOUT)

	test("run decrypts and exposes env vars", () => {
		const result = runCli(home, workspace, ["run", "-e", "staging", "--", "sh", "-c", "echo $DB_PASSWORD"])
		expect(result.stdout).toContain("s3cure")
	}, TIMEOUT)
})
