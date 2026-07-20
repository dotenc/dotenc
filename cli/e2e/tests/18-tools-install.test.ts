import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { generateEd25519Key, runCli, runCliWithStdin } from "../helpers/cli"

const TIMEOUT = 30_000

const git = (workspace: string, args: string[]): string => {
	const result = Bun.spawnSync(["git", ...args], { cwd: workspace })
	if (result.exitCode !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed: ${result.stderr.toString("utf-8")}`,
		)
	}
	return result.stdout.toString("utf-8")
}

const readFilesRecursively = (directory: string): Buffer[] => {
	const contents: Buffer[] = []
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const filePath = path.join(directory, entry.name)
		if (entry.isDirectory()) contents.push(...readFilesRecursively(filePath))
		else if (entry.isFile()) contents.push(readFileSync(filePath))
	}
	return contents
}

describe("tools install-agent-skill", () => {
	let home: string
	let workspace: string
	let fakeBinDir: string
	let fakeNpxLogPath: string

	beforeAll(() => {
		home = mkdtempSync(path.join(os.tmpdir(), "e2e-18-skill-home-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-18-skill-ws-"))
		fakeBinDir = mkdtempSync(path.join(os.tmpdir(), "e2e-18-fake-bin-"))
		fakeNpxLogPath = path.join(fakeBinDir, "npx-invocations.log")
		const fakeNpxPath = path.join(fakeBinDir, "npx")
		writeFileSync(
			fakeNpxPath,
			`#!/bin/sh
if [ -n "$DOTENC_FAKE_NPX_FAIL" ]; then
  exit "$DOTENC_FAKE_NPX_FAIL"
fi
printf '%s\n' "$*" >> "${fakeNpxLogPath}"
exit 0
`,
			"utf-8",
		)
		chmodSync(fakeNpxPath, 0o755)
		generateEd25519Key(home)
	})

	afterAll(() => {
		rmSync(home, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
		rmSync(fakeBinDir, { recursive: true, force: true })
	})

	test("runs npx skills add locally when first option selected", () => {
		// Send newline to select first option ("Locally") in the list prompt
		const result = runCliWithStdin(
			home,
			workspace,
			["tools", "install-agent-skill"],
			"\n",
			{
				PATH: `${fakeBinDir}:${process.env.PATH}`,
			},
		)
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("Agent skill installation completed")
		expect(existsSync(fakeNpxLogPath)).toBe(true)
		const log = readFileSync(fakeNpxLogPath, "utf-8")
		expect(log).toContain("skills add dotenc/skills --skill dotenc")
	}, TIMEOUT)

	test("passes -y when --force is provided", () => {
		const result = runCliWithStdin(
			home,
			workspace,
			["tools", "install-agent-skill", "--force"],
			"\n",
			{
				PATH: `${fakeBinDir}:${process.env.PATH}`,
			},
		)
		expect(result.exitCode).toBe(0)
		const log = readFileSync(fakeNpxLogPath, "utf-8")
		expect(log).toContain("skills add dotenc/skills --skill dotenc -y")
	}, TIMEOUT)

	test("exits with npx command exit code on failure", () => {
		const result = runCliWithStdin(
			home,
			workspace,
			["tools", "install-agent-skill"],
			"\n",
			{
				PATH: `${fakeBinDir}:${process.env.PATH}`,
				DOTENC_FAKE_NPX_FAIL: "9",
			},
		)
		expect(result.exitCode).toBe(9)
		expect(result.stderr).toContain("exited with code 9")
	}, TIMEOUT)
})

describe("tools install-vscode-extension", () => {
	let home: string
	let workspace: string
	let freshWorkspace: string

	beforeAll(() => {
		home = mkdtempSync(path.join(os.tmpdir(), "e2e-18-vscode-home-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-18-vscode-ws-"))
		freshWorkspace = mkdtempSync(path.join(os.tmpdir(), "e2e-18-vscode-fresh-"))
		generateEd25519Key(home)
	})

	afterAll(() => {
		rmSync(home, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
		rmSync(freshWorkspace, { recursive: true, force: true })
	})

	test("creates .vscode/extensions.json with dotenc recommendation", () => {
		const result = runCli(home, workspace, ["tools", "install-vscode-extension"])
		expect(result.exitCode).toBe(0)

		const jsonPath = path.join(workspace, ".vscode", "extensions.json")
		expect(existsSync(jsonPath)).toBe(true)

		const json = JSON.parse(
			require("node:fs").readFileSync(jsonPath, "utf-8"),
		)
		expect(json.recommendations).toContain("dotenc.dotenc")
	}, TIMEOUT)

	test("is idempotent — no duplicate on second run", () => {
		runCli(home, workspace, ["tools", "install-vscode-extension"])

		const jsonPath = path.join(workspace, ".vscode", "extensions.json")
		const json = JSON.parse(
			require("node:fs").readFileSync(jsonPath, "utf-8"),
		)
		expect(
			json.recommendations.filter((x: string) => x === "dotenc.dotenc"),
		).toHaveLength(1)
	}, TIMEOUT)

	test("prints fallback VS Code URL when no editor is detected", () => {
		// Uses a fresh workspace with no .vscode/ dir so no editor is detected
		const result = runCli(home, freshWorkspace, ["tools", "install-vscode-extension"])
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("vscode:extension/dotenc.dotenc")
	}, TIMEOUT)
})

describe("tools install-github-diffs", () => {
	let ciHome: string
	let fakeBinDir: string
	let fakeGhLogPath: string
	let fakeGhStdinPath: string
	let home: string
	let workspace: string

	const actionRef = "0123456789abcdef0123456789abcdef01234567"

	beforeAll(() => {
		home = mkdtempSync(path.join(os.tmpdir(), "e2e-18-github-home-"))
		ciHome = mkdtempSync(path.join(os.tmpdir(), "e2e-18-github-ci-home-"))
		workspace = mkdtempSync(path.join(os.tmpdir(), "e2e-18-github-ws-"))
		fakeBinDir = mkdtempSync(path.join(os.tmpdir(), "e2e-18-github-bin-"))
		fakeGhLogPath = path.join(fakeBinDir, "gh-invocations.log")
		fakeGhStdinPath = path.join(fakeBinDir, "gh-secret-stdin")

		const fakeGhPath = path.join(fakeBinDir, "gh")
		writeFileSync(
			fakeGhPath,
			`#!/bin/sh
printf '%s\\n' "$*" >> "${fakeGhLogPath}"

case "$1:$2" in
  repo:view)
    [ "$3" = "--json" ] || exit 21
    [ "$4" = "nameWithOwner,isFork,url" ] || exit 22
    printf '%s\\n' '{"nameWithOwner":"acme/widgets","isFork":false,"url":"https://github.com/acme/widgets"}'
    ;;
  secret:list)
    [ "$3" = "--repo" ] || exit 31
    [ "$4" = "acme/widgets" ] || exit 32
    [ "$5" = "--app" ] || exit 33
    [ "$6" = "actions" ] || exit 34
    [ "$7" = "--json" ] || exit 35
    [ "$8" = "name" ] || exit 36
    printf '%s\\n' '[]'
    ;;
  api:*)
    [ "$2" = "repos/dotenc/dotenc/contents/actions/diff/action.yml?ref=${actionRef}" ] || exit 41
    [ "$3" = "--hostname" ] || exit 42
    [ "$4" = "github.com" ] || exit 43
    [ "$5" = "--silent" ] || exit 44
    ;;
  secret:set)
    [ "$3" = "DOTENC_DIFF_PRIVATE_KEY_BASE64" ] || exit 51
    [ "$4" = "--repo" ] || exit 52
    [ "$5" = "acme/widgets" ] || exit 53
    [ "$6" = "--app" ] || exit 54
    [ "$7" = "actions" ] || exit 55
    cat > "${fakeGhStdinPath}"
    ;;
  *)
    exit 90
    ;;
