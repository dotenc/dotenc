import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

const getHomeConfig = mock(
	async () => ({}) as Record<string, string | undefined>,
)
const setHomeConfig = mock(async (_config: object) => {})

mock.module("../helpers/homeConfig", () => ({
	getHomeConfig,
	setHomeConfig,
}))

const { configCommand } = await import("../commands/config")

describe("configCommand", () => {
	beforeEach(() => {
		getHomeConfig.mockClear()
		setHomeConfig.mockClear()
	})

	test("sets supported config key", async () => {
		getHomeConfig.mockImplementation(async () => ({}))

		await configCommand("editor", "vim", { remove: false })

		expect(setHomeConfig).toHaveBeenCalledTimes(1)
		expect(setHomeConfig).toHaveBeenCalledWith({ editor: "vim" })
	})

	test("rejects shell metacharacters when setting an editor", async () => {
		getHomeConfig.mockImplementation(async () => ({}))
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			configCommand("editor", "vim; run-payload", { remove: false }),
		).rejects.toThrow("exit(1)")

		expect(setHomeConfig).not.toHaveBeenCalled()
		expect(logErrorSpy.mock.calls.flat().join(" ")).toContain(
			"shell metacharacters",
		)
		expect(exitSpy).toHaveBeenCalledWith(1)
		logErrorSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("reads supported config key", async () => {
		getHomeConfig.mockImplementation(async () => ({ editor: "nano" }))
		const logSpy = spyOn(console, "log").mockImplementation(() => {})

		await configCommand("editor", undefined, { remove: false })

		expect(logSpy).toHaveBeenCalledWith("nano")
		logSpy.mockRestore()
	})

	test("removes supported config key", async () => {
		getHomeConfig.mockImplementation(async () => ({ editor: "code" }))

		await configCommand("editor", undefined, { remove: true })

		expect(setHomeConfig).toHaveBeenCalledWith({})
	})

	test("rejects unsupported config keys", async () => {
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			configCommand("unknown", "value", { remove: false }),
		).rejects.toThrow("exit(1)")

		expect(logErrorSpy).toHaveBeenCalledTimes(1)
		expect(String(logErrorSpy.mock.calls[0][0])).toContain(
			'unsupported config key "unknown"',
		)
		expect(exitSpy).toHaveBeenCalledWith(1)
		logErrorSpy.mockRestore()
		exitSpy.mockRestore()
	})
})
