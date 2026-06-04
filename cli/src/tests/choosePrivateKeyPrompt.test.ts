import { describe, expect, mock, test } from "bun:test"
import crypto from "node:crypto"
import type { PrivateKeyEntry } from "../helpers/getPrivateKeys"
import {
	_runChoosePrivateKeyPrompt,
	CREATE_NEW_PRIVATE_KEY_CHOICE,
} from "../prompts/choosePrivateKey"

type RunChoosePrivateKeyPromptDeps = NonNullable<
	Parameters<typeof _runChoosePrivateKeyPrompt>[1]
>

const createPrivateKeyEntry = (
	name: string,
	algorithm: "rsa" | "ed25519",
): PrivateKeyEntry => {
	if (algorithm === "rsa") {
		const { privateKey } = crypto.generateKeyPairSync("rsa", {
			modulusLength: 2048,
		})
		return {
			name,
			privateKey,
			fingerprint: `${name}-fingerprint`,
			algorithm,
		}
	}

	const { privateKey } = crypto.generateKeyPairSync("ed25519")
	return {
		name,
		privateKey,
		fingerprint: `${name}-fingerprint`,
		algorithm,
		rawPublicKey: Buffer.alloc(32),
	}
}

const createWeakRsaPrivateKeyEntry = (name: string): PrivateKeyEntry => {
	const { privateKey } = crypto.generateKeyPairSync("rsa", {
		modulusLength: 1024,
	})
	return {
		name,
		privateKey,
		fingerprint: `${name}-fingerprint`,
		algorithm: "rsa",
	}
}

const makeDeps = (
	overrides: Partial<RunChoosePrivateKeyPromptDeps> = {},
): RunChoosePrivateKeyPromptDeps => {
	return {
		getPrivateKeys: mock(
			async () =>
				({
					keys: [],
					passphraseProtectedKeys: [],
					unsupportedKeys: [],
				}) as never,
		) as never,
		promptConfirm: mock(async () => false) as never,
		promptSelect: mock(async () => "") as never,
		createEd25519SshKey: mock(async () => "/tmp/new-key") as never,
		createPasswordlessSshKeyCopy: mock(
			async () =>
				({
					path: "/home/tester/.ssh/id_ed25519_passwordless",
					name: "id_ed25519_passwordless",
				}) as never,
		) as never,
		homedir: () => "/home/tester",
		logInfo: mock((_message: string) => {}),
		logWarn: mock((_message: string) => {}),
		isInteractive: () => true,
		...overrides,
	}
}

