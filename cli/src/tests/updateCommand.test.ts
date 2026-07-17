import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EventEmitter } from "node:events"

const detectInstallMethodMock = mock(
	() => "homebrew" as "homebrew" | "scoop" | "npm" | "binary" | "unknown",
)
const spawnMock = mock(() => {
	throw new Error("spawn should not be called")
})

mock.module("../helpers/update", () => ({
	detectInstallMethod: detectInstallMethodMock,
	GITHUB_RELEASES_URL: "https://github.com/dotenc/dotenc/releases",
}))
mock.module("node:child_process", () => ({ spawn: spawnMock }))

const { updateCommand } = await import("../commands/update")

const makeSpawn = (exitCode: number) => {
	const child = new EventEmitter()
	queueMicrotask(() => child.emit("exit", exitCode))
	return child as never
}

beforeEach(() => {
	detectInstallMethodMock.mockClear()
	spawnMock.mockClear()
	detectInstallMethodMock.mockImplementation(() => "homebrew")
	spawnMock.mockImplementation(() => {
		throw new Error("spawn should not be called")
	})
})

describe("updateCommand", () => {
	test("runs brew update then brew upgrade when Homebrew install is detected", async () => {
		detectInstallMethodMock.mockReturnValue("homebrew")

		let callCount = 0
		spawnMock.mockImplementation(() => {
			callCount++
			return makeSpawn(0)
		})

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await updateCommand()

		expect(callCount).toBe(2)
		expect(spawnMock).toHaveBeenNthCalledWith(
			1,
			"brew",
			["update"],
			expect.any(Object),
		)
		expect(spawnMock).toHaveBeenNthCalledWith(
			2,
			"brew",
			["upgrade", "dotenc"],
			expect.any(Object),
		)
		logSpy.mockRestore()
	})

	test("exits when brew update fails before running brew upgrade", async () => {
		detectInstallMethodMock.mockReturnValue("homebrew")

		let callCount = 0
		spawnMock.mockImplementation(() => {
			callCount++
			return makeSpawn(1)
		})

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(updateCommand()).rejects.toThrow("exit(1)")

		expect(callCount).toBe(1)
		errSpy.mockRestore()
		logSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("runs scoop update when Scoop install is detected", async () => {
		detectInstallMethodMock.mockReturnValue("scoop")
		spawnMock.mockImplementation(() => makeSpawn(0))

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await updateCommand()

		expect(spawnMock).toHaveBeenCalledWith(
			"scoop",
			["update", "dotenc"],
			expect.any(Object),
		)
		logSpy.mockRestore()
	})

	test("runs npm install -g when npm install is detected", async () => {
		detectInstallMethodMock.mockReturnValue("npm")
		spawnMock.mockImplementation(() => makeSpawn(0))

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await updateCommand()

		expect(spawnMock).toHaveBeenCalledWith(
			"npm",
			["install", "-g", "@dotenc/cli"],
			expect.any(Object),
		)
		logSpy.mockRestore()
	})

	test("prints release URL for standalone binary", async () => {
		detectInstallMethodMock.mockReturnValue("binary")

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await updateCommand()

		expect(spawnMock).not.toHaveBeenCalled()
		expect(
			logSpy.mock.calls.some((call) => String(call[0]).includes("releases")),
		).toBe(true)
		logSpy.mockRestore()
	})

	test("prints manual commands when install method is unknown", async () => {
		detectInstallMethodMock.mockReturnValue("unknown")

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await updateCommand()

		expect(spawnMock).not.toHaveBeenCalled()
		expect(
			logSpy.mock.calls.some((call) =>
				String(call[0]).includes("Could not determine installation method"),
			),
		).toBe(true)
		expect(
			logSpy.mock.calls.some((call) =>
				String(call[0]).includes("npm install -g @dotenc/cli"),
			),
		).toBe(true)
		expect(
			logSpy.mock.calls.some((call) =>
				String(call[0]).includes("brew update && brew upgrade dotenc"),
			),
		).toBe(true)
		logSpy.mockRestore()
	})

	test("exits with command code when updater exits non-zero", async () => {
		detectInstallMethodMock.mockReturnValue("npm")
		spawnMock.mockImplementation(() => makeSpawn(2))

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(updateCommand()).rejects.toThrow("exit(2)")
		errSpy.mockRestore()
		logSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("exits with code 1 when updater command throws", async () => {
		detectInstallMethodMock.mockReturnValue("homebrew")

		let callCount = 0
		spawnMock.mockImplementation(() => {
			callCount++
			if (callCount === 1) {
				// brew update — succeed so we get to upgrade
				return makeSpawn(0)
			}
			throw new Error("spawn ENOENT")
		})

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(updateCommand()).rejects.toThrow("exit(1)")

		expect(
			errSpy.mock.calls.some((call) =>
				String(call[0]).includes("failed to run"),
			),
		).toBe(true)
		expect(
			errSpy.mock.calls.some((call) => String(call[0]).includes("ENOENT")),
		).toBe(true)
		errSpy.mockRestore()
		logSpy.mockRestore()
		exitSpy.mockRestore()
	})
})
