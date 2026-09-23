import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const cli = path.resolve(import.meta.dir, "../cli.ts")
const roots: string[] = []
const secret = "synthetic-cli-credential"

const fixture = async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "dotenc-artifact-cli-"))
	roots.push(root)
	await fs.mkdir(path.join(root, "output"))
	return root
}

const invoke = (cwd: string, args: string[]) =>
	spawnSync(process.execPath, [cli, "doctor", ...args], {
		cwd,
		env: {
			PATH: process.env.PATH,
			HOME: cwd,
			NO_COLOR: "1",
			TEST_SECRET: secret,
		},
		encoding: "utf8",
		timeout: 10_000,
	})

afterEach(async () => {
	for (const root of roots.splice(0))
		await fs.rm(root, { recursive: true, force: true })
})

describe("artifact doctor CLI integration", () => {
	test("works outside a dotenc repository and returns JSON for a selected encoded leak", async () => {
		const root = await fixture()
		await fs.writeFile(
			path.join(root, "output", "bundle.js"),
			Buffer.from(secret).toString("base64"),
		)
		const result = invoke(root, [
			"artifacts",
			"output",
			"--secret-name",
			"TEST_SECRET",
			"--json",
		])
		expect(result.status).toBe(1)
		expect(result.stderr).toBe("")
		const report = JSON.parse(result.stdout)
		expect(report.command).toBe("doctor artifacts")
		expect(report.findings[0].id).toBe("artifact.secret-value")
		expect(result.stdout).not.toContain(secret)
		expect(result.stdout).not.toContain("TEST_SECRET")
	})

	test.each(
		[
			["--json", "--strict", "artifacts", "output"],
			["artifacts", "output", "--json", "--strict"],
		].map((args) => ({ args })),
	)("inherits JSON and strict flags in %j", async ({ args }) => {
		const root = await fixture()
		await fs.writeFile(
			path.join(root, "output", "bundle.js"),
			"process.env.DOTENC_PRIVATE_KEY_BASE64",
		)
		const result = invoke(root, args)
		expect(result.status).toBe(1)
		expect(result.stderr).toBe("")
		expect(JSON.parse(result.stdout).findings[0].id).toBe(
			"artifact.bootstrap-name",
		)
	})

	test.each(
		[
			["artifacts", "--json"],
			["artifacts", "output", "--secret-name", "--json"],
			["artifacts", "output", "--secret-name", "PRIVATE-NAME", "--json"],
			["artifacts", "output", "--unknown-private-option", "--json"],
			["--profile=private-profile", "artifacts", "output", "--json"],
			["--profile", "private-profile", "artifacts", "output", "--json"],
			["artifacts", "output", "--all", "--json"],
			["artifacts", "output", "extra-private-argument", "--json"],
		].map((args) => ({ args })),
	)("returns sanitized artifact JSON for invalid arguments %j", async ({
		args,
	}) => {
		const root = await fixture()
		const result = invoke(root, args)
		expect(result.status).toBe(2)
		expect(result.stderr).toBe("")
		const report = JSON.parse(result.stdout)
		expect(report.command).toBe("doctor artifacts")
		expect(report.complete).toBe(false)
		expect(report.findings[0].id).toBe("invocation.invalid")
		expect(result.stdout).not.toContain("private-profile")
		expect(result.stdout).not.toContain("PRIVATE-NAME")
		expect(result.stdout).not.toContain("unknown-private-option")
	})

	test("does not echo unknown options in human diagnostics", async () => {
		const root = await fixture()
		const result = invoke(root, [
			"artifacts",
			"output",
			"--synthetic-sensitive-argument",
		])
		expect(result.status).toBe(2)
		expect(result.stdout + result.stderr).not.toContain(
			"synthetic-sensitive-argument",
		)
		expect(result.stderr).toContain("invocation is invalid")
	})
})
