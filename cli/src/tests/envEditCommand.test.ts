import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { editCommand } from "../commands/env/edit"
import { createDataKey, encryptData } from "../helpers/crypto"
import { decryptEnvironment } from "../helpers/decryptEnvironment"
import { encryptDataKey } from "../helpers/encryptDataKey"
import { getEnvironmentByName } from "../helpers/getEnvironmentByName"
import { getKeyFingerprint } from "../helpers/getKeyFingerprint"

const createMockEditorScript = () => {
	const scriptPath = path.join(
		os.tmpdir(),
		`dotenc-edit-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
	)

	writeFileSync(
		scriptPath,
		`#!/bin/sh
if [ "$1" = "--wait" ]; then
  FILE="$2"
else
  FILE="$1"
fi

{
  sed -n '1,/^# ---$/p' "$FILE"
  echo "UPDATED=1"
} > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
`,
		"utf-8",
	)
	Bun.spawnSync(["chmod", "+x", scriptPath])
	return scriptPath
}

describe("editCommand", () => {
	let workspace: string
	let homeDir: string
	let cwdSpy: ReturnType<typeof spyOn>
	let homedirSpy: ReturnType<typeof spyOn>
	let originalPrivateKeyEnv: string | undefined
	let originalHomeEnv: string | undefined
	let originalEditorEnv: string | undefined
	let editorScriptPath: string
	let originalExitCode: typeof process.exitCode

	beforeEach(async () => {
		workspace = mkdtempSync(path.join(os.tmpdir(), "dotenc-edit-workspace-"))
		homeDir = mkdtempSync(path.join(os.tmpdir(), "dotenc-edit-home-"))
		cwdSpy = spyOn(process, "cwd").mockReturnValue(workspace)
		homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir)
		originalExitCode = process.exitCode
		originalPrivateKeyEnv = process.env.DOTENC_PRIVATE_KEY
		originalHomeEnv = process.env.HOME
		originalEditorEnv = process.env.EDITOR

		const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
		const privateKeyPem = privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString("utf-8")
		await fs.mkdir(path.join(homeDir, ".ssh"), { recursive: true })
		await fs.writeFile(
			path.join(homeDir, ".ssh", "id_ed25519"),
			privateKeyPem,
			{
				encoding: "utf-8",
				mode: 0o600,
			},
		)

		const fingerprint = getKeyFingerprint(publicKey)
		const rawPublicKey = Buffer.from(
			publicKey.export({ type: "spki", format: "der" }).subarray(-32),
		)
		const dataKey = createDataKey()
		const encryptedDataKey = encryptDataKey(
			{
				algorithm: "ed25519",
				publicKey,
				rawPublicKey,
			},
			dataKey,
		)
		const encryptedContent = await encryptData(dataKey, "ORIGINAL=1\n")

		const envPayload = {
			keys: [
				{
					name: "alice",
					fingerprint,
					encryptedDataKey: encryptedDataKey.toString("base64"),
					algorithm: "ed25519" as const,
				},
			],
			encryptedContent: encryptedContent.toString("base64"),
		}

		await fs.mkdir(path.join(workspace, ".dotenc"), { recursive: true })
		await fs.writeFile(
			path.join(workspace, ".dotenc", "alice.pub"),
			publicKey.export({ type: "spki", format: "pem" }).toString("utf-8"),
			"utf-8",
		)

		await fs.writeFile(
			path.join(workspace, ".env.test.enc"),
			JSON.stringify(envPayload, null, 2),
			"utf-8",
		)

		process.env.HOME = homeDir
		delete process.env.DOTENC_PRIVATE_KEY
		editorScriptPath = createMockEditorScript()
		process.env.EDITOR = `${editorScriptPath} --wait`
	})

	afterEach(() => {
		// Bun 1.3.14/1.4.2 ignore undefined assignments to this non-configurable
		// accessor. Restore an unset exit status as success so a prior error
		// assertion cannot leave the runner exiting 1. Tests run with --isolate.
		process.exitCode = originalExitCode ?? 0
		cwdSpy.mockRestore()
		homedirSpy.mockRestore()
		rmSync(workspace, { recursive: true, force: true })
		if (existsSync(editorScriptPath)) {
			rmSync(editorScriptPath, { force: true })
		}
		rmSync(homeDir, { recursive: true, force: true })

		if (originalHomeEnv === undefined) {
			delete process.env.HOME
		} else {
			process.env.HOME = originalHomeEnv
		}

		if (originalPrivateKeyEnv === undefined) {
			delete process.env.DOTENC_PRIVATE_KEY
		} else {
			process.env.DOTENC_PRIVATE_KEY = originalPrivateKeyEnv
		}

		if (originalEditorEnv === undefined) {
			delete process.env.EDITOR
		} else {
			process.env.EDITOR = originalEditorEnv
		}
	})

	test("supports editor commands with arguments from config/env", async () => {
		await editCommand("test")

		const updated = await getEnvironmentByName("test")
		expect(updated.keys).toHaveLength(1)
		const decrypted = await decryptEnvironment("test")
		expect(decrypted).toBe("UPDATED=1")

		const tmpRaw = await fs.readFile(
			path.join(workspace, ".env.test.enc"),
			"utf-8",
		)
		expect(tmpRaw).toContain('"encryptedContent"')
	})
	test.each([
		"nonzero exit",
		"editor signal",
		"editor discovery",
		"editor launch",
		"temporary write",
		"temporary read",
		"encryption failure",
	])("cleans plaintext before exiting on %s", async (failure) => {
		const scratch = path.join(workspace, "scratch")
		await fs.mkdir(scratch, { mode: 0o700 })
		const originalEnvelope = await fs.readFile(
			path.join(workspace, ".env.test.enc"),
		)
		let editor = editorScriptPath
		let setup = ""
		if (failure === "editor discovery") {
			await fs.mkdir(path.join(homeDir, ".dotenc"), { mode: 0o700 })
			await fs.writeFile(
				path.join(homeDir, ".dotenc", "config.json"),
				JSON.stringify({ editor: "unsafe;editor" }),
				{ mode: 0o600 },
			)
		} else if (failure === "editor launch") {
			editor = path.join(workspace, "missing-editor")
		} else if (failure === "temporary write") {
			// A real partial plaintext write followed by an I/O failure.
			setup = `
import fs from "node:fs/promises";
const write = fs.writeFile;
fs.writeFile = async (...args) => {
  await write(...args);
  throw new Error("Synthetic partial write failure");
};
`
		} else {
			const script = {
				"nonzero exit": "exit 7",
				"editor signal": "kill -TERM $$",
				"temporary read": 'rm "$1"',
				"encryption failure": 'printf "UPDATED=1\\n" >> "$1"\nrm .env.test.enc',
			}[failure]
			await fs.writeFile(editorScriptPath, `#!/bin/sh\n${script}\n`, {
				mode: 0o700,
			})
		}
		const runner = path.join(workspace, "edit-runner.ts")
		const commandPath = path.resolve(import.meta.dir, "../commands/env/edit.ts")
		await fs.writeFile(
			runner,
			`${setup}\nconst { editCommand } = await import(${JSON.stringify(commandPath)}); await editCommand("test");\n`,
		)
		const result = spawnSync(process.execPath, [runner], {
			cwd: workspace,
			env: {
				PATH: process.env.PATH,
				HOME: homeDir,
				TMPDIR: scratch,
				EDITOR: editor,
			},
			encoding: "utf-8",
			timeout: 15_000,
		})
		expect(result.error).toBeUndefined()
		expect(result.status).toBe(1)
		expect(result.stderr).toContain("Failed to edit environment")
		expect(result.stdout).not.toContain("ORIGINAL=1")
		expect(result.stderr).not.toContain("ORIGINAL=1")
		expect(await fs.readdir(scratch)).toEqual([])
		if (failure !== "encryption failure") {
			expect(await fs.readFile(path.join(workspace, ".env.test.enc"))).toEqual(
				originalEnvelope,
			)
		}
	})
	test.each([
		"exit",
		"signal",
	])("reports editor %s failure after cleaning up", async (failure) => {
		const scratch = path.join(workspace, "in-process-scratch")
		await fs.mkdir(scratch, { mode: 0o700 })
		await fs.writeFile(
			editorScriptPath,
			failure === "exit" ? "#!/bin/sh\nexit 7\n" : "#!/bin/sh\nkill -TERM $$\n",
			{ mode: 0o700 },
		)
		const originalTmpdir = process.env.TMPDIR
		process.env.TMPDIR = scratch
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})
		try {
			await editCommand("test")
			expect(process.exitCode).toBe(1)
			expect(errorSpy).toHaveBeenCalledWith("\nFailed to edit environment.")
			expect(errorSpy).toHaveBeenCalledWith(
				failure === "exit"
					? "Editor exited with code 7"
					: "Editor terminated by signal SIGTERM",
			)
			expect(await fs.readdir(scratch)).toEqual([])
			expect(await decryptEnvironment("test")).toBe("ORIGINAL=1\n")
		} finally {
			if (originalTmpdir === undefined) delete process.env.TMPDIR
			else process.env.TMPDIR = originalTmpdir
			errorSpy.mockRestore()
		}
	})
})
