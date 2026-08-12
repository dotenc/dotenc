import { describe, expect, mock, test } from "bun:test"
import crypto from "node:crypto"
import type { GetKeyCandidatesResult } from "../helpers/getKeyCandidates"
import type { KeyCandidate } from "../helpers/keyCandidate"
import { _runChooseKeyCandidatePrompt } from "../prompts/chooseKeyCandidate"

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

function result(keys: KeyCandidate[]): GetKeyCandidatesResult {
	return {
		keys,
		passphraseProtectedKeys: [],
		unsupportedKeys: [],
		onePassword: {
			status: "available",
			keys,
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
			.mock.calls[0][1].options
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
})
