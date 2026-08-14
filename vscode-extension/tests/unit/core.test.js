const { describe, expect, test } = require("bun:test")
const packageJson = require("../../package.json")
const { formatDetectedVersion } = require("../../src/helpers/formatDetectedVersion")
const {
	getDotencExecutable,
	normalizeExecutablePath,
} = require("../../src/helpers/getDotencExecutable")
const { getFailureSteps } = require("../../src/helpers/getFailureSteps")
const { getFailureUserMessage } = require("../../src/helpers/getFailureUserMessage")
const {
	getDotencInstallCommand,
} = require("../../src/helpers/getDotencInstallCommand")
const {
	getMachineScopedConfigurationValue,
} = require("../../src/helpers/getMachineScopedConfigurationValue")
const {
	isAutoViewDecryptedEnabled,
} = require("../../src/helpers/isAutoViewDecryptedEnabled")
const { isVersionSupported } = require("../../src/helpers/isVersionSupported")
const { mapFailureCode } = require("../../src/helpers/mapFailureCode")
const { MIN_DOTENC_VERSION } = require("../../src/helpers/minDotencVersion")
const { parseEnvironmentName } = require("../../src/helpers/parseEnvironmentName")
const { parseJsonPayload } = require("../../src/helpers/parseJsonPayload")
const { runProcess } = require("../../src/helpers/runProcess")
const { stripAnsi } = require("../../src/helpers/stripAnsi")

