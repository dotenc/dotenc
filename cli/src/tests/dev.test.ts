import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

type LegacyProfileCandidate = {
	name: string
	layerCount: number
	requiresAllLayers: boolean
}

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
const discoverLegacyProfileMock = mock(
	async (
		_name: string,
		_options?: unknown,
	): Promise<LegacyProfileCandidate | undefined> => undefined,
)
const discoverPossibleLegacyProfilesMock = mock(
	async (_options?: unknown): Promise<LegacyProfileCandidate[]> => [],
)
const dispose = mock(() => {})
const decryptionContext = { dispose }
const createDecryptEnvironmentDataContext = mock(() => decryptionContext)

mock.module("../helpers/decryptEnvironment", () => ({
	createDecryptEnvironmentDataContext,
}))
mock.module("../helpers/discoverPersonalProfiles", () => ({
	discoverLegacyProfile: discoverLegacyProfileMock,
	discoverPersonalProfiles: discoverPersonalProfilesMock,
	discoverPossibleLegacyProfiles: discoverPossibleLegacyProfilesMock,
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
	discoverLegacyProfileMock.mockClear()
	discoverPossibleLegacyProfilesMock.mockClear()
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
	discoverLegacyProfileMock.mockImplementation(async () => undefined)
	discoverPossibleLegacyProfilesMock.mockImplementation(async () => [])
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
		expect(discoverLegacyProfileMock).not.toHaveBeenCalled()
		expect(discoverPossibleLegacyProfilesMock).not.toHaveBeenCalled()
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

	test("warns about possible legacy profiles without loading them", async () => {
		discoverPersonalProfilesMock.mockImplementation(async () => ({
			discovered: [],
			accessible: [],
		}))
		discoverPossibleLegacyProfilesMock.mockImplementation(async () => [
			{ name: "alice", layerCount: 1, requiresAllLayers: false },
		])
		const errSpy = spyOn(console, "error").mockImplementation(() => {})

		await devCommand("node", ["app.js"], {})

		expect(promptSelectMock).not.toHaveBeenCalled()
		expect(runCommandMock.mock.calls[0][2]).toMatchObject({
			env: "development",
		})
		const warning = String(errSpy.mock.calls[0]?.[0])
		expect(warning).toContain("possible legacy personal environments")
		expect(warning).toContain("alice")
		expect(warning).toContain("None were loaded")
		expect(warning).toContain("dotenc env rename alice personal.alice")
		errSpy.mockRestore()
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
		expect(discoverLegacyProfileMock).not.toHaveBeenCalled()
		expect(discoverPossibleLegacyProfilesMock).not.toHaveBeenCalled()
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

	test("a missing explicit profile gets a read-only legacy rename hint", async () => {
		discoverLegacyProfileMock.mockImplementation(async () => ({
			name: "bob",
			layerCount: 1,
			requiresAllLayers: false,
		}))
		const errSpy = spyOn(console, "error").mockImplementation(() => {})

		await devCommand("node", ["app.js"], { profile: "bob" })

		expect(discoverLegacyProfileMock).toHaveBeenCalledWith("bob", {
			invocationDir: process.cwd(),
			localOnly: undefined,
			decryptionContext,
		})
		expect(runCommandMock.mock.calls[0][2]).toMatchObject({
			env: "development",
		})
		const warning = String(errSpy.mock.calls[0]?.[0])
		expect(warning).toContain("personal profile bob was not found")
		expect(warning).toContain("possible legacy personal environment")
		expect(warning).toContain(
			"It was not loaded. Continuing with development only.",
		)
		expect(warning).toContain("dotenc env rename bob personal.bob")
		expect(discoverPossibleLegacyProfilesMock).not.toHaveBeenCalled()
		errSpy.mockRestore()
	})

	test("does not suggest renaming when the namespaced profile exists but is inaccessible", async () => {
		discoverPersonalProfilesMock.mockImplementation(async () => ({
			discovered: ["personal.bob"],
			accessible: [],
		}))
		discoverLegacyProfileMock.mockImplementation(async () => ({
			name: "bob",
			layerCount: 1,
			requiresAllLayers: false,
		}))
		const errSpy = spyOn(console, "error").mockImplementation(() => {})

		await devCommand("node", ["app.js"], { profile: "bob" })

		expect(discoverLegacyProfileMock).not.toHaveBeenCalled()
		expect(runCommandMock.mock.calls[0][2]).toMatchObject({
			env: "development",
		})
		const warning = String(errSpy.mock.calls[0]?.[0])
		expect(warning).toContain("personal profile bob is not accessible")
		expect(warning).not.toContain("dotenc env rename")
		errSpy.mockRestore()
	})

	test("never falls back to a legacy production environment", async () => {
		discoverPersonalProfilesMock.mockImplementation(async () => ({
			discovered: [],
			accessible: [],
		}))
		discoverLegacyProfileMock.mockImplementation(async () => ({
			name: "production",
			layerCount: 1,
			requiresAllLayers: false,
		}))
		const errSpy = spyOn(console, "error").mockImplementation(() => {})

		await devCommand("node", ["app.js"], { profile: "production" })

		expect(runCommandMock.mock.calls[0][2]).toMatchObject({
			env: "development",
		})
		expect(String(errSpy.mock.calls[0]?.[0])).toContain("It was not loaded")
		expect(String(errSpy.mock.calls[0]?.[0])).toContain(
			"dotenc env rename production personal.production",
		)
		errSpy.mockRestore()
	})

	test("lists multiple possible legacy profiles without prompting", async () => {
		discoverPersonalProfilesMock.mockImplementation(async () => ({
			discovered: [],
			accessible: [],
		}))
		discoverPossibleLegacyProfilesMock.mockImplementation(async () => [
			{ name: "alice", layerCount: 1, requiresAllLayers: false },
			{ name: "bob", layerCount: 1, requiresAllLayers: false },
		])
		const errSpy = spyOn(console, "error").mockImplementation(() => {})

		await devCommand("node", ["app.js"], {})

		expect(promptSelectMock).not.toHaveBeenCalled()
		expect(runCommandMock.mock.calls[0][2]).toMatchObject({
			env: "development",
		})
		const warning = String(errSpy.mock.calls[0]?.[0])
		expect(warning).toContain("alice, bob")
		expect(warning).toContain("dotenc env rename alice personal.alice")
		expect(warning).toContain("dotenc env rename bob personal.bob")
		errSpy.mockRestore()
	})

	test("adds --all-layers when a legacy source is outside the invocation directory", async () => {
		discoverLegacyProfileMock.mockImplementation(async () => ({
			name: "bob",
			layerCount: 1,
			requiresAllLayers: true,
		}))
		const errSpy = spyOn(console, "error").mockImplementation(() => {})

		await devCommand("node", ["app.js"], { profile: "bob" })

		expect(String(errSpy.mock.calls[0]?.[0])).toContain(
			"dotenc env rename bob personal.bob --all-layers",
		)
		expect(runCommandMock.mock.calls[0][2]).toMatchObject({
			env: "development",
		})
		errSpy.mockRestore()
	})

	test("does not suggest a rename whose namespaced destination already exists", async () => {
		discoverPersonalProfilesMock.mockImplementation(async () => ({
			discovered: ["personal.alice"],
			accessible: [],
		}))
		discoverPossibleLegacyProfilesMock.mockImplementation(async () => [
			{ name: "alice", layerCount: 1, requiresAllLayers: false },
		])
		const errSpy = spyOn(console, "error").mockImplementation(() => {})

		await devCommand("node", ["app.js"], {})

		expect(
			errSpy.mock.calls.some((call) =>
				String(call[0]).includes("dotenc env rename"),
			),
		).toBe(false)
		expect(runCommandMock.mock.calls[0][2]).toMatchObject({
			env: "development",
		})
		errSpy.mockRestore()
	})

	test("renders a safe migration command for a dash-prefixed legacy name", async () => {
		discoverPersonalProfilesMock.mockImplementation(async () => ({
			discovered: [],
			accessible: [],
		}))
		discoverPossibleLegacyProfilesMock.mockImplementation(async () => [
			{ name: "-alice", layerCount: 1, requiresAllLayers: true },
		])
		const errSpy = spyOn(console, "error").mockImplementation(() => {})

		await devCommand("node", ["app.js"], {})

		expect(String(errSpy.mock.calls[0]?.[0])).toContain(
			"dotenc env rename --all-layers -- -alice personal.-alice",
		)
		errSpy.mockRestore()
	})

	test("passes local-only to possible legacy discovery", async () => {
		discoverPersonalProfilesMock.mockImplementation(async () => ({
			discovered: [],
			accessible: [],
		}))

		await devCommand("node", ["app.js"], { localOnly: true })

		expect(discoverPossibleLegacyProfilesMock).toHaveBeenCalledWith({
			invocationDir: process.cwd(),
			localOnly: true,
			decryptionContext,
		})
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
