import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as realFs from "node:fs"
import path from "node:path"
import type { EnvFile } from "../helpers/findEnvironmentsRecursive"
import type { KeyCandidate } from "../helpers/keyCandidate"

const ROOT = "/workspace"
const SUBDIR = path.join(ROOT, "packages", "web")

const makePublicKey = (name: string, fingerprint: string) => ({
	name,
	algorithm: "ed25519" as const,
	fingerprint,
	publicKey: {} as never,
	rawPublicKey: Buffer.alloc(32),
})

const makePrivateKey = (name: string, fingerprint: string) => ({
	name,
	fingerprint,
	privateKey: {} as never,
	algorithm: "ed25519" as const,
})

const makeEnvFile = (name: string, dir = ROOT): EnvFile => ({
	name,
	dir,
	filePath: path.join(dir, `.env.${name}.enc`),
})

const makeEnvJson = (fingerprint: string) => ({
	version: 2 as const,
	keys: [
		{
			fingerprint,
			name: "alice",
			encryptedDataKey: "",
			algorithm: "ed25519" as const,
		},
	],
	encryptedContent: "",
})

const getPrivateKeys = mock(async () => ({
	keys: [] as ReturnType<typeof makePrivateKey>[],
	passphraseProtectedKeys: [] as string[],
}))
const getPublicKeys = mock(
	async (_dotencDir: string) => [] as ReturnType<typeof makePublicKey>[],
)
const findEnvironmentsRecursive = mock(async (_dir: string) => [] as EnvFile[])
const getEnvironmentByPath = mock(async (_filePath: string) => makeEnvJson(""))
const resolveProjectRoot = mock((_dir: string, _existsSync: unknown) => ROOT)
const existsSync = mock((_p: string) => true)
const discoverOnePasswordKeyCandidates = mock(async () => ({
	status: "available" as const,
	keys: [] as KeyCandidate[],
	unsupportedKeys: [],
	unavailableAccounts: [],
}))

mock.module("../helpers/getPrivateKeys", () => ({ getPrivateKeys }))
mock.module("../helpers/getPublicKeys", () => ({ getPublicKeys }))
mock.module("../helpers/findEnvironmentsRecursive", () => ({
	findEnvironmentsRecursive,
}))
mock.module("../helpers/getEnvironmentByPath", () => ({ getEnvironmentByPath }))
mock.module("../helpers/resolveProjectRoot", () => ({ resolveProjectRoot }))
mock.module("../helpers/onePasswordKeyProvider", () => ({
	discoverOnePasswordKeyCandidates,
}))
mock.module("node:fs", () => ({ ...realFs, existsSync }))

const { whoamiCommand } = await import("../commands/whoami")

