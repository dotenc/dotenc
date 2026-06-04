import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { consola } from "consola"
import { _runChooseEnvironmentPrompt } from "../prompts/chooseEnvironment"
import { createEnvironmentPrompt } from "../prompts/createEnvironment"
import { _runInputKeyPrompt } from "../prompts/inputKey"
import { inputNamePrompt } from "../prompts/inputName"

describe("prompt wrappers", () => {
	const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
	const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")

	beforeEach(() => {
		Object.defineProperty(process.stdin, "isTTY", {
			configurable: true,
			value: true,
		})
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		})
	})

	afterEach(() => {
		if (stdinTty) {
			Object.defineProperty(process.stdin, "isTTY", stdinTty)
		}
		if (stdoutTty) {
			Object.defineProperty(process.stdout, "isTTY", stdoutTty)
		}
	})

	test("inputNamePrompt sanitizes with allowed characters and lowercase", async () => {
		const promptSpy = spyOn(consola, "prompt").mockResolvedValue(
			"  Alice! Name_Dev-01  " as never,
		)

		const name = await inputNamePrompt("Your name?", "default-user")
		expect(name).toBe("alicename_dev-01")
		expect(promptSpy).toHaveBeenCalledTimes(1)
		expect(promptSpy).toHaveBeenCalledWith("Your name?", {
			cancel: "reject",
			default: "default-user",
			initial: undefined,
			placeholder: undefined,
			type: "text",
		})
		promptSpy.mockRestore()
	})

	test("inputKeyPrompt uses password prompt with mask", async () => {
		const promptSpy = async (questions: unknown) => {
			expect(questions).toEqual([
				{
					type: "password",
					name: "key",
					mask: "*",
					message: "Paste key",
					default: "default-key",
				},
			])

			return { key: "secret" }
		}

		const key = await _runInputKeyPrompt("Paste key", "default-key", promptSpy)
		expect(key).toBe("secret")
	})

	test("createEnvironmentPrompt returns selected environment", async () => {
		const promptSpy = spyOn(consola, "prompt").mockResolvedValue(
			"staging" as never,
		)

		const environment = await createEnvironmentPrompt(
			"Environment name?",
			"development",
		)
		expect(environment).toBe("staging")
		expect(promptSpy).toHaveBeenCalledWith("Environment name?", {
			cancel: "reject",
			default: "development",
			initial: undefined,
			placeholder: undefined,
			type: "text",
		})
		promptSpy.mockRestore()
	})

	test("chooseEnvironment helper throws guidance when no environments exist", async () => {
		await expect(
			_runChooseEnvironmentPrompt("Pick env", {
				getEnvironments: async () => [],
			}),
		).rejects.toThrow("No environment files found")
	})

	test("chooseEnvironment helper passes discovered choices to prompt", async () => {
		const selected = await _runChooseEnvironmentPrompt("Pick environment", {
			getEnvironments: async () => ["dev", "production"],
			promptSelect: (async (_message: string, _options: unknown) =>
				"dev") as never,
		})

		expect(selected).toBe("dev")
	})

	test("chooseEnvironment auto-selects the only environment in non-interactive mode", async () => {
		const selected = await _runChooseEnvironmentPrompt("Pick environment", {
			getEnvironments: async () => ["dev"],
			isInteractive: () => false,
		})

		expect(selected).toBe("dev")
	})
})
