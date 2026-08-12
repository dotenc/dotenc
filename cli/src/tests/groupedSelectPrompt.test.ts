import { describe, expect, test } from "bun:test"
import { stripVTControlCharacters } from "node:util"
import { _renderGroupedSelect } from "../ui/prompts"

describe("grouped select prompt", () => {
	const options = [
		{
			group: "Local - ~/.ssh",
			label: "id_ed25519",
			value: "id_ed25519",
		},
		{
			group: "1Password - company [ABCD...1234]",
			label: "GitHub",
			hint: "ed25519 - Private",
			value: "qualified",
		},
	]

	test("renders headings separately from selectable options", () => {
		const rendered = stripVTControlCharacters(
			_renderGroupedSelect("Choose a key", options, 1, "active"),
		)

		expect(rendered).toContain("Local - ~/.ssh\n  id_ed25519")
		expect(rendered).toContain(
			"1Password - company [ABCD...1234]\n❯ GitHub  ed25519 - Private",
		)
	})

	test("renders submitted and cancelled states compactly", () => {
		expect(
			stripVTControlCharacters(
				_renderGroupedSelect("Choose a key", options, 1, "submit"),
			),
		).toBe("◇ Choose a key\nGitHub")
		expect(
			stripVTControlCharacters(
				_renderGroupedSelect("Choose a key", options, 0, "cancel"),
			),
		).toBe("■ Choose a key")
	})

	test("renders initial and error states with the active option", () => {
		for (const state of ["initial", "error"] as const) {
			const rendered = stripVTControlCharacters(
				_renderGroupedSelect("Choose a key", options, 0, state),
			)
			expect(rendered).toContain("❯ id_ed25519")
		}
	})
})
