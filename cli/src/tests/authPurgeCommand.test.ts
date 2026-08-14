import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as realFs from "node:fs"
import * as realFsPromises from "node:fs/promises"
import path from "node:path"
import type { EnvFile } from "../helpers/findEnvironmentsRecursive"

const CWD = "/tmp/dotenc-purge-test"
const ROOT = CWD
const BOB_FINGERPRINT = "bob-fingerprint"
const ALICE_FINGERPRINT = "alice-fingerprint"

const makeEnvFile = (name: string, dir = ROOT): EnvFile => ({
	name,
	dir,
	filePath: path.join(dir, `.env.${name}.enc`),
})

const makeEnvironment = (fingerprints: string[]) => ({
	version: 2,
	keys: fingerprints.map((fingerprint) => ({
		name: fingerprint === BOB_FINGERPRINT ? "bob" : "alice",
		fingerprint,
		encryptedDataKey: "ZW5jcnlwdGVk",
		algorithm: "ed25519" as const,
	})),
	encryptedContent: "ZW5jcnlwdGVk",
})

let envFiles: EnvFile[] = []
const environmentFingerprints = new Map<string, string[]>()

const findEnvironmentsRecursive = mock(async (_dir: string) => envFiles)
const getEnvironmentByPath = mock(async (filePath: string) => {
	const fingerprints = environmentFingerprints.get(filePath)
	if (!fingerprints) throw new Error("unreadable")
	return makeEnvironment(fingerprints)
})
const getPublicKeys = mock(async (_dotencDir?: string) => [
	{
		name: "bob",
		fingerprint: BOB_FINGERPRINT,
		algorithm: "ed25519" as const,
	},
	{
		name: "alice",
		fingerprint: ALICE_FINGERPRINT,
		algorithm: "ed25519" as const,
	},
])
const decryptEnvironmentData = mock(
	async (_name?: string, _env?: unknown, _context?: unknown) => "SECRET=1",
)
const disposeDecryptionContext = mock(() => {})
const decryptionContext = { dispose: disposeDecryptionContext }
const createDecryptEnvironmentDataContext = mock(() => decryptionContext)
const encryptEnvironment = mock(
	async (
		name: string,
		_content: string,
		options?: {
			baseDir?: string
			revokePublicKeyFingerprints?: string[]
		},
	) => {
		const filePath = path.join(options?.baseDir ?? ROOT, `.env.${name}.enc`)
		const revoked = new Set(options?.revokePublicKeyFingerprints ?? [])
		const existing = environmentFingerprints.get(filePath) ?? []
		environmentFingerprints.set(
			filePath,
			existing.filter((fingerprint) => !revoked.has(fingerprint)),
		)
	},
)
const resolveProjectRoot = mock((_dir: string, _existsSync: unknown) => ROOT)
const validateKeyName = mock((name: string) =>
	name.startsWith("../")
		? { valid: false as const, reason: "invalid key name" }
		: { valid: true as const },
)
const confirmPrompt = mock(async (_msg: string) => true)
const existsSync = mock((_p: string) => true)
const fsUnlink = mock(async (_filePath: string) => {})

mock.module("../helpers/findEnvironmentsRecursive", () => ({
	findEnvironmentsRecursive,
}))
mock.module("../helpers/getEnvironmentByPath", () => ({ getEnvironmentByPath }))
mock.module("../helpers/getPublicKeys", () => ({ getPublicKeys }))
mock.module("../helpers/decryptEnvironment", () => ({
	createDecryptEnvironmentDataContext,
	decryptEnvironmentData,
	decryptEnvironment: decryptEnvironmentData,
}))
mock.module("../helpers/encryptEnvironment", () => ({ encryptEnvironment }))
mock.module("../helpers/resolveProjectRoot", () => ({ resolveProjectRoot }))
mock.module("../helpers/validateKeyName", () => ({ validateKeyName }))
mock.module("../prompts/confirm", () => ({ confirmPrompt }))
mock.module("node:fs", () => ({ ...realFs, existsSync }))
mock.module("node:fs/promises", () => ({
	...realFsPromises,
	default: { ...realFsPromises, unlink: fsUnlink },
}))

const { authPurgeCommand } = await import("../commands/auth/purge")

