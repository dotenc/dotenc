import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import crypto from "node:crypto"
import * as realFs from "node:fs"
import * as realFsPromises from "node:fs/promises"
import realOs from "node:os"
import path from "node:path"

const CWD = "/workspace"

const inputNamePromptMock = mock(
	async (_message: string, _def?: string) => "alice",
)
const userInfoMock = mock(
	() =>
		({ username: "tester" }) as ReturnType<typeof import("node:os").userInfo>,
)
const choosePrivateKeyPromptMock = mock(async (_message: string) => {
	const { privateKey } = crypto.generateKeyPairSync("ed25519")
	return {
		name: "id_ed25519",
		privateKey,
		fingerprint: "test-fingerprint",
		algorithm: "ed25519" as const,
		rawPublicKey: Buffer.alloc(32),
	}
})
const keyAddCommandMock = mock(async (_name: string, _options: unknown) => {})
const setupGitDiffMock = mock((_projectRoot?: string) => {})
const resolveProjectRootMock = mock(
	(_startDir: string, _exists: (filePath: string) => boolean): string => {
		throw new Error("not initialized")
	},
)
const existsSyncMock = mock((_p: unknown) => false)
const readFileMock = mock(async (_p: unknown, _enc?: unknown) => "")
const unlinkMock = mock(async (_p: unknown) => {})
const createCommandMock = mock(
	async (_env: string, _key: string, _content?: string) => {},
)

mock.module("../prompts/inputName", () => ({
	inputNamePrompt: inputNamePromptMock,
}))
mock.module("node:os", () => ({
	default: { ...realOs, userInfo: userInfoMock },
}))
mock.module("../prompts/choosePrivateKey", () => ({
	choosePrivateKeyPrompt: choosePrivateKeyPromptMock,
}))
mock.module("../commands/key/add", () => ({
	keyAddCommand: keyAddCommandMock,
}))
mock.module("../helpers/setupGitDiff", () => ({
	setupGitDiff: setupGitDiffMock,
}))
mock.module("../helpers/resolveProjectRoot", () => ({
	resolveProjectRoot: resolveProjectRootMock,
}))
mock.module("node:fs", () => ({ ...realFs, existsSync: existsSyncMock }))
mock.module("node:fs/promises", () => ({
	...realFsPromises,
	default: { ...realFsPromises, readFile: readFileMock, unlink: unlinkMock },
}))
mock.module("../commands/env/create", () => ({
	createCommand: createCommandMock,
}))

const { initCommand, _resolveDocsUrl } = await import("../commands/init")

beforeEach(() => {
	inputNamePromptMock.mockClear()
	userInfoMock.mockClear()
	choosePrivateKeyPromptMock.mockClear()
	keyAddCommandMock.mockClear()
	setupGitDiffMock.mockClear()
	resolveProjectRootMock.mockClear()
	existsSyncMock.mockClear()
	readFileMock.mockClear()
	unlinkMock.mockClear()
	createCommandMock.mockClear()

	inputNamePromptMock.mockImplementation(async () => "alice")
	userInfoMock.mockImplementation(
		() =>
			({ username: "tester" }) as ReturnType<typeof import("node:os").userInfo>,
	)
	choosePrivateKeyPromptMock.mockImplementation(async () => {
		const { privateKey } = crypto.generateKeyPairSync("ed25519")
		return {
			name: "id_ed25519",
			privateKey,
			fingerprint: "test-fingerprint",
			algorithm: "ed25519" as const,
			rawPublicKey: Buffer.alloc(32),
		}
	})
	keyAddCommandMock.mockImplementation(async () => {})
	setupGitDiffMock.mockImplementation(() => {})
	resolveProjectRootMock.mockImplementation(() => {
		throw new Error("not initialized")
	})
	existsSyncMock.mockImplementation(() => false)
	readFileMock.mockImplementation(async () => "")
	unlinkMock.mockImplementation(async () => {})
	createCommandMock.mockImplementation(async () => {})
})

