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
						renames: [],
					},
				},
			],
		}

		const markdown = renderReport(report, { includeMarker: true })
		expect(markdown.startsWith(COMMENT_MARKER)).toBe(true)
		expect(markdown).toContain("~ DATABASE_URL")
		expect(markdown).toContain("+ OPENAI_API_KEY")
		expect(markdown).toContain("- LEGACY_TOKEN")
		expect(markdown).toContain("+ ci-production")
		expect(markdown).toContain("- contractor-john")
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
		expect(markdown).not.toContain("@team")
	})

	test("neutralizes Markdown, HTML, line breaks, and bidi controls", () => {
		const report: EnvironmentDiffReport = {
			schemaVersion: 1,
			environments: [
				{
					path: "apps/<img src=x>/.env.evil](url).enc",
					name: "@octocat\n## injected\u202e",
					status: "modified",
					variables: {
						status: "available",
						added: ["@team/<script>alert(1)</script>\n# heading"],
						changed: [],
						removed: [],
					},
					access: {
						...emptyAccess,
						grants: [{ name: "[click](javascript:bad)", fingerprint: "fp" }],
					},
				},
			],
		}

		const markdown = renderReport(report)
		expect(markdown).not.toContain("<img")
		expect(markdown).not.toContain("<script")
		expect(markdown).not.toContain("javascript:bad)")
		expect(markdown).not.toContain("@octocat")
		expect(markdown).not.toContain("@team")
		expect(markdown).not.toContain("\n## injected")
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
			],
		}

		expect(reportHasChanges(report)).toBe(true)
		expect(renderReport(report)).toContain("Variable diff unavailable")
	})
})
