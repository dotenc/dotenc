import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, existsSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { generateEd25519Key, runCli } from "../helpers/cli"

const TIMEOUT = 30_000

describe("Key Remove (key-deletion only)", () => {
	let aliceHome: string
	let bobHome: string
	let workspace: string

	beforeAll(() => {
		aliceHome = mkdtempSync(path.join(os.tmpdir(), "e2e-14-alice-"))
		bobHome = mkdtempSync(path.join(os.tmpdir(), "e2e-14-bob-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-14-workspace-"))
		generateEd25519Key(aliceHome)
		generateEd25519Key(bobHome)
	})

	afterAll(() => {
		rmSync(aliceHome, { recursive: true, force: true })
		rmSync(bobHome, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
	})

	test("Alice inits and creates staging env", () => {
		runCli(aliceHome, workspace, ["init", "--name", "alice"])
		runCli(aliceHome, workspace, ["env", "create", "staging", "alice"])
	}, TIMEOUT)

	test("Alice adds Bob's key and grants access", () => {
		runCli(aliceHome, workspace, [
			"key", "add", "bob", "--from-ssh",
			path.join(bobHome, ".ssh", "id_ed25519"),
		])
		runCli(aliceHome, workspace, ["auth", "grant", "staging", "bob"])
	}, TIMEOUT)

	test("removes the .pub file", () => {
		const result = runCli(aliceHome, workspace, ["key", "remove", "bob", "--yes"])
		expect(result.exitCode).toBe(0)
		expect(existsSync(path.join(workspace, ".dotenc", "bob.pub"))).toBe(false)
	}, TIMEOUT)

	test("prints offboarding hint", () => {
		// Setup fresh workspace for this isolated test
		const ws2 = mkdtempSync(path.join(os.tmpdir(), "e2e-14b-workspace-"))
		const bobHome2 = mkdtempSync(path.join(os.tmpdir(), "e2e-14b-bob-"))
		generateEd25519Key(bobHome2)

		try {
			runCli(aliceHome, ws2, ["init", "--name", "alice"])
			runCli(aliceHome, ws2, ["env", "create", "staging", "alice"])
			runCli(aliceHome, ws2, [
				"key", "add", "bob", "--from-ssh",
				path.join(bobHome2, ".ssh", "id_ed25519"),
			])

			const result = runCli(aliceHome, ws2, ["key", "remove", "bob", "--yes"])

			const output = result.stdout.toString() + result.stderr.toString()
			expect(output).toContain("dotenc auth purge bob")
		} finally {
			rmSync(ws2, { recursive: true, force: true })
			rmSync(bobHome2, { recursive: true, force: true })
		}
	}, TIMEOUT)

	test("does NOT revoke environment access (Bob can still decrypt after key remove)", () => {
		// Setup: fresh workspace, grant bob access, remove bob's key file, verify bob can still decrypt
		const ws3 = mkdtempSync(path.join(os.tmpdir(), "e2e-14c-workspace-"))
		const bobHome3 = mkdtempSync(path.join(os.tmpdir(), "e2e-14c-bob-"))
		generateEd25519Key(bobHome3)

		try {
			runCli(aliceHome, ws3, ["init", "--name", "alice"])
			runCli(aliceHome, ws3, ["env", "create", "staging", "alice"])
			runCli(aliceHome, ws3, [
				"key", "add", "bob", "--from-ssh",
				path.join(bobHome3, ".ssh", "id_ed25519"),
			])
			runCli(aliceHome, ws3, ["auth", "grant", "staging", "bob"])

			runCli(aliceHome, ws3, ["key", "remove", "bob", "--yes"])

			// Bob's pub file is removed, but the encrypted env still has his entry
			expect(existsSync(path.join(ws3, ".dotenc", "bob.pub"))).toBe(false)

			// Bob can still decrypt (env was NOT rotated/revoked)
			const result = runCli(bobHome3, ws3, [
				"run", "-e", "staging", "--", "sh", "-c", "echo ok",
			])
			expect(result.stdout).toContain("ok")
		} finally {
			rmSync(ws3, { recursive: true, force: true })
			rmSync(bobHome3, { recursive: true, force: true })
		}
	}, TIMEOUT)
})
