import { afterEach, describe, expect, test } from "bun:test"
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

// Drain both pipes and await exit explicitly. Synchronous child-process waits
// can leave dangling-process bookkeeping in Bun's isolated Linux test runner.
const invoke = async (cwd: string, args: readonly string[]) => {
	const child = Bun.spawn([process.execPath, cli, "doctor", ...args], {
		cwd,
		env: {
			PATH: process.env.PATH,
			HOME: cwd,
			NO_COLOR: "1",
			TEST_SECRET: secret,
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		timeout: 4_000,
		killSignal: "SIGKILL",
	})
	try {
		const [status, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		])
		return { status, stdout, stderr }
	} finally {
		if (child.exitCode === null) child.kill("SIGKILL")
		await child.exited
	}
}

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
		const result = await invoke(root, [
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
		const result = await invoke(root, args)
		expect(result.status).toBe(1)
		expect(result.stderr).toBe("")
		expect(JSON.parse(result.stdout).findings[0].id).toBe(
			"artifact.bootstrap-name",
		)
	})

	test.each(
		[
			["artifacts", "--json"],
			["--unknown-private-option", "artifacts", "output", "--json"],
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
		const result = await invoke(root, args)
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

	test.each([
		{ args: ["artifacts", "output", "--synthetic-sensitive-argument"] },
		{ args: ["--synthetic-sensitive-argument", "artifacts", "output"] },
	])("does not echo unknown options in human diagnostics for %j", async ({
		args,
	}) => {
		const root = await fixture()
		const result = await invoke(root, args)
		expect(result.status).toBe(2)
		expect(result.stdout).toBe("")
		expect(result.stderr).not.toContain("synthetic-sensitive-argument")
		expect(result.stderr).toContain("artifact doctor invocation is invalid")
	})

	test("does not mistake the profile value artifacts for the subcommand", async () => {
		const root = await fixture()
		const result = await invoke(root, [
			"--profile",
			"artifacts",
			"--unknown-option",
			"--json",
		])
		expect(result.status).toBe(2)
		expect(result.stderr).toBe("")
		expect(JSON.parse(result.stdout).command).toBe("doctor")
	})
})
