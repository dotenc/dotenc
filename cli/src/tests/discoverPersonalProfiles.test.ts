import { describe, expect, mock, spyOn, test } from "bun:test"
import path from "node:path"
import type { DecryptEnvironmentDataContext } from "../helpers/decryptEnvironment"
import {
	discoverLegacyProfile,
	discoverPersonalProfiles,
	discoverPossibleLegacyProfiles,
} from "../helpers/discoverPersonalProfiles"

const ROOT = "/repo"
const SUBDIR = path.join(ROOT, "packages", "app")
const context = {
	dispose: () => {},
} as unknown as DecryptEnvironmentDataContext

const deps = (
	filesByDir: Record<string, string[]>,
	inaccessibleNames = new Set(["personal.inaccessible"]),
	recipientFingerprints: Record<string, string[]> = {},
	invalidPublicKeys = new Set<string>(),
) => {
	const readdir = mock(async (dir: string) => filesByDir[dir] ?? [])
	const readFile = mock(async (filePath: string) =>
		path.basename(filePath, ".pub"),
	)
	const decryptEnvironmentData = mock(async (name: string) => {
		if (inaccessibleNames.has(name)) throw new Error("access denied")
		return "KEY=value"
	})
	return {
		readdir,
		readFile,
		exists: mock(() => true),
		resolveProjectRoot: mock(() => ROOT),
		buildAncestorChain: mock(() => [ROOT, SUBDIR]),
		getEnvironmentByPath: mock(async (filePath: string) => {
			const fileName = path.basename(filePath)
			const environmentName = fileName.slice(".env.".length, -".enc".length)
			const fingerprints = recipientFingerprints[environmentName] ?? [
				`fingerprint:${environmentName}`,
			]
			return {
				version: 2 as const,
				keys: fingerprints.map((fingerprint, index) => ({
					name: `recipient-${index}`,
					fingerprint,
					encryptedDataKey: "ZGF0YQ==",
					algorithm: "ed25519" as const,
				})),
				encryptedContent: "ZGF0YQ==",
			}
		}),
		decryptEnvironmentData,
		parseSpkiPublicKey: mock((input: string) => ({ alias: input }) as never),
		getKeyFingerprint: mock(
			(key: unknown) => `fingerprint:${(key as { alias: string }).alias}`,
		),
		validatePublicKey: mock((key: unknown) =>
			invalidPublicKeys.has((key as { alias: string }).alias)
				? ({ valid: false, reason: "invalid" } as const)
				: ({ valid: true } as const),
		),
	}
}

describe("discoverPersonalProfiles", () => {
	test("checks every ancestor layer and deduplicates profiles", async () => {
		const testDeps = deps({
			[ROOT]: [
				".env.personal.alice.enc",
				".env.production.enc",
				".env.personal.inaccessible.enc",
			],
			[SUBDIR]: [".env.personal.alice.enc", ".env.personal.bob.enc"],
		})

		const result = await discoverPersonalProfiles(
			{
				invocationDir: SUBDIR,
				decryptionContext: context,
			},
			testDeps,
		)

		expect(result).toEqual({
			discovered: ["personal.alice", "personal.bob", "personal.inaccessible"],
			accessible: ["personal.alice", "personal.bob"],
		})
		expect(
			testDeps.decryptEnvironmentData.mock.calls.filter(
				(call) => call[0] === "personal.alice",
			),
		).toHaveLength(2)
	})

	test("local-only scans only the invocation directory", async () => {
		const testDeps = deps({
			[ROOT]: [".env.personal.root.enc"],
			[SUBDIR]: [".env.personal.local.enc"],
		})

		const result = await discoverPersonalProfiles(
			{
				invocationDir: SUBDIR,
				localOnly: true,
				decryptionContext: context,
			},
			testDeps,
		)

		expect(result).toEqual({
			discovered: ["personal.local"],
			accessible: ["personal.local"],
		})
		expect(testDeps.readdir.mock.calls).toEqual([[SUBDIR]])
		expect(testDeps.resolveProjectRoot).not.toHaveBeenCalled()
	})
})

