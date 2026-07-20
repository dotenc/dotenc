import { describe, expect, spyOn, test } from "bun:test"
import crypto from "node:crypto"
import {
	createEnvironmentDiffReport,
	ENVIRONMENT_DIFF_LIMITS,
	type EnvironmentDiffInput,
	EnvironmentDiffInputError,
} from "../helpers/createEnvironmentDiffReport"
import { createDataKey, encryptData } from "../helpers/crypto"
import { encryptDataKey } from "../helpers/encryptDataKey"
import { getKeyFingerprint } from "../helpers/getKeyFingerprint"
import type { Environment } from "../schemas/environment"

type RecipientFixture = {
	name: string
	fingerprint: string
	algorithm?: "rsa" | "ed25519"
}

const defaultRecipients: RecipientFixture[] = [
	{ name: "ci-production", fingerprint: "fingerprint-ci" },
]

const encode = (value: string) => Buffer.from(value, "utf-8").toString("base64")

const encryptedEnvironment = ({
	plaintext = "",
	nonce = "nonce",
	recipients = defaultRecipients,
	version = 2,
}: {
	plaintext?: string
	nonce?: string
	recipients?: RecipientFixture[]
	version?: number
} = {}) =>
	JSON.stringify({
		version,
		keys: recipients.map((recipient) => ({
			name: recipient.name,
			fingerprint: recipient.fingerprint,
			encryptedDataKey: encode(`wrapped:${nonce}:${recipient.fingerprint}`),
			algorithm: recipient.algorithm ?? "ed25519",
		})),
		encryptedContent: encode(`${nonce}\n${plaintext}`),
	})

const fixtureDecryptor = async (
	_environmentName: string,
	environment: Environment,
) => {
	const decoded = Buffer.from(environment.encryptedContent, "base64").toString(
		"utf-8",
	)
	return decoded.slice(decoded.indexOf("\n") + 1)
}

const createReport = (input: EnvironmentDiffInput) =>
	createEnvironmentDiffReport(input, { decryptEnvironment: fixtureDecryptor })

const realEncryptedEnvironment = async ({
	dataKey,
	environmentName = "production",
	plaintext,
	publicKey,
	version = 2,
}: {
	dataKey: Buffer
	environmentName?: string
	plaintext: string
	publicKey: crypto.KeyObject
	version?: 1 | 2
}): Promise<string> => {
	const publicDer = publicKey.export({ type: "spki", format: "der" }) as Buffer
	const encryptedContent = await encryptData(
		dataKey,
		plaintext,
		version >= 2 ? Buffer.from(environmentName, "utf-8") : undefined,
	)
	const encryptedKey = encryptDataKey(
		{
			algorithm: "ed25519",
			publicKey,
			rawPublicKey: Buffer.from(publicDer.subarray(publicDer.byteLength - 32)),
		},
		dataKey,
	)
	return JSON.stringify({
		version,
		keys: [
			{
				name: "ci-production",
				fingerprint: getKeyFingerprint(publicKey),
				encryptedDataKey: encryptedKey.toString("base64"),
				algorithm: "ed25519",
			},
		],
		encryptedContent: encryptedContent.toString("base64"),
	})
}

