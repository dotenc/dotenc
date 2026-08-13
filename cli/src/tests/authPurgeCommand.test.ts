import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as realFs from "node:fs"
import * as realFsPromises from "node:fs/promises"
import path from "node:path"
import type { EnvFile } from "../helpers/findEnvironmentsRecursive"

const CWD = "/tmp/dotenc-purge-test"
const ROOT = CWD // in flat-project tests, cwd = projectRoot

const makeEnvFile = (name: string, dir = ROOT): EnvFile => ({
	name,
	dir,
	filePath: path.join(dir, `.env.${name}.enc`),
})

const findEnvironmentsRecursive = mock(async (_dir: string) => [
	makeEnvFile("staging"),
	makeEnvFile("production"),
])
const getEnvironmentByPath = mock(async (_filePath: string) => ({
	keys: [{ name: "bob" }, { name: "alice" }],
}))
const decryptEnvironmentData = mock(
	async (_name?: string, _env?: unknown, _context?: unknown) => "SECRET=1",
)
const disposeDecryptionContext = mock(() => {})
const decryptionContext = { dispose: disposeDecryptionContext }
const createDecryptEnvironmentDataContext = mock(() => decryptionContext)
const encryptEnvironment = mock(
	async (_name: string, _content: string, _options?: object) => {},
)
const resolveProjectRoot = mock((_dir: string, _existsSync: unknown) => ROOT)
const validateKeyName = mock((name: string) =>
	name.startsWith("../")
		? { valid: false as const, reason: "invalid key name" }
		: { valid: true as const },
)
const confirmPrompt = mock(async (_msg: string) => true)
const existsSync = mock((_p: string) => true)
const fsUnlink = mock(async (_filePath: string) => {})

mock.module("../helpers/findEnvironmentsRecursive", () => ({
	findEnvironmentsRecursive,
}))
mock.module("../helpers/getEnvironmentByPath", () => ({ getEnvironmentByPath }))
mock.module("../helpers/decryptEnvironment", () => ({
	createDecryptEnvironmentDataContext,
	decryptEnvironmentData,
	decryptEnvironment: decryptEnvironmentData,
}))
mock.module("../helpers/encryptEnvironment", () => ({ encryptEnvironment }))
mock.module("../helpers/resolveProjectRoot", () => ({ resolveProjectRoot }))
mock.module("../helpers/validateKeyName", () => ({ validateKeyName }))
mock.module("../prompts/confirm", () => ({ confirmPrompt }))
mock.module("node:fs", () => ({ ...realFs, existsSync }))
mock.module("node:fs/promises", () => ({
	...realFsPromises,
	default: { ...realFsPromises, unlink: fsUnlink },
}))

const { authPurgeCommand } = await import("../commands/auth/purge")

