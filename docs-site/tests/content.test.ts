import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { documentationLink, rewriteMarkdown } from "../scripts/links"
import { sources } from "../scripts/sources"

const root = resolve(import.meta.dir, "../..")
test("repository links resolve to mounted pages and preserved internal references", () => {
	expect(
		documentationLink("OCI_IMAGE.md#using-the-image", "docs/INSTALLATION.md"),
	).toBe("/docs/ci/containers/#using-the-image")
	expect(
		documentationLink("../SECURITY.md#threat-model", "docs/EXPO_EAS.md"),
	).toBe("/docs/security/model/#threat-model")
	expect(documentationLink("/docs/EXPO_EAS.md", "cli/README.md")).toBe(
		"/docs/ci/expo-eas/",
	)
	expect(
		documentationLink(
			"https://github.com/dotenc/dotenc#provider-runbooks",
			"cli/README.md",
		),
	).toBe("/docs/ci/providers/#provider-runbooks")
	expect(
		documentationLink("PROVIDER_HELPERS_ROADMAP.md", "docs/VERCEL.md"),
	).toBe(
		"https://github.com/dotenc/dotenc/blob/main/docs/PROVIDER_HELPERS_ROADMAP.md",
	)
	expect(documentationLink("https://example.com/guide", "docs/VERCEL.md")).toBe(
		"https://example.com/guide",
	)
})
test("code examples are not rewritten as navigation", () => {
	const code = "```md\n[example](../SECURITY.md)\n```"
	expect(rewriteMarkdown(code, "docs/EXPO_EAS.md")).toBe(code)
	expect(rewriteMarkdown("[model](../SECURITY.md)", "docs/EXPO_EAS.md")).toBe(
		"[model](/docs/security/model/)",
	)
})
test("every published imported page has a unique route and an existing canonical source", () => {
	expect(new Set(sources.map(({ slug }) => slug)).size).toBe(sources.length)
	for (const { file } of sources) {
		expect(existsSync(resolve(root, file))).toBe(true)
		expect(file).not.toContain("docs/plans/")
		expect(file).not.toContain("docs/security/")
	}
})
test("installed skill entry points remain available", () => {
	const readme = readFileSync(resolve(root, "cli/README.md"), "utf8")
	expect(readme).toContain("## Provider runbooks")
	expect(existsSync(resolve(root, "docs/EXPO_EAS.md"))).toBe(true)
	expect(
		readFileSync(resolve(root, "website/src/index.html"), "utf8"),
	).toContain('id="installation"')
})
