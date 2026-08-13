import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import pkg from "../../package.json"

const repositoryRoot = path.resolve(import.meta.dir, "../../..")

const readAction = (relativePath: string) =>
	readFileSync(path.join(repositoryRoot, relativePath), "utf-8")

const getDefaultVersion = (contents: string) => {
	const match = contents.match(
		/^ {2}version:\n(?: {4}.*\n)*? {4}default: ([^\n]+)$/m,
	)
	if (!match) throw new Error("setup action has no version default")
	return match[1].trim()
}

describe("setup action version pin", () => {
	test("pins the monorepo and wrapper defaults to the tested CLI version", () => {
		const monorepoVersion = getDefaultVersion(
			readAction("actions/setup/action.yml"),
		)
		const wrapperVersion = getDefaultVersion(
			readAction("actions/wrapper-repos/setup-action/action.yml"),
		)

		expect(monorepoVersion).toBe(pkg.version)
		expect(wrapperVersion).toBe(pkg.version)
		expect(monorepoVersion).not.toBe("latest")
	})
})