describe("choosePrivateKeyPrompt", () => {
	test("shows passphrase keys as selectable and logs unsupported keys", async () => {
		const selectedKey = createPrivateKeyEntry("id_ed25519", "ed25519")

		const getPrivateKeys = mock(
			async () =>
				({
					keys: [selectedKey],
					passphraseProtectedKeys: ["id_locked"],
					unsupportedKeys: [
						{ name: "id_locked", reason: "passphrase-protected" },
						{ name: "id_ecdsa", reason: "unsupported algorithm: ec" },
					],
				}) as never,
		)
		const promptSelect = mock(async () => "id_ed25519")
		const logWarn = mock((_message: string) => {})

		const selected = await _runChoosePrivateKeyPrompt(
			"Pick key",
			makeDeps({
				getPrivateKeys: getPrivateKeys as never,
				logWarn,
				promptSelect: promptSelect as never,
			}),
		)

		expect(selected).toBe(selectedKey)
		expect(promptSelect).toHaveBeenCalledTimes(1)
		const [_message, options] = promptSelect.mock.calls[0] as unknown as [
			string,
			{ options: Array<{ label: string; value: string; hint?: string }> },
		]

		const passphraseChoice = options.options.find(
			(choice) => choice.label === "id_locked",
		)
		expect(passphraseChoice).toBeDefined()
		expect(passphraseChoice?.hint).toBe("passphrase-protected")

		expect(
			options.options.some((choice) => choice.label.includes("id_ecdsa")),
		).toBe(false)
		expect(logWarn).toHaveBeenCalledWith(expect.stringContaining("id_ecdsa"))

		expect(options.options[options.options.length - 1].value).toBe(
			CREATE_NEW_PRIVATE_KEY_CHOICE,
		)
	})

	test("creates a new key and re-prompts until a supported key is selected", async () => {
		const createdKey = createPrivateKeyEntry("id_ed25519_dotenc", "ed25519")
		let getPrivateKeysCall = 0
		const getPrivateKeys = mock(
			async () =>
				({
					keys: getPrivateKeysCall++ === 0 ? [] : [createdKey],
					passphraseProtectedKeys: ["id_old"],
					unsupportedKeys: [{ name: "id_old", reason: "passphrase-protected" }],
				}) as never,
		)

		let promptCall = 0
		const promptSelect = mock(async () => {
			promptCall += 1
			return promptCall === 1
				? CREATE_NEW_PRIVATE_KEY_CHOICE
				: "id_ed25519_dotenc"
		})

		const createEd25519SshKey = mock(async () => "/tmp/id_ed25519_dotenc")
		const logInfo = mock((_message: string) => {})
		const logWarn = mock((_message: string) => {})

		const selected = await _runChoosePrivateKeyPrompt(
			"Pick key",
			makeDeps({
				getPrivateKeys: getPrivateKeys as never,
				promptSelect: promptSelect as never,
				createEd25519SshKey: createEd25519SshKey as never,
				logInfo,
				logWarn,
			}),
		)

		expect(selected).toBe(createdKey)
		expect(createEd25519SshKey).toHaveBeenCalledTimes(1)
		expect(promptSelect).toHaveBeenCalledTimes(2)
		expect(getPrivateKeys).toHaveBeenCalledTimes(2)
		expect(logInfo).toHaveBeenCalled()
		expect(logWarn).not.toHaveBeenCalled()
	})

	test("creates a passwordless copy when user confirms passphrase flow", async () => {
		const createdKey = createPrivateKeyEntry(
			"id_ed25519_passwordless",
			"ed25519",
		)
		let getPrivateKeysCall = 0
		const getPrivateKeys = mock(
			async () =>
				({
					keys: getPrivateKeysCall++ === 0 ? [] : [createdKey],
					passphraseProtectedKeys: ["id_ed25519"],
					unsupportedKeys: [
						{ name: "id_ed25519", reason: "passphrase-protected" },
					],
				}) as never,
		)

		const promptSelect = mock(
			async () => "__dotenc_passphrase_protected_key__:id_ed25519",
		)
		const promptConfirm = mock(async () => true)

		const createPasswordlessSshKeyCopy = mock(
			async () =>
				({
					path: "/home/tester/.ssh/id_ed25519_passwordless",
					name: "id_ed25519_passwordless",
				}) as never,
		)

		const selected = await _runChoosePrivateKeyPrompt(
			"Pick key",
			makeDeps({
				getPrivateKeys: getPrivateKeys as never,
				promptConfirm: promptConfirm as never,
				promptSelect: promptSelect as never,
				createPasswordlessSshKeyCopy: createPasswordlessSshKeyCopy as never,
			}),
		)

		expect(selected).toBe(createdKey)
		expect(createPasswordlessSshKeyCopy).toHaveBeenCalledWith(
			"/home/tester/.ssh/id_ed25519",
		)
		expect(promptSelect).toHaveBeenCalledTimes(1)
		expect(promptConfirm).toHaveBeenCalledTimes(1)
		expect(getPrivateKeys).toHaveBeenCalledTimes(2)
	})

	test("re-prompts when user declines passwordless copy creation", async () => {
		const supportedKey = createPrivateKeyEntry("id_ed25519", "ed25519")
		let promptCall = 0
		const promptSelect = mock(async () => {
			promptCall += 1
			if (promptCall === 1) {
				return "__dotenc_passphrase_protected_key__:id_locked"
			}

			return "id_ed25519"
		})
		const promptConfirm = mock(async () => false)

		const selected = await _runChoosePrivateKeyPrompt(
			"Pick key",
			makeDeps({
				getPrivateKeys: mock(
					async () =>
						({
							keys: [supportedKey],
							passphraseProtectedKeys: ["id_locked"],
							unsupportedKeys: [
								{ name: "id_locked", reason: "passphrase-protected" },
							],
						}) as never,
				) as never,
				promptConfirm: promptConfirm as never,
				promptSelect: promptSelect as never,
			}),
		)

		expect(selected).toBe(supportedKey)
	})

	test("warns and re-prompts when passwordless copy creation fails", async () => {
		const supportedKey = createPrivateKeyEntry("id_ed25519", "ed25519")
		let promptCall = 0
		const promptSelect = mock(async () => {
			promptCall += 1
			if (promptCall === 1) {
				return "__dotenc_passphrase_protected_key__:id_locked"
			}

			return "id_ed25519"
		})
		const promptConfirm = mock(async () => true)

		const logWarn = mock((_message: string) => {})
		const selected = await _runChoosePrivateKeyPrompt(
			"Pick key",
			makeDeps({
				getPrivateKeys: mock(
					async () =>
						({
							keys: [supportedKey],
							passphraseProtectedKeys: ["id_locked"],
							unsupportedKeys: [
								{ name: "id_locked", reason: "passphrase-protected" },
							],
						}) as never,
				) as never,
				promptConfirm: promptConfirm as never,
				promptSelect: promptSelect as never,
				createPasswordlessSshKeyCopy: mock(async () => {
					throw new Error("bad passphrase")
				}) as never,
				logWarn,
			}),
		)

		expect(selected).toBe(supportedKey)
		expect(logWarn).toHaveBeenCalled()
	})

	test("uses the first available key in non-interactive mode", async () => {
		const selectedKey = createPrivateKeyEntry("id_ed25519", "ed25519")
		const getPrivateKeys = mock(
			async () =>
				({
					keys: [selectedKey],
					passphraseProtectedKeys: [],
					unsupportedKeys: [
						{ name: "id_ecdsa", reason: "unsupported algorithm: ec" },
					],
				}) as never,
		)
		const promptSelect = mock(async () => "id_ed25519")

		const selected = await _runChoosePrivateKeyPrompt(
			"Pick key",
			makeDeps({
				getPrivateKeys: getPrivateKeys as never,
				promptSelect: promptSelect as never,
				isInteractive: () => false,
			}),
		)

		expect(selected).toBe(selectedKey)
		expect(promptSelect).not.toHaveBeenCalled()
	})

	test("ignores weak RSA keys and picks a valid key in non-interactive mode", async () => {
		const weakRsa = createWeakRsaPrivateKeyEntry("id_rsa")
		const strongEd25519 = createPrivateKeyEntry("id_ed25519_alt", "ed25519")
		const getPrivateKeys = mock(
			async () =>
				({
					keys: [weakRsa, strongEd25519],
					passphraseProtectedKeys: [],
					unsupportedKeys: [],
				}) as never,
		)

		const selected = await _runChoosePrivateKeyPrompt(
			"Pick key",
			makeDeps({
				getPrivateKeys: getPrivateKeys as never,
				isInteractive: () => false,
			}),
		)

		expect(selected).toBe(strongEd25519)
	})

	test("requires an explicit key choice in non-interactive mode when multiple supported keys exist", async () => {
		const firstKey = createPrivateKeyEntry("id_ed25519", "ed25519")
		const secondKey = createPrivateKeyEntry("id_ed25519_alt", "ed25519")

		await expect(
			_runChoosePrivateKeyPrompt(
				"Pick key",
				makeDeps({
					getPrivateKeys: mock(
						async () =>
							({
								keys: [firstKey, secondKey],
								passphraseProtectedKeys: [],
								unsupportedKeys: [],
							}) as never,
					) as never,
					isInteractive: () => false,
				}),
				{
					nonInteractiveHint: "--private-key <name>",
				},
			),
		).rejects.toThrow("Pass --private-key <name>")
	})

	test("selects a preferred supported key without prompting", async () => {
		const firstKey = createPrivateKeyEntry("id_ed25519", "ed25519")
		const secondKey = createPrivateKeyEntry("id_ed25519_alt", "ed25519")
		const promptSelect = mock(async () => "id_ed25519")

		const selected = await _runChoosePrivateKeyPrompt(
			"Pick key",
			makeDeps({
				getPrivateKeys: mock(
					async () =>
						({
							keys: [firstKey, secondKey],
							passphraseProtectedKeys: [],
							unsupportedKeys: [],
						}) as never,
				) as never,
				promptSelect: promptSelect as never,
				isInteractive: () => false,
			}),
			{
				preferredKeyName: "id_ed25519_alt",
			},
		)

		expect(selected).toBe(secondKey)
		expect(promptSelect).not.toHaveBeenCalled()
	})

	test("rejects an explicit passphrase-protected key in non-interactive mode", async () => {
		await expect(
			_runChoosePrivateKeyPrompt(
				"Pick key",
				makeDeps({
					getPrivateKeys: mock(
						async () =>
							({
								keys: [],
								passphraseProtectedKeys: ["id_locked"],
								unsupportedKeys: [
									{ name: "id_locked", reason: "passphrase-protected" },
								],
							}) as never,
					) as never,
					isInteractive: () => false,
				}),
				{
					preferredKeyName: "id_locked",
				},
			),
		).rejects.toThrow("passphrase-protected")
	})

	test("shows weak RSA keys as unsupported in interactive mode", async () => {
		const weakRsa = createWeakRsaPrivateKeyEntry("id_rsa")
		const strongEd25519 = createPrivateKeyEntry("id_ed25519_alt", "ed25519")
		const getPrivateKeys = mock(
			async () =>
				({
					keys: [weakRsa, strongEd25519],
					passphraseProtectedKeys: [],
					unsupportedKeys: [],
				}) as never,
		)
		const promptSelect = mock(async () => "id_ed25519_alt")
		const logWarn = mock((_message: string) => {})

		await _runChoosePrivateKeyPrompt(
			"Pick key",
			makeDeps({
				getPrivateKeys: getPrivateKeys as never,
				logWarn,
				promptSelect: promptSelect as never,
			}),
		)

		expect(logWarn).toHaveBeenCalledWith(
			expect.stringContaining("RSA key is 1024 bits"),
		)
	})

	test("throws passphrase guidance in non-interactive mode when no usable keys exist", async () => {
		const getPrivateKeys = mock(
			async () =>
				({
					keys: [],
					passphraseProtectedKeys: ["id_locked"],
					unsupportedKeys: [
						{ name: "id_locked", reason: "passphrase-protected" },
					],
				}) as never,
		)

		await expect(
			_runChoosePrivateKeyPrompt(
				"Pick key",
				makeDeps({
					getPrivateKeys: getPrivateKeys as never,
					isInteractive: () => false,
				}),
			),
		).rejects.toThrow("passphrase-protected")
	})

	test("throws unsupported summary in non-interactive mode when all keys are unsupported", async () => {
		const getPrivateKeys = mock(
			async () =>
				({
					keys: [],
					passphraseProtectedKeys: [],
					unsupportedKeys: [
						{ name: "id_ecdsa", reason: "unsupported algorithm" },
					],
				}) as never,
		)

		await expect(
			_runChoosePrivateKeyPrompt(
				"Pick key",
				makeDeps({
					getPrivateKeys: getPrivateKeys as never,
					isInteractive: () => false,
				}),
			),
		).rejects.toThrow("No supported SSH keys found")
	})

	test("throws no-keys guidance in non-interactive mode when no keys exist", async () => {
		const getPrivateKeys = mock(
			async () =>
				({
					keys: [],
					passphraseProtectedKeys: [],
					unsupportedKeys: [],
				}) as never,
		)

		await expect(
			_runChoosePrivateKeyPrompt(
				"Pick key",
				makeDeps({
					getPrivateKeys: getPrivateKeys as never,
					isInteractive: () => false,
				}),
			),
		).rejects.toThrow("No SSH keys found in ~/.ssh/")
	})
})
