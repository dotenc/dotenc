import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EventEmitter } from "node:events"
import { logger } from "../ui/logger"

const spawnMock = mock(() => {
	throw new Error("spawn not expected")
})
const promptSelectMock = mock(async () => "local" as "local" | "global")
class MockNonInteractivePromptError extends Error {}

mock.module("node:child_process", () => ({ spawn: spawnMock }))
mock.module("../ui/prompts", () => ({
	NonInteractivePromptError: MockNonInteractivePromptError,
	promptSelect: promptSelectMock,
}))

const { _installAgentSkillCommand, _runBunX } = await import(
	"../commands/tools/install-agent-skill"
)

const ORIGINAL_ENV = {
	PATH: "C:\\trusted-bin",
	PATHEXT: ".EXE;.CMD",
}
const RESOLVED_BUN = "C:\\trusted-bin\\bun.exe"
const resolveExecutableMock = mock(
	(_command: string, _originalEnv?: NodeJS.ProcessEnv): string | undefined =>
		RESOLVED_BUN,
)
const installAgentSkillCommand = (
	options: Parameters<typeof _installAgentSkillCommand>[0],
	dependencyOverrides: Parameters<typeof _installAgentSkillCommand>[1] = {},
) =>
	_installAgentSkillCommand(options, {
		originalEnv: ORIGINAL_ENV,
		resolveExecutable: resolveExecutableMock,
		...dependencyOverrides,
	})

const IMMUTABLE_SKILL_SOURCE =
	"https://github.com/dotenc/skills/archive/dc3245191988923fced07c63b31df8184a1d1853.tar.gz"

const makeSpawn = (exitCode: number) => {
	const child = new EventEmitter()
	queueMicrotask(() => child.emit("exit", exitCode))
	return child as never
}

beforeEach(() => {
	spawnMock.mockClear()
	promptSelectMock.mockClear()
	resolveExecutableMock.mockClear()
	promptSelectMock.mockImplementation(async () => "local")
	resolveExecutableMock.mockImplementation(() => RESOLVED_BUN)
	spawnMock.mockImplementation(() => {
		throw new Error("spawn not expected")
	})
})

