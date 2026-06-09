import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test"
import * as realFs from "node:fs"
import path from "node:path"

const ROOT = "/workspace"
const SUBDIR = path.join(ROOT, "packages", "web")

const spawnMock = mock((..._args: unknown[]) => {
	throw new Error("spawn should not be called")
})
const existsSyncMock = mock((_p: unknown) => false)
const decryptEnvironmentData = mock(
	async (_name?: string, _env?: unknown) => "KEY=value",
)
const getEnvironmentByPath = mock(async (_fp: string) => ({
	version: 2 as const,
	keys: [] as { name: string }[],
	encryptedContent: "",
}))
const parseEnv = mock(
	(_content?: string) => ({ KEY: "value" }) as Record<string, string>,
)
const validateEnvironmentName = mock((_name: string) => ({
	valid: true as boolean,
	reason: undefined as string | undefined,
}))
const buildAncestorChain = mock((_root: string, _inv: string) => [ROOT])
const resolveProjectRoot = mock(() => ROOT)

mock.module("node:child_process", () => ({ spawn: spawnMock }))
mock.module("node:fs", () => ({ ...realFs, existsSync: existsSyncMock }))
mock.module("../helpers/decryptEnvironment", () => ({ decryptEnvironmentData }))
mock.module("../helpers/getEnvironmentByPath", () => ({ getEnvironmentByPath }))
mock.module("../helpers/parseEnv", () => ({ parseEnv }))
mock.module("../helpers/validateEnvironmentName", () => ({
	validateEnvironmentName,
}))
mock.module("../helpers/buildAncestorChain", () => ({ buildAncestorChain }))
mock.module("../helpers/resolveProjectRoot", () => ({ resolveProjectRoot }))

const { runCommand } = await import("../commands/run")

let cwdSpy: ReturnType<typeof spyOn<typeof process, "cwd">>

beforeEach(() => {
	cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
	spawnMock.mockClear()
	existsSyncMock.mockClear()
	decryptEnvironmentData.mockClear()
	getEnvironmentByPath.mockClear()
	parseEnv.mockClear()
	validateEnvironmentName.mockClear()
	buildAncestorChain.mockClear()
	resolveProjectRoot.mockClear()
	spawnMock.mockImplementation(() => {
		throw new Error("spawn should not be called")
	})
	existsSyncMock.mockImplementation(() => false)
	validateEnvironmentName.mockImplementation(() => ({
		valid: true,
		reason: undefined,
	}))
	decryptEnvironmentData.mockImplementation(async () => "KEY=value")
	getEnvironmentByPath.mockImplementation(async () => ({
		version: 2 as const,
		keys: [],
		encryptedContent: "",
	}))
	parseEnv.mockImplementation(() => ({ KEY: "value" }))
	buildAncestorChain.mockImplementation(() => [ROOT])
	resolveProjectRoot.mockImplementation(() => ROOT)
})

afterEach(() => {
	cwdSpy.mockRestore()
})

