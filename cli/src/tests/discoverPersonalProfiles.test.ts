import { describe, expect, mock, test } from "bun:test"
import path from "node:path"
import type { DecryptEnvironmentDataContext } from "../helpers/decryptEnvironment"
import { discoverPersonalProfiles } from "../helpers/discoverPersonalProfiles"

const ROOT = "/repo"
const SUBDIR = path.join(ROOT, "packages", "app")
const context = {
	dispose: () => {},
} as unknown as DecryptEnvironmentDataContext

const deps = (filesByDir: Record<string, string[]>) => {
	const readdir = mock(async (dir: string) => filesByDir[dir] ?? [])
	const decryptEnvironmentData = mock(async (name: string) => {
		if (name === "personal.inaccessible") throw new Error("access denied")
		return "KEY=value"
	})
	return {
		readdir,
		exists: mock(() => true),
		resolveProjectRoot: mock(() => ROOT),
		buildAncestorChain: mock(() => [ROOT, SUBDIR]),
		getEnvironmentByPath: mock(async (filePath: string) => ({
			version: 2 as const,
			keys: [],
			encryptedContent: filePath,
		})),
		decryptEnvironmentData,
	}
}

describe("discoverPersonalProfiles", () => {
	test("checks every ancestor layer and deduplicates profiles", async () => {
		const testDeps = deps({
			[ROOT]: [
				".env.personal.alice.enc",
				".env.production.enc",
				".env.personal.inaccessible.enc",
			],
			[SUBDIR]: [".env.personal.alice.enc", ".env.personal.bob.enc"],
		})

		const result = await discoverPersonalProfiles(
			{
				invocationDir: SUBDIR,
				decryptionContext: context,
			},
			testDeps,
		)

		expect(result).toEqual({
			discovered: ["personal.alice", "personal.bob", "personal.inaccessible"],
			accessible: ["personal.alice", "personal.bob"],
		})
		expect(
			testDeps.decryptEnvironmentData.mock.calls.filter(
				(call) => call[0] === "personal.alice",
			),
		).toHaveLength(2)
	})

	test("local-only scans only the invocation directory", async () => {
		const testDeps = deps({
			[ROOT]: [".env.personal.root.enc"],
			[SUBDIR]: [".env.personal.local.enc"],
		})

		const result = await discoverPersonalProfiles(
			{
				invocationDir: SUBDIR,
				localOnly: true,
				decryptionContext: context,
			},
			testDeps,
		)

		expect(result).toEqual({
			discovered: ["personal.local"],
			accessible: ["personal.local"],
		})
		expect(testDeps.readdir.mock.calls).toEqual([[SUBDIR]])
		expect(testDeps.resolveProjectRoot).not.toHaveBeenCalled()
	})
})
