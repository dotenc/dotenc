import { describe, expect, mock, test } from "bun:test"
import crypto from "node:crypto"
import {
	type GetKeyCandidatesResult,
	getKeyCandidates,
} from "../helpers/getKeyCandidates"
import type { PrivateKeyEntry } from "../helpers/getPrivateKeys"
import type { KeyCandidate } from "../helpers/keyCandidate"

function privateKeyEntry(
	name: string,
	type: "ed25519" | "ec" = "ed25519",
): PrivateKeyEntry {
	const pair =
		type === "ec"
			? crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
			: crypto.generateKeyPairSync("ed25519")
	return {
		name,
		privateKey: pair.privateKey,
		fingerprint: `${name}-fingerprint`,
		algorithm: "ed25519",
	}
}

function providerCandidate(): KeyCandidate {
	const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519")
	return {
		source: "1password",
		selector: `1password:${"A".repeat(26)}:${"V".repeat(26)}:${"I".repeat(26)}`,
		name: "GitHub",
		hint: "ed25519 - Private",
		group: { id: `1password:${"A".repeat(26)}`, label: "Account A" },
		publicKey,
		fingerprint: "provider-fingerprint",
		algorithm: "ed25519",
		loadPrivateKey: async () => ({
			name: "GitHub",
			privateKey,
			fingerprint: "provider-fingerprint",
			algorithm: "ed25519",
		}),
	}
}

describe("getKeyCandidates", () => {
	test("combines environment, filesystem, and provider keys with policy failures", async () => {
		const provider = providerCandidate()
		const providerResult: GetKeyCandidatesResult["onePassword"] = {
			status: "available",
			keys: [provider],
			unsupportedKeys: [
				{ name: "1Password / weak", reason: "RSA key is too weak" },
			],
			unavailableAccounts: [],
		}
		const result = await getKeyCandidates(
			{ includeOnePassword: true },
			{
				getPrivateKeys: async () => ({
					keys: [
						privateKeyEntry("env.DOTENC_PRIVATE_KEY_BASE64"),
						privateKeyEntry("id_ed25519"),
						privateKeyEntry("id_ecdsa", "ec"),
					],
					passphraseProtectedKeys: ["id_rsa"],
					unsupportedKeys: [
						{ name: "id_dsa", reason: "unsupported algorithm" },
					],
				}),
				discoverOnePasswordKeyCandidates: async () => providerResult,
			},
		)

		expect(result.keys.map((key) => key.source)).toEqual([
			"environment",
			"filesystem",
			"1password",
		])
		expect(result.keys.map((key) => key.selector)).toEqual([
			"env.DOTENC_PRIVATE_KEY_BASE64",
			"id_ed25519",
			provider.selector,
		])
		expect(result.passphraseProtectedKeys).toEqual(["id_rsa"])
		expect(result.unsupportedKeys).toEqual(
			expect.arrayContaining([
				{ name: "id_dsa", reason: "unsupported algorithm" },
				{ name: "1Password / weak", reason: "RSA key is too weak" },
				expect.objectContaining({ name: "id_ecdsa" }),
			]),
		)
		expect(await result.keys[0].loadPrivateKey()).toMatchObject({
			name: "env.DOTENC_PRIVATE_KEY_BASE64",
		})
	})

	test("skips 1Password discovery unless the caller explicitly opts in", async () => {
		const discoverOnePasswordKeyCandidates = mock(async () => {
			throw new Error("1Password discovery should remain lazy")
		})
		const result = await getKeyCandidates(undefined, {
			getPrivateKeys: async () => ({
				keys: [privateKeyEntry("id_ed25519")],
				passphraseProtectedKeys: [],
				unsupportedKeys: [],
			}),
			discoverOnePasswordKeyCandidates,
		})

		expect(result.keys.map((key) => key.selector)).toEqual(["id_ed25519"])
		expect(result.onePassword.status).toBe("not-requested")
		expect(discoverOnePasswordKeyCandidates).not.toHaveBeenCalled()
	})
})
