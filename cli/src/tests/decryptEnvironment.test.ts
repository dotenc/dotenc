import { describe, expect, mock, spyOn, test } from "bun:test"
import crypto from "node:crypto"
import {
	createDecryptEnvironmentDataContext,
	createEnvironmentAccessProbeContext,
	decryptEnvironment,
	decryptEnvironmentData,
	environmentDataKeysEqual,
	probeEnvironmentAccess,
	reencryptEnvironmentData,
} from "../helpers/decryptEnvironment"
import type {
	GetPrivateKeysOptions,
	PrivateKeyEntry,
} from "../helpers/getPrivateKeys"
import type { Environment } from "../schemas/environment"

type DecryptEnvironmentDataDeps = NonNullable<
	Parameters<typeof decryptEnvironmentData>[2]
>
type DecryptEnvironmentDeps = NonNullable<
	Parameters<typeof decryptEnvironment>[1]
>
type EnvironmentDataKeyComparisonDeps = NonNullable<
	Parameters<typeof environmentDataKeysEqual>[2]
>
type EnvironmentAccessProbeDeps = Parameters<typeof probeEnvironmentAccess>[1]

function makePrivateKeyEntry(
	fingerprint: string,
	name = "id_ed25519",
): PrivateKeyEntry {
	const keyPair = crypto.generateKeyPairSync("ed25519")
	return {
		name,
		privateKey: keyPair.privateKey,
		fingerprint,
		algorithm: "ed25519",
	}
}

function makeEnvironment(
	fingerprints: string | string[],
	name = "alice",
): Environment {
	const normalizedFingerprints = Array.isArray(fingerprints)
		? fingerprints
		: [fingerprints]
	return {
		keys: normalizedFingerprints.map((fingerprint, index) => ({
			name: index === 0 ? name : `${name}-${index + 1}`,
			fingerprint,
			encryptedDataKey: Buffer.from("encrypted-data-key").toString("base64"),
			algorithm: "ed25519",
		})),
		encryptedContent: Buffer.from("encrypted-content").toString("base64"),
	}
}

