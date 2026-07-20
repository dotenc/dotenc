import { describe, expect, mock, test } from "bun:test"
import crypto from "node:crypto"
import {
	decryptEnvironment,
	decryptEnvironmentData,
	environmentDataKeysEqual,
} from "../helpers/decryptEnvironment"
import type { PrivateKeyEntry } from "../helpers/getPrivateKeys"
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

function makeEnvironment(fingerprint: string, name = "alice"): Environment {
	return {
		keys: [
			{
				name,
				fingerprint,
				encryptedDataKey: Buffer.from("encrypted-data-key").toString("base64"),
				algorithm: "ed25519",
			},
		],
		encryptedContent: Buffer.from("encrypted-content").toString("base64"),
	}
}

describe("decryptEnvironmentData", () => {
	test("throws passphrase-protected error when no usable private keys exist", async () => {
		const deps: DecryptEnvironmentDataDeps = {
			getPrivateKeys: async () => ({
				keys: [],
				passphraseProtectedKeys: ["id_ed25519"],
			}),
			decryptDataKey: (() => Buffer.alloc(32)) as never,
			decryptData: (async () => "") as never,
		}

		await expect(
			decryptEnvironmentData("test-env", makeEnvironment("fp-1"), deps),
		).rejects.toThrow("passphrase-protected")
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
})

describe("environmentDataKeysEqual", () => {
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
		const deps: DecryptEnvironmentDeps = {
			getPrivateKeys: async () => ({
				keys: [makePrivateKeyEntry("fp-private", "id_my_key")],
				passphraseProtectedKeys: [],
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

		expect(logError).toHaveBeenCalledTimes(1)
		const message = String(logError.mock.calls[0][0])
		expect(message).toContain("You do not have access to this environment")
		expect(message).toContain("id_my_key")
		expect(message).toContain("alice")
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
