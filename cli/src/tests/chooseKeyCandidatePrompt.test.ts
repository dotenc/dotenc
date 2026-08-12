import { describe, expect, mock, test } from "bun:test"
import crypto from "node:crypto"
import type { GetKeyCandidatesResult } from "../helpers/getKeyCandidates"
import type { KeyCandidate } from "../helpers/keyCandidate"
import { _runChooseKeyCandidatePrompt } from "../prompts/chooseKeyCandidate"
import { CREATE_NEW_PRIVATE_KEY_CHOICE } from "../prompts/choosePrivateKey"

const ACCOUNT_A = "A".repeat(26)
const ACCOUNT_B = "B".repeat(26)
const VAULT = "V".repeat(26)
const ITEM_A = "I".repeat(26)
const ITEM_B = "J".repeat(26)

function candidate(account: string, item: string, label: string): KeyCandidate {
	const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
	return {
		source: "1password",
		selector: `1password:${account}:${VAULT}:${item}`,
		name: "GitHub",
		hint: "ed25519 - Private",
		group: { id: `1password:${account}`, label },
		publicKey,
		fingerprint: `${account}-fingerprint`,
		algorithm: "ed25519",
		loadPrivateKey: async () => ({
			name: "GitHub",
			privateKey,
			fingerprint: `${account}-fingerprint`,
			algorithm: "ed25519",
		}),
	}
}

function localCandidate(
	name: string,
	source: "environment" | "filesystem" = "filesystem",
): KeyCandidate {
	const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
	return {
		source,
		selector: name,
		name,
		hint: "ed25519",
		group:
			source === "environment"
				? { id: "environment", label: "Environment" }
				: { id: "filesystem", label: "Local - ~/.ssh" },
		publicKey,
		fingerprint: `${name}-fingerprint`,
		algorithm: "ed25519",
		loadPrivateKey: async () => ({
			name,
			privateKey,
			fingerprint: `${name}-fingerprint`,
			algorithm: "ed25519",
		}),
	}
}

function result(
	keys: KeyCandidate[],
	status: GetKeyCandidatesResult["onePassword"]["status"] = "available",
): GetKeyCandidatesResult {
	return {
		keys,
		passphraseProtectedKeys: [],
		unsupportedKeys: [],
		onePassword: {
			status,
			keys: keys.filter((key) => key.source === "1password"),
			unsupportedKeys: [],
			unavailableAccounts: [],
		},
	}
}

function deps(
	value: GetKeyCandidatesResult,
	selected = value.keys[0]?.selector,
) {
	return {
		getKeyCandidates: mock(async () => value) as never,
		promptConfirm: mock(async () => false) as never,
		promptGroupedSelect: mock(async () => selected) as never,
		runWithGroupedSpinner: mock(
			async (_group: string, _message: string, task: () => Promise<unknown>) =>
				task(),
		) as never,
		createEd25519SshKey: mock(async () => "/tmp/key") as never,
		createPasswordlessSshKeyCopy: mock(async () => ({
			name: "copy",
			path: "/tmp/copy",
		})) as never,
		homedir: () => "/home/tester",
		isInteractive: () => true,
		logInfo: mock(() => {}),
		logWarn: mock(() => {}),
	}
}