describe("initCommand", () => {
	test("exits when no name is provided", async () => {
		inputNamePromptMock.mockImplementation(async () => "")

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(initCommand({})).rejects.toThrow("exit(1)")
		expect(keyAddCommandMock).not.toHaveBeenCalled()
		expect(createCommandMock).not.toHaveBeenCalled()
		errSpy.mockRestore()
		logSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("exits when private key selection fails", async () => {
		choosePrivateKeyPromptMock.mockImplementation(async () => {
			throw new Error("No private keys available")
		})

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(initCommand({})).rejects.toThrow("exit(1)")
		errSpy.mockRestore()
		logSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("configures an existing clone without changing project data", async () => {
		resolveProjectRootMock.mockImplementation(() => CWD)
		const logs: string[] = []
		const logSpy = spyOn(console, "log").mockImplementation((message) =>
			logs.push(String(message)),
		)

		await initCommand({})

		expect(setupGitDiffMock).toHaveBeenCalledTimes(1)
		expect(setupGitDiffMock).toHaveBeenCalledWith(CWD)
		expect(inputNamePromptMock).not.toHaveBeenCalled()
		expect(choosePrivateKeyPromptMock).not.toHaveBeenCalled()
		expect(keyAddCommandMock).not.toHaveBeenCalled()
		expect(createCommandMock).not.toHaveBeenCalled()
		expect(readFileMock).not.toHaveBeenCalled()
		expect(unlinkMock).not.toHaveBeenCalled()
		expect(logs.some((line) => line.includes("Existing dotenc project"))).toBe(
			true,
		)
		expect(
			logs.some((line) => line.includes("Git diff driver configured")),
		).toBe(true)
		expect(
			logs.some((line) =>
				line.includes("No keys or environments were changed"),
			),
		).toBe(true)

		logSpy.mockRestore()
	})

	test("warns when first-initialization options are ignored in an existing clone", async () => {
		resolveProjectRootMock.mockImplementation(() => CWD)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const warnSpy = spyOn(console, "warn").mockImplementation(() => {})

		await initCommand({ name: "alice", privateKey: "id_ed25519" })

		expect(warnSpy).toHaveBeenCalledTimes(1)
		expect(String(warnSpy.mock.calls[0]?.[0])).toContain("were ignored")
		expect(String(warnSpy.mock.calls[0]?.[0])).toContain("dotenc key add")
		expect(choosePrivateKeyPromptMock).not.toHaveBeenCalled()
		expect(keyAddCommandMock).not.toHaveBeenCalled()
		expect(createCommandMock).not.toHaveBeenCalled()

		logSpy.mockRestore()
		warnSpy.mockRestore()
	})

	test("surfaces git setup failures without changing an existing project", async () => {
		resolveProjectRootMock.mockImplementation(() => CWD)
		setupGitDiffMock.mockImplementation(() => {
			throw new Error("git config failed")
		})

		await expect(initCommand({})).rejects.toThrow("git config failed")
		expect(inputNamePromptMock).not.toHaveBeenCalled()
		expect(choosePrivateKeyPromptMock).not.toHaveBeenCalled()
		expect(keyAddCommandMock).not.toHaveBeenCalled()
		expect(createCommandMock).not.toHaveBeenCalled()
		expect(readFileMock).not.toHaveBeenCalled()
		expect(unlinkMock).not.toHaveBeenCalled()
	})

	test("migrates .env and creates development + personal environments", async () => {
		const envPath = path.join(CWD, ".env")
		existsSyncMock.mockImplementation(
			(p) =>
				String(p) === envPath ||
				String(p) === ".claude" ||
				String(p) === ".vscode",
		)
		readFileMock.mockImplementation(async () => "API_KEY=abc123\n")

		const cwdSpy = spyOn(process, "cwd").mockReturnValue(CWD)
		const logs: string[] = []
		const warns: string[] = []
		const logSpy = spyOn(console, "log").mockImplementation((msg) =>
			logs.push(String(msg)),
		)
		const warnSpy = spyOn(console, "warn").mockImplementation((msg) =>
			warns.push(String(msg)),
		)
		const errSpy = spyOn(console, "error").mockImplementation(() => {})

		await initCommand({ name: "alice" })

		expect(keyAddCommandMock).toHaveBeenCalledTimes(1)
		expect(keyAddCommandMock.mock.calls[0]?.[0]).toBe("alice")
		expect(createCommandMock).toHaveBeenCalledTimes(2)
		expect(createCommandMock.mock.calls[0]).toEqual([
			"development",
			"alice",
			"API_KEY=abc123\n",
		])
		expect(createCommandMock.mock.calls[1]).toEqual(["alice", "alice"])
		expect(unlinkMock).toHaveBeenCalledWith(envPath)
		expect(readFileMock).toHaveBeenCalledWith(envPath, "utf-8")
		expect(warns).toHaveLength(0)
		expect(logs.some((line) => line.includes("Install the agent skill"))).toBe(
			true,
		)
		expect(logs.some((line) => line.includes("install-vscode-extension"))).toBe(
			true,
		)

		const docsUrl = _resolveDocsUrl()
		if (docsUrl) {
			expect(logs.some((line) => line.includes(docsUrl))).toBe(true)
		}

		cwdSpy.mockRestore()
		logSpy.mockRestore()
		warnSpy.mockRestore()
		errSpy.mockRestore()
	})

	test("preserves .env when development environment creation fails", async () => {
		const envPath = path.join(CWD, ".env")
		existsSyncMock.mockImplementation(
			(filePath) => String(filePath) === envPath,
		)
		readFileMock.mockImplementation(async () => "API_KEY=keep-me\n")
		createCommandMock.mockImplementation(async () => {
			throw new Error("environment creation failed")
		})

		const cwdSpy = spyOn(process, "cwd").mockReturnValue(CWD)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})

		await expect(initCommand({ name: "alice" })).rejects.toThrow(
			"environment creation failed",
		)

		expect(readFileMock).toHaveBeenCalledWith(envPath, "utf-8")
		expect(unlinkMock).not.toHaveBeenCalled()

		cwdSpy.mockRestore()
		logSpy.mockRestore()
	})

	test("continues when git diff setup fails and skips personal environment for development user", async () => {
		setupGitDiffMock.mockImplementation(() => {
			throw new Error("not a git repository")
		})

		const cwdSpy = spyOn(process, "cwd").mockReturnValue(CWD)
		const logs: string[] = []
		const warns: string[] = []
		const logSpy = spyOn(console, "log").mockImplementation((msg) =>
			logs.push(String(msg)),
		)
		const warnSpy = spyOn(console, "warn").mockImplementation((msg) =>
			warns.push(String(msg)),
		)
		const errSpy = spyOn(console, "error").mockImplementation(() => {})

		await initCommand({ name: "development" })

		expect(warns).toHaveLength(1)
		expect(warns[0]).toContain("could not set up git diff driver")
		expect(createCommandMock).toHaveBeenCalledTimes(1)
		expect(createCommandMock.mock.calls[0]).toEqual([
			"development",
			"development",
			undefined,
		])
		expect(
			logs.some((line) => line.includes("Edit your personal environment")),
		).toBe(false)

		cwdSpy.mockRestore()
		logSpy.mockRestore()
		warnSpy.mockRestore()
		errSpy.mockRestore()
	})
})
