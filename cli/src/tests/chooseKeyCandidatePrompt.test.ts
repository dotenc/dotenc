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

	test("returns the sole candidate without prompting in non-interactive mode", async () => {
		const filesystem = localCandidate("id_ed25519")
		const testDeps = {
			...deps(result([filesystem])),
			isInteractive: () => false,
		}

		await expect(
			_runChooseKeyCandidatePrompt("Choose", testDeps),
		).resolves.toBe(filesystem)
		expect(testDeps.promptGroupedSelect).not.toHaveBeenCalled()
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
})
