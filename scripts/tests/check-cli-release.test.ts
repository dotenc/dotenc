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
import { afterEach, describe, expect, test } from "bun:test"
import {
	CLI_RELEASE_ASSETS,
	assertReleaseTargetMissing,
	assertReservedReleaseTarget,
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

type ApiFixture = { status: number; value?: unknown }
type ApiRequest = {
	body?: unknown
	method: string
	url: string
}
type ApiFixtures = Record<string, ApiFixture | ApiFixture[]>

const releaseInventoryPath =
	"/repos/dotenc/dotenc/releases?per_page=100&page=1"
const mainRefPath = "/repos/dotenc/dotenc/git/ref/heads/main"
const tagRefPath = (version: string) =>
	`/repos/dotenc/dotenc/git/ref/tags/v${version}`
const tagObjectPath = (sha: string) =>
	`/repos/dotenc/dotenc/git/tags/${sha}`

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
) =>
	createCliReleaseDependencies({
		root,
		repository: "dotenc/dotenc",
		apiUrl: "https://api.github.test",
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
			const body = fixture.value === undefined ? "" : JSON.stringify(fixture.value)
			return new Response(body, {
				status: fixture.status,
				headers: { "content-length": String(Buffer.byteLength(body)) },
			})
		},
	})

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
							value: [
								{
									tag_name: "v0.13.0",
									draft: false,
									prerelease: false,
								},
							],
						},
					},
					requests,
				),
			),
		).toEqual({ version: "0.14.0", bumped: true })
		expect(requests.map(({ url }) => url)).toEqual([
			"https://api.github.test/repos/dotenc/dotenc/releases?per_page=100&page=1",
			"https://api.github.test/repos/dotenc/dotenc/git/ref/tags/v0.14.0",
			"https://api.github.test/repos/dotenc/dotenc/git/ref/heads/main",
		])
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
						[releaseInventoryPath]: { status: 200, value: [] },
					},
					requests,
				),
			),
		).toEqual({ version: "0.14.0", bumped: true })
		expect(requests.map(({ url }) => url)).toEqual([
			"https://api.github.test/repos/dotenc/dotenc/releases?per_page=100&page=1",
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
		const releasesPath =
			"/repos/dotenc/dotenc/releases?per_page=100&page=1"
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
					[releasesPath]: {
						status: 200,
						value: [
							{
								tag_name: "v0.13.0",
								draft: false,
								prerelease: false,
							},
						],
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
		const releasesPath =
			"/repos/dotenc/dotenc/releases?per_page=100&page=1"
		const remotePackage = readFileSync(
			path.resolve(import.meta.dir, "../../cli/package.json"),
		).toString("base64")
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
					[releasesPath]: {
						status: 200,
						value: [
							{
								tag_name: "v0.13.0",
								draft: false,
								prerelease: false,
							},
						],
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
		const releasesPath =
			"/repos/dotenc/dotenc/releases?per_page=100&page=1"
		const tagPath = "/repos/dotenc/dotenc/git/ref/tags/v0.14.0"

		await expect(
			assertReleaseTargetMissing(
				currentSha,
				"0.14.0",
				dependencies(root, {
					...mainFixture,
					[releasesPath]: {
						status: 200,
						value: [
							{ tag_name: "v0.14.0", draft: true, prerelease: false },
						],
					},
				}),
			),
		).rejects.toThrow("already exists")

		await expect(
			evaluateCliReleaseGate(
				{ eventName: "push", beforeSha, currentSha, runId: RUN_ID },
				dependencies(root, {
					...mainFixture,
					[releasesPath]: {
						status: 200,
						value: [
							{ tag_name: "v0.14.0", draft: true, prerelease: false },
						],
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
					[releasesPath]: {
						status: 200,
						value: [
							{ tag_name: "v0.15.0", draft: false, prerelease: false },
						],
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
					[releasesPath]: { status: 200, value: [] },
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
					[releasesPath]: { status: 500 },
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
					[releaseInventoryPath]: { status: 200, value: [] },
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

		expect(requests.filter(({ method }) => method === "POST")).toEqual([
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
					value: [
						{
							tag_name: "v0.13.0",
							draft: false,
							prerelease: false,
						},
					],
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
		expect(requests.some(({ method }) => method === "POST")).toBeFalse()
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
						value: [
							{
								tag_name: "v0.13.0",
								draft: false,
								prerelease: false,
							},
							{
								tag_name: "v0.14.0",
								draft: false,
								prerelease: false,
							},
						],
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
					[releaseInventoryPath]: { status: 200, value: [] },
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
		const reservation = reservationFixture(
			"0.14.0",
			reservedSha,
			OTHER_RUN_ID,
		)
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
							value: [
								{
									tag_name: "v0.13.0",
									draft: false,
									prerelease: false,
								},
							],
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
		expect(requests.some(({ method }) => method === "POST")).toBeFalse()
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
						value: [
							{
								tag_name: "v0.13.0",
								draft: false,
								prerelease: false,
							},
						],
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
						value: [
							{
								tag_name: "v0.14.0",
								draft: true,
								prerelease: false,
							},
						],
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
						value: [
							{
								tag_name: "v0.13.0",
								draft: false,
								prerelease: false,
							},
							{
								tag_name: "v0.14.0",
								draft: true,
								prerelease: false,
							},
						],
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
						value: [
							{
								tag_name: "v0.14.1",
								draft: false,
								prerelease: false,
							},
						],
					},
				}),
			),
		).rejects.toThrow("Previous CLI version v0.14.0 is not a published stable release")
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
					[releaseInventoryPath]: { status: 200, value: [] },
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

	test("bounds streamed GitHub responses without a Content-Length", async () => {
		const root = createRepository()
		let cancelled = false
		const deps = createCliReleaseDependencies({
			root,
			repository: "dotenc/dotenc",
			apiUrl: "https://api.github.test",
			token: "test-token",
			fetchImpl: async () =>
				new Response(
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
				),
		})

		await expect(deps.github("releases?per_page=100&page=1")).rejects.toThrow(
			"exceeded its bound",
		)
		expect(cancelled).toBeTrue()
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