describe("chooseKeyCandidatePrompt", () => {
	test("loads 1Password candidates only after the user chooses the action", async () => {
		const local = localCandidate("id_ed25519")
		const provider = candidate(ACCOUNT_A, ITEM_A, "Account A")
		const localResult = result([local], "not-requested")
		const providerResult = result([local, provider])
		const getKeyCandidates = mock()
			.mockResolvedValueOnce(localResult)
			.mockResolvedValueOnce(providerResult)
		const promptGroupedSelect = mock(
			async (
				_message,
				options: { options: Array<{ label: string; value: string }> },
			) => {
				const providerOption = options.options.find(
					(option) => option.value === provider.selector,
				)
				if (providerOption) return providerOption.value
				return options.options.find(
					(option) =>
						option.label === "Use a key from 1Password (experimental)",
				)?.value
			},
		)
		const testDeps = {
			...deps(localResult),
			getKeyCandidates: getKeyCandidates as never,
			promptGroupedSelect: promptGroupedSelect as never,
		}

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps),
		).resolves.toBe(provider)
		expect(getKeyCandidates.mock.calls).toEqual([
			[{ includeOnePassword: false }],
			[{ includeOnePassword: true }],
		])
		expect(testDeps.runWithGroupedSpinner).toHaveBeenCalledWith(
			"1Password",
			"Loading SSH keys...",
			expect.any(Function),
		)
		const initialOptions = promptGroupedSelect.mock.calls[0][1].options
		expect(initialOptions).toContainEqual(
			expect.objectContaining({
				group: "Actions",
				label: "Use a key from 1Password (experimental)",
			}),
		)
		expect(
			initialOptions.some((option) => option.value === provider.selector),
		).toBe(false)
		const loadedOptions = promptGroupedSelect.mock.calls[1][1].options
		expect(loadedOptions).toContainEqual(
			expect.objectContaining({
				group: provider.group.label,
				value: provider.selector,
			}),
		)
		expect(
			loadedOptions.some(
				(option) => option.label === "Use a key from 1Password (experimental)",
			),
		).toBe(false)
	})

	test("reports opt-in provider failures and keeps local keys usable", async () => {
		for (const [status, warning] of [
			["not-installed", "1Password CLI is not installed"],
			["no-accounts", "no configured 1Password accounts"],
			["unavailable", "installed 1Password CLI was unavailable"],
			["unsupported-version", "requires op 2.x"],
		] as const) {
			const local = localCandidate(`id_${status}`)
			const localResult = result([local], "not-requested")
			const unavailableResult = result([local], status)
			const getKeyCandidates = mock()
				.mockResolvedValueOnce(localResult)
				.mockResolvedValueOnce(unavailableResult)
			const promptGroupedSelect = mock()
				.mockResolvedValueOnce("__dotenc_one_password__")
				.mockResolvedValueOnce(local.selector)
			const testDeps = {
				...deps(localResult),
				getKeyCandidates: getKeyCandidates as never,
				promptGroupedSelect: promptGroupedSelect as never,
			}

			await expect(
				_runChooseKeyCandidatePrompt("Choose", testDeps),
			).resolves.toBe(local)
			expect(testDeps.logWarn).toHaveBeenCalledWith(
				expect.stringContaining(warning),
			)
		}
	})

	test("reports unsupported keys and unavailable accounts after discovery", async () => {
		const local = localCandidate("id_ed25519")
		const value = result([local])
		value.unsupportedKeys = [
			{ name: "legacy-key", reason: "unsupported algorithm" },
		]
		value.onePassword.unavailableAccounts = [
			{
				label: "1Password - unavailable.example [AAAA...AAAA]",
				reason: "authorization-or-access-failed",
			},
		]
		const testDeps = deps(value, local.selector)

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps),
		).resolves.toBe(local)
		expect(testDeps.logWarn).toHaveBeenCalledWith(
			expect.stringContaining("legacy-key: unsupported algorithm"),
		)
		expect(testDeps.logWarn).toHaveBeenCalledWith(
			expect.stringContaining("authorization-or-access-failed"),
		)
	})

	test("renders stable account categories and returns the selected public candidate", async () => {
		const first = candidate(
			ACCOUNT_A,
			ITEM_A,
			"1Password - personal.example [AAAA...AAAA]",
		)
		const second = candidate(
			ACCOUNT_B,
			ITEM_B,
			"1Password - company.example [BBBB...BBBB]",
		)
		const testDeps = deps(result([first, second]), second.selector)

		const selected = await _runChooseKeyCandidatePrompt("Choose", testDeps)
		expect(selected).toBe(second)
		const options = (testDeps.promptGroupedSelect as ReturnType<typeof mock>)
			.mock.calls[0][1].options as Array<{ label: string }>
		expect(options.slice(0, 2)).toEqual([
			expect.objectContaining({
				group: first.group.label,
				value: first.selector,
			}),
			expect.objectContaining({
				group: second.group.label,
				value: second.selector,
			}),
		])
		expect(options.at(-1)).toMatchObject({ group: "Actions" })
	})

	test("requires a qualified selector for duplicate titles", async () => {
		const first = candidate(ACCOUNT_A, ITEM_A, "Account A")
		const second = candidate(ACCOUNT_B, ITEM_B, "Account B")
		await expect(
			_runChooseKeyCandidatePrompt("Choose", deps(result([first, second])), {
				preferredKeyName: "GitHub",
			}),
		).rejects.toThrow(first.selector)
	})

	test("accepts an exact qualified selector without prompting", async () => {
		const first = candidate(ACCOUNT_A, ITEM_A, "Account A")
		const second = candidate(ACCOUNT_B, ITEM_B, "Account B")
		const testDeps = deps(result([first, second]))
		const selected = await _runChooseKeyCandidatePrompt("Choose", testDeps, {
			preferredKeyName: second.selector,
		})
		expect(selected).toBe(second)
		expect(testDeps.promptGroupedSelect).not.toHaveBeenCalled()
	})

	test("accepts a preferred local key without discovering 1Password", async () => {
		const local = localCandidate("id_ed25519")
		const localResult = result([local], "not-requested")
		const testDeps = deps(localResult)

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps, {
				preferredKeyName: local.selector,
			}),
		).resolves.toBe(local)
		expect(testDeps.getKeyCandidates).toHaveBeenCalledWith({
			includeOnePassword: false,
		})
		expect(testDeps.runWithGroupedSpinner).not.toHaveBeenCalled()
		expect(testDeps.promptGroupedSelect).not.toHaveBeenCalled()
	})

	test("loads 1Password before rejecting an unresolved preferred key", async () => {
		const localResult = result([], "not-requested")
		const providerResult = result([])
		const getKeyCandidates = mock()
			.mockResolvedValueOnce(localResult)
			.mockResolvedValueOnce(providerResult)
		const testDeps = {
			...deps(localResult),
			getKeyCandidates: getKeyCandidates as never,
		}

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps, {
				preferredKeyName: "missing",
			}),
		).rejects.toThrow("was not found")
		expect(testDeps.runWithGroupedSpinner).toHaveBeenCalledTimes(1)
		expect(getKeyCandidates.mock.calls).toEqual([
			[{ includeOnePassword: false }],
			[{ includeOnePassword: true }],
		])
	})

	test("keeps environment passphrase keys out of the local-copy choices", async () => {
		const filesystem = localCandidate("id_ed25519")
		const value = result([filesystem])
		value.passphraseProtectedKeys = ["env.DOTENC_PRIVATE_KEY_BASE64", "id_rsa"]
		const testDeps = deps(value, filesystem.selector)

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps),
		).resolves.toBe(filesystem)
		const options = (testDeps.promptGroupedSelect as ReturnType<typeof mock>)
			.mock.calls[0][1].options as Array<{ label: string }>
		expect(options.some((option) => option.label.startsWith("env."))).toBe(
			false,
		)
		expect(options.some((option) => option.label === "id_rsa")).toBe(true)
		expect(testDeps.logWarn).toHaveBeenCalledWith(
			expect.stringContaining("DOTENC_PRIVATE_KEY_PASSPHRASE"),
		)
		expect(testDeps.createPasswordlessSshKeyCopy).not.toHaveBeenCalled()
	})

	test("does not flag selectable passphrase keys as unsupported", async () => {
		const filesystem = localCandidate("id_ed25519")
		const value = result([filesystem])
		value.passphraseProtectedKeys = ["id_locked"]
		value.unsupportedKeys = [
			{ name: "id_locked", reason: "passphrase-protected" },
		]
		const testDeps = deps(value, filesystem.selector)

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps),
		).resolves.toBe(filesystem)
		expect(testDeps.logWarn).not.toHaveBeenCalled()
		const options = (testDeps.promptGroupedSelect as ReturnType<typeof mock>)
			.mock.calls[0][1].options as Array<{ label: string; hint?: string }>
		expect(options).toContainEqual(
			expect.objectContaining({
				label: "id_locked",
				hint: "passphrase-protected",
			}),
		)
	})

	test("rejects a crafted environment-key local-copy selection", async () => {
		const filesystem = localCandidate("id_ed25519")
		const value = result([filesystem])
		value.passphraseProtectedKeys = ["env.DOTENC_PRIVATE_KEY_BASE64"]
		const promptGroupedSelect = mock()
			.mockResolvedValueOnce(
				"__dotenc_passphrase_protected_key__:env.DOTENC_PRIVATE_KEY_BASE64",
			)
			.mockResolvedValueOnce(filesystem.selector)
		const testDeps = {
			...deps(value),
			promptGroupedSelect: promptGroupedSelect as never,
		}

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps),
		).resolves.toBe(filesystem)
		expect(testDeps.createPasswordlessSshKeyCopy).not.toHaveBeenCalled()
		expect(testDeps.logWarn).toHaveBeenCalledWith(
			expect.stringContaining("DOTENC_PRIVATE_KEY_PASSPHRASE"),
		)
	})

	test("returns the sole local candidate without discovering 1Password in non-interactive mode", async () => {
		const filesystem = localCandidate("id_ed25519")
		const provider = candidate(ACCOUNT_A, ITEM_A, "Account A")
		const getKeyCandidates = mock(
			async (options: { includeOnePassword?: boolean }) =>
				options.includeOnePassword
					? result([filesystem, provider])
					: result([filesystem], "not-requested"),
		)
		const testDeps = {
			...deps(result([filesystem], "not-requested")),
			getKeyCandidates: getKeyCandidates as never,
			isInteractive: () => false,
		}

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps),
		).resolves.toBe(filesystem)
		expect(getKeyCandidates.mock.calls).toEqual([
			[{ includeOnePassword: false }],
		])
		expect(testDeps.promptGroupedSelect).not.toHaveBeenCalled()
	})

	test("discovers 1Password after local candidates are exhausted in non-interactive mode", async () => {
		const provider = candidate(ACCOUNT_A, ITEM_A, "Account A")
		const localResult = result([], "not-requested")
		const providerResult = result([provider])
		const getKeyCandidates = mock()
			.mockResolvedValueOnce(localResult)
			.mockResolvedValueOnce(providerResult)
		const testDeps = {
			...deps(localResult),
			getKeyCandidates: getKeyCandidates as never,
			isInteractive: () => false,
		}

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps),
		).resolves.toBe(provider)
		expect(getKeyCandidates.mock.calls).toEqual([
			[{ includeOnePassword: false }],
			[{ includeOnePassword: true }],
		])
	})

	test("reports non-interactive ambiguity with qualified selectors", async () => {
		const first = localCandidate("id_ed25519")
		const second = candidate(ACCOUNT_A, ITEM_A, "Account A")
		const testDeps = {
			...deps(result([first, second])),
			isInteractive: () => false,
		}

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps),
		).rejects.toThrow(second.selector)
	})

	test("reports passphrase and unsupported-version guidance non-interactively", async () => {
		const passphraseResult = result([])
		passphraseResult.passphraseProtectedKeys = ["id_rsa"]
		await expect(
			_runChooseKeyCandidatePrompt("Choose", {
				...deps(passphraseResult),
				isInteractive: () => false,
			}),
		).rejects.toThrow("DOTENC_PRIVATE_KEY_PASSPHRASE")

		await expect(
			_runChooseKeyCandidatePrompt("Choose", {
				...deps(result([], "unsupported-version")),
				isInteractive: () => false,
			}),
		).rejects.toThrow("requires op 2.x")
	})

	test("reports unsupported and missing keys non-interactively", async () => {
		const unsupportedResult = result([])
		unsupportedResult.unsupportedKeys = [
			{ name: "id_ecdsa", reason: "unsupported algorithm" },
		]
		await expect(
			_runChooseKeyCandidatePrompt("Choose", {
				...deps(unsupportedResult),
				isInteractive: () => false,
			}),
		).rejects.toThrow("Unsupported keys")

		await expect(
			_runChooseKeyCandidatePrompt("Choose", {
				...deps(result([], "no-accounts")),
				isInteractive: () => false,
			}),
		).rejects.toThrow("configured 1Password accounts")

		await expect(
			_runChooseKeyCandidatePrompt("Choose", {
				...deps(result([])),
				isInteractive: () => false,
			}),
		).rejects.toThrow("No SSH keys found in ~/.ssh/.")
	})

	test("handles preferred passphrase, unsupported, and missing selectors", async () => {
		const passphraseResult = result([])
		passphraseResult.passphraseProtectedKeys = ["id_rsa"]
		await expect(
			_runChooseKeyCandidatePrompt("Choose", deps(passphraseResult), {
				preferredKeyName: "id_rsa",
			}),
		).rejects.toThrow("passphrase-protected")

		const unsupportedResult = result([])
		unsupportedResult.unsupportedKeys = [
			{ name: "id_ecdsa", reason: "unsupported algorithm" },
		]
		await expect(
			_runChooseKeyCandidatePrompt("Choose", deps(unsupportedResult), {
				preferredKeyName: "id_ecdsa",
			}),
		).rejects.toThrow("unsupported algorithm")

		const provider = candidate(ACCOUNT_A, ITEM_A, "Account A")
		await expect(
			_runChooseKeyCandidatePrompt("Choose", deps(result([provider])), {
				preferredKeyName: "missing",
			}),
		).rejects.toThrow("1 1Password key(s)")
	})

	test("creates a new local key and selects it after rescanning", async () => {
		const created = localCandidate("id_created")
		const getKeyCandidates = mock()
			.mockResolvedValueOnce(result([]))
			.mockResolvedValueOnce(result([created]))
		const testDeps = {
			...deps(result([]), CREATE_NEW_PRIVATE_KEY_CHOICE),
			getKeyCandidates: getKeyCandidates as never,
			createEd25519SshKey: mock(async () => "/tmp/id_created") as never,
		}

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps),
		).resolves.toBe(created)
		expect(testDeps.createEd25519SshKey).toHaveBeenCalledTimes(1)
		expect(testDeps.logInfo).toHaveBeenCalledWith(
			expect.stringContaining("id_created"),
		)
	})

	test("keeps the picker usable when local key creation fails", async () => {
		const local = localCandidate("id_ed25519")
		const value = result([local])
		const promptGroupedSelect = mock()
			.mockResolvedValueOnce(CREATE_NEW_PRIVATE_KEY_CHOICE)
			.mockResolvedValueOnce(local.selector)
		const testDeps = {
			...deps(value),
			promptGroupedSelect: promptGroupedSelect as never,
			createEd25519SshKey: mock(async () => {
				throw new Error("creation failed")
			}) as never,
		}

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps),
		).resolves.toBe(local)
		expect(testDeps.logWarn).toHaveBeenCalledWith(
			expect.stringContaining("creation failed"),
		)
	})

	test("creates a passwordless copy only for a filesystem key", async () => {
		const initial = result([])
		initial.passphraseProtectedKeys = ["id_rsa"]
		const copied = localCandidate("copy")
		const getKeyCandidates = mock()
			.mockResolvedValueOnce(initial)
			.mockResolvedValueOnce(result([copied]))
		const promptGroupedSelect = mock(
			async (_message, options) =>
				options.options.find(
					(option: { label: string }) => option.label === "id_rsa",
				).value,
		)
		const testDeps = {
			...deps(initial),
			getKeyCandidates: getKeyCandidates as never,
			promptConfirm: mock(async () => true) as never,
			promptGroupedSelect: promptGroupedSelect as never,
		}

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps),
		).resolves.toBe(copied)
		expect(testDeps.createPasswordlessSshKeyCopy).toHaveBeenCalledWith(
			"/home/tester/.ssh/id_rsa",
		)
	})

	test("keeps the picker usable when passwordless copy creation fails", async () => {
		const local = localCandidate("id_ed25519")
		const value = result([local])
		value.passphraseProtectedKeys = ["id_rsa"]
		const promptGroupedSelect = mock()
			.mockResolvedValueOnce("__dotenc_passphrase_protected_key__:id_rsa")
			.mockResolvedValueOnce(local.selector)
		const testDeps = {
			...deps(value),
			promptConfirm: mock(async () => true) as never,
			promptGroupedSelect: promptGroupedSelect as never,
			createPasswordlessSshKeyCopy: mock(async () => {
				throw new Error("copy failed")
			}) as never,
		}

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps),
		).resolves.toBe(local)
		expect(testDeps.logWarn).toHaveBeenCalledWith(
			expect.stringContaining("copy failed"),
		)
	})
})