esac
`,
			"utf-8",
		)
		chmodSync(fakeGhPath, 0o755)

		generateEd25519Key(home)
		git(workspace, ["init", "--quiet"])
		git(workspace, ["config", "user.email", "e2e@example.test"])
		git(workspace, ["config", "user.name", "dotenc e2e"])

		const init = runCli(home, workspace, ["init", "--name", "alice"])
		if (init.exitCode !== 0) {
			throw new Error(`dotenc init failed: ${init.stderr}`)
		}
		const create = runCli(home, workspace, [
			"env",
			"create",
			"staging",
			"alice",
		])
		if (create.exitCode !== 0) {
			throw new Error(`dotenc env create failed: ${create.stderr}`)
		}
		git(workspace, ["add", "--all"])
		git(workspace, ["commit", "--quiet", "-m", "initial dotenc project"])
	})

	afterAll(() => {
		rmSync(home, { recursive: true, force: true })
		rmSync(ciHome, { recursive: true, force: true })
		rmSync(workspace, { recursive: true, force: true })
		rmSync(fakeBinDir, { recursive: true, force: true })
	})

	test("installs a least-privilege redacted diff workflow without exposing the private key", () => {
		const commandHelp = runCli(home, workspace, ["tools", "--help"])
		expect(commandHelp.exitCode).toBe(0)
		expect(commandHelp.stdout).toContain("install-github-diffs")

		const result = runCli(
			home,
			workspace,
			[
				"tools",
				"install-github-diffs",
				"--environment",
				".env.staging.enc",
				"--action-ref",
				actionRef,
				"--yes",
			],
			{ PATH: `${fakeBinDir}:${process.env.PATH}` },
		)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain(
			"GitHub redacted diffs are configured for acme/widgets",
		)
		expect(existsSync(fakeGhStdinPath)).toBe(true)

		const publicKeyPath = path.join(
			workspace,
			".dotenc",
			"github-diff.pub",
		)
		const publicKey = readFileSync(publicKeyPath, "utf-8")
		expect(publicKey).toContain("-----BEGIN PUBLIC KEY-----")
		expect(publicKey).not.toContain("PRIVATE KEY")

		const environment = JSON.parse(
			readFileSync(path.join(workspace, ".env.staging.enc"), "utf-8"),
		) as { keys: Array<{ name: string }> }
		expect(environment.keys.map((key) => key.name)).toContain("github-diff")

		const workflow = readFileSync(
			path.join(workspace, ".github", "workflows", "dotenc-diff.yml"),
			"utf-8",
		)
		expect(workflow).toContain("pull_request_target:")
		expect(workflow).toContain("contents: read")
		expect(workflow).toContain("pull-requests: write")
		expect(workflow).toContain(
			`uses: dotenc/dotenc/actions/diff@${actionRef}`,
		)
		expect(workflow).toContain(
			"DOTENC_PRIVATE_KEY_BASE64: ${{ secrets.DOTENC_DIFF_PRIVATE_KEY_BASE64 }}",
		)
		expect(workflow).not.toMatch(/^\s*-\s+uses:\s+actions\/checkout/m)
		expect(workflow).not.toMatch(/^\s+run:/m)

		const encodedPrivateKey = readFileSync(fakeGhStdinPath, "utf-8")
		const privatePem = Buffer.from(encodedPrivateKey, "base64").toString(
			"utf-8",
		)
		expect(privatePem).toStartWith("-----BEGIN PRIVATE KEY-----")
		expect(privatePem).toContain("-----END PRIVATE KEY-----")

		const ciAccess = runCli(
			ciHome,
			workspace,
			["run", "-e", "staging", "--", "sh", "-c", "printf ci-access"],
			{
				DOTENC_PRIVATE_KEY: "",
				DOTENC_PRIVATE_KEY_BASE64: encodedPrivateKey,
			},
		)
		expect(ciAccess.exitCode).toBe(0)
		expect(ciAccess.stdout).toContain("ci-access")

		const ghLog = readFileSync(fakeGhLogPath, "utf-8")
		expect(ghLog).toContain(
			`api repos/dotenc/dotenc/contents/actions/diff/action.yml?ref=${actionRef}`,
		)
		expect(ghLog).toContain(
			"secret set DOTENC_DIFF_PRIVATE_KEY_BASE64 --repo acme/widgets --app actions",
		)
		expect(ghLog).not.toContain("--body")
		expect(ghLog).not.toContain(encodedPrivateKey)
		expect(ghLog).not.toContain(privatePem)
		expect(result.stdout).not.toContain(encodedPrivateKey)
		expect(result.stdout).not.toContain(privatePem)
		expect(result.stderr).not.toContain(encodedPrivateKey)
		expect(result.stderr).not.toContain(privatePem)

		const workspaceBytes = Buffer.concat(readFilesRecursively(workspace))
		expect(workspaceBytes.includes(Buffer.from(encodedPrivateKey))).toBe(false)
		expect(workspaceBytes.includes(Buffer.from(privatePem))).toBe(false)
	}, TIMEOUT)
})
