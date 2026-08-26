import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import {
	assertReleaseTargetMissing,
	assertReservedReleaseTarget,
	CLI_RELEASE_ASSETS,
	createCliReleaseDependencies,
	createReleaseReservationMessage,
	evaluateCliReleaseGate,
	reserveCliReleaseTag,
	verifyCliRelease,
} from "../check-cli-release"

const temporaryDirectories: string[] = []
const RUN_ID = "123456789"
const OTHER_RUN_ID = "987654321"

const runGit = (root: string, args: string[]) =>
	execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: os.devNull,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_DEFAULT_HASH: "sha1",
			GIT_TERMINAL_PROMPT: "0",
		},
	}).trim()

const createRepository = () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "dotenc-release-gate-"))
	temporaryDirectories.push(root)
	runGit(root, ["init", "--quiet", "--object-format=sha1"])
	runGit(root, ["config", "user.name", "dotenc test"])
	runGit(root, ["config", "user.email", "test@dotenc.invalid"])
	mkdirSync(path.join(root, "cli"))
	return root
}

const commitVersion = (root: string, version: string) => {
	writeFileSync(
		path.join(root, "cli", "package.json"),
		`${JSON.stringify({ name: "@dotenc/cli", version })}\n`,
	)
	runGit(root, ["add", "cli/package.json"])
	runGit(root, ["commit", "--quiet", "--no-verify", "-m", `v${version}`])
	return runGit(root, ["rev-parse", "HEAD"])
}

type ApiFixture =
	| { error: Error }
	| { headers?: Record<string, string>; status: number; value?: unknown }
type ApiRequest = {
	body?: unknown
	method: string
	url: string
}
type ApiFixtures = Record<string, ApiFixture | ApiFixture[]>

const releaseInventoryPath = "/graphql"
const graphqlUrl = "https://api.github.test/graphql"
const mainRefPath = "/repos/dotenc/dotenc/git/ref/heads/main"
const tagRefPath = (version: string) =>
	`/repos/dotenc/dotenc/git/ref/tags/v${version}`
const tagObjectPath = (sha: string) => `/repos/dotenc/dotenc/git/tags/${sha}`

type ReleaseNodeFixture = {
	id?: string
	isDraft: boolean
	isPrerelease: boolean
	tagName: string
}

const releaseInventoryPage = (
	nodes: ReleaseNodeFixture[],
	pageInfo: { endCursor: string | null; hasNextPage: boolean } = {
		endCursor: null,
		hasNextPage: false,
	},
	totalCount = nodes.length,
) => ({
	data: {
		repository: {
			releases: {
				nodes: nodes.map(({ id, ...node }) => ({
					id: id ?? `release-${node.tagName}`,
					...node,
				})),
				pageInfo,
				totalCount,
			},
		},
	},
})

const reservationFixture = (
	version: string,
	commit: string,
	runId = RUN_ID,
	tagObjectSha = "a".repeat(40),
) => {
	const message = createReleaseReservationMessage(version, commit, runId)
	return {
		message,
		tagObject: {
			sha: tagObjectSha,
			tag: `v${version}`,
			message,
			object: { type: "commit", sha: commit },
		},
		tagObjectSha,
		tagRef: {
			ref: `refs/tags/v${version}`,
			object: { type: "tag", sha: tagObjectSha },
		},
	}
}

const dependencies = (
	root: string,
	fixtures: ApiFixtures = {},
	requests: ApiRequest[] = [],
	delays: number[] = [],
) =>
	createCliReleaseDependencies({
		root,
		repository: "dotenc/dotenc",
		apiUrl: "https://api.github.test",
		graphqlUrl,
		token: "test-token",
		fetchImpl: async (input, init) => {
			const url = String(input)
			const method = init?.method ?? "GET"
			requests.push({
				method,
				url,
				body:
					typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
			})
			const parsedUrl = new URL(url)
			const pathname = `${parsedUrl.pathname}${parsedUrl.search}`
			const configured = fixtures[pathname]
			const fixture = Array.isArray(configured)
				? (configured.shift() ?? { status: 404 })
				: (configured ?? { status: 404 })
			if ("error" in fixture) throw fixture.error
			const body =
				fixture.value === undefined ? "" : JSON.stringify(fixture.value)
			return new Response(body, {
				status: fixture.status,
				headers: {
					"content-length": String(Buffer.byteLength(body)),
					...fixture.headers,
				},
			})
		},
		sleepImpl: async (milliseconds) => {
			delays.push(milliseconds)
		},
	})

const expectedRetryDelays = [1_000, 2_000, 4_000]
const readKinds = ["REST", "GraphQL"] as const
const transientReadFailures: [string, ApiFixture][] = [
	["network failure", { error: new Error("simulated network failure") }],
	["HTTP 408", { status: 408 }],
	["HTTP 500", { status: 500 }],
	["HTTP 502", { status: 502 }],
	["HTTP 503", { status: 503 }],
	["HTTP 504", { status: 504 }],
]

const jsonResponse = (value: unknown) => {
	const body = JSON.stringify(value)
	return new Response(body, {
		status: 200,
		headers: { "content-length": String(Buffer.byteLength(body)) },
	})
}

const trackedBodyResponse = (
	body: ReadableStream<Uint8Array>,
	onCancel: () => void,
	headers: Record<string, string> = {},
	status = 200,
) => {
	const cancel = body.cancel.bind(body)
	body.cancel = async (reason) => {
		onCancel()
		return cancel(reason)
	}
	return new Response(body, { status, headers })
}

const unreadableBodyResponse = (
	onCancel: () => void,
	headers: Record<string, string> = {},
	status = 200,
) =>
	trackedBodyResponse(
		new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new Error("simulated response body failure"))
			},
		}),
		onCancel,
		headers,
		status,
	)

const stalledBodyResponse = (signal: AbortSignal, onCancel: () => void) =>
	trackedBodyResponse(
		new ReadableStream<Uint8Array>({
			start(controller) {
				const abort = () =>
					controller.error(
						signal.reason ?? new DOMException("Aborted", "AbortError"),
					)
				if (signal.aborted) abort()
				else signal.addEventListener("abort", abort, { once: true })
			},
		}),
		onCancel,
	)

afterEach(() => {
	for (const root of temporaryDirectories.splice(0)) {
		rmSync(root, { recursive: true, force: true })
	}
})