describe("runCommand", () => {
	test("exits when no environment is provided", async () => {
		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(runCommand("echo", ["ok"], {})).rejects.toThrow("exit(1)")
		expect(errSpy).toHaveBeenCalledTimes(1)
		expect(String(errSpy.mock.calls[0][0])).toContain("No environment provided")
		expect(exitSpy).toHaveBeenCalledWith(1)
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("exits when environment name is invalid", async () => {
		validateEnvironmentName.mockImplementation(() => ({
			valid: false,
			reason: "Invalid environment name: contains spaces.",
		}))

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			runCommand("echo", ["ok"], { env: "bad env" }),
		).rejects.toThrow("exit(1)")
		expect(String(errSpy.mock.calls[0][0])).toContain(
			"Invalid environment name",
		)
		expect(exitSpy).toHaveBeenCalledWith(1)
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("uses DOTENC_ENV fallback and spawns with decrypted env", async () => {
		const originalDotenvEnv = process.env.DOTENC_ENV
		try {
			process.env.DOTENC_ENV = "staging"

			const errSpy = spyOn(console, "error").mockImplementation(() => {})
			const exitSpy = spyOn(process, "exit").mockImplementation(
				(_code: number): never => undefined as never,
			)
			parseEnv.mockImplementation(() => ({ API_KEY: "abc123" }))

			let capturedEnv: NodeJS.ProcessEnv | undefined
			let exitHandler: ((code: number | null) => void) | undefined

			const filePath = path.join(ROOT, ".env.staging.enc")
			existsSyncMock.mockImplementation((p) => p === filePath)
			decryptEnvironmentData.mockImplementation(async () => "API_KEY=abc123")
			spawnMock.mockImplementation(
				(_command: unknown, _args: unknown, options: unknown) => {
					capturedEnv = (options as { env: NodeJS.ProcessEnv }).env
					const child = {
						on: (event: string, cb: (code: number | null) => void) => {
							if (event === "exit") exitHandler = cb
							return child
						},
					}
					return child as never
				},
			)

			await runCommand("node", ["app.js"], {})

			expect(parseEnv).toHaveBeenCalledWith("API_KEY=abc123")
			expect(capturedEnv?.API_KEY).toBe("abc123")
			expect(errSpy).not.toHaveBeenCalled()

			if (!exitHandler)
				throw new Error("Expected exit handler to be registered")
			exitHandler(7)
			expect(exitSpy).toHaveBeenCalledWith(7)
			errSpy.mockRestore()
			exitSpy.mockRestore()
		} finally {
			if (originalDotenvEnv) process.env.DOTENC_ENV = originalDotenvEnv
			else delete process.env.DOTENC_ENV
		}
	})

	test("warns when some environments fail but still runs command", async () => {
		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation(
			(_code: number): never => undefined as never,
		)

		const stagingFile = path.join(ROOT, ".env.staging.enc")
		const aliceFile = path.join(ROOT, ".env.alice.enc")

		existsSyncMock.mockImplementation(
			(p) => p === stagingFile || p === aliceFile,
		)
		decryptEnvironmentData.mockImplementation(async (name: unknown) => {
			if (name === "staging") throw new Error("failed to decrypt staging")
			return "PERSONAL_SECRET=personal456"
		})
		parseEnv.mockImplementation(() => ({ PERSONAL_SECRET: "personal456" }))
		spawnMock.mockImplementation(() => {
			const child = {
				on: (_event: string, _cb: (code: number | null) => void) => child,
			}
			return child as never
		})

		await runCommand("sh", ["-c", "echo ok"], { env: "staging,alice" })

		const logMessages = errSpy.mock.calls.map((c) => String(c[0]))
		expect(
			logMessages.some((m) => m.includes("failed to decrypt staging")),
		).toBe(true)
		expect(
			logMessages.some((m) =>
				m.includes("1 of 2 environment(s) failed to load"),
			),
		).toBe(true)
		expect(spawnMock).toHaveBeenCalledTimes(1)
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("exits when strict mode is enabled and any environment fails", async () => {
		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		const stagingFile = path.join(ROOT, ".env.staging.enc")
		const aliceFile = path.join(ROOT, ".env.alice.enc")

		existsSyncMock.mockImplementation(
			(p) => p === stagingFile || p === aliceFile,
		)
		decryptEnvironmentData.mockImplementation(async (name: unknown) => {
			if (name === "staging") throw new Error("failed to decrypt staging")
			return "PERSONAL_SECRET=personal456"
		})

		await expect(
			runCommand("sh", ["-c", "echo ok"], {
				env: "staging,alice",
				strict: true,
			}),
		).rejects.toThrow("exit(1)")

		const logMessages = errSpy.mock.calls.map((c) => String(c[0]))
		expect(logMessages.some((m) => m.includes("strict mode is enabled"))).toBe(
			true,
		)
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("does not pass dotenc bootstrap keys to child process", async () => {
		const originalBase64Key = process.env.DOTENC_PRIVATE_KEY_BASE64
		const originalKey = process.env.DOTENC_PRIVATE_KEY
		try {
			process.env.DOTENC_PRIVATE_KEY_BASE64 = "super-secret-base64-key"
			process.env.DOTENC_PRIVATE_KEY = "super-secret-key"

			const exitSpy = spyOn(process, "exit").mockImplementation(
				(_code: number): never => undefined as never,
			)

			let capturedEnv: NodeJS.ProcessEnv | undefined
			const filePath = path.join(ROOT, ".env.production.enc")
			existsSyncMock.mockImplementation((p) => p === filePath)
			decryptEnvironmentData.mockImplementation(async () => "KEY=value")
			parseEnv.mockImplementation(() => ({ KEY: "value" }))
			spawnMock.mockImplementation(
				(_command: unknown, _args: unknown, options: unknown) => {
					capturedEnv = (options as { env: NodeJS.ProcessEnv }).env
					const child = {
						on: (_event: string, _cb: (code: number | null) => void) => child,
					}
					return child as never
				},
			)

			await runCommand("node", ["app.js"], { env: "production" })

			expect(capturedEnv).toBeDefined()
			expect(capturedEnv?.DOTENC_PRIVATE_KEY_BASE64).toBeUndefined()
			expect(capturedEnv?.DOTENC_PRIVATE_KEY).toBeUndefined()
			expect(capturedEnv?.KEY).toBe("value")
			exitSpy.mockRestore()
		} finally {
			if (originalBase64Key === undefined)
				delete process.env.DOTENC_PRIVATE_KEY_BASE64
			else process.env.DOTENC_PRIVATE_KEY_BASE64 = originalBase64Key
			if (originalKey === undefined) delete process.env.DOTENC_PRIVATE_KEY
			else process.env.DOTENC_PRIVATE_KEY = originalKey
		}
	})

	test("exits when all environments fail and reports unknown errors", async () => {
		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		const stagingFile = path.join(ROOT, ".env.staging.enc")
		const aliceFile = path.join(ROOT, ".env.alice.enc")

		existsSyncMock.mockImplementation(
			(p) => p === stagingFile || p === aliceFile,
		)
		decryptEnvironmentData.mockImplementation(async (name: unknown) => {
			if (name === "staging") throw "boom"
			throw new Error("failed to decrypt alice")
		})

		await expect(
			runCommand("sh", ["-c", "echo ok"], { env: "staging,alice" }),
		).rejects.toThrow("exit(1)")

		const logMessages = errSpy.mock.calls.map((c) => String(c[0]))
		expect(
			logMessages.some((m) =>
				m.includes(
					"Unknown error occurred while decrypting the environment staging",
				),
			),
		).toBe(true)
		expect(logMessages.some((m) => m.includes("failed to decrypt alice"))).toBe(
			true,
		)
		expect(
			logMessages.some((m) => m.includes("All environments failed to load")),
		).toBe(true)
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("treats missing env file at all levels as a failure", async () => {
		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		// existsSyncMock returns false by default → env file not found anywhere
		await expect(
			runCommand("echo", ["ok"], { env: "nonexistent" }),
		).rejects.toThrow("exit(1)")

		const messages = errSpy.mock.calls.map((c) => String(c[0]))
		expect(messages.some((m) => m.includes("nonexistent"))).toBe(true)
		expect(messages.some((m) => m.includes("All environments failed"))).toBe(
			true,
		)
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("exits when resolveProjectRoot fails (not in a project)", async () => {
		resolveProjectRoot.mockImplementation(() => {
			throw new Error(
				'Not in a dotenc project. Run "dotenc init" to initialize.',
			)
		})

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			runCommand("echo", ["ok"], { env: "staging" }),
		).rejects.toThrow("exit(1)")

		expect(String(errSpy.mock.calls[0]?.[0])).toContain(
			"Not in a dotenc project",
		)
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("--local-only skips ancestor dirs and only uses cwd", async () => {
		cwdSpy.mockReturnValue(SUBDIR)
		buildAncestorChain.mockImplementation(() => [ROOT, SUBDIR])

		const rootFile = path.join(ROOT, ".env.staging.enc")
		const localFile = path.join(SUBDIR, ".env.staging.enc")

		const decryptCalls: string[] = []
		existsSyncMock.mockImplementation((p) => p === rootFile || p === localFile)
		decryptEnvironmentData.mockImplementation(async (name: unknown) => {
			decryptCalls.push(name as string)
			return "VALUE=local"
		})
		parseEnv.mockImplementation(() => ({ VALUE: "local" }))
		spawnMock.mockImplementation(() => {
			const child = {
				on: (_event: string, _cb: (code: number | null) => void) => child,
			}
			return child as never
		})

		const exitSpy = spyOn(process, "exit").mockImplementation(
			(_code: number): never => undefined as never,
		)

		await runCommand("echo", ["ok"], { env: "staging", localOnly: true })

		// With localOnly=true: only cwd is in dirs=[SUBDIR], so only localFile is checked
		expect(decryptCalls).toHaveLength(1)
		expect(spawnMock).toHaveBeenCalledTimes(1)
		exitSpy.mockRestore()
	})

	test("loads from ancestor chain with deeper level overriding root", async () => {
		cwdSpy.mockReturnValue(SUBDIR)
		buildAncestorChain.mockImplementation(() => [ROOT, SUBDIR])

		const rootFile = path.join(ROOT, ".env.staging.enc")
		const localFile = path.join(SUBDIR, ".env.staging.enc")

		existsSyncMock.mockImplementation((p) => p === rootFile || p === localFile)
		getEnvironmentByPath.mockImplementation(async (fp) => ({
			version: 2 as const,
			keys: [],
			encryptedContent: fp,
		}))
		decryptEnvironmentData.mockImplementation(
			async (_name: unknown, env: unknown) => {
				const fp = (env as { encryptedContent: string }).encryptedContent
				if (fp === rootFile) return "VALUE=root\nSHARED=root"
				return "VALUE=local\nEXTRA=extra"
			},
		)
		parseEnv.mockImplementation((content: unknown) => {
			const result: Record<string, string> = {}
			for (const line of (content as string).split("\n")) {
				const [k, v] = line.split("=")
				if (k && v !== undefined) result[k] = v
			}
			return result
		})

		let capturedEnv: NodeJS.ProcessEnv | undefined
		spawnMock.mockImplementation(
			(_command: unknown, _args: unknown, options: unknown) => {
				capturedEnv = (options as { env: NodeJS.ProcessEnv }).env
				const child = {
					on: (_event: string, _cb: (code: number | null) => void) => child,
				}
				return child as never
			},
		)

		const exitSpy = spyOn(process, "exit").mockImplementation(
			(_code: number): never => undefined as never,
		)

		await runCommand("echo", ["ok"], { env: "staging" })

		// local (deeper) wins over root — VALUE should be "local"
		expect(capturedEnv?.VALUE).toBe("local")
		// root-only key is still present
		expect(capturedEnv?.SHARED).toBe("root")
		// local-only key is present
		expect(capturedEnv?.EXTRA).toBe("extra")
		exitSpy.mockRestore()
	})
})
