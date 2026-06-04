import { mkdirSync, writeFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const DEFAULT_BUN_CLI_PATH = "/app/cli/src/cli.ts"
const DEFAULT_NODE_CLI_PATH = "/app/cli/dist/cli.js"

const getCliInvocation = (): string[] => {
	if (process.env.DOTENC_E2E_CLI_RUNTIME === "node") {
		return ["node", process.env.DOTENC_E2E_CLI_PATH ?? DEFAULT_NODE_CLI_PATH]
	}

	return ["bun", process.env.DOTENC_E2E_CLI_PATH ?? DEFAULT_BUN_CLI_PATH]
}

type Ed25519KeyOptions = {
	fileName?: string
	passphrase?: string
}

type RsaKeyOptions = {
	fileName?: string
	bits?: number
	passphrase?: string
}

export function generateEd25519Key(
	homeDir: string,
	options: Ed25519KeyOptions = {},
): void {
	const sshDir = path.join(homeDir, ".ssh")
	mkdirSync(sshDir, { recursive: true })
	const fileName = options.fileName ?? "id_ed25519"
	const passphrase = options.passphrase ?? ""
	const result = Bun.spawnSync(
		[
			"ssh-keygen",
			"-t",
			"ed25519",
			"-f",
			path.join(sshDir, fileName),
			"-N",
			passphrase,
			"-q",
		],
	)
	if (result.exitCode !== 0) {
		throw new Error(`ssh-keygen ed25519 failed: ${result.stderr.toString()}`)
	}
}

export function generateRsaKey(
	homeDir: string,
	options: RsaKeyOptions = {},
): void {
	const sshDir = path.join(homeDir, ".ssh")
	mkdirSync(sshDir, { recursive: true })
	const fileName = options.fileName ?? "id_rsa"
	const bits = options.bits ?? 2048
	const passphrase = options.passphrase ?? ""
	const result = Bun.spawnSync(
		[
			"ssh-keygen",
			"-t",
			"rsa",
			"-b",
			String(bits),
			"-f",
			path.join(sshDir, fileName),
			"-N",
			passphrase,
			"-q",
		],
	)
	if (result.exitCode !== 0) {
		throw new Error(`ssh-keygen rsa failed: ${result.stderr.toString()}`)
	}
}

// E2E fixture passphrase: "secret" — matched in test interactions and env overrides.
export function generatePassphraseEd25519Key(homeDir: string): void {
	generateEd25519Key(homeDir, { passphrase: "secret" })
}

export function runCli(
	homeDir: string,
	workspace: string,
	args: string[],
	extraEnv?: Record<string, string>,
): { stdout: string; stderr: string; exitCode: number } {
	const result = Bun.spawnSync([...getCliInvocation(), ...args], {
		cwd: workspace,
		env: {
			...process.env,
			HOME: homeDir,
			DOTENC_SKIP_UPDATE_CHECK: "1",
			...extraEnv,
		},
	})
	return {
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
		exitCode: result.exitCode,
	}
}

export function runCliWithStdin(
	homeDir: string,
	workspace: string,
	args: string[],
	stdin: string,
	extraEnv?: Record<string, string>,
): { stdout: string; stderr: string; exitCode: number } {
	const result = Bun.spawnSync([...getCliInvocation(), ...args], {
		cwd: workspace,
		env: {
			...process.env,
			HOME: homeDir,
			DOTENC_SKIP_UPDATE_CHECK: "1",
			...extraEnv,
		},
		stdin: Buffer.from(stdin),
	})
	return {
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
		exitCode: result.exitCode,
	}
}

export type ExpectInteraction = {
	expect: string
	send: string
}

function quoteTcl(value: string): string {
	return `"${value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\$/g, "\\$")
		.replace(/\[/g, "\\[")
		.replace(/\]/g, "\\]")}"`
}

export function runCliWithExpect(
	homeDir: string,
	workspace: string,
	args: string[],
	interactions: ExpectInteraction[],
	extraEnv?: Record<string, string>,
): { stdout: string; stderr: string; exitCode: number } {
	const invocation = [...getCliInvocation(), ...args]
	const expectLogUser =
		extraEnv?.DOTENC_E2E_EXPECT_LOG_USER ??
		process.env.DOTENC_E2E_EXPECT_LOG_USER
	const scriptLines = [
		"set timeout 60",
		"match_max 100000",
		`log_user ${expectLogUser === "1" ? "1" : "0"}`,
		`spawn -noecho ${invocation.map((part) => quoteTcl(part)).join(" ")}`,
		"stty rows 40 columns 200",
	]

	for (const interaction of interactions) {
		scriptLines.push(`expect -re ${quoteTcl(interaction.expect)}`)
		scriptLines.push(`send -- ${quoteTcl(interaction.send)}`)
	}

	scriptLines.push("expect eof")
	scriptLines.push("catch wait result")
	scriptLines.push("set exit_code [lindex $result 3]")
	scriptLines.push("exit $exit_code")

	const result = Bun.spawnSync(["expect", "-c", scriptLines.join("\n")], {
		cwd: workspace,
		env: {
			...process.env,
			COLUMNS: "200",
			HOME: homeDir,
			LINES: "40",
			TERM: "xterm",
			DOTENC_SKIP_UPDATE_CHECK: "1",
			...extraEnv,
		},
	})

	return {
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
		exitCode: result.exitCode,
	}
}

export function createMockEditor(content: string): string {
	const contentFile = path.join(tmpdir(), `mock-editor-content-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	writeFileSync(contentFile, content + "\n")

	const scriptFile = path.join(tmpdir(), `mock-editor-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`)
	writeFileSync(
		scriptFile,
		`#!/bin/bash
FILE="$1"
{
    sed -n '1,/^# ---$/p' "$FILE"
    cat "${contentFile}"
} > "\${FILE}.tmp"
mv "\${FILE}.tmp" "$FILE"
`,
	)
	chmodSync(scriptFile, 0o755)
	return scriptFile
}
