import { describe, expect, test } from "bun:test"
import { stripVTControlCharacters } from "node:util"
import { _renderGroupedSelect } from "../ui/prompts"

describe("grouped select prompt", () => {
	test("renders headings separately from selectable options", () => {
		const rendered = stripVTControlCharacters(
			_renderGroupedSelect(
				"Choose a key",
				[
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
				],
				1,
				"active",
			),
		)

		expect(rendered).toContain("Local - ~/.ssh\n  id_ed25519")
		expect(rendered).toContain(
			"1Password - company [ABCD...1234]\n❯ GitHub  ed25519 - Private",
		)
	})
})
