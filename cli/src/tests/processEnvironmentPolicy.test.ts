import { describe, expect, test } from "bun:test"
import { findBlockedDecryptedEnvironmentNames } from "../helpers/processEnvironmentPolicy"

describe("process environment policy", () => {
	test("reserves DOTENC and GitHub control names case-insensitively", () => {
		const result = findBlockedDecryptedEnvironmentNames(
			{
				dotenc_custom: "secret",
				Github_Output: "secret",
				GITHUB_STEP_SUMMARY: "secret",
			},
			["dotenc_custom", "github_output", "GITHUB_STEP_SUMMARY"],
		)

		expect(result).toEqual({
			reserved: ["dotenc_custom", "Github_Output", "GITHUB_STEP_SUMMARY"],
			unsafe: [],
		})
	})

	test("blocks exact names and loader prefixes with exact per-name overrides", () => {
		const result = findBlockedDecryptedEnvironmentNames(
			{
				NODE_OPTIONS: "secret",
				LD_PRELOAD: "secret",
				DYLD_LIBRARY_PATH: "secret",
				SAFE_VALUE: "secret",
			},
			["node_options", "ld_preload"],
		)

		expect(result).toEqual({
			reserved: [],
			unsafe: ["DYLD_LIBRARY_PATH"],
		})
	})
})