describe("CLI release gate", () => {
	test("accepts a strict stable increase independently of registry timing", async () => {
		const root = createRepository()
		const beforeSha = commitVersion(root, "0.13.0")
		const currentSha = commitVersion(root, "0.14.0")
		const requests: ApiRequest[] = []

		expect(
			await evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(
					root,
					{
						[mainRefPath]: {
							status: 200,
							value: { object: { type: "commit", sha: currentSha } },
						},
						[releaseInventoryPath]: {
							status: 200,
							value: releaseInventoryPage([
								{
									tagName: "v0.13.0",
									isDraft: false,
									isPrerelease: false,
								},
							]),
						},
					},
					requests,
				),
			),
		).toEqual({ version: "0.14.0", bumped: true })
		expect(requests.map(({ url }) => url)).toEqual([
			graphqlUrl,
			"https://api.github.test/repos/dotenc/dotenc/git/ref/tags/v0.14.0",
			"https://api.github.test/repos/dotenc/dotenc/git/ref/heads/main",
		])
	})

	test("follows authoritative release pagination through an empty first page", async () => {
		const root = createRepository()
		const beforeSha = commitVersion(root, "0.13.0")
		const currentSha = commitVersion(root, "0.14.0")
		const requests: ApiRequest[] = []

		expect(
			await evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(
					root,
					{
						[mainRefPath]: {
							status: 200,
							value: { object: { type: "commit", sha: currentSha } },
						},
						[releaseInventoryPath]: [
							{
								status: 200,
								value: releaseInventoryPage(
									[],
									{
										hasNextPage: true,
										endCursor: "cursor-1",
									},
									1,
								),
							},
							{
								status: 200,
								value: releaseInventoryPage([
									{
										tagName: "v0.13.0",
										isDraft: false,
										isPrerelease: false,
									},
								]),
							},
						],
					},
					requests,
				),
			),
		).toEqual({ version: "0.14.0", bumped: true })

		const graphqlRequests = requests.filter(({ url }) => url === graphqlUrl)
		expect(graphqlRequests.every(({ method }) => method === "POST")).toBeTrue()
		const variables = graphqlRequests.map(
			({ body }) => (body as { variables: unknown }).variables,
		)
		expect(variables).toEqual([
			{ owner: "dotenc", name: "dotenc", cursor: null },
			{ owner: "dotenc", name: "dotenc", cursor: "cursor-1" },
		])
		const query = (graphqlRequests[0].body as { query: unknown }).query
		expect(query).toBeString()
		for (const field of [
			"totalCount",
			"id",
			"tagName",
			"isDraft",
			"isPrerelease",
		]) {
			expect(query).toContain(field)
		}
	})

	test("rejects missing and non-progressing release cursors", async () => {
		const root = createRepository()
		const currentSha = commitVersion(root, "0.14.0")
		const mainFixture = {
			[mainRefPath]: {
				status: 200,
				value: { object: { type: "commit", sha: currentSha } },
			},
		} satisfies Record<string, ApiFixture>

		await expect(
			assertReleaseTargetMissing(
				currentSha,
				"0.14.0",
				dependencies(root, {
					...mainFixture,
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([], {
							hasNextPage: true,
							endCursor: null,
						}),
					},
				}),
			),
		).rejects.toThrow("release inventory pagination is invalid")

		await expect(
			assertReleaseTargetMissing(
				currentSha,
				"0.14.0",
				dependencies(root, {
					...mainFixture,
					[releaseInventoryPath]: [
						{
							status: 200,
							value: releaseInventoryPage([], {
								hasNextPage: true,
								endCursor: "cursor-1",
							}),
						},
						{
							status: 200,
							value: releaseInventoryPage([], {
								hasNextPage: true,
								endCursor: "cursor-1",
							}),
						},
					],
				}),
			),
		).rejects.toThrow("release inventory pagination is invalid")
	})

	test("rejects false terminal totals and duplicate release evidence", async () => {
		const root = createRepository()
		const currentSha = commitVersion(root, "0.14.0")
		const mainFixture = {
			[mainRefPath]: {
				status: 200,
				value: { object: { type: "commit", sha: currentSha } },
			},
		} satisfies Record<string, ApiFixture>

		await expect(
			assertReleaseTargetMissing(
				currentSha,
				"0.14.0",
				dependencies(root, {
					...mainFixture,
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([], undefined, 1),
					},
				}),
			),
		).rejects.toThrow("release inventory is incomplete")

		const release = {
			tagName: "v0.13.0",
			isDraft: false,
			isPrerelease: false,
		}
		await expect(
			assertReleaseTargetMissing(
				currentSha,
				"0.14.0",
				dependencies(root, {
					...mainFixture,
					[releaseInventoryPath]: [
						{
							status: 200,
							value: releaseInventoryPage(
								[release],
								{ hasNextPage: true, endCursor: "cursor-1" },
								2,
							),
						},
						{
							status: 200,
							value: releaseInventoryPage([release], undefined, 2),
						},
					],
				}),
			),
		).rejects.toThrow("release inventory is invalid")
	})

	test("rejects a release total that changes between pages", async () => {
		const root = createRepository()
		const currentSha = commitVersion(root, "0.14.0")

		await expect(
			assertReleaseTargetMissing(
				currentSha,
				"0.14.0",
				dependencies(root, {
					[mainRefPath]: {
						status: 200,
						value: { object: { type: "commit", sha: currentSha } },
					},
					[releaseInventoryPath]: [
						{
							status: 200,
							value: releaseInventoryPage(
								[],
								{ hasNextPage: true, endCursor: "cursor-1" },
								1,
							),
						},
						{
							status: 200,
							value: releaseInventoryPage([], undefined, 2),
						},
					],
				}),
			),
		).rejects.toThrow("release inventory total is invalid")
	})

	test("rejects GraphQL errors and release totals above the global bound", async () => {
		const root = createRepository()
		const currentSha = commitVersion(root, "0.14.0")
		const mainFixture = {
			[mainRefPath]: {
				status: 200,
				value: { object: { type: "commit", sha: currentSha } },
			},
		} satisfies Record<string, ApiFixture>

		await expect(
			assertReleaseTargetMissing(
				currentSha,
				"0.14.0",
				dependencies(root, {
					...mainFixture,
					[releaseInventoryPath]: {
						status: 200,
						value: { errors: [{ message: "unavailable" }] },
					},
				}),
			),
		).rejects.toThrow("release inventory could not be verified")

		await expect(
			assertReleaseTargetMissing(
				currentSha,
				"0.14.0",
				dependencies(root, {
					...mainFixture,
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([], undefined, 1_001),
					},
				}),
			),
		).rejects.toThrow("release inventory total is invalid")
	})

	test("bounds release inventory pagination independently of page contents", async () => {
		const root = createRepository()
		const currentSha = commitVersion(root, "0.14.0")
		const requests: ApiRequest[] = []
		const pages = Array.from({ length: 10 }, (_, index) => ({
			status: 200,
			value: releaseInventoryPage([], {
				hasNextPage: true,
				endCursor: `cursor-${index + 1}`,
			}),
		}))

		await expect(
			assertReleaseTargetMissing(
				currentSha,
				"0.14.0",
				dependencies(
					root,
					{
						[mainRefPath]: {
							status: 200,
							value: { object: { type: "commit", sha: currentSha } },
						},
						[releaseInventoryPath]: pages,
					},
					requests,
				),
			),
		).rejects.toThrow("release inventory exceeded its bound")
		expect(requests.filter(({ url }) => url === graphqlUrl)).toHaveLength(10)
	})

	test("treats an unchanged unreleased version as a pending release", async () => {
		const root = createRepository()
		commitVersion(root, "0.14.0")
		writeFileSync(path.join(root, "README.md"), "unchanged version\n")
		runGit(root, ["add", "README.md"])
		runGit(root, ["commit", "--quiet", "--no-verify", "-m", "docs"])
		const currentSha = runGit(root, ["rev-parse", "HEAD"])
		const beforeSha = runGit(root, ["rev-parse", "HEAD^"])
		const requests: ApiRequest[] = []

		expect(
			await evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(
					root,
					{
						[mainRefPath]: {
							status: 200,
							value: { object: { type: "commit", sha: currentSha } },
						},
						[releaseInventoryPath]: {
							status: 200,
							value: releaseInventoryPage([]),
						},
					},
					requests,
				),
			),
		).toEqual({ version: "0.14.0", bumped: true })
		expect(requests.map(({ url }) => url)).toEqual([
			graphqlUrl,
			"https://api.github.test/repos/dotenc/dotenc/git/ref/tags/v0.14.0",
			"https://api.github.test/repos/dotenc/dotenc/git/ref/heads/main",
		])
	})

	test("rejects a downgrade below the maximum stable first-parent version", async () => {
		const root = createRepository()
		commitVersion(root, "0.20.0")
		const beforeSha = commitVersion(root, "0.13.0")
		const currentSha = commitVersion(root, "0.14.0")

		await expect(
			evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(root),
			),
		).rejects.toThrow("greater than historical version 0.20.0")
	})

	test("rejects malformed historical package versions", async () => {
		const root = createRepository()
		commitVersion(root, "0.12.0")
		commitVersion(root, "not-semver")
		const beforeSha = commitVersion(root, "0.13.0")
		const currentSha = commitVersion(root, "0.14.0")

		await expect(
			evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(root),
			),
		).rejects.toThrow("historical CLI version is not valid SemVer")
	})

	test("rejects a higher intermediate version in one multi-commit push", async () => {
		const root = createRepository()
		const beforeSha = commitVersion(root, "0.13.0")
		commitVersion(root, "0.20.0")
		const currentSha = commitVersion(root, "0.15.0")

		await expect(
			evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(root),
			),
		).rejects.toThrow("higher intermediate version 0.20.0")
	})

	test("rejects a queued release whose version is stale relative to main", async () => {
		const root = createRepository()
		const beforeSha = commitVersion(root, "0.13.0")
		const currentSha = commitVersion(root, "0.14.0")
		const remoteSha = "f".repeat(40)
		const mainRefPath = "/repos/dotenc/dotenc/git/ref/heads/main"
		const comparePath = `/repos/dotenc/dotenc/compare/${currentSha}...${remoteSha}`
		const contentsPath = `/repos/dotenc/dotenc/contents/cli/package.json?ref=${remoteSha}`
		const remotePackage = Buffer.from(
			JSON.stringify({ name: "@dotenc/cli", version: "0.15.0" }),
		).toString("base64")

		await expect(
			evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(root, {
					[mainRefPath]: {
						status: 200,
						value: { object: { type: "commit", sha: remoteSha } },
					},
					[comparePath]: {
						status: 200,
						value: {
							status: "ahead",
							merge_base_commit: { sha: currentSha },
						},
					},
					[contentsPath]: {
						status: 200,
						value: {
							type: "file",
							encoding: "base64",
							content: remotePackage,
						},
					},
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([
							{
								tagName: "v0.13.0",
								isDraft: false,
								isPrerelease: false,
							},
						]),
					},
				}),
			),
		).rejects.toThrow("0.14.0 is stale relative to main 0.15.0")
	})

	test("allows a later main commit with the same real-size CLI package version", async () => {
		const root = createRepository()
		const beforeSha = commitVersion(root, "0.13.0")
		const currentSha = commitVersion(root, "0.14.0")
		const remoteSha = "e".repeat(40)
		const mainRefPath = "/repos/dotenc/dotenc/git/ref/heads/main"
		const comparePath = `/repos/dotenc/dotenc/compare/${currentSha}...${remoteSha}`
		const contentsPath = `/repos/dotenc/dotenc/contents/cli/package.json?ref=${remoteSha}`
		const remotePackageSource = readFileSync(
			path.resolve(import.meta.dir, "../../cli/package.json"),
			"utf8",
		).replace(/^  "version": "[^"]+",$/m, '  "version": "0.14.0",')
		const remotePackage = Buffer.from(remotePackageSource).toString("base64")
		expect(remotePackage.length).toBeGreaterThan(4096)

		expect(
			await evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(root, {
					[mainRefPath]: {
						status: 200,
						value: { object: { type: "commit", sha: remoteSha } },
					},
					[comparePath]: {
						status: 200,
						value: {
							status: "ahead",
							merge_base_commit: { sha: currentSha },
						},
					},
					[contentsPath]: {
						status: 200,
						value: {
							type: "file",
							encoding: "base64",
							content: remotePackage,
						},
					},
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([
							{
								tagName: "v0.13.0",
								isDraft: false,
								isPrerelease: false,
							},
						]),
					},
				}),
			),
		).toEqual({ version: "0.14.0", bumped: true })
	})

	test("rejects a non-ancestor previous revision", async () => {
		const root = createRepository()
		commitVersion(root, "0.13.0")
		const mainBranch = runGit(root, ["branch", "--show-current"])
		runGit(root, ["checkout", "--quiet", "-b", "side"])
		const beforeSha = commitVersion(root, "0.14.0")
		runGit(root, ["checkout", "--quiet", mainBranch])
		const currentSha = commitVersion(root, "0.15.0")

		await expect(
			evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(root),
			),
		).rejects.toThrow("not a forward history transition")
	})

	test("fails closed for draft releases, existing tags, and incomplete inventories", async () => {
		const root = createRepository()
		const beforeSha = commitVersion(root, "0.13.0")
		const currentSha = commitVersion(root, "0.14.0")
		const mainRefPath = "/repos/dotenc/dotenc/git/ref/heads/main"
		const mainFixture = {
			[mainRefPath]: {
				status: 200,
				value: { object: { type: "commit", sha: currentSha } },
			},
		} satisfies Record<string, ApiFixture>
		const tagPath = "/repos/dotenc/dotenc/git/ref/tags/v0.14.0"

		await expect(
			assertReleaseTargetMissing(
				currentSha,
				"0.14.0",
				dependencies(root, {
					...mainFixture,
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([
							{ tagName: "v0.14.0", isDraft: true, isPrerelease: false },
						]),
					},
				}),
			),
		).rejects.toThrow("already exists")

		await expect(
			evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(root, {
					...mainFixture,
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([
							{ tagName: "v0.14.0", isDraft: true, isPrerelease: false },
						]),
					},
				}),
			),
		).rejects.toThrow("Partial release v0.14.0")

		await expect(
			assertReleaseTargetMissing(
				currentSha,
				"0.14.0",
				dependencies(root, {
					...mainFixture,
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([
							{ tagName: "v0.15.0", isDraft: false, isPrerelease: false },
						]),
					},
				}),
			),
		).rejects.toThrow("must exceed existing release v0.15.0")

		await expect(
			assertReleaseTargetMissing(
				currentSha,
				"0.14.0",
				dependencies(root, {
					...mainFixture,
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([]),
					},
					[tagPath]: { status: 200, value: {} },
				}),
			),
		).rejects.toThrow("already exists")

		await expect(
			assertReleaseTargetMissing(
				currentSha,
				"0.14.0",
				dependencies(root, {
					...mainFixture,
					[releaseInventoryPath]: { status: 500 },
				}),
			),
		).rejects.toThrow("could not be inspected")
	})

	test("creates an annotated release reservation before fan-out", async () => {
		const root = createRepository()
		const currentSha = commitVersion(root, "0.14.0")
		const reservation = reservationFixture("0.14.0", currentSha)
		const requests: ApiRequest[] = []

		await reserveCliReleaseTag(
			currentSha,
			"0.14.0",
			RUN_ID,
			dependencies(
				root,
				{
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([]),
					},
					[mainRefPath]: {
						status: 200,
						value: { object: { type: "commit", sha: currentSha } },
					},
					"/repos/dotenc/dotenc/git/tags": {
						status: 201,
						value: reservation.tagObject,
					},
					"/repos/dotenc/dotenc/git/refs": {
						status: 201,
						value: reservation.tagRef,
					},
				},
				requests,
			),
		)

		expect(
			requests.filter(
				({ url }) => url.endsWith("/git/tags") || url.endsWith("/git/refs"),
			),
		).toEqual([
			{
				method: "POST",
				url: "https://api.github.test/repos/dotenc/dotenc/git/tags",
				body: {
					tag: "v0.14.0",
					message: reservation.message,
					object: currentSha,
					type: "commit",
				},
			},
			{
				method: "POST",
				url: "https://api.github.test/repos/dotenc/dotenc/git/refs",
				body: {
					ref: "refs/tags/v0.14.0",
					sha: reservation.tagObjectSha,
				},
			},
		])
	})

	test("keeps an exact owner reservation idempotent on rerun", async () => {
		const root = createRepository()
		const beforeSha = commitVersion(root, "0.13.0")
		const currentSha = commitVersion(root, "0.14.0")
		const reservation = reservationFixture("0.14.0", currentSha)
		const requests: ApiRequest[] = []
		const deps = dependencies(
			root,
			{
				[releaseInventoryPath]: {
					status: 200,
					value: releaseInventoryPage([
						{
							tagName: "v0.13.0",
							isDraft: false,
							isPrerelease: false,
						},
					]),
				},
				[tagRefPath("0.14.0")]: {
					status: 200,
					value: reservation.tagRef,
				},
				[tagObjectPath(reservation.tagObjectSha)]: {
					status: 200,
					value: reservation.tagObject,
				},
			},
			requests,
		)

		expect(
			await evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				deps,
			),
		).toEqual({ version: "0.14.0", bumped: true })
		await reserveCliReleaseTag(currentSha, "0.14.0", RUN_ID, deps)
		expect(
			requests.some(
				({ url }) => url.endsWith("/git/tags") || url.endsWith("/git/refs"),
			),
		).toBeFalse()
	})

	test("fails closed when the same workflow run already published", async () => {
		const root = createRepository()
		const beforeSha = commitVersion(root, "0.13.0")
		const currentSha = commitVersion(root, "0.14.0")
		const reservation = reservationFixture("0.14.0", currentSha)

		await expect(
			evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(root, {
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([
							{
								tagName: "v0.13.0",
								isDraft: false,
								isPrerelease: false,
							},
							{
								tagName: "v0.14.0",
								isDraft: false,
								isPrerelease: false,
							},
						]),
					},
					[tagRefPath("0.14.0")]: {
						status: 200,
						value: reservation.tagRef,
					},
					[tagObjectPath(reservation.tagObjectSha)]: {
						status: 200,
						value: reservation.tagObject,
					},
				}),
			),
		).rejects.toThrow("already published its CLI release")
	})

	test("accepts a 422 reference race only for the exact owner", async () => {
		const root = createRepository()
		const currentSha = commitVersion(root, "0.14.0")
		const reservation = reservationFixture("0.14.0", currentSha)
		const requests: ApiRequest[] = []

		await reserveCliReleaseTag(
			currentSha,
			"0.14.0",
			RUN_ID,
			dependencies(
				root,
				{
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([]),
					},
					[tagRefPath("0.14.0")]: [
						{ status: 404 },
						{ status: 200, value: reservation.tagRef },
					],
					[mainRefPath]: {
						status: 200,
						value: { object: { type: "commit", sha: currentSha } },
					},
					"/repos/dotenc/dotenc/git/tags": {
						status: 201,
						value: reservation.tagObject,
					},
					"/repos/dotenc/dotenc/git/refs": { status: 422 },
					[tagObjectPath(reservation.tagObjectSha)]: {
						status: 200,
						value: reservation.tagObject,
					},
				},
				requests,
			),
		)

		expect(
			requests.filter(
				({ method, url }) =>
					method === "GET" && url.endsWith("/git/ref/tags/v0.14.0"),
			),
		).toHaveLength(2)
	})

	test("does not steal a valid reservation from an earlier same-version run", async () => {
		const root = createRepository()
		commitVersion(root, "0.13.0")
		const reservedSha = commitVersion(root, "0.14.0")
		writeFileSync(path.join(root, "README.md"), "later same-version head\n")
		runGit(root, ["add", "README.md"])
		runGit(root, ["commit", "--quiet", "--no-verify", "-m", "docs"])
		const currentSha = runGit(root, ["rev-parse", "HEAD"])
		const reservation = reservationFixture("0.14.0", reservedSha, OTHER_RUN_ID)
		const requests: ApiRequest[] = []

		expect(
			await evaluateCliReleaseGate(
				{
					eventName: "push",
					beforeSha: reservedSha,
					currentSha,
					runId: RUN_ID,
				},
				dependencies(
					root,
					{
						[releaseInventoryPath]: {
							status: 200,
							value: releaseInventoryPage([
								{
									tagName: "v0.13.0",
									isDraft: false,
									isPrerelease: false,
								},
							]),
						},
						[tagRefPath("0.14.0")]: {
							status: 200,
							value: reservation.tagRef,
						},
						[tagObjectPath(reservation.tagObjectSha)]: {
							status: 200,
							value: reservation.tagObject,
						},
						[mainRefPath]: {
							status: 200,
							value: { object: { type: "commit", sha: currentSha } },
						},
					},
					requests,
				),
			),
		).toEqual({ version: "0.14.0", bumped: false })
		expect(
			requests.some(
				({ url }) => url.endsWith("/git/tags") || url.endsWith("/git/refs"),
			),
		).toBeFalse()
	})

	test("rejects a reservation marker that does not match its target", async () => {
		const root = createRepository()
		const beforeSha = commitVersion(root, "0.13.0")
		const currentSha = commitVersion(root, "0.14.0")
		const reservation = reservationFixture("0.14.0", currentSha)
		const mismatchedTagObject = {
			...reservation.tagObject,
			message: createReleaseReservationMessage("0.14.0", beforeSha, RUN_ID),
		}

		await expect(
			evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(root, {
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([
							{
								tagName: "v0.13.0",
								isDraft: false,
								isPrerelease: false,
							},
						]),
					},
					[tagRefPath("0.14.0")]: {
						status: 200,
						value: reservation.tagRef,
					},
					[tagObjectPath(reservation.tagObjectSha)]: {
						status: 200,
						value: mismatchedTagObject,
					},
				}),
			),
		).rejects.toThrow("marker does not match its target")
	})

	test("rejects a draft colliding with an exact annotated reservation", async () => {
		const root = createRepository()
		const currentSha = commitVersion(root, "0.14.0")
		const reservation = reservationFixture("0.14.0", currentSha)

		await expect(
			assertReservedReleaseTarget(
				currentSha,
				"0.14.0",
				RUN_ID,
				dependencies(root, {
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([
							{
								tagName: "v0.14.0",
								isDraft: true,
								isPrerelease: false,
							},
						]),
					},
					[tagRefPath("0.14.0")]: {
						status: 200,
						value: reservation.tagRef,
					},
				}),
			),
		).rejects.toThrow("missing or ambiguous")
	})

	test("blocks a later release while a lower stable draft is unfinished", async () => {
		const root = createRepository()
		commitVersion(root, "0.13.0")
		const beforeSha = commitVersion(root, "0.14.0")
		const currentSha = commitVersion(root, "0.15.0")

		await expect(
			evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(root, {
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([
							{
								tagName: "v0.13.0",
								isDraft: false,
								isPrerelease: false,
							},
							{
								tagName: "v0.14.0",
								isDraft: true,
								isPrerelease: false,
							},
						]),
					},
				}),
			),
		).rejects.toThrow("Partial release v0.14.0")
	})

	test("requires the exact prior stable version to be published", async () => {
		const root = createRepository()
		commitVersion(root, "0.13.0")
		const beforeSha = commitVersion(root, "0.14.0")
		const currentSha = commitVersion(root, "0.15.0")

		await expect(
			evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(root, {
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([
							{
								tagName: "v0.14.1",
								isDraft: false,
								isPrerelease: false,
							},
						]),
					},
				}),
			),
		).rejects.toThrow(
			"Previous CLI version v0.14.0 is not a published stable release",
		)
	})

	test("accepts an exact target reservation after main advances", async () => {
		const root = createRepository()
		const currentSha = commitVersion(root, "0.14.0")
		const reservation = reservationFixture("0.14.0", currentSha)
		const requests: ApiRequest[] = []

		await assertReservedReleaseTarget(
			currentSha,
			"0.14.0",
			RUN_ID,
			dependencies(
				root,
				{
					[releaseInventoryPath]: {
						status: 200,
						value: releaseInventoryPage([]),
					},
					[tagRefPath("0.14.0")]: {
						status: 200,
						value: reservation.tagRef,
					},
					[tagObjectPath(reservation.tagObjectSha)]: {
						status: 200,
						value: reservation.tagObject,
					},
					[mainRefPath]: {
						status: 200,
						value: { object: { type: "commit", sha: "f".repeat(40) } },
					},
				},
				requests,
			),
		)
		expect(requests.map(({ url }) => url)).not.toContain(
			"https://api.github.test/repos/dotenc/dotenc/git/ref/heads/main",
		)
	})

	for (const [label, failure] of transientReadFailures) {
		test(`retries a transient REST read after ${label}`, async () => {
			const root = createRepository()
			const requests: ApiRequest[] = []
			const delays: number[] = []
			const deps = dependencies(
				root,
				{
					[tagRefPath("0.14.0")]: [
						failure,
						{ status: 200, value: { ok: true } },
					],
				},
				requests,
				delays,
			)

			expect(await deps.github("git/ref/tags/v0.14.0")).toEqual({
				status: "present",
				value: { ok: true },
			})
			expect(requests).toHaveLength(2)
			expect(delays).toEqual([expectedRetryDelays[0]])
		})

		test(`retries a transient GraphQL read after ${label}`, async () => {
			const root = createRepository()
			const requests: ApiRequest[] = []
			const delays: number[] = []
			const page = releaseInventoryPage([])
			const deps = dependencies(
				root,
				{
					[releaseInventoryPath]: [failure, { status: 200, value: page }],
				},
				requests,
				delays,
			)

			expect(await deps.releasePage()).toEqual(page)
			expect(requests).toHaveLength(2)
			expect(delays).toEqual([expectedRetryDelays[0]])
		})
	}

	for (const kind of readKinds) {
		test(`retries a ${kind} read after a 200 response body failure`, async () => {
			const root = createRepository()
			const delays: number[] = []
			const signals: (AbortSignal | null | undefined)[] = []
			let attempts = 0
			let cancellations = 0
			const page = releaseInventoryPage([])
			const deps = createCliReleaseDependencies({
				root,
				repository: "dotenc/dotenc",
				apiUrl: "https://api.github.test",
				graphqlUrl,
				token: "test-token",
				fetchImpl: async (_input, init) => {
					signals.push(init?.signal)
					attempts += 1
					if (attempts === 1) {
						return unreadableBodyResponse(() => {
							cancellations += 1
						})
					}
					return jsonResponse(kind === "REST" ? { ok: true } : page)
				},
				readTimeoutSignalImpl: () => new AbortController().signal,
				sleepImpl: async (milliseconds) => {
					delays.push(milliseconds)
				},
			})

			if (kind === "REST") {
				expect(await deps.github("git/ref/tags/v0.14.0")).toEqual({
					status: "present",
					value: { ok: true },
				})
			} else {
				expect(await deps.releasePage()).toEqual(page)
			}
			expect(attempts).toBe(2)
			expect(cancellations).toBe(1)
			expect(delays).toEqual([expectedRetryDelays[0]])
			expect(new Set(signals).size).toBe(2)
		})

		test(`retries a ${kind} read after a stalled 200 response body aborts`, async () => {
			const root = createRepository()
			const controllers: AbortController[] = []
			const delays: number[] = []
			const signals: (AbortSignal | null | undefined)[] = []
			let attempts = 0
			let cancellations = 0
			const page = releaseInventoryPage([])
			const deps = createCliReleaseDependencies({
				root,
				repository: "dotenc/dotenc",
				apiUrl: "https://api.github.test",
				graphqlUrl,
				token: "test-token",
				fetchImpl: async (_input, init) => {
					signals.push(init?.signal)
					attempts += 1
					if (attempts === 1) {
						const signal = init?.signal
						if (!(signal instanceof AbortSignal)) {
							throw new Error("missing read timeout signal")
						}
						const response = stalledBodyResponse(signal, () => {
							cancellations += 1
						})
						const controller = controllers.at(-1)
						setTimeout(
							() =>
								controller?.abort(
									new DOMException("Timed out", "TimeoutError"),
								),
							0,
						)
						return response
					}
					return jsonResponse(kind === "REST" ? { ok: true } : page)
				},
				readTimeoutSignalImpl: () => {
					const controller = new AbortController()
					controllers.push(controller)
					return controller.signal
				},
				sleepImpl: async (milliseconds) => {
					delays.push(milliseconds)
				},
			})

			if (kind === "REST") {
				expect(await deps.github("git/ref/tags/v0.14.0")).toEqual({
					status: "present",
					value: { ok: true },
				})
			} else {
				expect(await deps.releasePage()).toEqual(page)
			}
			expect(attempts).toBe(2)
			expect(cancellations).toBe(1)
			expect(delays).toEqual([expectedRetryDelays[0]])
			expect(controllers).toHaveLength(2)
			expect(controllers[0].signal.aborted).toBeTrue()
			expect(new Set(signals).size).toBe(2)
		})

		test(`exhausts ${kind} 200 response body failures deterministically`, async () => {
			const root = createRepository()
			const delays: number[] = []
			const signals: (AbortSignal | null | undefined)[] = []
			let attempts = 0
			let cancellations = 0
			const deps = createCliReleaseDependencies({
				root,
				repository: "dotenc/dotenc",
				apiUrl: "https://api.github.test",
				graphqlUrl,
				token: "test-token",
				fetchImpl: async (_input, init) => {
					signals.push(init?.signal)
					attempts += 1
					return unreadableBodyResponse(() => {
						cancellations += 1
					})
				},
				readTimeoutSignalImpl: () => new AbortController().signal,
				sleepImpl: async (milliseconds) => {
					delays.push(milliseconds)
				},
			})

			const read =
				kind === "REST"
					? deps.github("git/ref/tags/v0.14.0")
					: deps.releasePage()
			await expect(read).rejects.toThrow("could not be inspected")
			expect(attempts).toBe(4)
			expect(cancellations).toBe(4)
			expect(delays).toEqual(expectedRetryDelays)
			expect(signals).toHaveLength(4)
			expect(
				signals.every((signal) => signal instanceof AbortSignal),
			).toBeTrue()
			expect(new Set(signals).size).toBe(4)
		})
	}

	test("applies Retry-After and rate-limit policy to 200 body retries", async () => {
		const root = createRepository()
		let graphqlAttempts = 0
		let graphqlCancellations = 0
		const graphqlDelays: number[] = []
		const page = releaseInventoryPage([])
		const graphqlDeps = createCliReleaseDependencies({
			root,
			repository: "dotenc/dotenc",
			apiUrl: "https://api.github.test",
			graphqlUrl,
			token: "test-token",
			fetchImpl: async () => {
				graphqlAttempts += 1
				if (graphqlAttempts === 1) {
					return unreadableBodyResponse(
						() => {
							graphqlCancellations += 1
						},
						{ "retry-after": "2" },
					)
				}
				return jsonResponse(page)
			},
			readTimeoutSignalImpl: () => new AbortController().signal,
			sleepImpl: async (milliseconds) => {
				graphqlDelays.push(milliseconds)
			},
		})
		expect(await graphqlDeps.releasePage()).toEqual(page)
		expect(graphqlAttempts).toBe(2)
		expect(graphqlCancellations).toBe(1)
		expect(graphqlDelays).toEqual([2_000])

		let restAttempts = 0
		let restCancellations = 0
		const restDelays: number[] = []
		const restDeps = createCliReleaseDependencies({
			root,
			repository: "dotenc/dotenc",
			apiUrl: "https://api.github.test",
			graphqlUrl,
			token: "test-token",
			fetchImpl: async () => {
				restAttempts += 1
				if (restAttempts === 1) {
					return unreadableBodyResponse(
						() => {
							restCancellations += 1
						},
						{ "x-ratelimit-remaining": "0" },
					)
				}
				return jsonResponse({ ok: true })
			},
			readTimeoutSignalImpl: () => new AbortController().signal,
			sleepImpl: async (milliseconds) => {
				restDelays.push(milliseconds)
			},
		})
		await expect(restDeps.github("git/ref/tags/v0.14.0")).rejects.toThrow(
			"could not be inspected",
		)
		expect(restAttempts).toBe(1)
		expect(restCancellations).toBe(1)
		expect(restDelays).toEqual([])
	})

	test("fails closed on malformed or over-budget body Retry-After values", async () => {
		const root = createRepository()
		for (const retryAfter of ["1.5", "31"]) {
			let attempts = 0
			let cancellations = 0
			const delays: number[] = []
			const deps = createCliReleaseDependencies({
				root,
				repository: "dotenc/dotenc",
				apiUrl: "https://api.github.test",
				graphqlUrl,
				token: "test-token",
				fetchImpl: async () => {
					attempts += 1
					return unreadableBodyResponse(
						() => {
							cancellations += 1
						},
						{ "retry-after": retryAfter },
					)
				},
				readTimeoutSignalImpl: () => new AbortController().signal,
				sleepImpl: async (milliseconds) => {
					delays.push(milliseconds)
				},
			})

			await expect(deps.releasePage()).rejects.toThrow("could not be inspected")
			expect(attempts).toBe(1)
			expect(cancellations).toBe(1)
			expect(delays).toEqual([])
		}
	})

	for (const kind of readKinds) {
		test(`does not retry malformed ${kind} 200 response content`, async () => {
			const root = createRepository()
			const delays: number[] = []
			let attempts = 0
			const deps = createCliReleaseDependencies({
				root,
				repository: "dotenc/dotenc",
				apiUrl: "https://api.github.test",
				graphqlUrl,
				token: "test-token",
				fetchImpl: async () => {
					attempts += 1
					return attempts === 1
						? new Response("{", {
								status: 200,
								headers: { "content-length": "1" },
							})
						: jsonResponse(
								kind === "REST" ? { ok: true } : releaseInventoryPage([]),
							)
				},
				readTimeoutSignalImpl: () => new AbortController().signal,
				sleepImpl: async (milliseconds) => {
					delays.push(milliseconds)
				},
			})

			const read =
				kind === "REST"
					? deps.github("git/ref/tags/v0.14.0")
					: deps.releasePage()
			await expect(read).rejects.toThrow("response is invalid")
			expect(attempts).toBe(1)
			expect(delays).toEqual([])
		})
	}

	test("cancels transient bodies before waiting and refreshes attempt deadlines", async () => {
		const root = createRepository()
		const events: string[] = []
		const signals: (AbortSignal | null | undefined)[] = []
		let attempt = 0
		const page = releaseInventoryPage([])
		const deps = createCliReleaseDependencies({
			root,
			repository: "dotenc/dotenc",
			apiUrl: "https://api.github.test",
			graphqlUrl,
			token: "test-token",
			fetchImpl: async (_input, init) => {
				signals.push(init?.signal)
				attempt += 1
				if (attempt === 1) {
					return new Response(
						new ReadableStream<Uint8Array>({
							cancel() {
								events.push("cancel")
							},
						}),
						{ status: 503 },
					)
				}
				const body = JSON.stringify(page)
				return new Response(body, {
					status: 200,
					headers: { "content-length": String(Buffer.byteLength(body)) },
				})
			},
			sleepImpl: async (milliseconds) => {
				events.push(`sleep:${milliseconds}`)
			},
		})

		expect(await deps.releasePage()).toEqual(page)
		expect(events).toEqual(["cancel", "sleep:1000"])
		expect(signals).toHaveLength(2)
		expect(signals[0]).toBeInstanceOf(AbortSignal)
		expect(signals[1]).toBeInstanceOf(AbortSignal)
		expect(signals[0]).not.toBe(signals[1])
	})

	test("stops retrying REST and GraphQL reads after four attempts", async () => {
		const root = createRepository()
		const restRequests: ApiRequest[] = []
		const restDelays: number[] = []
		const restDeps = dependencies(
			root,
			{ [tagRefPath("0.14.0")]: { status: 503 } },
			restRequests,
			restDelays,
		)

		await expect(restDeps.github("git/ref/tags/v0.14.0")).rejects.toThrow(
			"could not be inspected",
		)
		expect(restRequests).toHaveLength(4)
		expect(restDelays).toEqual(expectedRetryDelays)

		const graphqlRequests: ApiRequest[] = []
		const graphqlDelays: number[] = []
		const graphqlDeps = dependencies(
			root,
			{
				[releaseInventoryPath]: {
					error: new Error("persistent network failure"),
				},
			},
			graphqlRequests,
			graphqlDelays,
		)

		await expect(graphqlDeps.releasePage()).rejects.toThrow(
			"could not be inspected",
		)
		expect(graphqlRequests).toHaveLength(4)
		expect(graphqlDelays).toEqual(expectedRetryDelays)
	})

	for (const status of [403, 404, 429]) {
		test(`does not retry HTTP ${status} read responses`, async () => {
			const root = createRepository()
			const restRequests: ApiRequest[] = []
			const restDelays: number[] = []
			const restDeps = dependencies(
				root,
				{ [tagRefPath("0.14.0")]: { status } },
				restRequests,
				restDelays,
			)

			if (status === 404) {
				expect(await restDeps.github("git/ref/tags/v0.14.0")).toEqual({
					status: "missing",
				})
			} else {
				await expect(restDeps.github("git/ref/tags/v0.14.0")).rejects.toThrow(
					"could not be inspected",
				)
			}
			expect(restRequests).toHaveLength(1)
			expect(restDelays).toEqual([])

			const graphqlRequests: ApiRequest[] = []
			const graphqlDelays: number[] = []
			const graphqlDeps = dependencies(
				root,
				{ [releaseInventoryPath]: { status } },
				graphqlRequests,
				graphqlDelays,
			)
			await expect(graphqlDeps.releasePage()).rejects.toThrow(
				"could not be inspected",
			)
			expect(graphqlRequests).toHaveLength(1)
			expect(graphqlDelays).toEqual([])
		})
	}

	test("honors bounded numeric Retry-After delays for retryable reads", async () => {
		const root = createRepository()
		const restDelays: number[] = []
		const restDeps = dependencies(
			root,
			{
				[tagRefPath("0.14.0")]: [
					{ status: 503, headers: { "retry-after": "2" } },
					{ status: 200, value: { ok: true } },
				],
			},
			[],
			restDelays,
		)
		expect(await restDeps.github("git/ref/tags/v0.14.0")).toEqual({
			status: "present",
			value: { ok: true },
		})
		expect(restDelays).toEqual([2_000])

		const graphqlDelays: number[] = []
		const page = releaseInventoryPage([])
		const graphqlDeps = dependencies(
			root,
			{
				[releaseInventoryPath]: [
					{ status: 503, headers: { "retry-after": "0" } },
					{ status: 200, value: page },
				],
			},
			[],
			graphqlDelays,
		)
		expect(await graphqlDeps.releasePage()).toEqual(page)
		expect(graphqlDelays).toEqual([expectedRetryDelays[0]])
	})

	test("fails closed on malformed or over-budget Retry-After values", async () => {
		const root = createRepository()
		for (const retryAfter of ["1.5", "31"]) {
			const requests: ApiRequest[] = []
			const delays: number[] = []
			const deps = dependencies(
				root,
				{
					[releaseInventoryPath]: [
						{ status: 503, headers: { "retry-after": retryAfter } },
						{ status: 200, value: releaseInventoryPage([]) },
					],
				},
				requests,
				delays,
			)

			await expect(deps.releasePage()).rejects.toThrow("could not be inspected")
			expect(requests).toHaveLength(1)
			expect(delays).toEqual([])
		}
	})

	test("caps cumulative Retry-After sleep at thirty seconds", async () => {
		const root = createRepository()
		const overBudgetRequests: ApiRequest[] = []
		const overBudgetDelays: number[] = []
		const overBudgetDeps = dependencies(
			root,
			{
				[tagRefPath("0.14.0")]: [
					{ status: 503, headers: { "retry-after": "20" } },
					{ status: 503, headers: { "retry-after": "20" } },
					{ status: 200, value: { ok: true } },
				],
			},
			overBudgetRequests,
			overBudgetDelays,
		)
		await expect(overBudgetDeps.github("git/ref/tags/v0.14.0")).rejects.toThrow(
			"could not be inspected",
		)
		expect(overBudgetRequests).toHaveLength(2)
		expect(overBudgetDelays).toEqual([20_000])

		const exactBudgetDelays: number[] = []
		const page = releaseInventoryPage([])
		const exactBudgetDeps = dependencies(
			root,
			{
				[releaseInventoryPath]: [
					{ status: 503, headers: { "retry-after": "20" } },
					{ status: 503, headers: { "retry-after": "10" } },
					{ status: 200, value: page },
				],
			},
			[],
			exactBudgetDelays,
		)
		expect(await exactBudgetDeps.releasePage()).toEqual(page)
		expect(exactBudgetDelays).toEqual([20_000, 10_000])
	})

	test("does not retry when GitHub reports no remaining rate limit", async () => {
		const root = createRepository()
		const requests: ApiRequest[] = []
		const delays: number[] = []
		const deps = dependencies(
			root,
			{
				[tagRefPath("0.14.0")]: [
					{
						status: 503,
						headers: { "x-ratelimit-remaining": "0" },
					},
					{ status: 200, value: { ok: true } },
				],
			},
			requests,
			delays,
		)

		await expect(deps.github("git/ref/tags/v0.14.0")).rejects.toThrow(
			"could not be inspected",
		)
		expect(requests).toHaveLength(1)
		expect(delays).toEqual([])
	})

	test("does not retry GraphQL HTTP-200 errors", async () => {
		const root = createRepository()
		const requests: ApiRequest[] = []
		const delays: number[] = []
		const response = {
			errors: [{ type: "RATE_LIMITED", message: "redacted" }],
		}
		const deps = dependencies(
			root,
			{
				[releaseInventoryPath]: [
					{ status: 200, value: response },
					{ status: 200, value: releaseInventoryPage([]) },
				],
			},
			requests,
			delays,
		)

		expect(await deps.releasePage()).toEqual(response)
		expect(requests).toHaveLength(1)
		expect(delays).toEqual([])
	})

	test("keeps release reservation mutations single-attempt", async () => {
		const root = createRepository()
		const currentSha = commitVersion(root, "0.14.0")
		const requests: ApiRequest[] = []
		const delays: number[] = []
		const deps = dependencies(
			root,
			{
				"/repos/dotenc/dotenc/git/tags": [
					{ status: 503 },
					{ status: 201, value: {} },
				],
				"/repos/dotenc/dotenc/git/refs": [
					{ status: 503 },
					{ status: 201, value: {} },
				],
			},
			requests,
			delays,
		)

		await expect(
			deps.createTag("v0.14.0", "reservation", currentSha),
		).rejects.toThrow("could not be created")
		await expect(
			deps.createReference("refs/tags/v0.14.0", "a".repeat(40)),
		).rejects.toThrow("could not be reserved")
		expect(requests).toHaveLength(2)
		expect(delays).toEqual([])
	})

	test("does not retry successful mutation headers with unreadable bodies", async () => {
		const root = createRepository()
		const currentSha = commitVersion(root, "0.14.0")
		const delays: number[] = []
		const signals: (AbortSignal | null | undefined)[] = []
		let attempts = 0
		let readTimeoutSignals = 0
		const deps = createCliReleaseDependencies({
			root,
			repository: "dotenc/dotenc",
			apiUrl: "https://api.github.test",
			graphqlUrl,
			token: "test-token",
			fetchImpl: async (_input, init) => {
				attempts += 1
				signals.push(init?.signal)
				return unreadableBodyResponse(() => {}, {}, 201)
			},
			readTimeoutSignalImpl: () => {
				readTimeoutSignals += 1
				return new AbortController().signal
			},
			sleepImpl: async (milliseconds) => {
				delays.push(milliseconds)
			},
		})

		await expect(
			deps.createTag("v0.14.0", "reservation", currentSha),
		).rejects.toThrow("response could not be read")
		await expect(
			deps.createReference("refs/tags/v0.14.0", "a".repeat(40)),
		).rejects.toThrow("response could not be read")
		expect(attempts).toBe(2)
		expect(signals).toHaveLength(2)
		expect(signals.every((signal) => signal instanceof AbortSignal)).toBeTrue()
		expect(new Set(signals).size).toBe(2)
		expect(readTimeoutSignals).toBe(0)
		expect(delays).toEqual([])
	})

	test("bounds streamed GitHub responses without a Content-Length", async () => {
		const root = createRepository()
		let cancelled = false
		let attempts = 0
		const delays: number[] = []
		const deps = createCliReleaseDependencies({
			root,
			repository: "dotenc/dotenc",
			apiUrl: "https://api.github.test",
			graphqlUrl,
			token: "test-token",
			fetchImpl: async () => {
				attempts += 1
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array(700_000))
							controller.enqueue(new Uint8Array(700_000))
						},
						cancel() {
							cancelled = true
						},
					}),
					{ status: 200 },
				)
			},
			sleepImpl: async (milliseconds) => {
				delays.push(milliseconds)
			},
		})

		await expect(deps.github("releases?per_page=100&page=1")).rejects.toThrow(
			"exceeded its bound",
		)
		expect(cancelled).toBeTrue()
		expect(attempts).toBe(1)
		expect(delays).toEqual([])

		cancelled = false
		await expect(deps.releasePage()).rejects.toThrow("exceeded its bound")
		expect(cancelled).toBeTrue()
		expect(attempts).toBe(2)
		expect(delays).toEqual([])
	})

	test("verifies the exact published tag and base asset digests", async () => {
		const root = createRepository()
		const currentSha = commitVersion(root, "0.14.0")
		const reservation = reservationFixture("0.14.0", currentSha)
		const dist = path.join(root, "cli", "dist")
		mkdirSync(dist)
		const assets = CLI_RELEASE_ASSETS.map((name, index) => {
			const contents = Buffer.from(`asset-${index}`)
			writeFileSync(path.join(dist, name), contents)
			return {
				name,
				state: "uploaded",
				size: contents.byteLength,
				digest: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
			}
		})
		const releasePath = "/repos/dotenc/dotenc/releases/tags/v0.14.0"
		const tagPath = "/repos/dotenc/dotenc/git/ref/tags/v0.14.0"
		const fixtures = {
			[releasePath]: {
				status: 200,
				value: {
					tag_name: "v0.14.0",
					draft: false,
					prerelease: false,
					assets,
				},
			},
			[tagPath]: {
				status: 200,
				value: reservation.tagRef,
			},
			[tagObjectPath(reservation.tagObjectSha)]: {
				status: 200,
				value: reservation.tagObject,
			},
		}

		expect(
			await verifyCliRelease(
				currentSha,
				RUN_ID,
				root,
				dependencies(root, fixtures),
			),
		).toEqual({ version: "0.14.0", tag: "v0.14.0" })

		const mismatched = structuredClone(fixtures)
		;(mismatched[releasePath].value.assets[0] as { digest: string }).digest =
			"sha256:0000000000000000000000000000000000000000000000000000000000000000"
		await expect(
			verifyCliRelease(
				currentSha,
				RUN_ID,
				root,
				dependencies(root, mismatched),
			),
		).rejects.toThrow("failed verification")
	})

	test("manual dispatch validates the current revision but never infers a bump", async () => {
		const root = createRepository()
		const currentSha = commitVersion(root, "0.14.0")
		const requests: ApiRequest[] = []

		expect(
			await evaluateCliReleaseGate(
				{ eventName: "workflow_dispatch", currentSha, runId: RUN_ID },
				dependencies(root, {}, requests),
			),
		).toEqual({ version: "0.14.0", bumped: false })
		expect(requests).toEqual([])
	})
})