describe("probeEnvironmentAccess", () => {
	test("unwraps only, clears the data key, and suppresses key-loader diagnostics", async () => {
		const unwrappedDataKey = Buffer.alloc(32, 17)
		const decryptData = mock(async () => "SECRET=value")
		const getPrivateKeys = mock(async (_options?: GetPrivateKeysOptions) => ({
			keys: [makePrivateKeyEntry("fp-match")],
			passphraseProtectedKeys: [],
		}))
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys,
			decryptDataKey: (() => unwrappedDataKey) as never,
			decryptData: decryptData as never,
		}

		expect(
			await probeEnvironmentAccess(makeEnvironment("fp-match"), deps),
		).toEqual({ status: "accessible" })
		expect(decryptData).not.toHaveBeenCalled()
		expect(unwrappedDataKey).toEqual(Buffer.alloc(32))
		expect(getPrivateKeys).toHaveBeenCalledTimes(1)
		expect(getPrivateKeys.mock.calls[0][0]).toMatchObject({
			environmentKeyErrorMode: "collect",
		})
		const diagnosticLogger = getPrivateKeys.mock.calls[0][0]?.logError
		expect(diagnosticLogger).toBeFunction()
		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		diagnosticLogger?.("provider detail that must not be logged")
		expect(errSpy).not.toHaveBeenCalled()
		errSpy.mockRestore()
	})

	test("uses recipient fingerprints rather than display aliases", async () => {
		const decryptDataKey = mock(() => Buffer.alloc(32, 1))
		const localKey = makePrivateKeyEntry("fp-local", "same-alias")
		const environment = makeEnvironment("fp-recipient", "same-alias")
		const deps: EnvironmentAccessProbeDeps = {
			getPrivateKeys: async () => ({
				keys: [localKey],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: decryptDataKey as never,
		}

		expect(await probeEnvironmentAccess(environment, deps)).toEqual({
			status: "inaccessible",
		})
		expect(decryptDataKey).not.toHaveBeenCalled()
	})

	test("classifies a corrupt wrapped data key without exposing the failure", async () => {
		const deps: EnvironmentAccessProbeDeps = {
			getPrivateKeys: async () => ({
				keys: [makePrivateKeyEntry("fp-match")],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: () => {
				throw new Error("raw cryptographic failure: private detail")
			},
		}

		const result = await probeEnvironmentAccess(
			makeEnvironment("fp-match"),
			deps,
		)
		expect(result).toEqual({ status: "corrupt-data-key" })
		expect(JSON.stringify(result)).not.toContain("private detail")
	})

	test("clears an invalid-length unwrapped key before reporting corruption", async () => {
		const invalidDataKey = Buffer.alloc(31, 23)
		const deps: EnvironmentAccessProbeDeps = {
			getPrivateKeys: async () => ({
				keys: [makePrivateKeyEntry("fp-match")],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: (() => invalidDataKey) as never,
		}

		expect(
			await probeEnvironmentAccess(makeEnvironment("fp-match"), deps),
		).toEqual({ status: "corrupt-data-key" })
		expect(invalidDataKey).toEqual(Buffer.alloc(31))
	})

	test("continues from a corrupt local wrap to a valid local wrap and clears both keys", async () => {
		const corruptKey = makePrivateKeyEntry("fp-corrupt", "id_corrupt")
		const validKey = makePrivateKeyEntry("fp-valid", "id_valid")
		const invalidDataKey = Buffer.alloc(31, 19)
		const validDataKey = Buffer.alloc(32, 29)
		const decryptDataKey = mock((privateKey: PrivateKeyEntry) =>
			privateKey.fingerprint === "fp-corrupt" ? invalidDataKey : validDataKey,
		)
		const deps: EnvironmentAccessProbeDeps = {
			getPrivateKeys: async () => ({
				keys: [corruptKey, validKey],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: decryptDataKey as never,
		}

		expect(
			await probeEnvironmentAccess(
				makeEnvironment(["fp-corrupt", "fp-valid"]),
				deps,
			),
		).toEqual({ status: "accessible" })
		expect(decryptDataKey).toHaveBeenCalledTimes(2)
		expect(invalidDataKey).toEqual(Buffer.alloc(31))
		expect(validDataKey).toEqual(Buffer.alloc(32))
	})

	test.each([
		["corrupt first", ["fp-corrupt", "fp-valid"]],
		["valid first", ["fp-valid", "fp-corrupt"]],
	] as const)("is accessible with matching local keys in %s order", async (_label, order) => {
		const keysByFingerprint = new Map([
			["fp-corrupt", makePrivateKeyEntry("fp-corrupt", "id_corrupt")],
			["fp-valid", makePrivateKeyEntry("fp-valid", "id_valid")],
		])
		const validDataKey = Buffer.alloc(32, 31)
		const decryptDataKey = mock((privateKey: PrivateKeyEntry) => {
			if (privateKey.fingerprint === "fp-corrupt") {
				throw new Error("corrupt wrapped key")
			}
			return validDataKey
		})
		const discoverOnePasswordKeyCandidates = mock(async () => ({
			status: "unavailable" as const,
			keys: [],
			unsupportedKeys: [],
			unavailableAccounts: [],
		}))
		const deps: EnvironmentAccessProbeDeps = {
			getPrivateKeys: async () => ({
				keys: order.map((fingerprint) => {
					const key = keysByFingerprint.get(fingerprint)
					if (!key) throw new Error("missing test key")
					return key
				}),
				passphraseProtectedKeys: [],
			}),
			discoverOnePasswordKeyCandidates,
			decryptDataKey: decryptDataKey as never,
		}

		expect(
			await probeEnvironmentAccess(makeEnvironment([...order].reverse()), deps),
		).toEqual({ status: "accessible" })
		expect(validDataKey).toEqual(Buffer.alloc(32))
		expect(discoverOnePasswordKeyCandidates).not.toHaveBeenCalled()
	})

	test("defers corrupt classification to inconclusive provider evidence", async () => {
		const localKey = makePrivateKeyEntry("fp-local")
		const decryptDataKey = mock(() => {
			throw new Error("corrupt wrapped key")
		})
		const baseDeps: EnvironmentAccessProbeDeps = {
			getPrivateKeys: async () => ({
				keys: [localKey],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: decryptDataKey as never,
		}

		expect(
			await probeEnvironmentAccess(makeEnvironment("fp-local"), {
				...baseDeps,
				discoverOnePasswordKeyCandidates: async () => ({
					status: "unavailable",
					keys: [],
					unsupportedKeys: [],
					unavailableAccounts: [],
				}),
			}),
		).toEqual({
			status: "provider-inconclusive",
			provider: "1password",
			reason: "discovery-unavailable",
		})

		expect(
			await probeEnvironmentAccess(makeEnvironment("fp-local"), {
				...baseDeps,
				discoverOnePasswordKeyCandidates: async () => ({
					status: "available",
					keys: [],
					unsupportedKeys: [],
					unavailableAccounts: [],
				}),
			}),
		).toEqual({ status: "corrupt-data-key" })
	})

	test("keeps passphrase-protected local access inconclusive after corrupt usable wraps", async () => {
		const deps: EnvironmentAccessProbeDeps = {
			getPrivateKeys: async () => ({
				keys: [makePrivateKeyEntry("fp-local")],
				passphraseProtectedKeys: ["id_protected"],
			}),
			decryptDataKey: () => {
				throw new Error("corrupt wrapped key")
			},
		}

		expect(
			await probeEnvironmentAccess(makeEnvironment("fp-local"), deps),
		).toEqual({
			status: "local-key-inconclusive",
			reason: "passphrase-protected",
		})
	})

	test("sanitizes cached provider failures into a stable classification", async () => {
		const deps: EnvironmentAccessProbeDeps = {
			getPrivateKeys: async () => ({
				keys: [],
				passphraseProtectedKeys: [],
			}),
			loadCachedOnePasswordPrivateKey: async () => ({
				status: "transient-failure",
				error: new Error("raw provider exception: account detail") as never,
			}),
			decryptDataKey: (() => Buffer.alloc(32)) as never,
		}

		const result = await probeEnvironmentAccess(
			makeEnvironment("fp-provider"),
			deps,
		)
		expect(result).toEqual({
			status: "provider-inconclusive",
			provider: "1password",
			reason: "cached-key-unavailable",
		})
		expect(JSON.stringify(result)).not.toContain("account detail")

		const rejectedResult = await probeEnvironmentAccess(
			makeEnvironment("fp-provider"),
			{
				...deps,
				loadCachedOnePasswordPrivateKey: async () => {
					throw new Error("raw rejected provider promise: account detail")
				},
			},
		)
		expect(rejectedResult).toEqual({
			status: "provider-inconclusive",
			provider: "1password",
			reason: "cached-key-unavailable",
		})
		expect(JSON.stringify(rejectedResult)).not.toContain("account detail")
	})

	test("distinguishes provider discovery and partial-account failures", async () => {
		const baseDeps: EnvironmentAccessProbeDeps = {
			getPrivateKeys: async () => ({
				keys: [],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: (() => Buffer.alloc(32)) as never,
		}

		expect(
			await probeEnvironmentAccess(makeEnvironment("fp-provider"), {
				...baseDeps,
				discoverOnePasswordKeyCandidates: async () => ({
					status: "unavailable",
					keys: [],
					unsupportedKeys: [],
					unavailableAccounts: [],
				}),
			}),
		).toEqual({
			status: "provider-inconclusive",
			provider: "1password",
			reason: "discovery-unavailable",
		})

		expect(
			await probeEnvironmentAccess(makeEnvironment("fp-provider"), {
				...baseDeps,
				discoverOnePasswordKeyCandidates: async () => ({
					status: "available",
					keys: [],
					unsupportedKeys: [],
					unavailableAccounts: [
						{
							label: "sanitized account label",
							reason: "authorization-or-access-failed",
						},
					],
				}),
			}),
		).toEqual({
			status: "provider-inconclusive",
			provider: "1password",
			reason: "account-unavailable",
		})
	})

	test("shares local and provider state across an explicitly supplied context", async () => {
		const privateKey = makePrivateKeyEntry("fp-provider", "1Password / key")
		const loadPrivateKey = mock(async () => privateKey)
		const getPrivateKeys = mock(async () => ({
			keys: [],
			passphraseProtectedKeys: [],
		}))
		const discoverOnePasswordKeyCandidates = mock(async () => ({
			status: "available" as const,
			keys: [
				{
					source: "1password" as const,
					selector: "1password:a:v:i",
					name: "key",
					hint: "ed25519",
					group: { id: "a", label: "Account A" },
					publicKey: crypto.createPublicKey(privateKey.privateKey),
					fingerprint: "fp-provider",
					algorithm: "ed25519" as const,
					loadPrivateKey,
				},
			],
			unsupportedKeys: [],
			unavailableAccounts: [],
		}))
		const firstDataKey = Buffer.alloc(32, 3)
		const secondDataKey = Buffer.alloc(32, 4)
		let unwrapCalls = 0
		const context = createEnvironmentAccessProbeContext({
			getPrivateKeys,
			discoverOnePasswordKeyCandidates,
			decryptDataKey: (() =>
				unwrapCalls++ === 0 ? firstDataKey : secondDataKey) as never,
		})

		try {
			expect(
				await Promise.all([
					probeEnvironmentAccess(makeEnvironment("fp-provider"), context),
					probeEnvironmentAccess(makeEnvironment("fp-provider"), context),
				]),
			).toEqual([{ status: "accessible" }, { status: "accessible" }])
			expect(getPrivateKeys).toHaveBeenCalledTimes(1)
			expect(discoverOnePasswordKeyCandidates).toHaveBeenCalledTimes(1)
			expect(loadPrivateKey).toHaveBeenCalledTimes(1)
			expect(firstDataKey).toEqual(Buffer.alloc(32))
			expect(secondDataKey).toEqual(Buffer.alloc(32))
		} finally {
			context.dispose()
		}
	})
})

describe("decryptEnvironmentData", () => {
	test("continues from a corrupt local wrap to a later decryptable local wrap", async () => {
		const corruptKey = makePrivateKeyEntry("fp-corrupt", "id_corrupt")
		const validKey = makePrivateKeyEntry("fp-valid", "id_valid")
		const invalidDataKey = Buffer.alloc(31, 19)
		const validDataKey = Buffer.alloc(32, 29)
		const decryptData = mock(async (dataKey: Buffer) => {
			expect(dataKey).toEqual(Buffer.alloc(32, 29))
			return "OK"
		})
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({
				keys: [corruptKey, validKey],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: ((privateKey: PrivateKeyEntry) =>
				privateKey.fingerprint === "fp-corrupt"
					? invalidDataKey
					: validDataKey) as never,
			decryptData: decryptData as never,
		}

		expect(
			await decryptEnvironmentData(
				"development",
				makeEnvironment(["fp-corrupt", "fp-valid"]),
				deps,
			),
		).toBe("OK")
		expect(invalidDataKey).toEqual(Buffer.alloc(31))
		expect(validDataKey).toEqual(Buffer.alloc(32))
	})

	test("does not discover 1Password when a local key matches", async () => {
		const discover = mock(async () => ({
			status: "available" as const,
			keys: [],
			unsupportedKeys: [],
			unavailableAccounts: [],
		}))
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({
				keys: [makePrivateKeyEntry("fp-match")],
				passphraseProtectedKeys: [],
			}),
			discoverOnePasswordKeyCandidates: discover,
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "OK") as never,
		}

		expect(
			await decryptEnvironmentData(
				"test-env",
				makeEnvironment("fp-match"),
				deps,
			),
		).toBe("OK")
		expect(discover).not.toHaveBeenCalled()
	})

	test("uses a cached 1Password locator before full discovery", async () => {
		const privateKey = makePrivateKeyEntry(
			"fp-provider",
			"1Password / cached SSH key",
		)
		const loadCachedOnePasswordPrivateKey = mock(async () => ({
			status: "loaded" as const,
			privateKey,
		}))
		const discoverOnePasswordKeyCandidates = mock(async () => ({
			status: "available" as const,
			keys: [],
			unsupportedKeys: [],
			unavailableAccounts: [],
		}))
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({ keys: [], passphraseProtectedKeys: [] }),
			loadCachedOnePasswordPrivateKey,
			discoverOnePasswordKeyCandidates,
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "OK") as never,
		}

		expect(
			await decryptEnvironmentData(
				"test-env",
				makeEnvironment("fp-provider"),
				deps,
			),
		).toBe("OK")
		expect(loadCachedOnePasswordPrivateKey).toHaveBeenCalledWith([
			"fp-provider",
		])
		expect(discoverOnePasswordKeyCandidates).not.toHaveBeenCalled()
	})

	test("reuses one cached 1Password key across different recipient sets", async () => {
		const privateKey = makePrivateKeyEntry(
			"fp-provider",
			"1Password / cached SSH key",
		)
		const loadCachedOnePasswordPrivateKey = mock(async () => ({
			status: "loaded" as const,
			privateKey,
		}))
		const context = createDecryptEnvironmentDataContext({
			getPrivateKeys: async () => ({ keys: [], passphraseProtectedKeys: [] }),
			loadCachedOnePasswordPrivateKey,
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "OK") as never,
		})

		try {
			expect(
				await Promise.all([
					decryptEnvironmentData(
						"development",
						makeEnvironment(["fp-provider", "fp-teammate"]),
						context,
					),
					decryptEnvironmentData(
						"alice",
						makeEnvironment("fp-provider"),
						context,
					),
				]),
			).toEqual(["OK", "OK"])
			expect(loadCachedOnePasswordPrivateKey).toHaveBeenCalledTimes(1)
		} finally {
			context.dispose()
		}
	})

	test("loads only one matching 1Password private key after local keys miss", async () => {
		const privateKey = makePrivateKeyEntry("fp-provider", "1Password / key")
		const loadPrivateKey = mock(async () => privateKey)
		const otherLoader = mock(async () => makePrivateKeyEntry("fp-other"))
		const publicKey = crypto.createPublicKey(privateKey.privateKey)
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({ keys: [], passphraseProtectedKeys: [] }),
			discoverOnePasswordKeyCandidates: async () => ({
				status: "available",
				keys: [
					{
						source: "1password",
						selector: "1password:a:v:i",
						name: "key",
						hint: "ed25519",
						group: { id: "a", label: "a" },
						publicKey,
						fingerprint: "fp-provider",
						algorithm: "ed25519",
						loadPrivateKey,
					},
					{
						source: "1password",
						selector: "1password:b:v:i",
						name: "other",
						hint: "ed25519",
						group: { id: "b", label: "b" },
						publicKey,
						fingerprint: "fp-other",
						algorithm: "ed25519",
						loadPrivateKey: otherLoader,
					},
				],
				unsupportedKeys: [],
				unavailableAccounts: [],
			}),
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "OK") as never,
		}

		expect(
			await decryptEnvironmentData(
				"test-env",
				makeEnvironment("fp-provider"),
				deps,
			),
		).toBe("OK")
		expect(loadPrivateKey).toHaveBeenCalledTimes(1)
		expect(otherLoader).not.toHaveBeenCalled()
	})

	test("shares discovery and private-key loading across a decryption batch", async () => {
		const privateKey = makePrivateKeyEntry("fp-provider", "1Password / key")
		const loadPrivateKey = mock(async () => privateKey)
		const getPrivateKeys = mock(async () => ({
			keys: [],
			passphraseProtectedKeys: [],
		}))
		const discoverOnePasswordKeyCandidates = mock(async () => ({
			status: "available" as const,
			keys: [
				{
					source: "1password" as const,
					selector: "1password:a:v:i",
					name: "key",
					hint: "ed25519",
					group: { id: "a", label: "Account A" },
					publicKey: crypto.createPublicKey(privateKey.privateKey),
					fingerprint: "fp-provider",
					algorithm: "ed25519" as const,
					loadPrivateKey,
				},
			],
			unsupportedKeys: [],
			unavailableAccounts: [],
		}))
		const context = createDecryptEnvironmentDataContext({
			getPrivateKeys,
			discoverOnePasswordKeyCandidates,
			decryptDataKey: (() => Buffer.alloc(32, 7)) as never,
			decryptData: (async () => "OK") as never,
		})

		try {
			expect(
				await Promise.all([
					decryptEnvironmentData(
						"development",
						makeEnvironment("fp-provider"),
						context,
					),
					decryptEnvironmentData(
						"alice",
						makeEnvironment("fp-provider"),
						context,
					),
				]),
			).toEqual(["OK", "OK"])
			expect(getPrivateKeys).toHaveBeenCalledTimes(1)
			expect(discoverOnePasswordKeyCandidates).toHaveBeenCalledTimes(1)
			expect(loadPrivateKey).toHaveBeenCalledTimes(1)
		} finally {
			context.dispose()
		}
	})

	test("throws passphrase-protected error when no usable private keys exist", async () => {
		const loadCachedOnePasswordPrivateKey = mock(async () => ({
			status: "miss" as const,
		}))
		const discoverOnePasswordKeyCandidates = mock(async () => ({
			status: "available" as const,
			keys: [],
			unsupportedKeys: [],
			unavailableAccounts: [],
		}))
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({
				keys: [],
				passphraseProtectedKeys: ["id_ed25519"],
			}),
			loadCachedOnePasswordPrivateKey,
			discoverOnePasswordKeyCandidates,
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "") as never,
		}

		await expect(
			decryptEnvironmentData("test-env", makeEnvironment("fp-1"), deps),
		).rejects.toThrow("passphrase-protected")
		expect(loadCachedOnePasswordPrivateKey).toHaveBeenCalledTimes(1)
		expect(discoverOnePasswordKeyCandidates).not.toHaveBeenCalled()
	})

	test("does not discover after a transient cached 1Password failure", async () => {
		const transientError = new Error("cached provider unavailable")
		const discoverOnePasswordKeyCandidates = mock(async () => ({
			status: "available" as const,
			keys: [],
			unsupportedKeys: [],
			unavailableAccounts: [],
		}))
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({ keys: [], passphraseProtectedKeys: [] }),
			loadCachedOnePasswordPrivateKey: async () => ({
				status: "transient-failure",
				error: transientError as never,
			}),
			discoverOnePasswordKeyCandidates,
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "") as never,
		}

		await expect(
			decryptEnvironmentData("test-env", makeEnvironment("fp-1"), deps),
		).rejects.toBe(transientError)
		expect(discoverOnePasswordKeyCandidates).not.toHaveBeenCalled()
	})

	test("reuses a transient cached failure across a decryption context", async () => {
		const transientError = new Error("cached provider unavailable")
		const loadCachedOnePasswordPrivateKey = mock(async () => ({
			status: "transient-failure" as const,
			error: transientError as never,
		}))
		const discoverOnePasswordKeyCandidates = mock(async () => ({
			status: "available" as const,
			keys: [],
			unsupportedKeys: [],
			unavailableAccounts: [],
		}))
		const context = createDecryptEnvironmentDataContext({
			getPrivateKeys: async () => ({ keys: [], passphraseProtectedKeys: [] }),
			loadCachedOnePasswordPrivateKey,
			discoverOnePasswordKeyCandidates,
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "") as never,
		})

		try {
			await expect(
				decryptEnvironmentData(
					"development",
					makeEnvironment("fp-development"),
					context,
				),
			).rejects.toBe(transientError)
			await expect(
				decryptEnvironmentData(
					"personal",
					makeEnvironment("fp-personal"),
					context,
				),
			).rejects.toBe(transientError)
			expect(loadCachedOnePasswordPrivateKey).toHaveBeenCalledTimes(1)
			expect(discoverOnePasswordKeyCandidates).not.toHaveBeenCalled()
		} finally {
			context.dispose()
		}
	})

	test("throws when no private keys are found", async () => {
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({
				keys: [],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "") as never,
		}

		await expect(
			decryptEnvironmentData("test-env", makeEnvironment("fp-1"), deps),
		).rejects.toThrow("No private keys found")
	})

	test("preserves no-key guidance when 1Password is not installed", async () => {
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({ keys: [], passphraseProtectedKeys: [] }),
			discoverOnePasswordKeyCandidates: async () => ({
				status: "not-installed",
				keys: [],
				unsupportedKeys: [],
				unavailableAccounts: [],
			}),
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "") as never,
		}

		await expect(
			decryptEnvironmentData("test-env", makeEnvironment("fp-1"), deps),
		).rejects.toThrow("No private keys found")
	})

	test("preserves no-key guidance when 1Password discovery finds no supported keys", async () => {
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({ keys: [], passphraseProtectedKeys: [] }),
			discoverOnePasswordKeyCandidates: async () => ({
				status: "available",
				keys: [],
				unsupportedKeys: [],
				unavailableAccounts: [
					{
						label: "1Password - personal.example [AAAA...AAAA]",
						reason: "authorization-or-access-failed",
					},
				],
			}),
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "") as never,
		}

		await expect(
			decryptEnvironmentData("test-env", makeEnvironment("fp-1"), deps),
		).rejects.toThrow(
			"No private keys found. Please ensure you have SSH keys in ~/.ssh/ or set DOTENC_PRIVATE_KEY_BASE64. 1Password access was unavailable for: 1Password - personal.example [AAAA...AAAA].",
		)
	})

	test("reports an unsupported installed 1Password CLI version", async () => {
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({ keys: [], passphraseProtectedKeys: [] }),
			discoverOnePasswordKeyCandidates: async () => ({
				status: "unsupported-version",
				keys: [],
				unsupportedKeys: [],
				unavailableAccounts: [],
			}),
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "") as never,
		}

		await expect(
			decryptEnvironmentData("test-env", makeEnvironment("fp-1"), deps),
		).rejects.toThrow("requires op 2.x")
	})

	test("throws access denied when no key fingerprint matches", async () => {
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({
				keys: [makePrivateKeyEntry("fp-private")],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "") as never,
		}

		await expect(
			decryptEnvironmentData(
				"test-env",
				makeEnvironment("fp-environment"),
				deps,
			),
		).rejects.toThrow("Access denied to the environment.")
	})

	test("wraps data key decryption failures", async () => {
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({
				keys: [makePrivateKeyEntry("fp-match")],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: () => {
				throw new Error("decryptDataKey failed")
			},
			decryptData: (async () => "") as never,
		}

		await expect(
			decryptEnvironmentData("test-env", makeEnvironment("fp-match"), deps),
		).rejects.toThrow("Failed to decrypt the data key.")
	})

	test("decrypts environment content when authorized key matches", async () => {
		const unwrappedDataKey = Buffer.alloc(32, 7)
		const decryptDataKey = mock(
			(_privateKey: PrivateKeyEntry, _encryptedDataKey: Buffer) =>
				unwrappedDataKey,
		)
		const decryptData = mock(async () => "API_KEY=abc123")

		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({
				keys: [makePrivateKeyEntry("fp-match")],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: decryptDataKey as never,
			decryptData: decryptData as never,
		}

		const env = makeEnvironment("fp-match")
		const result = await decryptEnvironmentData("test-env", env, deps)

		expect(result).toBe("API_KEY=abc123")
		expect(decryptDataKey).toHaveBeenCalledTimes(1)
		const encryptedDataKeyArg = decryptDataKey.mock.calls[0][1] as Buffer
		expect(encryptedDataKeyArg.toString("utf-8")).toBe("encrypted-data-key")
		expect(decryptData).toHaveBeenCalledTimes(1)
		expect(unwrappedDataKey).toEqual(Buffer.alloc(32))
	})

	test("zeroes the data key when content decryption fails", async () => {
		const unwrappedDataKey = Buffer.alloc(32, 9)
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({
				keys: [makePrivateKeyEntry("fp-match")],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: (() => unwrappedDataKey) as never,
			decryptData: async () => {
				throw new Error("content decryption failed")
			},
		}

		await expect(
			decryptEnvironmentData("test-env", makeEnvironment("fp-match"), deps),
		).rejects.toThrow("content decryption failed")
		expect(unwrappedDataKey).toEqual(Buffer.alloc(32))
	})

	test("zeroes the reused data key when destination encryption fails", async () => {
		const unwrappedDataKey = Buffer.alloc(32, 11)
		const encryptFailure = new Error("destination encryption failed")
		const deps = {
			getPrivateKeys: async () => ({
				keys: [makePrivateKeyEntry("fp-match")],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: (() => unwrappedDataKey) as never,
			decryptData: (async () => "VALUE=secret") as never,
			encryptData: async () => {
				throw encryptFailure
			},
		}

		await expect(
			reencryptEnvironmentData(
				"alice",
				"personal.alice",
				makeEnvironment("fp-match"),
				deps,
			),
		).rejects.toBe(encryptFailure)
		expect(unwrappedDataKey).toEqual(Buffer.alloc(32))
	})
})

describe("environmentDataKeysEqual", () => {
	test("reuses provider discovery and private-key loading for both unwraps", async () => {
		const privateKey = makePrivateKeyEntry("fp-provider", "1Password / key")
		const loadPrivateKey = mock(async () => privateKey)
		const discoverOnePasswordKeyCandidates = mock(async () => ({
			status: "available" as const,
			keys: [
				{
					source: "1password" as const,
					selector: "1password:a:v:i",
					name: "key",
					hint: "ed25519",
					group: { id: "a", label: "Account A" },
					publicKey: crypto.createPublicKey(privateKey.privateKey),
					fingerprint: "fp-provider",
					algorithm: "ed25519" as const,
					loadPrivateKey,
				},
			],
			unsupportedKeys: [],
			unavailableAccounts: [],
		}))
		const getPrivateKeys = mock(async () => ({
			keys: [],
			passphraseProtectedKeys: [],
		}))

		expect(
			await environmentDataKeysEqual(
				makeEnvironment("fp-provider"),
				makeEnvironment("fp-provider"),
				{
					getPrivateKeys,
					discoverOnePasswordKeyCandidates,
					decryptDataKey: (() => Buffer.alloc(32, 1)) as never,
				},
			),
		).toBe(true)
		expect(getPrivateKeys).toHaveBeenCalledTimes(1)
		expect(discoverOnePasswordKeyCandidates).toHaveBeenCalledTimes(1)
		expect(loadPrivateKey).toHaveBeenCalledTimes(1)
	})

	test("returns true for equal unwrapped keys and zeroes both buffers", async () => {
		const privateKey = makePrivateKeyEntry("fp-match")
		const baseDataKey = Buffer.alloc(32, 1)
		const headDataKey = Buffer.alloc(32, 1)
		let calls = 0
		const deps: EnvironmentDataKeyComparisonDeps = {
			getPrivateKeys: async () => ({
				keys: [privateKey],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: (() =>
				calls++ === 0 ? baseDataKey : headDataKey) as never,
		}

		expect(
			await environmentDataKeysEqual(
				makeEnvironment("fp-match"),
				makeEnvironment("fp-match"),
				deps,
			),
		).toBe(true)
		expect(baseDataKey).toEqual(Buffer.alloc(32))
		expect(headDataKey).toEqual(Buffer.alloc(32))
	})

	test("compares unwrapped keys and zeroes both buffers", async () => {
		const privateKey = makePrivateKeyEntry("fp-match")
		const baseDataKey = Buffer.alloc(32, 1)
		const headDataKey = Buffer.alloc(32, 2)
		let calls = 0
		const deps: EnvironmentDataKeyComparisonDeps = {
			getPrivateKeys: async () => ({
				keys: [privateKey],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: (() =>
				calls++ === 0 ? baseDataKey : headDataKey) as never,
		}

		expect(
			await environmentDataKeysEqual(
				makeEnvironment("fp-match"),
				makeEnvironment("fp-match"),
				deps,
			),
		).toBe(false)
		expect(baseDataKey).toEqual(Buffer.alloc(32))
		expect(headDataKey).toEqual(Buffer.alloc(32))
	})

	test("zeroes the first key when the second unwrap fails", async () => {
		const privateKey = makePrivateKeyEntry("fp-match")
		const baseDataKey = Buffer.alloc(32, 3)
		let calls = 0
		const deps: EnvironmentDataKeyComparisonDeps = {
			getPrivateKeys: async () => ({
				keys: [privateKey],
				passphraseProtectedKeys: [],
			}),
			decryptDataKey: (() => {
				if (calls++ === 0) return baseDataKey
				throw new Error("second unwrap failed")
			}) as never,
		}

		await expect(
			environmentDataKeysEqual(
				makeEnvironment("fp-match"),
				makeEnvironment("fp-match"),
				deps,
			),
		).rejects.toThrow("Failed to decrypt the data key")
		expect(baseDataKey).toEqual(Buffer.alloc(32))
	})
})

describe("decryptEnvironment", () => {
	test("logs guidance when access is denied", async () => {
		const logError = mock((_message: string) => {})
		const getPrivateKeys = mock(async () => ({
			keys: [makePrivateKeyEntry("fp-private", "id_my_key")],
			passphraseProtectedKeys: [],
		}))
		const deps: DecryptEnvironmentDeps = {
			getPrivateKeys,
			getEnvironmentByName: async () =>
				makeEnvironment("fp-environment", "alice"),
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "") as never,
			logError,
		}

		await expect(decryptEnvironment("staging", deps)).rejects.toThrow(
			"Access denied to the environment.",
		)

		expect(logError).toHaveBeenCalledTimes(1)
		const message = String(logError.mock.calls[0][0])
		expect(message).toContain("You do not have access to this environment")
		expect(message).toContain("id_my_key")
		expect(message).toContain("alice")
		expect(message).toContain(
			"\nThese are your available private keys:\n- id_my_key\n",
		)
		expect(message).toContain(
			"\nPlease ask the owners of any of the following keys to grant you access:\n- alice\n",
		)
		expect(getPrivateKeys).toHaveBeenCalledTimes(1)
	})

	test("lists safe 1Password labels in access-denied guidance", async () => {
		const logError = mock((_message: string) => {})
		const loadPrivateKey = mock(async () => makePrivateKeyEntry("fp-provider"))
		const deps: DecryptEnvironmentDeps = {
			getPrivateKeys: async () => ({
				keys: [],
				passphraseProtectedKeys: [],
			}),
			discoverOnePasswordKeyCandidates: async () => ({
				status: "available",
				keys: [
					{
						source: "1password",
						selector: "1password:account:vault:item",
						name: "MacBook Pro",
						hint: "ed25519 - Private",
						group: {
							id: "1password:account",
							label: "1Password - example [ABCD...WXYZ]",
						},
						publicKey: {} as never,
						fingerprint: "fp-provider",
						algorithm: "ed25519",
						loadPrivateKey,
					},
				],
				unsupportedKeys: [],
				unavailableAccounts: [],
			}),
			getEnvironmentByName: async () =>
				makeEnvironment("fp-environment", "alice"),
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "") as never,
			logError,
		}

		await expect(decryptEnvironment("staging", deps)).rejects.toThrow(
			"Access denied to the environment.",
		)

		const message = String(logError.mock.calls[0][0])
		expect(message).toContain("1Password - example [ABCD...WXYZ] / MacBook Pro")
		expect(message).not.toContain("1password:account:vault:item")
		expect(loadPrivateKey).not.toHaveBeenCalled()
	})

	test("logs a specific error when data key decryption fails", async () => {
		const logError = mock((_message: string) => {})
		const deps: DecryptEnvironmentDeps = {
			getPrivateKeys: async () => ({
				keys: [makePrivateKeyEntry("fp-match", "id_my_key")],
				passphraseProtectedKeys: [],
			}),
			getEnvironmentByName: async () => makeEnvironment("fp-match", "alice"),
			decryptDataKey: () => {
				throw new Error("bad key")
			},
			decryptData: (async () => "") as never,
			logError,
		}

		await expect(decryptEnvironment("staging", deps)).rejects.toThrow(
			"Failed to decrypt the data key.",
		)

		expect(logError).toHaveBeenCalledTimes(1)
		expect(String(logError.mock.calls[0][0])).toContain(
			"failed to decrypt the data key",
		)
	})

	test("returns decrypted content on success without logging errors", async () => {
		const logError = mock((_message: string) => {})
		const deps: DecryptEnvironmentDeps = {
			getPrivateKeys: async () => ({
				keys: [makePrivateKeyEntry("fp-match", "id_my_key")],
				passphraseProtectedKeys: [],
			}),
			getEnvironmentByName: async () => makeEnvironment("fp-match", "alice"),
			decryptDataKey: () => Buffer.alloc(32, 1),
			decryptData: async () => "TOKEN=xyz",
			logError,
		}

		const result = await decryptEnvironment("staging", deps)
		expect(result).toBe("TOKEN=xyz")
		expect(logError).not.toHaveBeenCalled()
	})
})
