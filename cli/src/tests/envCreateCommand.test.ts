import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as realFsPromises from "node:fs/promises"

const ROOT = "/workspace"

const makePublicKey = (name: string) => ({
	name,
	algorithm: "ed25519" as const,
	fingerprint: `SHA256:${name}`,
	publicKey: {} as never,
	rawPublicKey: Buffer.alloc(32),
})

const resolveProjectRoot = mock((_dir: string, _existsSync: unknown) => ROOT)
const environmentExists = mock((_name: string, _dir: string) => false)
const getPublicKeys = mock(async (_dotencDir: string) => [
	makePublicKey("alice"),
])
const fsWriteFile = mock(
	async (_path: unknown, _content: unknown, _options?: unknown) => {},
)

const getEnvironmentNameSuggestion = mock(() => "development")

mock.module("../helpers/resolveProjectRoot", () => ({ resolveProjectRoot }))
mock.module("../helpers/environmentExists", () => ({ environmentExists }))
mock.module("../helpers/getEnvironmentNameSuggestion", () => ({
	getEnvironmentNameSuggestion,
}))
mock.module("../helpers/getPublicKeys", () => ({ getPublicKeys }))
mock.module("node:fs/promises", () => ({
	...realFsPromises,
	default: { ...realFsPromises, writeFile: fsWriteFile },
}))

const {
	_normalizePublicKeyNamesForCreate,
	_resolvePublicKeySelectionForCreate,
	createCommand,
} = await import("../commands/env/create")

describe("createCommand key selection normalization", () => {
	test("normalizes a single selected key string into an array", () => {
		expect(_normalizePublicKeyNamesForCreate("ivan")).toEqual(["ivan"])
	})

	test("keeps an array selection unchanged", () => {
		expect(_normalizePublicKeyNamesForCreate(["ivan", "alice"])).toEqual([
			"ivan",
			"alice",
		])
	})

	test("returns empty array for missing or blank selection", () => {
		expect(_normalizePublicKeyNamesForCreate(undefined)).toEqual([])
		expect(_normalizePublicKeyNamesForCreate("")).toEqual([])
		expect(_normalizePublicKeyNamesForCreate("   ")).toEqual([])
	})
})

describe("createCommand public key selection resolution", () => {
	test("uses repeatable --public-key values when provided", () => {
		expect(
			_resolvePublicKeySelectionForCreate(undefined, ["alice", "bob"]),
		).toEqual(["alice", "bob"])
	})

	test("uses positional public key when no --public-key values are provided", () => {
		expect(_resolvePublicKeySelectionForCreate("alice", undefined)).toBe(
			"alice",
		)
	})

	test("rejects mixing positional public key and --public-key values", () => {
		expect(() => _resolvePublicKeySelectionForCreate("alice", ["bob"])).toThrow(
			"[publicKey]",
		)
	})
})

describe("createCommand location resolution", () => {
	beforeEach(() => {
		resolveProjectRoot.mockClear()
		environmentExists.mockClear()
		getPublicKeys.mockClear()
		fsWriteFile.mockClear()
	})

	test("creates file in cwd", async () => {
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(ROOT)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		resolveProjectRoot.mockImplementation(() => ROOT)
		environmentExists.mockImplementation(() => false)
		getPublicKeys.mockImplementation(async () => [makePublicKey("alice")])
		fsWriteFile.mockImplementation(async () => {})

		await createCommand("staging", "alice", undefined)

		const writtenPath = String(fsWriteFile.mock.calls[0]?.[0])
		expect(writtenPath.startsWith(ROOT)).toBe(true)
		logSpy.mockRestore()
		cwdSpy.mockRestore()
	})
})
