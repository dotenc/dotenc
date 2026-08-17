import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import {
	createMockEditor,
	generateEd25519Key,
	runCli,
} from "../helpers/cli"

const TIMEOUT = 30_000

describe("doctor", () => {
	let home: string
	let workspace: string
	let nested: string

	beforeAll(() => {
		home = mkdtempSync(path.join(os.tmpdir(), "e2e-32-doctor-home-"))
		workspace = mkdtempSync(
			path.join(os.tmpdir(), "e2e-32-doctor-workspace-"),
		)
		nested = path.join(workspace, "packages", "api")
		mkdirSync(nested, { recursive: true })
		generateEd25519Key(home)

		expect(
			runCli(home, workspace, ["init", "--name", "alice"]).exitCode,
		).toBe(0)
		expect(
			runCli(home, workspace, ["env", "edit", "development"], {
				EDITOR: createMockEditor(
					"DOCTOR_SECRET_NAME=DOCTOR_SECRET_VALUE",
				),
			}).exitCode,
		).toBe(0)
		writeFileSync(
			path.join(nested, ".env.local"),
			"PLAINTEXT_DOCTOR_NAME=PLAINTEXT_DOCTOR_VALUE\n",
		)
	})

	afterAll(() => {
		rmSync(home, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
	})

	test(
		"returns a redacted versioned report without changing local state",
		() => {
			const observedPaths = [
				path.join(workspace, ".env.development.enc"),
				path.join(workspace, ".env.personal.alice.enc"),
				path.join(workspace, ".dotenc", "alice.pub"),
				path.join(home, ".ssh", "id_ed25519"),
				path.join(nested, ".env.local"),
			]
			const before = observedPaths.map((filePath) => ({
				filePath,
				content: readFileSync(filePath),
				mode: statSync(filePath).mode,
			}))
			const locatorCache = path.join(home, ".cache", "dotenc")
			expect(existsSync(locatorCache)).toBe(false)

			const result = runCli(home, nested, ["doctor", "--json", "--all"])
			expect(result.exitCode).toBe(0)
			expect(result.stderr).toBe("")
			const report = JSON.parse(result.stdout) as {
				schemaVersion: number
				command: string
				complete: boolean
				scope: { mode: string }
				exitCode: number
			}
			expect(report).toMatchObject({
				schemaVersion: 1,
				command: "doctor",
				complete: true,
				scope: { mode: "all" },
				exitCode: 0,
			})
			expect(result.stdout).not.toContain("DOCTOR_SECRET_NAME")
			expect(result.stdout).not.toContain("DOCTOR_SECRET_VALUE")
			expect(result.stdout).not.toContain("PLAINTEXT_DOCTOR_NAME")
			expect(result.stdout).not.toContain("PLAINTEXT_DOCTOR_VALUE")
			expect(result.stdout).not.toContain(path.join(home, ".ssh"))

			for (const snapshot of before) {
				expect(readFileSync(snapshot.filePath)).toEqual(snapshot.content)
				expect(statSync(snapshot.filePath).mode).toBe(snapshot.mode)
			}
			expect(existsSync(locatorCache)).toBe(false)
		},
		TIMEOUT,
	)

	test("mirrors effective and local-only nesting scope", () => {
		const effective = runCli(home, nested, ["doctor", "--json"])
		expect(effective.exitCode).toBe(0)
		expect(JSON.parse(effective.stdout).scope.mode).toBe("effective")

		const local = runCli(home, nested, ["doctor", "--json", "--local-only"])
		expect(local.exitCode).toBe(1)
		expect(JSON.parse(local.stdout)).toMatchObject({
			complete: true,
			scope: { mode: "local" },
			exitCode: 1,
		})
	}, TIMEOUT)

	test("keeps warnings DX-compatible unless strict is requested", () => {
		const normal = runCli(home, nested, ["doctor", "--all"])
		expect(normal.exitCode).toBe(0)
		expect(normal.stdout).toContain("development")
		expect(normal.stdout).toContain("plaintext environment")
		expect(normal.stdout).not.toContain("PLAINTEXT_DOCTOR_VALUE")

		const strict = runCli(home, nested, ["doctor", "--json", "--all", "--strict"])
		expect(strict.exitCode).toBe(1)
		expect(JSON.parse(strict.stdout).exitCode).toBe(1)
	}, TIMEOUT)

	test("uses exit 2 and versioned JSON for invalid invocations", () => {
		for (const { args, scope } of [
			{
				args: ["doctor", "--json", "--all", "--profile", "alice"],
				scope: { mode: "all", profile: "personal.alice" },
			},
			{
				args: ["doctor", "--json", "--profile"],
				scope: { mode: "effective" },
			},
			{
				args: ["doctor", "--json", "--unknown-option"],
				scope: { mode: "effective" },
			},
		]) {
			const result = runCli(home, nested, args)
			expect(result.exitCode).toBe(2)
			expect(result.stderr).toBe("")
			expect(JSON.parse(result.stdout)).toMatchObject({
				schemaVersion: 1,
				command: "doctor",
				complete: false,
				scope,
				exitCode: 2,
				findings: [{ id: "invocation.invalid" }],
			})
		}
	}, TIMEOUT)
})
