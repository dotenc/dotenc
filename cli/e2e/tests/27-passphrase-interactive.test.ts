import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
	generateEd25519Key,
	generatePassphraseEd25519Key,
	runCli,
	runCliWithExpect,
} from "../helpers/cli"

const TIMEOUT = 60_000
const HAS_PARENT_TTY = Boolean(process.stdin.isTTY && process.stdout.isTTY)

describe("Interactive passphrase-protected key conversion", () => {
	if (!HAS_PARENT_TTY) {
		test.skip("requires a real parent TTY", () => {})
		return
	}

	let passphraseHome: string
	let workspace: string

	beforeAll(() => {
		passphraseHome = mkdtempSync(path.join(os.tmpdir(), "e2e-27-passphrase-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-27-workspace-"))
		generatePassphraseEd25519Key(passphraseHome)
	})

	afterAll(() => {
		rmSync(passphraseHome, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
	})

	test("init can convert selected passphrase key into a passwordless copy", () => {
		const originalKeyPath = path.join(passphraseHome, ".ssh", "id_ed25519")
		const originalContentBefore = readFileSync(originalKeyPath, "utf-8")

		const initResult = runCliWithExpect(
			passphraseHome,
			workspace,
			["init", "--name", "alice"],
				[
					{ expect: "Which SSH key would you like to use\\?", send: "\r" },
					{ expect: "Create a passwordless copy of this key now\\?", send: "\r" },
					{ expect: "Enter old passphrase:", send: "secret\r" },
			],
		)

		expect(initResult.exitCode).toBe(0)

		const passwordlessCopyPath = path.join(
			passphraseHome,
			".ssh",
			"id_ed25519_passwordless",
		)
		expect(existsSync(passwordlessCopyPath)).toBe(true)

		const originalContentAfter = readFileSync(originalKeyPath, "utf-8")
		expect(originalContentAfter).toBe(originalContentBefore)

		const whoamiResult = runCli(passphraseHome, workspace, ["whoami"])
		expect(whoamiResult.exitCode).toBe(0)
		expect(whoamiResult.stdout).toContain("Name: alice")
		expect(whoamiResult.stdout).toContain(
			"Active SSH key: id_ed25519_passwordless",
		)
	}, TIMEOUT)

	test("interactive key add can convert selected passphrase key into passwordless copy", () => {
		const aliceHome = mkdtempSync(path.join(os.tmpdir(), "e2e-27-alice-home-"))
		const keyAddWorkspace = mkdtempSync(path.join(os.tmpdir(), "e2e-27-keyadd-ws-"))

		try {
			generateEd25519Key(aliceHome)
			const initResult = runCli(aliceHome, keyAddWorkspace, ["init", "--name", "alice"])
			expect(initResult.exitCode).toBe(0)

			const keyAddResult = runCliWithExpect(
				passphraseHome,
				keyAddWorkspace,
				["key", "add"],
					[
						{
							expect:
								"Would you like to add one of your SSH keys or paste a public key\\?",
						send: "\r",
						},
						{ expect: "Which SSH key do you want to add\\?", send: "\r" },
						{ expect: "Create a passwordless copy of this key now\\?", send: "\r" },
						{ expect: "Enter old passphrase:", send: "secret\r" },
					],
				)

			expect(keyAddResult.exitCode).toBe(0)

			const publicKeyPath = path.join(
				keyAddWorkspace,
				".dotenc",
				"id_ed25519_passwordless.pub",
			)
			expect(existsSync(publicKeyPath)).toBe(true)
		} finally {
			rmSync(aliceHome, { recursive: true, force: true })
			rmSync(keyAddWorkspace, { recursive: true, force: true })
		}
	}, TIMEOUT)
})
