import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { type FetchLike, GitHubClient } from "../src/github"
import { ACTION_LIMITS } from "../src/limits"
import { COMMENT_MARKER } from "../src/report"

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})

const gitBlob = (content: string) => {
	const bytes = Buffer.from(content)
	return {
		bytes,
		sha: createHash("sha1")
			.update(`blob ${bytes.byteLength}\0`)
			.update(bytes)
			.digest("hex"),
	}
}

const commitSha = "a".repeat(40)
const treeSha = "b".repeat(40)

describe("GitHub object API client", () => {
	test("fetches the exact commit tree and exact environment blob IDs", async () => {
		const blob = gitBlob('{"version":2}')
		const requests: Array<{ url: string; method: string }> = []
		const fetchImpl: FetchLike = async (input, init) => {
			const url = String(input)
			requests.push({ url, method: init?.method ?? "GET" })
			if (url.endsWith(`/git/commits/${commitSha}`)) {
				return jsonResponse({ sha: commitSha, tree: { sha: treeSha } })
			}
			if (url.endsWith(`/git/trees/${treeSha}?recursive=1`)) {
				return jsonResponse({
					sha: treeSha,
					truncated: false,
					tree: [
						{
							path: "apps/api/.env.production.enc",
							mode: "100644",
							type: "blob",
							sha: blob.sha,
							size: blob.bytes.byteLength,
						},
						{
							path: "package.json",
							mode: "100644",
							type: "blob",
							sha: "c".repeat(40),
							size: 1,
						},
					],
				})
			}
			if (url.endsWith(`/git/blobs/${blob.sha}`)) {
				return jsonResponse({
					sha: blob.sha,
					size: blob.bytes.byteLength,
					encoding: "base64",
					content: blob.bytes.toString("base64"),
				})
			}
			throw new Error("unexpected request")
		}

		const client = new GitHubClient({
			token: "github-token",
			repository: "dotenc/example",
			fetchImpl,
		})
		expect(await client.getEncryptedEnvironments(commitSha)).toEqual([
			{ path: "apps/api/.env.production.enc", content: '{"version":2}' },
		])
		expect(requests.map((request) => request.url)).toEqual([
			`https://api.github.com/repos/dotenc/example/git/commits/${commitSha}`,
			`https://api.github.com/repos/dotenc/example/git/trees/${treeSha}?recursive=1`,
			`https://api.github.com/repos/dotenc/example/git/blobs/${blob.sha}`,
		])
		expect(requests.every((request) => request.method === "GET")).toBe(true)
	})

	test("rejects truncated trees instead of silently creating a partial report", async () => {
		const fetchImpl: FetchLike = async (input) => {
			const url = String(input)
			return url.includes("/git/commits/")
				? jsonResponse({ sha: commitSha, tree: { sha: treeSha } })
				: jsonResponse({ sha: treeSha, truncated: true, tree: [] })
		}
		const client = new GitHubClient({
			token: "github-token",
			repository: "dotenc/example",
			fetchImpl,
		})

		await expect(client.getEncryptedEnvironments(commitSha)).rejects.toThrow(
			"could not be completed safely",
		)
	})

	test("ignores unrelated odd or long paths before applying environment limits", async () => {
		const fetchImpl: FetchLike = async (input) => {
			const url = String(input)
			return url.includes("/git/commits/")
				? jsonResponse({ sha: commitSha, tree: { sha: treeSha } })
				: jsonResponse({
						sha: treeSha,
						truncated: false,
						tree: [
							{ path: `${"very-long/".repeat(200)}README.md` },
							{ path: "odd/../README.md" },
						],
					})
		}
		const client = new GitHubClient({
			token: "github-token",
			repository: "dotenc/example",
			fetchImpl,
		})

		expect(await client.getEncryptedEnvironments(commitSha)).toEqual([])
	})

	test("rejects oversized environment entries before fetching their content", async () => {
		let requestCount = 0
		const fetchImpl: FetchLike = async (input) => {
			requestCount += 1
			const url = String(input)
			return url.includes("/git/commits/")
				? jsonResponse({ sha: commitSha, tree: { sha: treeSha } })
				: jsonResponse({
						sha: treeSha,
						truncated: false,
						tree: [
							{
								path: ".env.production.enc",
								mode: "100644",
								type: "blob",
								sha: "d".repeat(40),
								size: ACTION_LIMITS.maxEnvironmentFileBytes + 1,
							},
						],
					})
		}
		const client = new GitHubClient({
			token: "github-token",
			repository: "dotenc/example",
			fetchImpl,
		})

		await expect(client.getEncryptedEnvironments(commitSha)).rejects.toThrow()
		expect(requestCount).toBe(2)
	})

	test("rejects product-invalid matching paths before fetching their content", async () => {
		for (const invalidPath of [
			"evil\\dir/.env.production.enc",
			"evil\n/.env.production.enc",
			`.env.${"x".repeat(256)}.enc`,
		]) {
			let requestCount = 0
			const fetchImpl: FetchLike = async (input) => {
				requestCount += 1
				const url = String(input)
				return url.includes("/git/commits/")
					? jsonResponse({ sha: commitSha, tree: { sha: treeSha } })
					: jsonResponse({
							sha: treeSha,
							truncated: false,
							tree: [
								{
									path: invalidPath,
									mode: "100644",
									type: "blob",
									sha: "d".repeat(40),
									size: 1,
								},
							],
						})
			}
			const client = new GitHubClient({
				token: "github-token",
				repository: "dotenc/example",
				fetchImpl,
			})

			await expect(client.getEncryptedEnvironments(commitSha)).rejects.toThrow()
			expect(requestCount).toBe(2)
		}
	})

	test("enforces the shared base-plus-head byte budget before fetching blobs", async () => {
		const headCommitSha = "e".repeat(40)
		const headTreeSha = "f".repeat(40)
		let requestCount = 0
		const entries = (prefix: string) =>
			Array.from({ length: 6 }, (_, index) => ({
				path: `${prefix}/.env.environment-${index}.enc`,
				mode: "100644",
				type: "blob",
				sha: String(index + 1).repeat(40),
				size: ACTION_LIMITS.maxEnvironmentFileBytes,
			}))
		const fetchImpl: FetchLike = async (input) => {
			requestCount += 1
			const url = String(input)
			if (url.endsWith(`/git/commits/${commitSha}`)) {
				return jsonResponse({ sha: commitSha, tree: { sha: treeSha } })
			}
			if (url.endsWith(`/git/commits/${headCommitSha}`)) {
				return jsonResponse({ sha: headCommitSha, tree: { sha: headTreeSha } })
			}
			if (url.includes(`/git/trees/${treeSha}`)) {
				return jsonResponse({
					sha: treeSha,
					truncated: false,
					tree: entries("base"),
				})
			}
			if (url.includes(`/git/trees/${headTreeSha}`)) {
				return jsonResponse({
					sha: headTreeSha,
					truncated: false,
					tree: entries("head"),
				})
			}
			throw new Error("blob content must not be requested")
		}
		const client = new GitHubClient({
			token: "github-token",
			repository: "dotenc/example",
			fetchImpl,
		})

		await expect(
			client.getEncryptedEnvironmentComparison(commitSha, headCommitSha),
		).rejects.toThrow()
		expect(requestCount).toBe(4)
	})

	test("cryptographically verifies blob content against the requested object ID", async () => {
		const expectedBlob = gitBlob("expected")
		const tampered = Buffer.from("tampered")
		const fetchImpl: FetchLike = async (input) => {
			const url = String(input)
			if (url.includes("/git/commits/")) {
				return jsonResponse({ sha: commitSha, tree: { sha: treeSha } })
			}
			if (url.includes("/git/trees/")) {
				return jsonResponse({
					sha: treeSha,
					truncated: false,
					tree: [
						{
							path: ".env.production.enc",
							mode: "100644",
							type: "blob",
							sha: expectedBlob.sha,
							size: tampered.byteLength,
						},
					],
				})
			}
			return jsonResponse({
				sha: expectedBlob.sha,
				size: tampered.byteLength,
				encoding: "base64",
				content: tampered.toString("base64"),
			})
		}
		const client = new GitHubClient({
			token: "github-token",
			repository: "dotenc/example",
			fetchImpl,
		})

		await expect(client.getEncryptedEnvironments(commitSha)).rejects.toThrow()
	})

	test("updates the bot-authored marker comment instead of creating another", async () => {
		const requests: Array<{ url: string; method: string; body?: string }> = []
		const fetchImpl: FetchLike = async (input, init) => {
			requests.push({
				url: String(input),
				method: init?.method ?? "GET",
				body: init?.body as string | undefined,
			})
			if ((init?.method ?? "GET") === "GET") {
				return jsonResponse([
					{
						id: 123,
						body: `${COMMENT_MARKER}\nold`,
						user: { login: "github-actions[bot]", type: "Bot" },
					},
				])
			}
			return jsonResponse({
				html_url: "https://github.com/dotenc/example/pull/7#issuecomment-123",
			})
		}
		const client = new GitHubClient({
			token: "github-token",
			repository: "dotenc/example",
			fetchImpl,
		})

		expect(
			await client.upsertPullRequestComment(
				7,
				COMMENT_MARKER,
				`${COMMENT_MARKER}\nnew`,
			),
		).toContain("issuecomment-123")
		expect(requests.map((request) => request.method)).toEqual(["GET", "PATCH"])
		expect(requests[1].url).toEndWith(
			"/repos/dotenc/example/issues/comments/123",
		)
		expect(requests[1].body).toBe(
			JSON.stringify({ body: `${COMMENT_MARKER}\nnew` }),
		)
	})

	test("does not overwrite a marker copied into an untrusted user's comment", async () => {
		const methods: string[] = []
		const fetchImpl: FetchLike = async (_input, init) => {
			const method = init?.method ?? "GET"
			methods.push(method)
			return method === "GET"
				? jsonResponse([
						{
							id: 55,
							body: COMMENT_MARKER,
							user: { login: "attacker", type: "User" },
						},
					])
				: jsonResponse({
						html_url:
							"https://github.com/dotenc/example/pull/7#issuecomment-999",
					})
		}
		const client = new GitHubClient({
			token: "github-token",
			repository: "dotenc/example",
			fetchImpl,
		})

		await client.upsertPullRequestComment(
			7,
			COMMENT_MARKER,
			`${COMMENT_MARKER}\nnew`,
		)
		expect(methods).toEqual(["GET", "POST"])
	})

	test("fails safely at the comment page cap instead of creating spam", async () => {
		const methods: string[] = []
		const fetchImpl: FetchLike = async (_input, init) => {
			methods.push(init?.method ?? "GET")
			return jsonResponse([
				{
					id: methods.length,
					body: "unrelated",
					user: { login: "someone", type: "User" },
				},
			])
		}
		const client = new GitHubClient({
			token: "github-token",
			repository: "dotenc/example",
			fetchImpl,
			limits: {
				...ACTION_LIMITS,
				commentsPerPage: 1,
				maxCommentPages: 2,
			},
		})

		await expect(
			client.upsertPullRequestComment(
				7,
				COMMENT_MARKER,
				`${COMMENT_MARKER}\nnew`,
			),
		).rejects.toThrow()
		expect(methods).toEqual(["GET", "GET"])
	})

	test("never includes an API error body or token in thrown errors", async () => {
		const sentinel = "SENTINEL_PRIVATE_KEY_MATERIAL"
		const client = new GitHubClient({
			token: sentinel,
			repository: "dotenc/example",
			fetchImpl: async () => new Response(sentinel, { status: 403 }),
		})

		try {
			await client.getEncryptedEnvironments(commitSha)
			throw new Error("expected request to fail")
		} catch (error) {
			expect(String(error)).not.toContain(sentinel)
		}
	})
})
