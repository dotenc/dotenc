import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { generateEd25519Key, runCli, createMockEditor } from "../helpers/cli"

const TIMEOUT = 30_000

describe("environment-provided private keys", () => {
	let aliceHome: string
	let ciHome: string
	let workspace: string

	beforeAll(() => {
		aliceHome = mkdtempSync(path.join(os.tmpdir(), "e2e-04-alice-"))
		ciHome = mkdtempSync(path.join(os.tmpdir(), "e2e-04-ci-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-04-workspace-"))
		generateEd25519Key(aliceHome)
	})

	afterAll(() => {
		rmSync(aliceHome, { recursive: true, force: true })
		rmSync(ciHome, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
	})

	test("Alice inits and creates env", () => {
		runCli(aliceHome, workspace, ["init", "--name", "alice"])
		runCli(aliceHome, workspace, ["env", "create", "staging", "alice"])
	}, TIMEOUT)

	test("Alice edits env", () => {
		const editor = createMockEditor("DEPLOY_TOKEN=tok_abc123")
		runCli(aliceHome, workspace, ["env", "edit", "staging"], { EDITOR: editor })
	}, TIMEOUT)

	test("Alice can run normally", () => {
		const result = runCli(aliceHome, workspace, ["run", "-e", "staging", "--", "sh", "-c", "echo $DEPLOY_TOKEN"])
		expect(result.stdout).toContain("tok_abc123")
	}, TIMEOUT)

	test("CI decrypts via DOTENC_PRIVATE_KEY without .ssh dir", () => {
		const privateKey = readFileSync(path.join(aliceHome, ".ssh", "id_ed25519"), "utf-8")
		const result = runCli(ciHome, workspace, ["run", "-e", "staging", "--", "sh", "-c", "echo $DEPLOY_TOKEN"], {
			DOTENC_PRIVATE_KEY: privateKey,
		})
		expect(result.stdout).toContain("tok_abc123")
	}, TIMEOUT)

	test("CI decrypts via DOTENC_PRIVATE_KEY_BASE64 without .ssh dir", () => {
		const privateKey = readFileSync(path.join(aliceHome, ".ssh", "id_ed25519"), "utf-8")
		const result = runCli(ciHome, workspace, ["run", "-e", "staging", "--", "sh", "-c", "echo $DEPLOY_TOKEN"], {
			DOTENC_PRIVATE_KEY_BASE64: Buffer.from(privateKey, "utf-8").toString("base64"),
		})
		expect(result.stdout).toContain("tok_abc123")
	}, TIMEOUT)
})