describe("authPurgeCommand", () => {
	beforeEach(() => {
		findEnvironmentsRecursive.mockClear()
		getEnvironmentByPath.mockClear()
		decryptEnvironmentData.mockClear()
		createDecryptEnvironmentDataContext.mockClear()
		disposeDecryptionContext.mockClear()
		encryptEnvironment.mockClear()
		resolveProjectRoot.mockClear()
		validateKeyName.mockClear()
		confirmPrompt.mockClear()
		existsSync.mockClear()
		fsUnlink.mockClear()
	})

	test("rejects invalid key names", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(CWD)
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(authPurgeCommand("../evil", false)).rejects.toThrow("exit(1)")

		expect(exitSpy).toHaveBeenCalledWith(1)
		expect(String(logErrorSpy.mock.calls[0]?.[0])).toContain("invalid key name")
		logErrorSpy.mockRestore()
		exitSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("exits when key file does not exist", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(CWD)
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})
		resolveProjectRoot.mockImplementation(() => ROOT)
		existsSync.mockImplementation(() => false)

		await expect(authPurgeCommand("bob", false)).rejects.toThrow("exit(1)")

		expect(exitSpy).toHaveBeenCalledWith(1)
		expect(String(logErrorSpy.mock.calls[0]?.[0])).toContain("not found")
		logErrorSpy.mockRestore()
		exitSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("proceeds with no environments — just removes key file", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(CWD)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		existsSync.mockImplementation(() => true)
		findEnvironmentsRecursive.mockImplementation(async () => [])

		await authPurgeCommand("bob", true)

		expect(fsUnlink).toHaveBeenCalledWith(path.join(ROOT, ".dotenc", "bob.pub"))
		const logged = logSpy.mock.calls.map((c) => String(c[0]))
		expect(logged.some((m) => m.includes("Offboarding complete"))).toBe(true)
		logSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("revokes and rotates all affected environments, then removes key", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(CWD)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		existsSync.mockImplementation(() => true)
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging"),
			makeEnvFile("production"),
		])
		getEnvironmentByPath.mockImplementation(async () => ({
			keys: [{ name: "bob" }, { name: "alice" }],
		}))
		decryptEnvironmentData.mockImplementation(async () => "SECRET=1")
		encryptEnvironment.mockImplementation(async () => {})

		await authPurgeCommand("bob", true)

		expect(decryptEnvironmentData).toHaveBeenCalledTimes(2)
		expect(decryptEnvironmentData.mock.calls[0][2]).toBe(decryptionContext)
		expect(decryptEnvironmentData.mock.calls[1][2]).toBe(decryptionContext)
		expect(disposeDecryptionContext).toHaveBeenCalledTimes(1)
		expect(encryptEnvironment).toHaveBeenCalledTimes(2)
		expect(fsUnlink).toHaveBeenCalledWith(path.join(ROOT, ".dotenc", "bob.pub"))
		logSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("skips environments with per-file errors and reports failures in summary", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(CWD)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		existsSync.mockImplementation(() => true)
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging"),
			makeEnvFile("production"),
		])
		getEnvironmentByPath.mockImplementation(async () => ({
			keys: [{ name: "bob" }, { name: "alice" }],
		}))
		decryptEnvironmentData.mockImplementation(async () => {
			throw new Error("decrypt failed")
		})

		await authPurgeCommand("bob", true)

		// Key still deleted (best-effort)
		expect(fsUnlink).toHaveBeenCalledTimes(1)

		// Summary mentions failure
		const allLogged = [
			...logSpy.mock.calls.map((c) => String(c[0])),
			...logErrorSpy.mock.calls.map((c) => String(c[0])),
		]
		expect(
			allLogged.some((m) => m.includes("failed") || m.includes("staging")),
		).toBe(true)
		logSpy.mockRestore()
		logErrorSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("treats environment with zero remaining recipients as a file-level error", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(CWD)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		existsSync.mockImplementation(() => true)
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging"),
			makeEnvFile("production"),
		])
		getEnvironmentByPath.mockImplementation(async () => ({
			keys: [{ name: "bob" }], // bob is the only key
		}))
		encryptEnvironment.mockImplementation(async () => {})

		await authPurgeCommand("bob", true)

		// Should not encrypt (skipped)
		expect(encryptEnvironment).not.toHaveBeenCalled()

		const logged = logSpy.mock.calls.map((c) => String(c[0]))
		expect(
			logged.some((m) => m.includes("skipped") || m.includes("zero recipient")),
		).toBe(true)
		logSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("aborts when user declines confirmation", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(CWD)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		existsSync.mockImplementation(() => true)
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging"),
			makeEnvFile("production"),
		])
		getEnvironmentByPath.mockImplementation(async () => ({
			keys: [{ name: "bob" }, { name: "alice" }],
		}))
		confirmPrompt.mockImplementation(async () => false)

		await authPurgeCommand("bob", false)

		expect(confirmPrompt).toHaveBeenCalledTimes(1)
		expect(fsUnlink).not.toHaveBeenCalled()
		logSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("skips confirmation when yes=true", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(CWD)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		existsSync.mockImplementation(() => true)
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging"),
			makeEnvFile("production"),
		])
		getEnvironmentByPath.mockImplementation(async () => ({
			keys: [{ name: "bob" }, { name: "alice" }],
		}))
		decryptEnvironmentData.mockImplementation(async () => "SECRET=1")
		encryptEnvironment.mockImplementation(async () => {})
		confirmPrompt.mockImplementation(async () => true)

		await authPurgeCommand("bob", true)

		expect(confirmPrompt).not.toHaveBeenCalled()
		logSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("removes key file even when some environments fail (best-effort)", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(CWD)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		existsSync.mockImplementation(() => true)
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging"),
			makeEnvFile("production"),
		])
		getEnvironmentByPath.mockImplementation(async () => ({
			keys: [{ name: "bob" }, { name: "alice" }],
		}))
		decryptEnvironmentData.mockImplementation(async () => "SECRET=1")
		encryptEnvironment.mockImplementation(async () => {
			throw new Error("encrypt failed")
		})

		await authPurgeCommand("bob", true)

		expect(fsUnlink).toHaveBeenCalledWith(path.join(ROOT, ".dotenc", "bob.pub"))
		logSpy.mockRestore()
		logErrorSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("recursively discovers env files in subdirectories", async () => {
		const subdir = path.join(ROOT, "packages", "web")
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(CWD)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		existsSync.mockImplementation(() => true)
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging", ROOT),
			makeEnvFile("staging", subdir),
		])
		getEnvironmentByPath.mockImplementation(async () => ({
			keys: [{ name: "bob" }, { name: "alice" }],
		}))
		decryptEnvironmentData.mockImplementation(async () => "SECRET=1")
		encryptEnvironment.mockImplementation(async () => {})

		await authPurgeCommand("bob", true)

		// Both staging envs (root + subdir) should be processed
		expect(decryptEnvironmentData).toHaveBeenCalledTimes(2)
		expect(encryptEnvironment).toHaveBeenCalledTimes(2)
		expect(fsUnlink).toHaveBeenCalledWith(path.join(ROOT, ".dotenc", "bob.pub"))
		logSpy.mockRestore()
		cwdSpy.mockRestore()
	})
})
