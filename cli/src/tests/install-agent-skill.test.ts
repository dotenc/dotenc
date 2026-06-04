import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EventEmitter } from "node:events"
import { logger } from "../ui/logger"

const spawnMock = mock(() => {
	throw new Error("spawn not expected")
})
const promptSelectMock = mock(async () => "local" as "local" | "global")

mock.module("node:child_process", () => ({ spawn: spawnMock }))
mock.module("../ui/prompts", () => ({ promptSelect: promptSelectMock }))

const { installAgentSkillCommand, _runNpx } = await import(
	"../commands/tools/install-agent-skill"
)

const makeSpawn = (exitCode: number) => {
	const child = new EventEmitter()
	queueMicrotask(() => child.emit("exit", exitCode))
	return child as never
}

beforeEach(() => {
	spawnMock.mockClear()
	promptSelectMock.mockClear()
	promptSelectMock.mockImplementation(async () => "local")
	spawnMock.mockImplementation(() => {
		throw new Error("spawn not expected")
	})
})

describe("installAgentSkillCommand", () => {
	test("runs npx skills add for local installation", async () => {
		spawnMock.mockImplementation(() => makeSpawn(0))

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await installAgentSkillCommand({})

		expect(spawnMock).toHaveBeenCalledWith(
			"npx",
			["skills", "add", "ivanfilhoz/dotenc", "--skill", "dotenc"],
			expect.any(Object),
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
			"npx",
			["skills", "add", "ivanfilhoz/dotenc", "--skill", "dotenc", "-g"],
			expect.any(Object),
		)
		logSpy.mockRestore()
	})

	test("adds -y when --force is used", async () => {
		spawnMock.mockImplementation(() => makeSpawn(0))

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await installAgentSkillCommand({ force: true })

		expect(spawnMock).toHaveBeenCalledWith(
			"npx",
			["skills", "add", "ivanfilhoz/dotenc", "--skill", "dotenc", "-y"],
			expect.any(Object),
		)
		logSpy.mockRestore()
	})

	test("defaults to local scope in non-interactive mode", async () => {
		promptSelectMock.mockImplementation(async () => {
			throw new Error(
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
			"npx",
			["skills", "add", "ivanfilhoz/dotenc", "--skill", "dotenc"],
			expect.any(Object),
		)
		expect(infoSpy).toHaveBeenCalledWith(
			expect.stringContaining("Defaulting to"),
		)
		infoSpy.mockRestore()
		logSpy.mockRestore()
	})

	test("exits with updater exit code when npx returns non-zero", async () => {
		spawnMock.mockImplementation(() => makeSpawn(7))

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(installAgentSkillCommand({})).rejects.toThrow("exit(7)")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("exits with code 1 when npx command cannot be started", async () => {
		spawnMock.mockImplementation(() => {
			throw new Error("spawn ENOENT")
		})

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(installAgentSkillCommand({})).rejects.toThrow("exit(1)")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})
})

describe("_runNpx", () => {
	test("resolves with exit code when npx exits successfully", async () => {
		const child = new EventEmitter()
		const spawnImpl = mock(() => {
			queueMicrotask(() => child.emit("exit", 0))
			return child as never
		})

		const result = await _runNpx(["--version"], spawnImpl as never)
		expect(result).toBe(0)
		expect(spawnImpl).toHaveBeenCalled()
	})

	test("rejects when npx process emits an error", async () => {
		const child = new EventEmitter()
		const spawnImpl = mock(() => {
			queueMicrotask(() => child.emit("error", new Error("spawn ENOENT")))
			return child as never
		})

		await expect(
			_runNpx(["skills", "add"], spawnImpl as never),
		).rejects.toThrow("spawn ENOENT")
	})
})
