import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
	mkdtempSync,
	mkdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveStaticPath } from "../src/resolveStaticPath"

let temporaryDirectory: string
let root: string

beforeAll(() => {
	temporaryDirectory = mkdtempSync(join(realpathSync(tmpdir()), "dotenc-static-"))
	root = join(temporaryDirectory, "public")
	mkdirSync(join(root, "scripts"), { recursive: true })
	mkdirSync(join(root, "images"), { recursive: true })
	writeFileSync(join(root, "scripts", "main.js"), "")
	writeFileSync(join(root, "images", "dotenc logo.svg"), "")
})

afterAll(() => {
	rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe("resolveStaticPath", () => {
	test("resolves ordinary and URL-encoded asset paths inside the root", () => {
		expect(resolveStaticPath(root, "/scripts/main.js")).toBe(
			join(root, "scripts", "main.js"),
		)
		expect(resolveStaticPath(root, "/images/dotenc%20logo.svg")).toBe(
			join(root, "images", "dotenc logo.svg"),
		)
	})

	test.each([
		"/../secret",
		"/..%2fsecret",
		"/%2e%2e/secret",
		"/nested/%2e%2e/%2e%2e/secret",
	])("rejects paths that escape the static root: %s", (pathname) => {
		expect(resolveStaticPath(root, pathname)).toBeUndefined()
	})

	test("rejects malformed, null-containing, and non-URL paths", () => {
		expect(resolveStaticPath(root, "/%E0%A4%A")).toBeUndefined()
		expect(resolveStaticPath(root, "/asset%00.txt")).toBeUndefined()
		expect(resolveStaticPath(root, "../secret")).toBeUndefined()
	})

	test("rejects symlinks that escape the static root", () => {
		const outsideRoot = join(temporaryDirectory, "outside")
		mkdirSync(outsideRoot)
		writeFileSync(join(outsideRoot, "secret.txt"), "not public")
		symlinkSync(outsideRoot, join(root, "linked"), "dir")

		expect(resolveStaticPath(root, "/linked/secret.txt")).toBeUndefined()
	})
})
