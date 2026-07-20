import { describe, expect, test } from "bun:test"
import {
	COMMENT_MARKER,
	canonicalizeReport,
	type EnvironmentDiffReport,
	renderReport,
	reportHasChanges,
} from "../src/report"

const emptyAccess = {
	status: "available" as const,
	grants: [],
	revocations: [],
	renames: [],
}

describe("redacted Markdown report", () => {
	test("renders the target variable and access classifications", () => {
		const report: EnvironmentDiffReport = {
			schemaVersion: 1,
			environments: [
				{
					path: ".env.production.enc",
					name: "production",
					status: "modified",
					variables: {
						status: "available",
						added: ["OPENAI_API_KEY"],
						changed: ["DATABASE_URL"],
						removed: ["LEGACY_TOKEN"],
					},
					access: {
						status: "available",
						grants: [{ name: "ci-production", fingerprint: "fp-ci" }],
						revocations: [{ name: "contractor-john", fingerprint: "fp-old" }],
						renames: [
							{ fingerprint: "fp-rename", from: "ci-old", to: "ci-new" },
						],
					},
				},
			],
		}

		const markdown = renderReport(report, { includeMarker: true })
		expect(markdown.startsWith(COMMENT_MARKER)).toBe(true)
		expect(markdown).toContain(
			[
				"```diff",
				"~ DATABASE_URL",
				"+ OPENAI_API_KEY",
				"- LEGACY_TOKEN",
				"```",
			].join("\n"),
		)
		expect(markdown).toContain(
			[
				"```diff",
				"~ ci-old → ci-new",
				"+ ci-production",
				"- contractor-john",
				"```",
			].join("\n"),
		)
		expect(markdown).not.toContain("Variable values are never shown")
		expect(markdown).not.toContain("dotenc never includes values")
		expect(markdown).not.toContain("encryptedDataKey")
	})

	test("preserves supported punctuation in variable names and renders it inert", () => {
		const report = canonicalizeReport({
			schemaVersion: 1,
			environments: [
				{
					path: ".env.production.enc",
					name: "production",
					status: "modified",
					variables: {
						status: "available",
						added: ["A.B", "A-B", "1A", "@team"],
						changed: [],
						removed: [],
					},
					access: emptyAccess,
				},
			],
		})
		const markdown = renderReport(report)
		expect(report.environments[0].variables.added).toEqual([
			"1A",
			"@team",
			"A-B",
			"A.B",
		])
		expect(markdown).toContain("+ A.B")
		expect(markdown).toContain("+ A-B")
		expect(markdown).toContain("+ 1A")
		expect(markdown).toContain("+ @team")
	})

	test("keeps untrusted names inside dynamic fences and neutralizes controls", () => {
		const report: EnvironmentDiffReport = {
			schemaVersion: 1,
			environments: [
				{
					path: "apps/<img src=x>/.env.evil](url).enc",
					name: "@octocat\n## injected\u202e",
					status: "modified",
					variables: {
						status: "available",
						added: ["@team/<script>alert(1)</script>\n# heading```"],
						changed: [],
						removed: [],
					},
					access: {
						...emptyAccess,
						grants: [
							{ name: "[click](javascript:bad)````", fingerprint: "fp" },
						],
					},
				},
			],
		}

		const markdown = renderReport(report)
		expect(markdown).not.toContain("<img")
		expect(markdown).not.toContain("@octocat")
		expect(markdown).not.toContain("\n## injected")
		expect(markdown).toContain(
			[
				"````diff",
				"+ @team/<script>alert(1)</script>U000A# heading```",
				"````",
			].join("\n"),
		)
		expect(markdown).toContain(
			["`````diff", "+ [click](javascript:bad)````", "`````"].join("\n"),
		)
		expect(markdown).toContain("U000A")
		expect(markdown).toContain("U202E")
	})

	test("conservatively classifies an availability warning as a change", () => {
		const report: EnvironmentDiffReport = {
			schemaVersion: 1,
			environments: [
				{
					path: ".env.production.enc",
					name: "production",
					status: "modified",
					variables: {
						status: "unavailable",
						added: [],
						changed: [],
						removed: [],
						reason: {
							code: "base_decryption_failed",
							message:
								"Variable diff unavailable because the base environment could not be decrypted.",
						},
					},
					access: emptyAccess,
				},
				{
					path: ".env.staging.enc",
					name: "staging",
					status: "modified",
					variables: {
						status: "available",
						added: [],
						changed: [],
						removed: [],
					},
					access: {
						status: "unavailable",
						grants: [],
						revocations: [],
						renames: [],
						reason: {
							code: "base_recipient_metadata_invalid",
							message:
								"Access diff unavailable because the base recipient metadata is invalid.",
						},
					},
				},
			],
		}

		expect(reportHasChanges(report)).toBe(true)
		const markdown = renderReport(report)
		expect(markdown).toContain("Variable diff unavailable")
		expect(markdown).toContain("No recipient changes.")
		expect(markdown).toContain("No variable-name changes.")
		expect(markdown).toContain("Access diff unavailable")
		expect(markdown).not.toContain("```diff")
	})
})