describe("core helpers", () => {
	test("parses .env.<name>.enc filenames", () => {
		expect(parseEnvironmentName("/repo/.env.development.enc")).toBe(
			"development",
		)
		expect(parseEnvironmentName("/repo/.env.alice.enc")).toBe("alice")
		expect(parseEnvironmentName("/repo/.env")).toBeUndefined()
	})

	test("parses JSON payload only when valid", () => {
		expect(parseJsonPayload('{"ok":true}')).toEqual({ ok: true })
		expect(parseJsonPayload("   ")).toBeUndefined()
		expect(parseJsonPayload("not-json")).toBeUndefined()
	})

	test("parses JSON array payload (env list --json shape)", () => {
		const input = JSON.stringify([
			{ name: "staging", dir: "/workspace", filePath: "/workspace/.env.staging.enc" },
			{ name: "production", dir: "/workspace/packages/web", filePath: "/workspace/packages/web/.env.production.enc" },
		])
		const result = parseJsonPayload(input)
		expect(Array.isArray(result)).toBe(true)
		expect(result.length).toBe(2)
		expect(result[0].name).toBe("staging")
		expect(result[1].filePath).toBe("/workspace/packages/web/.env.production.enc")
	})

	test("strips ANSI escapes", () => {
		expect(stripAnsi("\u001b[31mError:\u001b[0m boom")).toBe("Error: boom")
	})

	test("supports versions >= minimum", () => {
		expect(isVersionSupported("0.9.0", MIN_DOTENC_VERSION)).toBe(true)
		expect(isVersionSupported("0.9.9", MIN_DOTENC_VERSION)).toBe(true)
		expect(isVersionSupported("1.0.0", MIN_DOTENC_VERSION)).toBe(true)
		expect(isVersionSupported("0.8.9", MIN_DOTENC_VERSION)).toBe(false)
		expect(isVersionSupported("v0.9.0", MIN_DOTENC_VERSION)).toBe(true)
		expect(isVersionSupported("invalid", MIN_DOTENC_VERSION)).toBe(false)
	})

	test("extracts normalized detected versions", () => {
		expect(formatDetectedVersion("v0.5.2")).toBe("0.5.2")
		expect(formatDetectedVersion("dotenc version 0.5.0")).toBe("0.5.0")
		expect(formatDetectedVersion("unknown")).toBe("unknown")
	})

	test("maps known failure messages to failure codes", () => {
		expect(
			mapFailureCode(
				'dotenc CLI was not found. Configure "dotenc.executablePath" in VS Code settings or install dotenc.',
			),
		).toBe("CLI_NOT_FOUND")
		expect(mapFailureCode("Access denied to the environment.")).toBe(
			"ACCESS_DENIED",
		)
		expect(
			mapFailureCode("Environment file not found: /tmp/.env.dev.enc"),
		).toBe("ENVIRONMENT_NOT_FOUND")
		expect(mapFailureCode("No public keys found.")).toBe("NO_PUBLIC_KEYS")
		expect(mapFailureCode("random failure")).toBe("UNKNOWN")
	})

	test("maps additional failure messages to explicit codes", () => {
		expect(mapFailureCode("No private keys found in ~/.ssh")).toBe("NO_IDENTITY")
		expect(mapFailureCode("No matching key found in keyring")).toBe(
			"NO_IDENTITY",
		)
		expect(mapFailureCode("this key is passphrase-protected")).toBe(
			"PASSPHRASE_PROTECTED_KEYS",
		)
		expect(mapFailureCode("No project found in current directory")).toBe(
			"PROJECT_NOT_INITIALIZED",
		)
		expect(mapFailureCode("Invalid environment name: bad/name")).toBe(
			"INVALID_ENVIRONMENT_NAME",
		)
	})

	test("access denied user message is explicit and actionable", () => {
		const message = getFailureUserMessage("staging", {
			code: "ACCESS_DENIED",
			message: "Access denied to the environment.",
		})

		expect(message).toContain('You do not have access to "staging".')
		expect(message).toContain('Run "dotenc whoami"')
		expect(message).toContain("grant you this environment")
	})

	test("returns generic message when no failure details exist", () => {
		expect(getFailureUserMessage("staging", undefined)).toContain(
			"cannot be edited right now",
		)
	})

	test("access denied guidance includes key add and grant commands", () => {
		const steps = getFailureSteps("production", { code: "ACCESS_DENIED" })
		const joined = steps.join("\n")
		expect(joined).toContain("dotenc key add <your-key-name> --from-file")
		expect(joined).toContain("dotenc auth grant production <your-key-name>")
	})

	test("cli-not-found guidance includes executable path setup", () => {
		const steps = getFailureSteps("development", {
			code: "CLI_NOT_FOUND",
		})

		expect(steps.join("\n")).toContain("dotenc.executablePath")
		expect(steps.join("\n")).toContain("Install dotenc CLI")
	})

	test("version unsupported guidance includes minimum version", () => {
		const steps = getFailureSteps("development", {
			code: "CLI_VERSION_UNSUPPORTED",
		})
		expect(steps.join("\n")).toContain(MIN_DOTENC_VERSION)
	})

	test("returns setup guidance for project bootstrapping and unknown failures", () => {
		const initSteps = getFailureSteps("development", {
			code: "PROJECT_NOT_INITIALIZED",
		})
		expect(initSteps.join("\n")).toContain("dotenc init")

		const genericSteps = getFailureSteps("development", {
			code: "UNKNOWN",
		})
		expect(genericSteps.join("\n")).toContain("dotenc whoami")
	})

	test("provides curl installer command on unix-like platforms", () => {
		const command = getDotencInstallCommand("darwin")
		expect(command).toEqual({
			download: {
				executable: "curl",
				args: ["-fsSL", "https://dotenc.org/install.sh"],
			},
			install: {
				executable: "sh",
				args: [],
			},
		})
	})

	test("does not provide curl installer command on windows", () => {
		expect(getDotencInstallCommand("win32")).toBeUndefined()
	})

	test("normalizes configured executable path values", () => {
		expect(normalizeExecutablePath("dotenc")).toBe("dotenc")
		expect(normalizeExecutablePath("  /usr/local/bin/dotenc  ")).toBe(
			"/usr/local/bin/dotenc",
		)
		expect(normalizeExecutablePath("   ")).toBe("dotenc")
		expect(normalizeExecutablePath(undefined)).toBe("dotenc")
	})

	test("uses only the machine-scoped executable path", () => {
		const resolved = getDotencExecutable(undefined, () => ({
			inspect: () => ({
				defaultValue: "dotenc",
				globalValue: "  custom-dotenc  ",
				workspaceValue: "workspace-controlled-dotenc",
				workspaceFolderValue: "folder-controlled-dotenc",
			}),
		}))
		expect(resolved).toBe("custom-dotenc")
	})

	test("ignores workspace values for machine-scoped settings", () => {
		const configuration = {
			inspect: () => ({
				defaultValue: "safe-default",
				workspaceValue: "workspace-value",
				workspaceFolderValue: "folder-value",
			}),
		}

		expect(
			getMachineScopedConfigurationValue(
				configuration,
				"setting",
				"fallback",
			),
		).toBe("safe-default")
	})

	test("keeps auto-view enabled by default without workspace overrides", () => {
		const enabled = isAutoViewDecryptedEnabled(() => ({
			inspect: () => ({
				defaultValue: true,
				workspaceValue: false,
				workspaceFolderValue: false,
			}),
		}))
		const globallyDisabled = isAutoViewDecryptedEnabled(() => ({
			inspect: () => ({
				defaultValue: true,
				globalValue: false,
				workspaceValue: true,
			}),
		}))

		expect(enabled).toBe(true)
		expect(globallyDisabled).toBe(false)
	})

	test("declares machine-only settings and disables untrusted workspaces", () => {
		const properties = packageJson.contributes.configuration.properties
		expect(properties["dotenc.autoViewDecrypted"].default).toBe(true)
		expect(properties["dotenc.autoViewDecrypted"].scope).toBe("machine")
		expect(properties["dotenc.executablePath"].scope).toBe("machine")
		expect(packageJson.capabilities.untrustedWorkspaces.supported).toBe(false)
	})

	test("runProcess returns error when executable is blank", async () => {
		const result = await runProcess("   ", process.cwd(), ["--version"])
		expect(result.code).toBe(1)
		expect(result.error).toBeInstanceOf(Error)
		expect(result.error?.message).toContain("empty")
	})

	test("runProcess executes command and forwards stdin input", async () => {
		const result = await runProcess(
			process.execPath,
			process.cwd(),
			["-e", "process.stdin.pipe(process.stdout)"],
			"hello-dotenc",
		)

		expect(result.code).toBe(0)
		expect(result.error).toBeUndefined()
		expect(result.stdout).toBe("hello-dotenc")
	})
})