const expectExit = async (run: () => Promise<void>) => {
	const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
		throw new Error(`exit(${code})`)
	})
	await expect(run()).rejects.toThrow("exit(1)")
	expect(exitSpy).toHaveBeenCalledWith(1)
	exitSpy.mockRestore()
}

describe("authPurgeCommand", () => {
	beforeEach(() => {
		envFiles = [makeEnvFile("staging"), makeEnvFile("production")]
		environmentFingerprints.clear()
		for (const envFile of envFiles) {
			environmentFingerprints.set(envFile.filePath, [
				BOB_FINGERPRINT,
				ALICE_FINGERPRINT,
			])
		}

		findEnvironmentsRecursive.mockClear()
		findEnvironmentsRecursive.mockImplementation(async () => envFiles)
		getEnvironmentByPath.mockClear()
		getEnvironmentByPath.mockImplementation(async (filePath: string) => {
			const fingerprints = environmentFingerprints.get(filePath)
			if (!fingerprints) throw new Error("unreadable")
			return makeEnvironment(fingerprints)
		})
		getPublicKeys.mockClear()
		getPublicKeys.mockImplementation(async () => [
			{
				name: "bob",
				fingerprint: BOB_FINGERPRINT,
				algorithm: "ed25519" as const,
			},
			{
				name: "alice",
				fingerprint: ALICE_FINGERPRINT,
				algorithm: "ed25519" as const,
			},
		])
		decryptEnvironmentData.mockClear()
		decryptEnvironmentData.mockImplementation(async () => "SECRET=1")
		createDecryptEnvironmentDataContext.mockClear()
		disposeDecryptionContext.mockClear()
		encryptEnvironment.mockClear()
		encryptEnvironment.mockImplementation(
			async (
				name: string,
				_content: string,
				options?: {
					baseDir?: string
					revokePublicKeyFingerprints?: string[]
				},
			) => {
				const filePath = path.join(options?.baseDir ?? ROOT, `.env.${name}.enc`)
				const revoked = new Set(options?.revokePublicKeyFingerprints ?? [])
				const existing = environmentFingerprints.get(filePath) ?? []
				environmentFingerprints.set(
					filePath,
					existing.filter((fingerprint) => !revoked.has(fingerprint)),
				)
			},
		)
		resolveProjectRoot.mockClear()
		validateKeyName.mockClear()
		confirmPrompt.mockClear()
		confirmPrompt.mockImplementation(async () => true)
		existsSync.mockClear()
		existsSync.mockImplementation(() => true)
		fsUnlink.mockClear()
	})

	test("rejects invalid key names", async () => {
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		await expectExit(() => authPurgeCommand("../evil", false))
		expect(String(logErrorSpy.mock.calls[0]?.[0])).toContain("invalid key name")
		logErrorSpy.mockRestore()
	})

	test("exits when key file does not exist", async () => {
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		existsSync.mockImplementation(() => false)
		await expectExit(() => authPurgeCommand("bob", false))
		expect(String(logErrorSpy.mock.calls[0]?.[0])).toContain("not found")
		logErrorSpy.mockRestore()
	})

	test("removes every alias for a fingerprint when no environments grant access", async () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		envFiles = []
		getPublicKeys.mockImplementation(async () => [
			{
				name: "bob",
				fingerprint: BOB_FINGERPRINT,
				algorithm: "ed25519" as const,
			},
			{
				name: "bob-laptop",
				fingerprint: BOB_FINGERPRINT,
				algorithm: "ed25519" as const,
			},
		])

		await authPurgeCommand("bob", true)

		expect(fsUnlink).toHaveBeenCalledWith(path.join(ROOT, ".dotenc", "bob.pub"))
		expect(fsUnlink).toHaveBeenCalledWith(
			path.join(ROOT, ".dotenc", "bob-laptop.pub"),
		)
		logSpy.mockRestore()
	})

	test("revokes by fingerprint even when recipient and public aliases differ", async () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		getPublicKeys.mockImplementation(async () => [
			{
				name: "robert",
				fingerprint: BOB_FINGERPRINT,
				algorithm: "ed25519" as const,
			},
			{
				name: "alice",
				fingerprint: ALICE_FINGERPRINT,
				algorithm: "ed25519" as const,
			},
		])

		await authPurgeCommand("robert", true)

		expect(encryptEnvironment).toHaveBeenCalledTimes(2)
		expect(encryptEnvironment.mock.calls[0][2]).toMatchObject({
			revokePublicKeyFingerprints: [BOB_FINGERPRINT],
		})
		expect(fsUnlink).toHaveBeenCalledWith(
			path.join(ROOT, ".dotenc", "robert.pub"),
		)
		logSpy.mockRestore()
	})

	test("fails closed when any environment cannot be validated", async () => {
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		environmentFingerprints.delete(envFiles[0].filePath)

		await expectExit(() => authPurgeCommand("bob", true))

		expect(decryptEnvironmentData).not.toHaveBeenCalled()
		expect(encryptEnvironment).not.toHaveBeenCalled()
		expect(fsUnlink).not.toHaveBeenCalled()
		logErrorSpy.mockRestore()
	})

	test("fails closed when revocation would leave zero recipients", async () => {
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		for (const envFile of envFiles) {
			environmentFingerprints.set(envFile.filePath, [BOB_FINGERPRINT])
		}

		await expectExit(() => authPurgeCommand("bob", true))

		expect(encryptEnvironment).not.toHaveBeenCalled()
		expect(fsUnlink).not.toHaveBeenCalled()
		logErrorSpy.mockRestore()
	})

	test("proves every affected environment decryptable before mutation", async () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		decryptEnvironmentData.mockImplementation(async (_name?: string) => {
			throw new Error("secret-bearing provider error")
		})

		await expectExit(() => authPurgeCommand("bob", true))

		expect(encryptEnvironment).not.toHaveBeenCalled()
		expect(fsUnlink).not.toHaveBeenCalled()
		expect(logErrorSpy.mock.calls.flat().join(" ")).not.toContain(
			"secret-bearing provider error",
		)
		expect(disposeDecryptionContext).toHaveBeenCalledTimes(1)
		logSpy.mockRestore()
		logErrorSpy.mockRestore()
	})

	test("retains the public key and exits non-zero after a partial rewrite", async () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		encryptEnvironment.mockImplementation(async (name: string) => {
			if (name === "staging") throw new Error("write failed")
		})

		await expectExit(() => authPurgeCommand("bob", true))

		expect(encryptEnvironment).toHaveBeenCalledTimes(2)
		expect(fsUnlink).not.toHaveBeenCalled()
		logSpy.mockRestore()
		logErrorSpy.mockRestore()
	})

	test("rescans before deleting the public key", async () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const logErrorSpy = spyOn(console, "error").mockImplementation(() => {})
		encryptEnvironment.mockImplementation(async () => {})

		await expectExit(() => authPurgeCommand("bob", true))

		expect(findEnvironmentsRecursive).toHaveBeenCalledTimes(2)
		expect(fsUnlink).not.toHaveBeenCalled()
		logSpy.mockRestore()
		logErrorSpy.mockRestore()
	})

	test("aborts without mutations when confirmation is declined", async () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		confirmPrompt.mockImplementation(async () => false)

		await authPurgeCommand("bob", false)

		expect(decryptEnvironmentData).not.toHaveBeenCalled()
		expect(encryptEnvironment).not.toHaveBeenCalled()
		expect(fsUnlink).not.toHaveBeenCalled()
		logSpy.mockRestore()
	})

	test("processes root and nested environments and removes the key after verification", async () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const subdir = path.join(ROOT, "packages", "web")
		envFiles = [makeEnvFile("staging"), makeEnvFile("staging", subdir)]
		environmentFingerprints.clear()
		for (const envFile of envFiles) {
			environmentFingerprints.set(envFile.filePath, [
				BOB_FINGERPRINT,
				ALICE_FINGERPRINT,
			])
		}

		await authPurgeCommand("bob", true)

		expect(decryptEnvironmentData).toHaveBeenCalledTimes(2)
		expect(encryptEnvironment).toHaveBeenCalledTimes(2)
		expect(fsUnlink).toHaveBeenCalledWith(path.join(ROOT, ".dotenc", "bob.pub"))
		logSpy.mockRestore()
	})
})
