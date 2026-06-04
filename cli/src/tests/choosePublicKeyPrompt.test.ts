import { describe, expect, mock, test } from "bun:test"
import { _runChoosePublicKeyPrompt } from "../prompts/choosePublicKey"

describe("choosePublicKeyPrompt", () => {
	test("uses promptSelect for single key selection when multiple keys exist", async () => {
		const promptSelect = mock(
			async (_message: string, _options: unknown) => "ivan",
		)
		const getPublicKeys = mock(
			async () => [{ name: "ivan.pub" }, { name: "alice.pub" }] as never,
		)

		const selected = await _runChoosePublicKeyPrompt("Pick a key", false, {
			getPublicKeys: getPublicKeys as never,
			promptSelect: promptSelect as never,
			isInteractive: () => true,
		})

		expect(selected).toBe("ivan")
		expect(promptSelect).toHaveBeenCalledTimes(1)
		expect(promptSelect).toHaveBeenCalledWith("Pick a key", {
			options: ["ivan", "alice"],
			nonInteractiveError:
				"An interactive terminal is required to choose a public key. Pass the public key name explicitly instead.",
		})
	})

	test("auto-selects the only key in single mode", async () => {
		const promptSelect = mock(async () => "ivan")
		const getPublicKeys = mock(async () => [{ name: "ivan.pub" }] as never)

		const selected = await _runChoosePublicKeyPrompt("Pick a key", false, {
			getPublicKeys: getPublicKeys as never,
			promptSelect: promptSelect as never,
			isInteractive: () => false,
		})

		expect(selected).toBe("ivan")
		expect(promptSelect).not.toHaveBeenCalled()
	})

	test("uses promptMultiSelect for multiple key selection", async () => {
		const promptMultiSelect = mock(
			async (_message: string, _options: unknown) => ["ivan", "alice"],
		)
		const getPublicKeys = mock(
			async () => [{ name: "ivan.pub" }, { name: "alice.pub" }] as never,
		)

		const selected = await _runChoosePublicKeyPrompt("Pick keys", true, {
			getPublicKeys: getPublicKeys as never,
			promptMultiSelect: promptMultiSelect as never,
			isInteractive: () => true,
		})

		expect(selected).toEqual(["ivan", "alice"])
		expect(promptMultiSelect).toHaveBeenCalledTimes(1)
		expect(promptMultiSelect).toHaveBeenCalledWith("Pick keys", {
			options: ["ivan", "alice"],
			required: true,
			nonInteractiveError:
				"An interactive terminal is required to choose multiple public keys. Pass one or more --public-key values instead.",
		})
	})

	test("throws when multiple selection is requested in non-interactive mode", async () => {
		const getPublicKeys = mock(
			async () => [{ name: "ivan.pub" }, { name: "alice.pub" }] as never,
		)

		await expect(
			_runChoosePublicKeyPrompt("Pick keys", true, {
				getPublicKeys: getPublicKeys as never,
				isInteractive: () => false,
			}),
		).rejects.toThrow("--public-key")
	})

	test("throws when no public keys exist", async () => {
		const getPublicKeys = mock(async () => [] as never)

		await expect(
			_runChoosePublicKeyPrompt("Pick key", false, {
				getPublicKeys: getPublicKeys as never,
				isInteractive: () => false,
			}),
		).rejects.toThrow("No public keys found")
	})
})