describe("createEnvironmentDiffReport", () => {
	test("reports only added, changed, and removed variable names", async () => {
		const report = await createReport({
			base: [
				{
					path: ".env.production.enc",
					content: encryptedEnvironment({
						plaintext: "UNCHANGED=same\nCHANGED=before\nREMOVED=secret",
						nonce: "base",
					}),
				},
			],
			head: [
				{
					path: ".env.production.enc",
					content: encryptedEnvironment({
						plaintext: "ADDED=new-secret\nCHANGED=after\nUNCHANGED=same",
						nonce: "head",
					}),
				},
			],
		})

		expect(report.schemaVersion).toBe(1)
		expect(report.environments).toHaveLength(1)
		expect(report.environments[0].variables).toEqual({
			status: "available",
			added: ["ADDED"],
			changed: ["CHANGED"],
			removed: ["REMOVED"],
		})
		const serialized = JSON.stringify(report)
		expect(serialized).not.toContain("new-secret")
		expect(serialized).not.toContain("before")
		expect(serialized).not.toContain("after")
	})

	test("omits formatting-only changes", async () => {
		const report = await createEnvironmentDiffReport(
			{
				base: [
					{
						path: ".env.staging.enc",
						content: encryptedEnvironment({
							plaintext: "FOO=bar\nQUOTED=value",
							nonce: "base",
						}),
					},
				],
				head: [
					{
						path: ".env.staging.enc",
						content: encryptedEnvironment({
							plaintext: '# comment\nFOO = "bar"\n\nQUOTED=value\n',
							nonce: "head",
						}),
					},
				],
			},
			{
				decryptEnvironment: fixtureDecryptor,
				dataKeysEqual: async () => false,
			},
		)

		expect(report.environments).toEqual([])
	})

	test("does not claim rotation without a data-key comparator", async () => {
		const base = encryptedEnvironment({ plaintext: "TOKEN=same", nonce: "old" })
		const head = encryptedEnvironment({ plaintext: "TOKEN=same", nonce: "new" })
		expect(base).not.toBe(head)

		const report = await createReport({
			base: [{ path: ".env.production.enc", content: base }],
			head: [{ path: ".env.production.enc", content: head }],
		})

		expect(report).toEqual({ schemaVersion: 1, environments: [] })
	})

	test("uses the reserved empty modified entry for a proven data-key-only change", async () => {
		const report = await createEnvironmentDiffReport(
			{
				base: [
					{
						path: ".env.production.enc",
						content: encryptedEnvironment({
							plaintext: "TOKEN=same",
							nonce: "base",
						}),
					},
				],
				head: [
					{
						path: ".env.production.enc",
						content: encryptedEnvironment({
							plaintext: "TOKEN=same",
							nonce: "head",
						}),
					},
				],
			},
			{
				decryptEnvironment: fixtureDecryptor,
				dataKeysEqual: async () => false,
			},
		)

		expect(report).toEqual({
			schemaVersion: 1,
			environments: [
				{
					path: ".env.production.enc",
					name: "production",
					status: "modified",
					variables: {
						status: "available",
						added: [],
						changed: [],
						removed: [],
					},
					access: {
						status: "available",
						grants: [],
						revocations: [],
						renames: [],
					},
				},
			],
		})
	})

	test("treats a missing legacy version as explicit v1 during rotation proof", async () => {
		const baseEnvironment = JSON.parse(
			encryptedEnvironment({
				plaintext: "TOKEN=same",
				nonce: "base",
				version: 1,
			}),
		) as Record<string, unknown>
		delete baseEnvironment.version

		let comparisons = 0
		const report = await createEnvironmentDiffReport(
			{
				base: [
					{
						path: ".env.production.enc",
						content: JSON.stringify(baseEnvironment),
					},
				],
				head: [
					{
						path: ".env.production.enc",
						content: encryptedEnvironment({
							plaintext: "TOKEN=same",
							nonce: "head",
							version: 1,
						}),
					},
				],
			},
			{
				decryptEnvironment: fixtureDecryptor,
				dataKeysEqual: async () => {
					comparisons++
					return false
				},
			},
		)

		expect(comparisons).toBe(1)
		expect(report.environments).toHaveLength(1)
		expect(report.environments[0].status).toBe("modified")
	})

	test("does not claim rotation when version or recipient metadata changed", async () => {
		const base = encryptedEnvironment({
			plaintext: "TOKEN=same",
			nonce: "base",
		})

		const cases = [
			{
				name: "version changed",
				head: encryptedEnvironment({
					plaintext: "TOKEN=same",
					nonce: "head",
					version: 1,
				}),
			},
			{
				name: "recipient algorithm changed",
				head: encryptedEnvironment({
					plaintext: "TOKEN=same",
					nonce: "head",
					recipients: [
						{
							name: "ci-production",
							fingerprint: "fingerprint-ci",
							algorithm: "rsa",
						},
					],
				}),
			},
		]

		for (const fixture of cases) {
			let comparisons = 0
			const report = await createEnvironmentDiffReport(
				{
					base: [{ path: ".env.production.enc", content: base }],
					head: [{ path: ".env.production.enc", content: fixture.head }],
				},
				{
					decryptEnvironment: fixtureDecryptor,
					dataKeysEqual: async () => {
						comparisons++
						return false
					},
				},
			)

			expect(report.environments, fixture.name).toEqual([])
			expect(comparisons, fixture.name).toBe(0)
		}
	})

	test("rejects a changed key when any unchanged recipient wrapper makes rotation inconsistent", async () => {
		const base = encryptedEnvironment({
			plaintext: "TOKEN=same",
			nonce: "base",
		})
		const head = JSON.parse(
			encryptedEnvironment({ plaintext: "TOKEN=same", nonce: "head" }),
		) as { keys: Array<{ encryptedDataKey: string }> }
		head.keys[0].encryptedDataKey = (
			JSON.parse(base) as { keys: Array<{ encryptedDataKey: string }> }
		).keys[0].encryptedDataKey

		await expect(
			createEnvironmentDiffReport(
				{
					base: [{ path: ".env.production.enc", content: base }],
					head: [
						{
							path: ".env.production.enc",
							content: JSON.stringify(head),
						},
					],
				},
				{
					decryptEnvironment: fixtureDecryptor,
					dataKeysEqual: async () => false,
				},
			),
		).rejects.toThrow("Data key rotation could not be verified safely.")
	})

	test("replaces invalid data-key comparator results with a static safe failure", async () => {
		const sentinel = "SENTINEL_DATA_KEY_MATERIAL"
		const base = encryptedEnvironment({
			plaintext: "TOKEN=same",
			nonce: "base",
		})
		const head = encryptedEnvironment({
			plaintext: "TOKEN=same",
			nonce: "head",
		})

		for (const dataKeysEqual of [
			async () => {
				throw new Error(sentinel)
			},
			async () => undefined as never,
		]) {
			try {
				await createEnvironmentDiffReport(
					{
						base: [{ path: ".env.production.enc", content: base }],
						head: [{ path: ".env.production.enc", content: head }],
					},
					{ decryptEnvironment: fixtureDecryptor, dataKeysEqual },
				)
				throw new Error("expected comparison to fail")
			} catch (error) {
				expect(String(error)).toContain(
					"Data key comparison could not be completed safely.",
				)
				expect(String(error)).not.toContain(sentinel)
			}
		}
	})

	test("compares access by fingerprint, including grants, revocations, and renames", async () => {
		const report = await createReport({
			base: [
				{
					path: ".env.production.enc",
					content: encryptedEnvironment({
						plaintext: "TOKEN=same",
						nonce: "base",
						recipients: [
							{ name: "old-ci", fingerprint: "fingerprint-rename" },
							{ name: "contractor", fingerprint: "fingerprint-revoke" },
							{ name: "owner", fingerprint: "fingerprint-stable" },
						],
					}),
				},
			],
			head: [
				{
					path: ".env.production.enc",
					content: encryptedEnvironment({
						plaintext: "TOKEN=same",
						nonce: "head",
						recipients: [
							{ name: "new-ci", fingerprint: "fingerprint-rename" },
							{ name: "owner", fingerprint: "fingerprint-stable" },
							{ name: "release", fingerprint: "fingerprint-grant" },
						],
					}),
				},
			],
		})

		expect(report.environments[0].access).toEqual({
			status: "available",
			grants: [{ name: "release", fingerprint: "fingerprint-grant" }],
			revocations: [{ name: "contractor", fingerprint: "fingerprint-revoke" }],
			renames: [
				{
					fingerprint: "fingerprint-rename",
					from: "old-ci",
					to: "new-ci",
				},
			],
		})
	})

	test("reports added and deleted environments at stable monorepo paths", async () => {
		const report = await createReport({
			base: [
				{
					path: "packages/worker/.env.legacy.enc",
					content: encryptedEnvironment({ plaintext: "OLD_TOKEN=value" }),
				},
			],
			head: [
				{
					path: "apps/api/.env.production.enc",
					content: encryptedEnvironment({ plaintext: "NEW_TOKEN=value" }),
				},
			],
		})

		expect(
			report.environments.map(({ path, name, status }) => ({
				path,
				name,
				status,
			})),
		).toEqual([
			{
				path: "apps/api/.env.production.enc",
				name: "production",
				status: "added",
			},
			{
				path: "packages/worker/.env.legacy.enc",
				name: "legacy",
				status: "deleted",
			},
		])
		expect(report.environments[0].variables.added).toEqual(["NEW_TOKEN"])
		expect(report.environments[0].access.grants).toEqual([
			{ name: "ci-production", fingerprint: "fingerprint-ci" },
		])
		expect(report.environments[1].variables.removed).toEqual(["OLD_TOKEN"])
		expect(report.environments[1].access.revocations).toEqual([
			{ name: "ci-production", fingerprint: "fingerprint-ci" },
		])
	})

	test("keeps access changes when one side cannot be decrypted", async () => {
		const privateKeySentinel = [
			"-----BEGIN OPENSSH PRIVATE KEY-----",
			"DO-NOT-LEAK",
			"-----END OPENSSH PRIVATE KEY-----",
		].join("\n")
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})
		try {
			const report = await createEnvironmentDiffReport(
				{
					base: [
						{
							path: ".env.production.enc",
							content: encryptedEnvironment({
								plaintext: "SECRET=base-value",
								nonce: "base-fails",
							}),
						},
					],
					head: [
						{
							path: ".env.production.enc",
							content: encryptedEnvironment({
								plaintext: "SECRET=head-value",
								nonce: "head",
								recipients: [
									...defaultRecipients,
									{ name: "new-ci", fingerprint: "fingerprint-new" },
								],
							}),
						},
					],
				},
				{
					decryptEnvironment: async (_name, environment) => {
						const decoded = Buffer.from(
							environment.encryptedContent,
							"base64",
						).toString("utf-8")
						if (decoded.startsWith("base-fails")) {
							throw new Error(`decrypt failed: ${privateKeySentinel}`)
						}
						return decoded.slice(decoded.indexOf("\n") + 1)
					},
				},
			)

			expect(report.environments[0].variables).toEqual({
				status: "unavailable",
				added: [],
				changed: [],
				removed: [],
				reason: {
					code: "base_decryption_failed",
					message:
						"Variable diff unavailable because the base environment could not be decrypted.",
				},
			})
			expect(report.environments[0].access.grants).toEqual([
				{ name: "new-ci", fingerprint: "fingerprint-new" },
			])
			const serialized = JSON.stringify(report)
			expect(serialized).not.toContain("base-value")
			expect(serialized).not.toContain("head-value")
			expect(serialized).not.toContain("DO-NOT-LEAK")
			expect(serialized).not.toContain("OPENSSH PRIVATE KEY")
			expect(errorSpy).not.toHaveBeenCalled()
		} finally {
			errorSpy.mockRestore()
		}
	})

	test("cryptographically distinguishes rotation from randomized same-key re-encryption", async () => {
		const originalBase64Key = process.env.DOTENC_PRIVATE_KEY_BASE64
		const originalRawKey = process.env.DOTENC_PRIVATE_KEY
		const keyPair = crypto.generateKeyPairSync("ed25519")
		const privateKeyPem = keyPair.privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString()
		const baseDataKey = Buffer.alloc(32, 0x31)
		const rotatedDataKey = Buffer.alloc(32, 0x32)

		try {
			process.env.DOTENC_PRIVATE_KEY_BASE64 = Buffer.from(
				privateKeyPem,
				"utf-8",
			).toString("base64")
			delete process.env.DOTENC_PRIVATE_KEY

			const base = await realEncryptedEnvironment({
				dataKey: baseDataKey,
				plaintext: "TOKEN=same",
				publicKey: keyPair.publicKey,
			})
			const sameKeyHead = await realEncryptedEnvironment({
				dataKey: baseDataKey,
				plaintext: "TOKEN=same",
				publicKey: keyPair.publicKey,
			})
			const rotatedHead = await realEncryptedEnvironment({
				dataKey: rotatedDataKey,
				plaintext: "TOKEN=same",
				publicKey: keyPair.publicKey,
			})
			const parsedBase = JSON.parse(base) as {
				encryptedContent: string
				keys: Array<{ encryptedDataKey: string }>
			}
			const parsedSameKeyHead = JSON.parse(sameKeyHead) as typeof parsedBase
			expect(parsedSameKeyHead.encryptedContent).not.toBe(
				parsedBase.encryptedContent,
			)
			expect(parsedSameKeyHead.keys[0].encryptedDataKey).not.toBe(
				parsedBase.keys[0].encryptedDataKey,
			)

			const sameKeyReport = await createEnvironmentDiffReport(
				{
					base: [{ path: ".env.production.enc", content: base }],
					head: [{ path: ".env.production.enc", content: sameKeyHead }],
				},
				{ privateKeySource: "environment" },
			)
			expect(sameKeyReport.environments).toEqual([])

			const rotatedReport = await createEnvironmentDiffReport(
				{
					base: [{ path: ".env.production.enc", content: base }],
					head: [{ path: ".env.production.enc", content: rotatedHead }],
				},
				{ privateKeySource: "environment" },
			)
			expect(rotatedReport.environments).toEqual([
				{
					path: ".env.production.enc",
					name: "production",
					status: "modified",
					variables: {
						status: "available",
						added: [],
						changed: [],
						removed: [],
					},
					access: {
						status: "available",
						grants: [],
						revocations: [],
						renames: [],
					},
				},
			])
			const serialized = JSON.stringify(rotatedReport)
			expect(serialized).not.toContain(baseDataKey.toString("base64"))
			expect(serialized).not.toContain(rotatedDataKey.toString("base64"))
			expect(serialized).not.toContain(baseDataKey.toString("hex"))
			expect(serialized).not.toContain(rotatedDataKey.toString("hex"))
			expect(serialized).not.toContain("PRIVATE KEY")
		} finally {
			baseDataKey.fill(0)
			rotatedDataKey.fill(0)
			if (originalBase64Key === undefined) {
				delete process.env.DOTENC_PRIVATE_KEY_BASE64
			} else {
				process.env.DOTENC_PRIVATE_KEY_BASE64 = originalBase64Key
			}
			if (originalRawKey === undefined) {
				delete process.env.DOTENC_PRIVATE_KEY
			} else {
				process.env.DOTENC_PRIVATE_KEY = originalRawKey
			}
		}
	})

	test("decrypts with only the dedicated environment key in CI mode", async () => {
		const originalBase64Key = process.env.DOTENC_PRIVATE_KEY_BASE64
		const originalRawKey = process.env.DOTENC_PRIVATE_KEY
		const keyPair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
		const privateKeyPem = keyPair.privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString()
		const fingerprint = getKeyFingerprint(keyPair.publicKey)
		const dataKey = createDataKey()
		const encryptedContent = await encryptData(
			dataKey,
			"REAL_SECRET=sentinel-real-value",
			Buffer.from("production", "utf-8"),
		)
		const encryptedKey = encryptDataKey(
			{ algorithm: "rsa", publicKey: keyPair.publicKey },
			dataKey,
		)
		const content = JSON.stringify({
			version: 2,
			keys: [
				{
					name: "ci-production",
					fingerprint,
					encryptedDataKey: encryptedKey.toString("base64"),
					algorithm: "rsa",
				},
			],
			encryptedContent: encryptedContent.toString("base64"),
		})

		try {
			process.env.DOTENC_PRIVATE_KEY_BASE64 = Buffer.from(
				privateKeyPem,
				"utf-8",
			).toString("base64")
			delete process.env.DOTENC_PRIVATE_KEY

			const report = await createEnvironmentDiffReport(
				{
					base: [],
					head: [{ path: ".env.production.enc", content }],
				},
				{ privateKeySource: "environment" },
			)

			expect(report.environments[0].variables.added).toEqual(["REAL_SECRET"])
			expect(JSON.stringify(report)).not.toContain("sentinel-real-value")
			expect(JSON.stringify(report)).not.toContain("PRIVATE KEY")
		} finally {
			if (originalBase64Key === undefined) {
				delete process.env.DOTENC_PRIVATE_KEY_BASE64
			} else {
				process.env.DOTENC_PRIVATE_KEY_BASE64 = originalBase64Key
			}
			if (originalRawKey === undefined) {
				delete process.env.DOTENC_PRIVATE_KEY
			} else {
				process.env.DOTENC_PRIVATE_KEY = originalRawKey
			}
		}
	})

	test("validates access independently when ciphertext or version is unsupported", async () => {
		const invalidHead = JSON.parse(
			encryptedEnvironment({
				plaintext: "TOKEN=head",
				recipients: [
					...defaultRecipients,
					{ name: "release", fingerprint: "fingerprint-release" },
				],
			}),
		) as Record<string, unknown>
		invalidHead.version = 99
		invalidHead.encryptedContent = "not base64"

		const report = await createReport({
			base: [
				{
					path: ".env.production.enc",
					content: encryptedEnvironment({ plaintext: "TOKEN=base" }),
				},
			],
			head: [
				{
					path: ".env.production.enc",
					content: JSON.stringify(invalidHead),
				},
			],
		})

		expect(report.environments[0].variables.status).toBe("unavailable")
		expect(report.environments[0].variables.reason?.code).toBe(
			"head_environment_invalid",
		)
		expect(report.environments[0].access.status).toBe("available")
		expect(report.environments[0].access.grants).toEqual([
			{ name: "release", fingerprint: "fingerprint-release" },
		])
	})

	test("retains access identities when recipient wrapping is malformed", async () => {
		const invalidHead = JSON.parse(
			encryptedEnvironment({
				plaintext: "TOKEN=head",
				recipients: [
					...defaultRecipients,
					{ name: "release", fingerprint: "fingerprint-release" },
				],
			}),
		) as {
			keys: Array<{ encryptedDataKey: string; algorithm: string }>
		}
		invalidHead.keys[0].encryptedDataKey = "not base64"
		invalidHead.keys[1].algorithm = "unsupported"

		const report = await createReport({
			base: [
				{
					path: ".env.production.enc",
					content: encryptedEnvironment({ plaintext: "TOKEN=base" }),
				},
			],
			head: [
				{
					path: ".env.production.enc",
					content: JSON.stringify(invalidHead),
				},
			],
		})

		expect(report.environments[0].variables.reason?.code).toBe(
			"head_environment_invalid",
		)
		expect(report.environments[0].access).toEqual({
			status: "available",
			grants: [{ name: "release", fingerprint: "fingerprint-release" }],
			revocations: [],
			renames: [],
		})
	})

	test("rejects duplicate recipient fingerprints as ambiguous metadata", async () => {
		const duplicateRecipients = encryptedEnvironment({
			plaintext: "TOKEN=value",
			recipients: [
				{ name: "alice", fingerprint: "same-fingerprint" },
				{ name: "bob", fingerprint: "same-fingerprint" },
			],
		})
		const report = await createReport({
			base: [],
			head: [{ path: ".env.production.enc", content: duplicateRecipients }],
		})

		expect(report.environments[0].access.status).toBe("unavailable")
		expect(report.environments[0].access.reason?.code).toBe(
			"head_recipient_metadata_invalid",
		)
		expect(report.environments[0].variables.reason?.code).toBe(
			"head_environment_invalid",
		)
	})

	test("rejects duplicate ciphertext members while retaining valid access metadata", async () => {
		const valid = JSON.parse(encryptedEnvironment()) as {
			keys: unknown
			encryptedContent: string
		}
		const duplicateJson = `{"version":2,"keys":${JSON.stringify(valid.keys)},"encryptedContent":"${valid.encryptedContent}","encryptedContent":"${encode("attacker replacement")}"}`
		const report = await createReport({
			base: [],
			head: [{ path: ".env.production.enc", content: duplicateJson }],
		})

		expect(report.environments[0].access.status).toBe("available")
		expect(report.environments[0].access.grants).toEqual([
			{ name: "ci-production", fingerprint: "fingerprint-ci" },
		])
		expect(report.environments[0].variables.status).toBe("unavailable")
		expect(JSON.stringify(report)).not.toContain("attacker replacement")
	})

	test("rejects duplicate JSON members inside recipient metadata as ambiguous", async () => {
		const valid = JSON.parse(encryptedEnvironment()) as {
			keys: Array<{
				fingerprint: string
				encryptedDataKey: string
				algorithm: string
			}>
			encryptedContent: string
		}
		const key = valid.keys[0]
		const duplicateRecipientJson = `{"version":2,"keys":[{"name":"first","name":"second","fingerprint":"${key.fingerprint}","encryptedDataKey":"${key.encryptedDataKey}","algorithm":"${key.algorithm}"}],"encryptedContent":"${valid.encryptedContent}"}`
		const report = await createReport({
			base: [],
			head: [{ path: ".env.production.enc", content: duplicateRecipientJson }],
		})

		expect(report.environments[0].access.reason?.code).toBe(
			"head_recipient_metadata_invalid",
		)
		expect(report.environments[0].variables.reason?.code).toBe(
			"head_environment_invalid",
		)
	})

	test("rejects duplicate dotenv variable assignments", async () => {
		const report = await createReport({
			base: [],
			head: [
				{
					path: ".env.production.enc",
					content: encryptedEnvironment({
						plaintext: "TOKEN=first-secret\nTOKEN=second-secret",
					}),
				},
			],
		})

		expect(report.environments[0].variables.reason?.code).toBe(
			"head_plaintext_invalid",
		)
		const serialized = JSON.stringify(report)
		expect(serialized).not.toContain("first-secret")
		expect(serialized).not.toContain("second-secret")
	})

	test("rejects duplicate dotenv names with punctuation or numeric prefixes", async () => {
		for (const variableName of ["A.B", "A-B", "1A"]) {
			const report = await createReport({
				base: [],
				head: [
					{
						path: `.env.${variableName}.enc`,
						content: encryptedEnvironment({
							plaintext: `${variableName}=first\n${variableName}=second`,
						}),
					},
				],
			})

			expect(report.environments[0].variables.reason?.code).toBe(
				"head_plaintext_invalid",
			)
		}
	})

	test("rejects Node parseEnv duplicate assignments after a backslash-prefixed quote", async () => {
		const report = await createReport({
			base: [],
			head: [
				{
					path: ".env.production.enc",
					content: encryptedEnvironment({
						plaintext: `A="x\\"
A=second-secret`,
					}),
				},
			],
		})

		expect(report.environments[0].variables.reason?.code).toBe(
			"head_plaintext_invalid",
		)
		expect(JSON.stringify(report)).not.toContain("second-secret")
	})

	test("does not mistake assignments inside backtick multiline values for duplicates", async () => {
		const report = await createReport({
			base: [],
			head: [
				{
					path: ".env.production.enc",
					content: encryptedEnvironment({
						plaintext: `MULTILINE=\`first
DUPLICATE=inside-value\`
DUPLICATE=outside-value`,
					}),
				},
			],
		})

		expect(report.environments[0].variables).toEqual({
			status: "available",
			added: ["DUPLICATE", "MULTILINE"],
			changed: [],
			removed: [],
		})
	})

	test("returns fixed errors for malformed encrypted JSON without raw content", async () => {
		const secretSentinel = "SENTINEL-SECRET-SHOULD-NOT-LEAK"
		const report = await createReport({
			base: [],
			head: [
				{
					path: ".env.production.enc",
					content: `{"encryptedContent":"${secretSentinel}`,
				},
			],
		})

		const serialized = JSON.stringify(report)
		expect(serialized).not.toContain(secretSentinel)
		expect(serialized.length).toBeLessThan(1000)
		expect(report.environments[0].variables.reason?.code).toBe(
			"head_environment_invalid",
		)
	})

	test("treats Markdown-like paths and recipient names as inert bounded data", async () => {
		const path = "apps/[click](javascript:alert(1))/.env.prod|<details>.enc"
		const recipientName = "[owner](javascript:alert(1)) | @everyone"
		const report = await createReport({
			base: [],
			head: [
				{
					path,
					content: encryptedEnvironment({
						plaintext: "SAFE=value",
						recipients: [
							{ name: recipientName, fingerprint: "fingerprint-owner" },
						],
					}),
				},
			],
		})

		expect(report.environments[0].path).toBe(path)
		expect(report.environments[0].access.grants[0].name).toBe(recipientName)
	})

	test("rejects oversized files before parsing with a bounded safe error", async () => {
		const sentinel = "OVERSIZED-SECRET-SENTINEL"
		const content = `${sentinel}${"x".repeat(ENVIRONMENT_DIFF_LIMITS.maxFileBytes)}`
		let caught: unknown
		try {
			await createReport({
				base: [],
				head: [{ path: ".env.production.enc", content }],
			})
		} catch (error) {
			caught = error
		}

		expect(caught).toBeInstanceOf(EnvironmentDiffInputError)
		expect((caught as EnvironmentDiffInputError).code).toBe("file_too_large")
		expect(String(caught)).not.toContain(sentinel)
		expect(String(caught).length).toBeLessThan(200)
	})

	test("enforces file-count, duplicate-path, and request-schema limits", async () => {
		const tooMany = Array.from(
			{ length: ENVIRONMENT_DIFF_LIMITS.maxFilesPerSide + 1 },
			(_, index) => ({ path: `.env.test-${index}.enc`, content: "{}" }),
		)
		await expect(
			createReport({ base: [], head: tooMany }),
		).rejects.toMatchObject({
			code: "too_many_files",
		})
		await expect(
			createReport({
				base: [],
				head: [
					{ path: ".env.test.enc", content: "{}" },
					{ path: ".env.test.enc", content: "{}" },
				],
			}),
		).rejects.toMatchObject({ code: "duplicate_path" })
		await expect(
			createEnvironmentDiffReport(
				{ base: [], head: [], extra: true } as never,
				{
					decryptEnvironment: fixtureDecryptor,
				},
			),
		).rejects.toMatchObject({ code: "invalid_request" })
	})

	test("enforces total-byte, JSON-depth, recipient-count, and variable-count limits", async () => {
		const oneMiB = "x".repeat(ENVIRONMENT_DIFF_LIMITS.maxFileBytes)
		const overTotalLimit = Array.from({ length: 11 }, (_, index) => ({
			path: `.env.large-${index}.enc`,
			content: oneMiB,
		}))
		await expect(
			createReport({ base: [], head: overTotalLimit }),
		).rejects.toMatchObject({ code: "input_too_large" })

		const tooDeep = `${'{"nested":'.repeat(
			ENVIRONMENT_DIFF_LIMITS.maxJsonDepth + 2,
		)}null${"}".repeat(ENVIRONMENT_DIFF_LIMITS.maxJsonDepth + 2)}`
		const deepReport = await createReport({
			base: [],
			head: [{ path: ".env.deep.enc", content: tooDeep }],
		})
		expect(deepReport.environments[0].variables.reason?.code).toBe(
			"head_environment_invalid",
		)

		const recipients = Array.from(
			{ length: ENVIRONMENT_DIFF_LIMITS.maxRecipientsPerEnvironment + 1 },
			(_, index) => ({
				name: `recipient-${index}`,
				fingerprint: `fingerprint-${index}`,
			}),
		)
		const recipientReport = await createReport({
			base: [],
			head: [
				{
					path: ".env.recipients.enc",
					content: encryptedEnvironment({ recipients }),
				},
			],
		})
		expect(recipientReport.environments[0].access.reason?.code).toBe(
			"head_recipient_metadata_invalid",
		)

		const variables = Array.from(
			{ length: ENVIRONMENT_DIFF_LIMITS.maxVariablesPerEnvironment + 1 },
			(_, index) => `VARIABLE_${index}=value`,
		).join("\n")
		const variableReport = await createReport({
			base: [],
			head: [
				{
					path: ".env.variables.enc",
					content: encryptedEnvironment({ plaintext: variables }),
				},
			],
		})
		expect(variableReport.environments[0].variables.reason?.code).toBe(
			"head_plaintext_invalid",
		)
	})

	test("marks oversized decrypted plaintext unavailable without revealing it", async () => {
		const report = await createEnvironmentDiffReport(
			{
				base: [],
				head: [
					{
						path: ".env.production.enc",
						content: encryptedEnvironment(),
					},
				],
			},
			{
				decryptEnvironment: async () =>
					`TOKEN=${"s".repeat(ENVIRONMENT_DIFF_LIMITS.maxPlaintextBytes)}`,
			},
		)

		expect(report.environments[0].variables.reason?.code).toBe(
			"head_plaintext_invalid",
		)
		expect(JSON.stringify(report).length).toBeLessThan(1000)
	})
})