describe("whoamiCommand", () => {
	beforeEach(() => {
		getPrivateKeys.mockClear()
		getPublicKeys.mockClear()
		findEnvironmentsRecursive.mockClear()
		getEnvironmentByPath.mockClear()
		resolveProjectRoot.mockClear()
		existsSync.mockClear()
		discoverOnePasswordKeyCandidates.mockClear()
		discoverOnePasswordKeyCandidates.mockImplementation(async () => ({
			status: "available",
			keys: [],
			unsupportedKeys: [],
			unavailableAccounts: [],
		}))
	})

	test("exits when no matching key found", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})
		resolveProjectRoot.mockImplementation(() => ROOT)
		getPrivateKeys.mockImplementation(async () => ({
			keys: [],
			passphraseProtectedKeys: [],
		}))
		getPublicKeys.mockImplementation(async () => [])
		findEnvironmentsRecursive.mockImplementation(async () => [])

		await expect(whoamiCommand()).rejects.toThrow("exit(1)")

		expect(exitSpy).toHaveBeenCalledWith(1)
		expect(String(logErrorSpy.mock.calls[0]?.[0])).toContain(
			"ask a project member",
		)
		logErrorSpy.mockRestore()
		exitSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("prints identity and authorized environments for matching key", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		getPrivateKeys.mockImplementation(async () => ({
			keys: [makePrivateKey("id_ed25519", "SHA256:alice")],
			passphraseProtectedKeys: [],
		}))
		getPublicKeys.mockImplementation(async () => [
			makePublicKey("alice", "SHA256:alice"),
		])
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging"),
		])
		getEnvironmentByPath.mockImplementation(async () =>
			makeEnvJson("SHA256:alice"),
		)

		await whoamiCommand()

		const logged = logSpy.mock.calls.map((c) => String(c[0]))
		expect(logged.some((m) => m.includes("alice"))).toBe(true)
		expect(logged.some((m) => m.includes("staging"))).toBe(true)
		expect(discoverOnePasswordKeyCandidates).not.toHaveBeenCalled()
		logSpy.mockRestore()
		logErrorSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("prints a matching 1Password-only identity without loading its private key", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		const loadPrivateKey = mock(async () => {
			throw new Error("private key should not be loaded")
		})
		resolveProjectRoot.mockImplementation(() => ROOT)
		getPrivateKeys.mockImplementation(async () => ({
			keys: [],
			passphraseProtectedKeys: [],
		}))
		getPublicKeys.mockImplementation(async () => [
			makePublicKey("alice", "SHA256:alice"),
		])
		discoverOnePasswordKeyCandidates.mockImplementation(async () => ({
			status: "available",
			keys: [
				{
					source: "1password",
					selector: "1password:account:vault:item",
					name: "MacBook Pro",
					hint: "ed25519 - Private",
					group: {
						id: "1password:account",
						label: "1Password - example.1password.com [ABCD...WXYZ]",
					},
					publicKey: {} as never,
					fingerprint: "SHA256:alice",
					algorithm: "ed25519",
					loadPrivateKey,
				},
			],
			unsupportedKeys: [],
			unavailableAccounts: [],
		}))
		findEnvironmentsRecursive.mockImplementation(async () => [])

		await whoamiCommand()

		const logged = logSpy.mock.calls.map((call) => String(call[0])).join("\n")
		expect(logged).toContain("Name: alice")
		expect(logged).toContain("1Password - example.1password.com")
		expect(logged).toContain("MacBook Pro")
		expect(logged).not.toContain("1password:account:vault:item")
		expect(loadPrivateKey).not.toHaveBeenCalled()
		logSpy.mockRestore()
		logErrorSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("prints both local and 1Password-only project identities", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		const loadPrivateKey = mock(async () => {
			throw new Error("private key should not be loaded")
		})
		getPrivateKeys.mockImplementation(async () => ({
			keys: [makePrivateKey("id_ed25519", "SHA256:alice")],
			passphraseProtectedKeys: [],
		}))
		getPublicKeys.mockImplementation(async () => [
			makePublicKey("alice", "SHA256:alice"),
			makePublicKey("deploy", "SHA256:deploy"),
		])
		discoverOnePasswordKeyCandidates.mockImplementation(async () => ({
			status: "available",
			keys: [
				{
					source: "1password",
					selector: "1password:account:vault:item",
					name: "Deploy",
					hint: "ed25519 - Private",
					group: {
						id: "1password:account",
						label: "1Password - example.1password.com [ABCD...WXYZ]",
					},
					publicKey: {} as never,
					fingerprint: "SHA256:deploy",
					algorithm: "ed25519",
					loadPrivateKey,
				},
			],
			unsupportedKeys: [],
			unavailableAccounts: [],
		}))
		findEnvironmentsRecursive.mockImplementation(async () => [])

		await whoamiCommand()

		const logged = logSpy.mock.calls.map((call) => String(call[0])).join("\n")
		expect(logged).toContain("Name: alice")
		expect(logged).toContain("Active SSH key: id_ed25519")
		expect(logged).toContain("Name: deploy")
		expect(logged).toContain("1Password - example.1password.com")
		expect(discoverOnePasswordKeyCandidates).toHaveBeenCalledTimes(1)
		expect(loadPrivateKey).not.toHaveBeenCalled()
		logSpy.mockRestore()
		logErrorSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("reads .dotenc from projectRoot when cwd is a subdir", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(SUBDIR)
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})
		resolveProjectRoot.mockImplementation(() => ROOT)
		getPrivateKeys.mockImplementation(async () => ({
			keys: [makePrivateKey("id_ed25519", "SHA256:alice")],
			passphraseProtectedKeys: [],
		}))
		getPublicKeys.mockImplementation(async () => [])
		findEnvironmentsRecursive.mockImplementation(async () => [])

		await expect(whoamiCommand()).rejects.toThrow("exit(1)") // No matching key found → exit(1)

		// getPublicKeys should be called with ROOT/.dotenc, not SUBDIR/.dotenc
		const calledWith = String(getPublicKeys.mock.calls[0]?.[0])
		expect(calledWith).toBe(path.join(ROOT, ".dotenc"))
		logErrorSpy.mockRestore()
		exitSpy.mockRestore()
		cwdSpy.mockRestore()
	})

	test("shows environments from all directory levels in a monorepo", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		getPrivateKeys.mockImplementation(async () => ({
			keys: [makePrivateKey("id_ed25519", "SHA256:alice")],
			passphraseProtectedKeys: [],
		}))
		getPublicKeys.mockImplementation(async () => [
			makePublicKey("alice", "SHA256:alice"),
		])
		findEnvironmentsRecursive.mockImplementation(async () => [
			makeEnvFile("staging", ROOT),
			makeEnvFile("staging", SUBDIR),
		])
		getEnvironmentByPath.mockImplementation(async () =>
			makeEnvJson("SHA256:alice"),
		)

		await whoamiCommand()

		const logged = logSpy.mock.calls.map((c) => String(c[0]))
		// Root-level staging has no qualifier
		expect(logged.some((m) => m === "  - staging")).toBe(true)
		// Subdir staging shows relative path
		expect(
			logged.some((m) => m.includes("staging") && m.includes("packages/web")),
		).toBe(true)
		logSpy.mockRestore()
		logErrorSpy.mockRestore()
		cwdSpy.mockRestore()
	})
})
