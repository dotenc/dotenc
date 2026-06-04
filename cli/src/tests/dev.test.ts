import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

const getCurrentKeyName = mock(async () => ["alice"])
const runCommandMock = mock(async () => {})
const promptSelectMock = mock(async () => "alice")
const isInteractiveMock = mock(() => true)

mock.module("../helpers/getCurrentKeyName", () => ({ getCurrentKeyName }))
mock.module("../commands/run", () => ({ runCommand: runCommandMock }))
mock.module("../ui/prompts", () => ({ promptSelect: promptSelectMock }))
mock.module("../ui/tty", () => ({ isInteractive: isInteractiveMock }))

const { devCommand } = await import("../commands/dev")

beforeEach(() => {
	getCurrentKeyName.mockClear()
	runCommandMock.mockClear()
	promptSelectMock.mockClear()
	isInteractiveMock.mockClear()
	getCurrentKeyName.mockImplementation(async () => ["alice"])
	runCommandMock.mockImplementation(async () => {})
	promptSelectMock.mockImplementation(async () => "alice")
	isInteractiveMock.mockImplementation(() => true)
})

describe("devCommand", () => {
	test("delegates to runCommand with development,<keyName>", async () => {
		await devCommand("node", ["app.js"], {})

		expect(runCommandMock).toHaveBeenCalledTimes(1)
		expect(runCommandMock).toHaveBeenCalledWith("node", ["app.js"], {
			env: "development,alice",
			localOnly: undefined,
		})
		expect(promptSelectMock).not.toHaveBeenCalled()
	})

	test("prints error when no identity is found", async () => {
		getCurrentKeyName.mockImplementation(async () => [])

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`process.exit(${code})`)
		})

		await expect(devCommand("node", ["app.js"], {})).rejects.toThrow(
			"process.exit(1)",
		)

		expect(runCommandMock).not.toHaveBeenCalled()
		expect(exitSpy).toHaveBeenCalledWith(1)
		expect(errSpy).toHaveBeenCalledTimes(1)
		const [errorMessage] = errSpy.mock.calls[0] as [string]
		expect(errorMessage).toContain("could not resolve your identity")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("prompts user to select identity when multiple keys match", async () => {
		getCurrentKeyName.mockImplementation(async () => ["alice", "alice-deploy"])
		promptSelectMock.mockImplementation(async () => "alice-deploy")

		await devCommand("node", ["app.js"], {})

		expect(promptSelectMock).toHaveBeenCalledTimes(1)
		expect(promptSelectMock).toHaveBeenCalledWith(
			"Multiple identities found. Which one do you want to use?",
			{
				options: [
					{ label: "alice", value: "alice" },
					{ label: "alice-deploy", value: "alice-deploy" },
				],
				nonInteractiveError:
					"Multiple identities found in non-interactive mode. Pass --identity <name> instead.",
			},
		)
		expect(runCommandMock).toHaveBeenCalledTimes(1)
		expect(runCommandMock).toHaveBeenCalledWith("node", ["app.js"], {
			env: "development,alice-deploy",
			localOnly: undefined,
		})
	})

	test("fails in non-interactive mode when multiple identities exist and none is specified", async () => {
		getCurrentKeyName.mockImplementation(async () => ["alice", "alice-deploy"])
		isInteractiveMock.mockImplementation(() => false)

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`process.exit(${code})`)
		})

		await expect(devCommand("node", ["app.js"], {})).rejects.toThrow(
			"process.exit(1)",
		)

		expect(promptSelectMock).not.toHaveBeenCalled()
		expect(errSpy).toHaveBeenCalledTimes(1)
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("uses the explicit identity when provided", async () => {
		getCurrentKeyName.mockImplementation(async () => ["alice", "alice-deploy"])

		await devCommand("node", ["app.js"], { identity: "alice-deploy" })

		expect(promptSelectMock).not.toHaveBeenCalled()
		expect(runCommandMock).toHaveBeenCalledWith("node", ["app.js"], {
			env: "development,alice-deploy",
			localOnly: undefined,
		})
	})

	test("forwards localOnly option to runCommand", async () => {
		await devCommand("node", ["app.js"], { localOnly: true })

		expect(runCommandMock).toHaveBeenCalledWith("node", ["app.js"], {
			env: "development,alice",
			localOnly: true,
		})
	})
})