describe("legacy personal profile discovery", () => {
	test("finds only decryptable legacy layers whose names match public-key aliases", async () => {
		const testDeps = deps(
			{
				[ROOT]: [
					".env.alice.enc",
					".env.orphan.enc",
					".env.locked.enc",
					".env.development.enc",
					".env.personal.named.enc",
				],
				[SUBDIR]: [".env.alice.enc"],
				[path.join(ROOT, ".dotenc")]: [
					"alice.pub",
					"locked.pub",
					"development.pub",
					"personal.named.pub",
				],
			},
			new Set(["locked"]),
		)

		const result = await discoverPossibleLegacyProfiles(
			{
				invocationDir: SUBDIR,
				decryptionContext: context,
			},
			testDeps,
		)

		expect(result).toEqual([
			{ name: "alice", layerCount: 2, requiresAllLayers: true },
		])
		expect(
			testDeps.decryptEnvironmentData.mock.calls.filter(
				(call) => call[0] === "alice",
			),
		).toHaveLength(2)
		expect(
			testDeps.decryptEnvironmentData.mock.calls.some(
				(call) => call[0] === "orphan",
			),
		).toBe(false)
		expect(
			testDeps.decryptEnvironmentData.mock.calls.some(
				(call) => call[0] === "development",
			),
		).toBe(false)
	})

	test("checks an explicit legacy profile under its source name across all layers", async () => {
		const testDeps = deps({
			[ROOT]: [".env.alice.enc"],
			[SUBDIR]: [".env.alice.enc"],
		})

		const result = await discoverLegacyProfile(
			"alice",
			{
				invocationDir: SUBDIR,
				decryptionContext: context,
			},
			testDeps,
		)

		expect(result).toEqual({
			name: "alice",
			layerCount: 2,
			requiresAllLayers: true,
		})
		expect(testDeps.decryptEnvironmentData.mock.calls).toHaveLength(2)
		expect(
			testDeps.decryptEnvironmentData.mock.calls.every(
				(call) => call[0] === "alice",
			),
		).toBe(true)
	})

	test("suppresses inaccessible and non-alias candidates without logging errors", async () => {
		const testDeps = deps(
			{
				[ROOT]: [".env.locked.enc", ".env.orphan.enc"],
				[SUBDIR]: [],
				[path.join(ROOT, ".dotenc")]: ["locked.pub"],
			},
			new Set(["locked"]),
		)
		const errSpy = spyOn(console, "error").mockImplementation(() => {})

		const result = await discoverPossibleLegacyProfiles(
			{
				invocationDir: SUBDIR,
				decryptionContext: context,
			},
			testDeps,
		)

		expect(result).toEqual([])
		expect(errSpy).not.toHaveBeenCalled()
		errSpy.mockRestore()
	})

	test("ignores an alias whose fingerprint is not a recipient in every layer", async () => {
		const testDeps = deps(
			{
				[ROOT]: [".env.alice.enc"],
				[SUBDIR]: [".env.alice.enc"],
				[path.join(ROOT, ".dotenc")]: ["alice.pub"],
			},
			new Set(),
			{ alice: ["fingerprint:someone-else"] },
		)

		const result = await discoverPossibleLegacyProfiles(
			{
				invocationDir: SUBDIR,
				decryptionContext: context,
			},
			testDeps,
		)

		expect(result).toEqual([])
		expect(testDeps.decryptEnvironmentData).not.toHaveBeenCalled()
	})

	test("silently ignores an invalid public key used only as an advisory alias", async () => {
		const testDeps = deps(
			{
				[ROOT]: [".env.alice.enc"],
				[SUBDIR]: [],
				[path.join(ROOT, ".dotenc")]: ["alice.pub"],
			},
			new Set(),
			{},
			new Set(["alice"]),
		)
		const errSpy = spyOn(console, "error").mockImplementation(() => {})

		const result = await discoverPossibleLegacyProfiles(
			{
				invocationDir: SUBDIR,
				decryptionContext: context,
			},
			testDeps,
		)

		expect(result).toEqual([])
		expect(errSpy).not.toHaveBeenCalled()
		errSpy.mockRestore()
	})

	test("local-only ignores legacy layers outside the invocation directory", async () => {
		const testDeps = deps({
			[ROOT]: [".env.root.enc"],
			[SUBDIR]: [".env.local.enc"],
			[path.join(ROOT, ".dotenc")]: ["root.pub", "local.pub"],
		})

		const result = await discoverPossibleLegacyProfiles(
			{
				invocationDir: SUBDIR,
				localOnly: true,
				decryptionContext: context,
			},
			testDeps,
		)

		expect(result).toEqual([
			{ name: "local", layerCount: 1, requiresAllLayers: false },
		])
		expect(testDeps.buildAncestorChain).not.toHaveBeenCalled()
	})

	test("marks one legacy ancestor layer as requiring --all-layers", async () => {
		const testDeps = deps({
			[ROOT]: [".env.alice.enc"],
			[SUBDIR]: [],
		})

		const result = await discoverLegacyProfile(
			"alice",
			{
				invocationDir: SUBDIR,
				decryptionContext: context,
			},
			testDeps,
		)

		expect(result).toEqual({
			name: "alice",
			layerCount: 1,
			requiresAllLayers: true,
		})
	})
})
