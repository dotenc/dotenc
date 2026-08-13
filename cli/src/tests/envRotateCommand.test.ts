import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as realFs from "node:fs"
import path from "node:path"
import type { EnvFile } from "../helpers/findEnvironmentsRecursive"

const ROOT = "/workspace"

const makeEnvFile = (name: string, dir = ROOT): EnvFile => ({
	name,
	dir,
	filePath: path.join(dir, `.env.${name}.enc`),
})

const chooseEnvironmentPrompt = mock(async (_msg: string) => "production")
const confirmPrompt = mock(async (_msg: string) => true)
const decryptEnvironmentData = mock(
	async (_name?: string, _env?: unknown, _context?: unknown) => "A=1",
)
const disposeDecryptionContext = mock(() => {})
const decryptionContext = { dispose: disposeDecryptionContext }
const createDecryptEnvironmentDataContext = mock(() => decryptionContext)
const encryptEnvironment = mock(
	async (_name: string, _content: string, _options?: object) => {},
)
const findEnvironmentsRecursive = mock(async (_dir: string) => [
	makeEnvFile("staging"),
	makeEnvFile("production"),
])
const getEnvironmentByPath = mock(async (_filePath: string) => ({
	version: 2 as const,
	keys: [],
	encryptedContent: "",
}))
const validateEnvironmentName = mock((name: string) =>
	name === "invalid"
		? { valid: false as const, reason: "invalid environment" }
		: { valid: true as const },
)
const resolveProjectRoot = mock((_dir: string, _existsSync: unknown) => ROOT)
const existsSync = mock((_p: string) => true)

mock.module("../prompts/chooseEnvironment", () => ({ chooseEnvironmentPrompt }))
mock.module("../prompts/confirm", () => ({ confirmPrompt }))
mock.module("../helpers/decryptEnvironment", () => ({
	createDecryptEnvironmentDataContext,
	decryptEnvironmentData,
	decryptEnvironment: decryptEnvironmentData,
}))
mock.module("../helpers/encryptEnvironment", () => ({ encryptEnvironment }))
mock.module("../helpers/findEnvironmentsRecursive", () => ({
	findEnvironmentsRecursive,
}))
mock.module("../helpers/getEnvironmentByPath", () => ({ getEnvironmentByPath }))
mock.module("../helpers/validateEnvironmentName", () => ({
	validateEnvironmentName,
}))
mock.module("../helpers/resolveProjectRoot", () => ({ resolveProjectRoot }))
mock.module("node:fs", () => ({ ...realFs, existsSync }))

const { rotateCommand } = await import("../commands/env/rotate")

describe("rotateCommand (single)", () => {
	beforeEach(() => {
		chooseEnvironmentPrompt.mockClear()
		confirmPrompt.mockClear()
		decryptEnvironmentData.mockClear()
		createDecryptEnvironmentDataContext.mockClear()
		disposeDecryptionContext.mockClear()
		encryptEnvironment.mockClear()
		findEnvironmentsRecursive.mockClear()
		getEnvironmentByPath.mockClear()
		validateEnvironmentName.mockClear()
		resolveProjectRoot.mockClear()
		existsSync.mockClear()
	})

	test("prompts for missing environment and rotates data key", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		existsSync.mockImplementation(() => true)
		chooseEnvironmentPrompt.mockImplementation(async () => "production")
		getEnvironmentByPath.mockImplementation(async () => ({
			version: 2 as const,
			keys: [],
			encryptedContent: "",
		}))
		decryptEnvironmentData.mockImplementation(async () => "A=1")
		encryptEnvironment.mockImplementation(async () => {})

		await rotateCommand("", false, false)

		expect(chooseEnvironmentPrompt).toHaveBeenCalledTimes(1)
		expect(decryptEnvironmentData).toHaveBeenCalledTimes(1)
		expect(encryptEnvironment).toHaveBeenCalledTimes(1)
		expect(String(logSpy.mock.calls[0]?.[0])).toContain(
			"Data key for production",
		)
		logSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("rotates the environment in cwd", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		existsSync.mockImplementation(() => true)
		getEnvironmentByPath.mockImplementation(async () => ({
			version: 2 as const,
			keys: [],
			encryptedContent: "",
		}))
		decryptEnvironmentData.mockImplementation(async () => "A=1")
		encryptEnvironment.mockImplementation(async () => {})

		await rotateCommand("production", false, false)

		expect(encryptEnvironment).toHaveBeenCalledWith("production", "A=1", {
			baseDir: ROOT,
		})
		logSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("exits on invalid environment name", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(rotateCommand("invalid", false, false)).rejects.toThrow(
			"exit(1)",
		)

		expect(exitSpy).toHaveBeenCalledWith(1)
		expect(decryptEnvironmentData).not.toHaveBeenCalled()
		expect(String(logErrorSpy.mock.calls[0]?.[0])).toContain(
			"invalid environment",
		)
		logErrorSpy.mockRestore()
		exitSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("exits when environment file not found", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})
		existsSync.mockImplementation(() => false)

		await expect(rotateCommand("production", false, false)).rejects.toThrow(
			"exit(1)",
		)

		expect(exitSpy).toHaveBeenCalledWith(1)
		expect(String(logErrorSpy.mock.calls[0]?.[0])).toContain("not found")
		logErrorSpy.mockRestore()
		exitSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("exits when decryption fails", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})
		existsSync.mockImplementation(() => true)
		getEnvironmentByPath.mockImplementation(async () => ({
			version: 2 as const,
			keys: [],
			encryptedContent: "",
		}))
		decryptEnvironmentData.mockImplementation(async () => {
			throw new Error("decrypt failed")
		})

		await expect(rotateCommand("production", false, false)).rejects.toThrow(
			"exit(1)",
		)

		expect(exitSpy).toHaveBeenCalledWith(1)
		expect(logErrorSpy).toHaveBeenCalledWith("decrypt failed")
		logErrorSpy.mockRestore()
		exitSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("exits when encryption fails", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})
		existsSync.mockImplementation(() => true)
		getEnvironmentByPath.mockImplementation(async () => ({
			version: 2 as const,
			keys: [],
			encryptedContent: "",
		}))
		decryptEnvironmentData.mockImplementation(async () => "A=1")
		encryptEnvironment.mockImplementation(async () => {
			throw new Error("encrypt failed")
		})

		await expect(rotateCommand("production", false, false)).rejects.toThrow(
			"exit(1)",
		)

		expect(exitSpy).toHaveBeenCalledWith(1)
		expect(logErrorSpy).toHaveBeenCalledWith("encrypt failed")
		logErrorSpy.mockRestore()
		exitSpy.mockRestore()
		cwdSpy.mockRestore()
	})
})

