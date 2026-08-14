import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import {
	createMockEditor,
	generateEd25519Key,
	runCli,
} from "../helpers/cli"

const TIMEOUT = 30_000

describe("Personal profile migration", () => {
	let home: string
	let workspace: string

	beforeAll(() => {
		home = mkdtempSync(path.join(os.tmpdir(), "e2e-31-alice-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-31-workspace-"))
		generateEd25519Key(home)

		expect(
			runCli(home, workspace, ["init", "--name", "alice"]).exitCode,
		).toBe(0)
		expect(
			runCli(home, workspace, [
				"env",
				"edit",
				"development",
			], {
				EDITOR: createMockEditor("SHARED_VALUE=shared-fixture"),
			}).exitCode,
		).toBe(0)
		expect(
			runCli(home, workspace, [
				"env",
				"delete",
				"personal.alice",
				"--yes",
			]).exitCode,
		).toBe(0)
		expect(
			runCli(home, workspace, ["env", "create", "alice", "alice"])
				.exitCode,
		).toBe(0)
		expect(
			runCli(home, workspace, ["env", "edit", "alice"], {
				EDITOR: createMockEditor("LEGACY_VALUE=legacy-fixture"),
			}).exitCode,
		).toBe(0)
	})

	afterAll(() => {
		rmSync(home, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
	})

	test(
		"dev warns about but never loads an accessible legacy profile",
		() => {
			const result = runCli(home, workspace, [
				"dev",
				"--",
				"sh",
				"-c",
				'printf "%s|%s" "$SHARED_VALUE" "${LEGACY_VALUE-unset}"',
			])

			expect(result.exitCode).toBe(0)
			expect(result.stdout).toContain("shared-fixture|unset")
			expect(result.stdout).not.toContain("legacy-fixture")
			expect(result.stderr).toContain("possible legacy")
			expect(result.stderr).toContain(
				"dotenc env rename alice personal.alice",
			)
		},
		TIMEOUT,
	)

	test(
		"nested dev suggests --all-layers for one ancestor-only legacy source",
		() => {
			const nested = path.join(workspace, "packages", "app")
			mkdirSync(nested, { recursive: true })

			const result = runCli(home, nested, [
				"dev",
				"--",
				"sh",
				"-c",
				'printf "%s" "${LEGACY_VALUE-unset}"',
			])

			expect(result.exitCode).toBe(0)
			expect(result.stdout).toContain("unset")
			expect(result.stderr).toContain(
				"dotenc env rename alice personal.alice --all-layers",
			)
		},
		TIMEOUT,
	)

	test(
		"rename requires explicit confirmation in a non-interactive process",
		() => {
			const result = runCli(home, workspace, [
				"env",
				"rename",
				"alice",
				"personal.alice",
			])

			expect(result.exitCode).toBe(1)
			expect(result.stderr).toContain("--yes")
			expect(existsSync(path.join(workspace, ".env.alice.enc"))).toBe(true)
			expect(
				existsSync(path.join(workspace, ".env.personal.alice.enc")),
			).toBe(false)
		},
		TIMEOUT,
	)

	test(
		"rename preserves recipients and makes the personal profile loadable",
		() => {
			const sourcePath = path.join(workspace, ".env.alice.enc")
			const destinationPath = path.join(
				workspace,
				".env.personal.alice.enc",
			)
			const before = JSON.parse(readFileSync(sourcePath, "utf-8")) as {
				keys: unknown[]
				encryptedContent: string
			}

			const renamed = runCli(home, workspace, [
				"env",
				"rename",
				"alice",
				"personal.alice",
				"--yes",
			])

			expect(renamed.exitCode).toBe(0)
			expect(existsSync(sourcePath)).toBe(false)
			expect(existsSync(destinationPath)).toBe(true)

			const after = JSON.parse(readFileSync(destinationPath, "utf-8")) as {
				version: number
				keys: unknown[]
				encryptedContent: string
			}
			expect(after.version).toBe(2)
			expect(after.keys).toEqual(before.keys)
			expect(after.encryptedContent).not.toBe(before.encryptedContent)

			const dev = runCli(home, workspace, [
				"dev",
				"--",
				"sh",
				"-c",
				'printf "%s|%s" "$SHARED_VALUE" "$LEGACY_VALUE"',
			])
			expect(dev.exitCode).toBe(0)
			expect(dev.stdout).toContain("shared-fixture|legacy-fixture")
		},
		TIMEOUT,
	)
})
