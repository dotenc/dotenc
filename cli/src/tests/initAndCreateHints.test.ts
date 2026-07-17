import { describe, expect, test } from "bun:test"
import { _getRunUsageHintForEnvironment } from "../commands/env/create"
import { _resolveDocsUrl } from "../commands/init"

describe("usage hints", () => {
	test("uses dotenc dev hint for development environment", () => {
		const hint = _getRunUsageHintForEnvironment("development")
		expect(hint).toContain("dotenc dev")
		expect(hint).not.toContain("dotenc run -e development")
	})

	test("uses dotenc run hint for non-development environments", () => {
		const hint = _getRunUsageHintForEnvironment("staging")
		expect(hint).toContain("dotenc run -e staging")
		expect(hint).toContain("DOTENC_ENV=staging")
	})
})

describe("docs url", () => {
	test("resolves docs url from package metadata", () => {
		const docsUrl = _resolveDocsUrl()
		expect(typeof docsUrl).toBe("string")
		expect(docsUrl).toContain("github.com/dotenc/dotenc")
	})
})
