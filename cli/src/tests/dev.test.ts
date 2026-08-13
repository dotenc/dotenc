import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

const runCommandMock = mock(
	async (
		_command: string,
		_args: string[],
		_options: Record<string, unknown>,
	) => {},
)
const promptSelectMock = mock(async () => "bob")
const isInteractiveMock = mock(() => true)
const discoverPersonalProfilesMock = mock(async (_options?: unknown) => ({
	discovered: ["personal.alice"],
	accessible: ["personal.alice"],
}))
const dispose = mock(() => {})
const decryptionContext = { dispose }
const createDecryptEnvironmentDataContext = mock(() => decryptionContext)

mock.module("../helpers/decryptEnvironment", () => ({
	createDecryptEnvironmentDataContext,
}))
mock.module("../helpers/discoverPersonalProfiles", () => ({
	discoverPersonalProfiles: discoverPersonalProfilesMock,
	toPersonalEnvironmentName: (profile: string) => `personal.${profile}`,
}))
mock.module("../commands/run", () => ({ runCommand: runCommandMock }))
mock.module("../ui/prompts", () => ({ promptSelect: promptSelectMock }))
mock.module("../ui/tty", () => ({ isInteractive: isInteractiveMock }))

const { devCommand } = await import("../commands/dev")

beforeEach(() => {
	runCommandMock.mockClear()
	promptSelectMock.mockClear()
	isInteractiveMock.mockClear()
	discoverPersonalProfilesMock.mockClear()
	createDecryptEnvironmentDataContext.mockClear()
	dispose.mockClear()
	runCommandMock.mockImplementation(
		async (
			_command: string,
			_args: string[],
			_options: Record<string, unknown>,
		) => {},
	)
	promptSelectMock.mockImplementation(async () => "bob")
	isInteractiveMock.mockImplementation(() => true)
	discoverPersonalProfilesMock.mockImplementation(async () => ({
		discovered: ["personal.alice"],
		accessible: ["personal.alice"],
	}))
})

describe("devCommand", () => {
	test("auto-selects the only accessible personal profile", async () => {
		await devCommand("node", ["app.js"], {})

		expect(discoverPersonalProfilesMock).toHaveBeenCalledWith({
			invocationDir: process.cwd(),
			localOnly: undefined,
			decryptionContext,
		})
		expect(runCommandMock).toHaveBeenCalledWith("node", ["app.js"], {
			env: "development,personal.alice",
			localOnly: undefined,
			strict: undefined,
			allowProcessEnv: undefined,
			requiredEnvs: ["development"],
			decryptionContext,
		})
		expect(promptSelectMock).not.toHaveBeenCalled()
		expect(dispose).toHaveBeenCalledTimes(1)
	})

	test("runs development only when no personal profiles exist", async () => {
		discoverPersonalProfilesMock.mockImplementation(async () => ({
			discovered: [],
			accessible: [],
		}))

		await devCommand("node", ["app.js"], {})

		expect(runCommandMock.mock.calls[0][2]).toMatchObject({
			env: "development",
			requiredEnvs: ["development"],
		})
	})

	test("warns and runs development only when profiles are inaccessible", async () => {
		discoverPersonalProfilesMock.mockImplementation(async () => ({
			discovered: ["personal.alice"],
			accessible: [],
		}))
		const errSpy = spyOn(console, "error").mockImplementation(() => {})

		await devCommand("node", ["app.js"], {})

		expect(String(errSpy.mock.calls[0]?.[0])).toContain(
			"no accessible personal profiles",
		)
		expect(runCommandMock.mock.calls[0][2]).toMatchObject({
			env: "development",
		})
		errSpy.mockRestore()
	})

	test("strict mode fails when discovered profiles are inaccessible", async () => {
		discoverPersonalProfilesMock.mockImplementation(async () => ({
			discovered: ["personal.alice"],
			accessible: [],
		}))
		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			devCommand("node", ["app.js"], { strict: true }),
		).rejects.toThrow("exit(1)")
		expect(runCommandMock).not.toHaveBeenCalled()
		expect(dispose).toHaveBeenCalledTimes(1)
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("prompts when multiple personal profiles are accessible", async () => {
		discoverPersonalProfilesMock.mockImplementation(async () => ({
			discovered: ["personal.alice", "personal.bob"],
			accessible: ["personal.alice", "personal.bob"],
		}))

		await devCommand("node", ["app.js"], {})

		expect(promptSelectMock).toHaveBeenCalledWith(
			"Multiple personal profiles are accessible. Which one do you want to use?",
			{
				options: [
					{ label: "alice", value: "alice" },
					{ label: "bob", value: "bob" },
				],
			},
		)
		expect(runCommandMock.mock.calls[0][2]).toMatchObject({
			env: "development,personal.bob",
		})
	})

	test("requires --profile for multiple profiles without a TTY", async () => {
		discoverPersonalProfilesMock.mockImplementation(async () => ({
			discovered: ["personal.alice", "personal.bob"],
			accessible: ["personal.alice", "personal.bob"],
		}))
		isInteractiveMock.mockImplementation(() => false)
		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(devCommand("node", ["app.js"], {})).rejects.toThrow("exit(1)")
		expect(promptSelectMock).not.toHaveBeenCalled()
		expect(runCommandMock).not.toHaveBeenCalled()
		expect(String(errSpy.mock.calls[0]?.[0])).toContain("--profile <name>")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("--profile always selects the personal namespace", async () => {
		discoverPersonalProfilesMock.mockImplementation(async () => ({
			discovered: ["personal.production", "personal.alice"],
			accessible: ["personal.production", "personal.alice"],
		}))

		await devCommand("node", ["app.js"], { profile: "production" })

		expect(promptSelectMock).not.toHaveBeenCalled()
		expect(runCommandMock.mock.calls[0][2]).toMatchObject({
			env: "development,personal.production",
		})
	})

	test("a missing explicit profile soft-fails unless strict", async () => {
		const errSpy = spyOn(console, "error").mockImplementation(() => {})

		await devCommand("node", ["app.js"], { profile: "bob" })

		expect(String(errSpy.mock.calls[0]?.[0])).toContain(
			"personal profile bob was not found",
		)
		expect(runCommandMock.mock.calls[0][2]).toMatchObject({
			env: "development",
		})
		errSpy.mockRestore()
	})

	test("forwards local-only, strict, and process-env overrides", async () => {
		await devCommand("node", ["app.js"], {
			localOnly: true,
			strict: true,
			allowProcessEnv: ["NODE_OPTIONS"],
		})

		expect(runCommandMock.mock.calls[0][2]).toMatchObject({
			localOnly: true,
			strict: true,
			allowProcessEnv: ["NODE_OPTIONS"],
		})
	})
})
