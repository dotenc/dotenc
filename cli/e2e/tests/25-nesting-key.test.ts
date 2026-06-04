import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { generateEd25519Key, runCli } from "../helpers/cli"

const TIMEOUT = 30_000

describe("hierarchical key operations", () => {
	let aliceHome: string
	let bobHome: string
	let workspace: string
	let subdir: string

	beforeAll(() => {
		aliceHome = mkdtempSync(path.join(os.tmpdir(), "e2e-25-alice-"))
		bobHome = mkdtempSync(path.join(os.tmpdir(), "e2e-25-bob-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-25-workspace-"))
		subdir = path.join(workspace, "packages", "web")
		mkdirSync(subdir, { recursive: true })
		generateEd25519Key(aliceHome)
		generateEd25519Key(bobHome)
	})

	afterAll(() => {
		rmSync(aliceHome, { recursive: true, force: true })
		rmSync(bobHome, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
	})

	test("init workspace at root", () => {
		const result = runCli(aliceHome, workspace, ["init", "--name", "alice"])
		expect(result.exitCode).toBe(0)
		expect(existsSync(path.join(workspace, ".dotenc"))).toBe(true)
	}, TIMEOUT)

	test("key list from subdir shows same keys as root", () => {
		const listFromRoot = runCli(aliceHome, workspace, ["key", "list"])
		const listFromSubdir = runCli(aliceHome, subdir, ["key", "list"])

		expect(listFromRoot.exitCode).toBe(0)
		expect(listFromSubdir.exitCode).toBe(0)
		// Both should list alice
		expect(listFromRoot.stdout).toContain("alice")
		expect(listFromSubdir.stdout).toContain("alice")
	}, TIMEOUT)

	test("key add from subdir writes to root .dotenc", () => {
		const bobSshKey = path.join(bobHome, ".ssh", "id_ed25519")
		const result = runCli(aliceHome, subdir, [
			"key",
			"add",
			"bob",
			"--from-ssh",
			bobSshKey,
		])
		expect(result.exitCode).toBe(0)
		// Key should be in root .dotenc, not subdir
		expect(existsSync(path.join(workspace, ".dotenc", "bob.pub"))).toBe(true)
		expect(existsSync(path.join(subdir, ".dotenc", "bob.pub"))).toBe(false)
	}, TIMEOUT)

	test("key remove from subdir removes from root .dotenc", () => {
		const result = runCli(aliceHome, subdir, ["key", "remove", "bob", "--yes"])
		expect(result.exitCode).toBe(0)
		expect(existsSync(path.join(workspace, ".dotenc", "bob.pub"))).toBe(false)
	}, TIMEOUT)
})
