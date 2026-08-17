import { describe, expect, mock, spyOn, test } from "bun:test"
import crypto from "node:crypto"
import path from "node:path"
import { decryptData, encryptData } from "../helpers/crypto"
import { decryptDataKey } from "../helpers/decryptDataKey"
import {
	createDecryptEnvironmentDataContext,
	type DecryptEnvironmentDataContext,
	decryptEnvironmentData,
	probeEnvironmentAccess,
} from "../helpers/decryptEnvironment"
import {
	discoverLegacyProfile,
	discoverPersonalProfiles,
	discoverPossibleLegacyProfiles,
} from "../helpers/discoverPersonalProfiles"
import { encryptDataKey } from "../helpers/encryptDataKey"
import { getKeyFingerprint } from "../helpers/getKeyFingerprint"
import type { Environment } from "../schemas/environment"

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
	const readFile = mock(async (filePath: string) => {
		const directory = path.dirname(filePath)
		const fileName = path.basename(filePath)
		if (!(filesByDir[directory] ?? []).includes(fileName)) {
			const error = new Error(`ENOENT: ${filePath}`) as NodeJS.ErrnoException
			error.code = "ENOENT"
			throw error
		}
		return path.basename(filePath, ".pub")
	})
	const decryptEnvironmentDataMock = mock(async (name: string) => {
		if (inaccessibleNames.has(name)) throw new Error("inaccessible")
		return "decrypted"
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
		decryptEnvironmentData: decryptEnvironmentDataMock,
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

const authenticatedEnvelope = async (
	environmentName: string,
	options: { aadName?: string; tamperCiphertext?: boolean } = {},
) => {
	const keyPair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
	const fingerprint = getKeyFingerprint(keyPair.publicKey)
	const dataKey = crypto.randomBytes(32)
	let encryptedContent: Buffer
	let encryptedDataKey: Buffer
	try {
		encryptedContent = await encryptData(
			dataKey,
			"SECRET_SENTINEL=authenticated-content",
			Buffer.from(options.aadName ?? environmentName, "utf8"),
		)
		encryptedDataKey = encryptDataKey(
			{ algorithm: "rsa", publicKey: keyPair.publicKey },
			dataKey,
		)
	} finally {
		dataKey.fill(0)
	}
	if (options.tamperCiphertext) encryptedContent[12] ^= 1

	const environment: Environment = {
		version: 2,
		keys: [
			{
				name: "alice",
				fingerprint,
				encryptedDataKey: encryptedDataKey.toString("base64"),
				algorithm: "rsa",
			},
		],
		encryptedContent: encryptedContent.toString("base64"),
	}
	const decryptionContext = createDecryptEnvironmentDataContext({
		getPrivateKeys: async () => ({
			keys: [
				{
					name: "generated-test-key",
					privateKey: keyPair.privateKey,
					fingerprint,
					algorithm: "rsa" as const,
				},
			],
			passphraseProtectedKeys: [],
			unsupportedKeys: [],
		}),
		decryptDataKey,
		decryptData,
	})
	return { environment, decryptionContext, fingerprint }
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

	test("does not advertise a profile when its wrapped key unwraps but AAD authentication fails", async () => {
		const { environment, decryptionContext } = await authenticatedEnvelope(
			"personal.alice",
			{ aadName: "personal.other" },
		)
		const testDeps = deps({
			[ROOT]: [".env.personal.alice.enc"],
			[SUBDIR]: [],
		})
		try {
			expect(
				await probeEnvironmentAccess(environment, decryptionContext),
			).toEqual({ status: "accessible" })

			const result = await discoverPersonalProfiles(
				{ invocationDir: SUBDIR, decryptionContext },
				{
					...testDeps,
					getEnvironmentByPath: mock(async () => environment),
					decryptEnvironmentData,
				},
			)

			expect(result).toEqual({
				discovered: ["personal.alice"],
				accessible: [],
			})
		} finally {
			decryptionContext.dispose()
		}
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
			[path.join(ROOT, ".dotenc")]: ["alice.pub"],
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

	test("does not hint an explicit legacy profile without its public alias", async () => {
		const testDeps = deps({
			[ROOT]: [".env.alice.enc"],
			[SUBDIR]: [],
			[path.join(ROOT, ".dotenc")]: [],
		})

		const result = await discoverLegacyProfile(
			"alice",
			{
				invocationDir: SUBDIR,
				decryptionContext: context,
			},
			testDeps,
		)

		expect(result).toBeUndefined()
		expect(testDeps.readFile).toHaveBeenCalledWith(
			path.join(ROOT, ".dotenc", "alice.pub"),
		)
		expect(testDeps.decryptEnvironmentData).not.toHaveBeenCalled()
	})

	test("does not advertise legacy profiles when ciphertext authentication fails after key unwrap", async () => {
		const { environment, decryptionContext, fingerprint } =
			await authenticatedEnvelope("alice", { tamperCiphertext: true })
		const testDeps = deps({
			[ROOT]: [".env.alice.enc"],
			[SUBDIR]: [],
			[path.join(ROOT, ".dotenc")]: ["alice.pub"],
		})
		const authenticatedDeps = {
			...testDeps,
			getEnvironmentByPath: mock(async () => environment),
			getKeyFingerprint: mock(() => fingerprint),
			decryptEnvironmentData,
		}
		try {
			expect(
				await probeEnvironmentAccess(environment, decryptionContext),
			).toEqual({ status: "accessible" })

			expect(
				await discoverLegacyProfile(
					"alice",
					{ invocationDir: SUBDIR, decryptionContext },
					authenticatedDeps,
				),
			).toBeUndefined()
			expect(
				await discoverPossibleLegacyProfiles(
					{ invocationDir: SUBDIR, decryptionContext },
					authenticatedDeps,
				),
			).toEqual([])
		} finally {
			decryptionContext.dispose()
		}
	})

	test("requires the exact public alias fingerprint for an explicit legacy profile", async () => {
		const testDeps = deps(
			{
				[ROOT]: [".env.alice.enc"],
				[SUBDIR]: [],
				[path.join(ROOT, ".dotenc")]: ["alice.pub"],
			},
			new Set(),
			{ alice: ["fingerprint:someone-else"] },
		)

		const result = await discoverLegacyProfile(
			"alice",
			{
				invocationDir: SUBDIR,
				decryptionContext: context,
			},
			testDeps,
		)

		expect(result).toBeUndefined()
		expect(testDeps.readFile).toHaveBeenCalledWith(
			path.join(ROOT, ".dotenc", "alice.pub"),
		)
		expect(testDeps.decryptEnvironmentData).not.toHaveBeenCalled()
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
			[path.join(ROOT, ".dotenc")]: ["alice.pub"],
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