describe("rotateCommand --all", () => {
	beforeEach(() => {
		chooseEnvironmentPrompt.mockClear()
		confirmPrompt.mockClear()
		decryptEnvironmentData.mockClear()
		createDecryptEnvironmentDataContext.mockClear()
		disposeDecryptionContext.mockClear()
		encryptEnvironment.mockClear()
		findEnvironmentsRecursive.mockClear()
		getEnvironmentByPath.mockClear()
		validateEnvironmentName.mockClear()
		resolveProjectRoot.mockClear()
		existsSync.mockClear()
	})

	test("prints 'No environments found' when list is empty", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		findEnvironmentsRecursive.mockImplementation(async () => [])

		await rotateCommand("", true, true)

		expect(decryptEnvironmentData).not.toHaveBeenCalled()
		const logged = logSpy.mock.calls.map((c) => String(c[0]))
		expect(logged.some((m) => m.includes("No environments found"))).toBe(true)
		logSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("rotates all environments when yes=true", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging"),
			makeEnvFile("production"),
		])
		getEnvironmentByPath.mockImplementation(async () => ({
			version: 2 as const,
			keys: [],
			encryptedContent: "",
		}))
		decryptEnvironmentData.mockImplementation(async () => "A=1")
		encryptEnvironment.mockImplementation(async () => {})

		await rotateCommand("", true, true)

		expect(decryptEnvironmentData).toHaveBeenCalledTimes(2)
		expect(decryptEnvironmentData.mock.calls[0][2]).toBe(decryptionContext)
		expect(decryptEnvironmentData.mock.calls[1][2]).toBe(decryptionContext)
		expect(disposeDecryptionContext).toHaveBeenCalledTimes(1)
		expect(encryptEnvironment).toHaveBeenCalledTimes(2)
		logSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("aborts when user declines", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging"),
			makeEnvFile("production"),
		])
		confirmPrompt.mockImplementation(async () => false)

		await rotateCommand("", true, false)

		expect(encryptEnvironment).not.toHaveBeenCalled()
		logSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("skips confirmation when yes=true", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging"),
			makeEnvFile("production"),
		])
		getEnvironmentByPath.mockImplementation(async () => ({
			version: 2 as const,
			keys: [],
			encryptedContent: "",
		}))
		decryptEnvironmentData.mockImplementation(async () => "A=1")
		encryptEnvironment.mockImplementation(async () => {})

		await rotateCommand("", true, true)

		expect(confirmPrompt).not.toHaveBeenCalled()
		logSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("reports per-file errors but continues (best-effort)", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging"),
			makeEnvFile("production"),
		])
		getEnvironmentByPath.mockImplementation(async () => ({
			version: 2 as const,
			keys: [],
			encryptedContent: "",
		}))
		decryptEnvironmentData.mockImplementation(async () => {
			throw new Error("decrypt failed")
		})

		await rotateCommand("", true, true)

		const errors = logErrorSpy.mock.calls.map((c) => String(c[0]))
		expect(errors.length).toBeGreaterThan(0)
		logSpy.mockRestore()
		logErrorSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("prints per-file success/failure summary", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging"),
			makeEnvFile("production"),
		])
		getEnvironmentByPath.mockImplementation(async () => ({
			version: 2 as const,
			keys: [],
			encryptedContent: "",
		}))
		decryptEnvironmentData.mockImplementation(async () => "A=1")
		encryptEnvironment.mockImplementation(async (_name: string) => {
			if (_name === "production") throw new Error("encrypt failed")
		})

		await rotateCommand("", true, true)

		const logged = logSpy.mock.calls.map((c) => String(c[0]))
		const errors = logErrorSpy.mock.calls.map((c) => String(c[0]))

		expect(logged.some((m) => m.includes("staging"))).toBe(true)
		expect(errors.some((m) => m.includes("production"))).toBe(true)
		logSpy.mockRestore()
		logErrorSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("recursively discovers and rotates nested env files", async () => {
		const subdir = path.join(ROOT, "packages", "web")
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging", ROOT),
			makeEnvFile("staging", subdir),
		])
		getEnvironmentByPath.mockImplementation(async () => ({
			version: 2 as const,
			keys: [],
			encryptedContent: "",
		}))
		decryptEnvironmentData.mockImplementation(async () => "A=1")
		encryptEnvironment.mockImplementation(async () => {})

		await rotateCommand("", true, true)

		expect(decryptEnvironmentData).toHaveBeenCalledTimes(2)
		expect(encryptEnvironment).toHaveBeenCalledTimes(2)
		logSpy.mockRestore()
		cwdSpy.mockRestore()
	})
})
