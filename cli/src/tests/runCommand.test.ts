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
import type { DecryptEnvironmentDataContext } from "../helpers/decryptEnvironment"

const ROOT = "/workspace"
const SUBDIR = path.join(ROOT, "packages", "web")

const spawnMock = mock((..._args: unknown[]) => {
	throw new Error("spawn should not be called")
})
const existsSyncMock = mock((_p: unknown) => false)
const decryptEnvironmentData = mock(
	async (_name?: string, _env?: unknown, _context?: unknown) => "KEY=value",
)
const disposeDecryptionContext = mock(() => {})
const decryptionContext = { dispose: disposeDecryptionContext }
const createDecryptEnvironmentDataContext = mock(() => decryptionContext)
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
mock.module("../helpers/decryptEnvironment", () => ({
	createDecryptEnvironmentDataContext,
	decryptEnvironmentData,
}))
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
	createDecryptEnvironmentDataContext.mockClear()
	disposeDecryptionContext.mockClear()
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
			expect(disposeDecryptionContext).toHaveBeenCalledTimes(1)
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
		expect(createDecryptEnvironmentDataContext).toHaveBeenCalledTimes(1)
		expect(decryptEnvironmentData.mock.calls).toHaveLength(2)
		expect(decryptEnvironmentData.mock.calls[0][2]).toBe(decryptionContext)
		expect(decryptEnvironmentData.mock.calls[1][2]).toBe(decryptionContext)
		expect(disposeDecryptionContext).toHaveBeenCalledTimes(1)
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("does not dispose a caller-owned decryption context", async () => {
		const externalDispose = mock(() => {})
		const externalContext = {
			...decryptionContext,
			dispose: externalDispose,
		} as unknown as DecryptEnvironmentDataContext
		const filePath = path.join(ROOT, ".env.staging.enc")
		existsSyncMock.mockImplementation((p) => p === filePath)
		spawnMock.mockImplementation(() => {
			const child = {
				on: (_event: string, _cb: (code: number | null) => void) => child,
			}
			return child as never
		})

		await runCommand("echo", ["ok"], {
			env: "staging",
			decryptionContext: externalContext,
		})

		expect(createDecryptEnvironmentDataContext).not.toHaveBeenCalled()
		expect(decryptEnvironmentData.mock.calls[0][2]).toBe(externalContext)
		expect(externalDispose).not.toHaveBeenCalled()
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
		const originalPassphrase = process.env.DOTENC_PRIVATE_KEY_PASSPHRASE
		const originalEnvironment = process.env.DOTENC_ENV
		try {
			process.env.DOTENC_PRIVATE_KEY_BASE64 = "super-secret-base64-key"
			process.env.DOTENC_PRIVATE_KEY = "super-secret-key"
			process.env.DOTENC_PRIVATE_KEY_PASSPHRASE = "super-secret-passphrase"
			process.env.DOTENC_ENV = "must-not-reach-child"

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
			expect(capturedEnv?.DOTENC_PRIVATE_KEY_PASSPHRASE).toBeUndefined()
			expect(capturedEnv?.DOTENC_ENV).toBeUndefined()
			expect(capturedEnv?.KEY).toBe("value")
			exitSpy.mockRestore()
		} finally {
			if (originalBase64Key === undefined)
				delete process.env.DOTENC_PRIVATE_KEY_BASE64
			else process.env.DOTENC_PRIVATE_KEY_BASE64 = originalBase64Key
			if (originalKey === undefined) delete process.env.DOTENC_PRIVATE_KEY
			else process.env.DOTENC_PRIVATE_KEY = originalKey
			if (originalPassphrase === undefined)
				delete process.env.DOTENC_PRIVATE_KEY_PASSPHRASE
			else process.env.DOTENC_PRIVATE_KEY_PASSPHRASE = originalPassphrase
			if (originalEnvironment === undefined) delete process.env.DOTENC_ENV
			else process.env.DOTENC_ENV = originalEnvironment
		}
	})

	test("rejects reserved decrypted variables without exposing values", async () => {
		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})
		const filePath = path.join(ROOT, ".env.production.enc")
		existsSyncMock.mockImplementation((p) => p === filePath)
		parseEnv.mockImplementation(() => ({
			DOTENC_PRIVATE_KEY: "must-not-be-logged",
			github_output: "also-secret",
		}))

		await expect(
			runCommand("node", ["app.js"], {
				env: "production",
				allowProcessEnv: ["DOTENC_PRIVATE_KEY", "github_output"],
			}),
		).rejects.toThrow("exit(1)")

		const diagnostics = errSpy.mock.calls
			.map((call) => String(call[0]))
			.join("\n")
		expect(diagnostics).toContain("DOTENC_PRIVATE_KEY")
		expect(diagnostics).toContain("github_output")
		expect(diagnostics).not.toContain("must-not-be-logged")
		expect(diagnostics).not.toContain("also-secret")
		expect(spawnMock).not.toHaveBeenCalled()
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("blocks unsafe loader variables unless each name is explicitly allowed", async () => {
		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})
		const filePath = path.join(ROOT, ".env.production.enc")
		existsSyncMock.mockImplementation((p) => p === filePath)
		parseEnv.mockImplementation(() => ({
			NODE_OPTIONS: "--require ./bootstrap.js",
			DYLD_INSERT_LIBRARIES: "/tmp/library.dylib",
		}))

		await expect(
			runCommand("node", ["app.js"], {
				env: "production",
				allowProcessEnv: ["node_options"],
			}),
		).rejects.toThrow("exit(1)")

		const diagnostics = errSpy.mock.calls
			.map((call) => String(call[0]))
			.join("\n")
		expect(diagnostics).toContain("DYLD_INSERT_LIBRARIES")
		expect(diagnostics).not.toContain("NODE_OPTIONS")
		expect(diagnostics).not.toContain("bootstrap.js")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("passes explicitly allowed unsafe loader variables", async () => {
		const filePath = path.join(ROOT, ".env.production.enc")
		existsSyncMock.mockImplementation((p) => p === filePath)
		parseEnv.mockImplementation(() => ({ NODE_OPTIONS: "--no-warnings" }))
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

		await runCommand("node", ["app.js"], {
			env: "production",
			allowProcessEnv: ["node_options"],
		})

		expect(capturedEnv?.NODE_OPTIONS).toBe("--no-warnings")
		expect(spawnMock).toHaveBeenCalledTimes(1)
	})

	test("fails before spawn when a bare command is absent from the original PATH", async () => {
		const originalPath = process.env.PATH
		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})
		const filePath = path.join(ROOT, ".env.production.enc")
		existsSyncMock.mockImplementation((p) => p === filePath)
		try {
			process.env.PATH = "/definitely/not/a/real/search/path"
			await expect(
				runCommand("missing-command", [], {
					env: "production",
					allowProcessEnv: ["PATH"],
				}),
			).rejects.toThrow("exit(1)")
			expect(spawnMock).not.toHaveBeenCalled()
			expect(String(errSpy.mock.calls.at(-1)?.[0])).toContain("missing-command")
			expect(String(errSpy.mock.calls.at(-1)?.[0])).not.toContain("not/a/real")
		} finally {
			if (originalPath === undefined) delete process.env.PATH
			else process.env.PATH = originalPath
			errSpy.mockRestore()
			exitSpy.mockRestore()
		}
	})

	test("handles child spawn errors without leaking error details", async () => {
		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation(
			(_code: number): never => undefined as never,
		)
		const filePath = path.join(ROOT, ".env.production.enc")
		existsSyncMock.mockImplementation((p) => p === filePath)
		spawnMock.mockImplementation(() => {
			const child = {
				on: (event: string, callback: (value: unknown) => void) => {
					if (event === "error") {
						const error = Object.assign(new Error("sensitive raw detail"), {
							code: "ENOENT",
						})
						callback(error)
					}
					return child
				},
			}
			return child as never
		})

		await runCommand("node", ["app.js"], { env: "production" })

		expect(exitSpy).toHaveBeenCalledWith(1)
		const diagnostics = errSpy.mock.calls
			.map((call) => String(call[0]))
			.join("\n")
		expect(diagnostics).toContain("ENOENT")
		expect(diagnostics).not.toContain("sensitive raw detail")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("always fails when a required environment cannot load", async () => {
		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})
		const personalFile = path.join(ROOT, ".env.personal.alice.enc")
		existsSyncMock.mockImplementation((p) => p === personalFile)

		await expect(
			runCommand("node", ["app.js"], {
				env: "development,personal.alice",
				requiredEnvs: ["development"],
			}),
		).rejects.toThrow("exit(1)")

		expect(
			errSpy.mock.calls.some((call) =>
				String(call[0]).includes("required environment(s) failed"),
			),
		).toBe(true)
		expect(spawnMock).not.toHaveBeenCalled()
		errSpy.mockRestore()
		exitSpy.mockRestore()
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