describe("installAgentSkillCommand", () => {
	test("resolves Bun before running its package runner with an immutable source", async () => {
		spawnMock.mockImplementation(() => makeSpawn(0))

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await installAgentSkillCommand({})

		expect(resolveExecutableMock).toHaveBeenCalledWith("bun", ORIGINAL_ENV)
		expect(spawnMock).toHaveBeenCalledWith(
			RESOLVED_BUN,
			[
				"x",
				"skills@1.5.22",
				"add",
				IMMUTABLE_SKILL_SOURCE,
				"--skill",
				"dotenc",
			],
			{ stdio: "inherit", shell: false },
		)
		expect(
			logSpy.mock.calls.some((call) => String(call[0]).includes("/dotenc")),
		).toBe(true)
		logSpy.mockRestore()
	})

	test("adds -g for global installation", async () => {
		promptSelectMock.mockImplementation(async () => "global")
		spawnMock.mockImplementation(() => makeSpawn(0))

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await installAgentSkillCommand({})

		expect(spawnMock).toHaveBeenCalledWith(
			RESOLVED_BUN,
			[
				"x",
				"skills@1.5.22",
				"add",
				IMMUTABLE_SKILL_SOURCE,
				"--skill",
				"dotenc",
				"-g",
			],
			{ stdio: "inherit", shell: false },
		)
		logSpy.mockRestore()
	})

	test("adds -y when --force is used", async () => {
		spawnMock.mockImplementation(() => makeSpawn(0))

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await installAgentSkillCommand({ force: true })

		expect(spawnMock).toHaveBeenCalledWith(
			RESOLVED_BUN,
			[
				"x",
				"skills@1.5.22",
				"add",
				IMMUTABLE_SKILL_SOURCE,
				"--skill",
				"dotenc",
				"-y",
			],
			{ stdio: "inherit", shell: false },
		)
		logSpy.mockRestore()
	})

	test("defaults to local scope in non-interactive mode", async () => {
		promptSelectMock.mockImplementation(async () => {
			throw new MockNonInteractivePromptError(
				"Install scope prompt is unavailable in non-interactive mode.",
			)
		})
		spawnMock.mockImplementation(() => makeSpawn(0))

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const infoSpy = spyOn(logger, "info").mockImplementation(
			(() => {}) as never,
		)
		await installAgentSkillCommand({})

		expect(promptSelectMock).toHaveBeenCalledTimes(1)
		expect(spawnMock).toHaveBeenCalledWith(
			RESOLVED_BUN,
			[
				"x",
				"skills@1.5.22",
				"add",
				IMMUTABLE_SKILL_SOURCE,
				"--skill",
				"dotenc",
			],
			{ stdio: "inherit", shell: false },
		)
		expect(infoSpy).toHaveBeenCalledWith(
			expect.stringContaining("Defaulting to"),
		)
		infoSpy.mockRestore()
		logSpy.mockRestore()
	})

	test("rethrows prompt errors instead of matching non-interactive text", async () => {
		promptSelectMock.mockImplementation(async () => {
			throw new Error(
				"Install scope prompt is unavailable in non-interactive mode.",
			)
		})

		await expect(installAgentSkillCommand({})).rejects.toThrow(
			"Install scope prompt is unavailable in non-interactive mode.",
		)
		expect(spawnMock).not.toHaveBeenCalled()
	})

	test("exits with runner exit code when bun x returns non-zero", async () => {
		spawnMock.mockImplementation(() => makeSpawn(7))

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(installAgentSkillCommand({})).rejects.toThrow("exit(7)")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("fails before prompting or spawning when Bun is absent from a Windows PATH", async () => {
		resolveExecutableMock.mockImplementation(() => undefined)

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(installAgentSkillCommand({})).rejects.toThrow("exit(1)")
		const output = errSpy.mock.calls.flat().join("\n")
		expect(resolveExecutableMock).toHaveBeenCalledWith("bun", ORIGINAL_ENV)
		expect(promptSelectMock).not.toHaveBeenCalled()
		expect(spawnMock).not.toHaveBeenCalled()
		expect(output).toContain("bun was not found on PATH")
		expect(output).toContain("standalone dotenc binaries do not bundle Bun")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("redacts unexpected Bun runner startup errors", async () => {
		spawnMock.mockImplementation(() => {
			throw new Error("sensitive operating system error")
		})

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(installAgentSkillCommand({})).rejects.toThrow("exit(1)")
		const output = errSpy.mock.calls.flat().join("\n")
		expect(output).toContain("Bun's package runner could not be started")
		expect(output).not.toContain("sensitive operating system error")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})
})

describe("_runBunX", () => {
	test("directly spawns the resolved Bun executable with x", async () => {
		const child = new EventEmitter()
		const spawnImpl = mock(() => {
			queueMicrotask(() => child.emit("exit", 0))
			return child as never
		})

		const result = await _runBunX(
			RESOLVED_BUN,
			["--version"],
			spawnImpl as never,
		)
		expect(result).toBe(0)
		expect(spawnImpl).toHaveBeenCalledWith(RESOLVED_BUN, ["x", "--version"], {
			stdio: "inherit",
			shell: false,
		})
	})

	test("rejects when the Bun process emits an error", async () => {
		const child = new EventEmitter()
		const spawnImpl = mock(() => {
			queueMicrotask(() => child.emit("error", new Error("spawn ENOENT")))
			return child as never
		})

		await expect(
			_runBunX(RESOLVED_BUN, ["skills", "add"], spawnImpl as never),
		).rejects.toThrow("spawn ENOENT")
	})
})
