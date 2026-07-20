import { describe, expect, test } from "bun:test"
import { parsePullRequestEvent } from "../src/context"

const sha = (character: string) => character.repeat(40)

describe("pull request event context", () => {
	test("extracts only the immutable Git object IDs and bounded PR context", () => {
		expect(
			parsePullRequestEvent({
				number: 42,
				repository: { full_name: "dotenc/example" },
				pull_request: {
					number: 42,
					base: { sha: sha("A") },
					head: { sha: sha("b") },
					title: "untrusted and ignored",
				},
			}),
		).toEqual({
			repository: "dotenc/example",
			pullRequestNumber: 42,
			baseSha: sha("a"),
			headSha: sha("b"),
		})
	})

	test("rejects refs, abbreviated SHAs, and malformed repository names", () => {
		for (const payload of [
			{
				number: 1,
				repository: { full_name: "dotenc/example" },
				pull_request: { base: { sha: "main" }, head: { sha: sha("b") } },
			},
			{
				number: 1,
				repository: { full_name: "dotenc/example/extra" },
				pull_request: {
					base: { sha: sha("a") },
					head: { sha: sha("b") },
				},
			},
		]) {
			expect(() => parsePullRequestEvent(payload)).toThrow(
				"could not be completed safely",
			)
		}
	})
})
