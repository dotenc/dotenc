import { describe, expect, test } from "bun:test"
import type { ActionIo } from "../src/action-io"
import type { PullRequestContext } from "../src/context"
import { COMMENT_MARKER, type EnvironmentDiffReport } from "../src/report"
import { type RuntimeDependencies, runAction } from "../src/runtime"

const context: PullRequestContext = {
	repository: "dotenc/example",
	pullRequestNumber: 9,
	baseSha: "a".repeat(40),
	headSha: "b".repeat(40),
}

const emptyReport: EnvironmentDiffReport = {
	schemaVersion: 1,
	environments: [],
}

const changedReport: EnvironmentDiffReport = {
	schemaVersion: 1,
	environments: [
		{
			path: ".env.production.enc",
			name: "production",
			status: "modified",
			variables: {
				status: "available",
				added: ["API_KEY"],
				changed: [],
				removed: [],
			},
			access: {
				status: "available",
				grants: [],
				revocations: [],
				renames: [],
			},
		},
	],
}

type Harness = {
	dependencies: RuntimeDependencies
	outputs: Map<string, string>
	summaries: string[]
	annotations: string[]
	comments: string[]
	deletions: Array<{ marker: string; pullRequestNumber: number }>
	environment: NodeJS.ProcessEnv
}

const createHarness = (
	options: {
		inputs?: Record<string, string>
		report?: EnvironmentDiffReport
		reportError?: Error
		failSetOutput?: boolean
		deleteCommentError?: Error
		deleteCommentResult?: boolean
	} = {},
): Harness => {
	const inputs = {
		"github-token": "github-token",
		comment: "true",
		"fail-on-error": "false",
		...options.inputs,
	}
	const outputs = new Map<string, string>()
	const summaries: string[] = []
	const annotations: string[] = []
	const comments: string[] = []
	const deletions: Array<{ marker: string; pullRequestNumber: number }> = []
	const environment: NodeJS.ProcessEnv = {
		GITHUB_EVENT_NAME: "pull_request_target",
		GITHUB_EVENT_PATH: "/runner/event.json",
		GITHUB_REPOSITORY: context.repository,
		GITHUB_API_URL: "https://api.github.com",
		DOTENC_PRIVATE_KEY_BASE64: "ZGVkaWNhdGVkLWtleQ==",
		DOTENC_PRIVATE_KEY_PASSPHRASE: "passphrase",
		DOTENC_PRIVATE_KEY: "legacy-raw-key-must-not-be-used",
	}
	const io: ActionIo = {
		getInput: (name) => inputs[name as keyof typeof inputs] ?? "",
		setOutput: async (name, value) => {
			if (options.failSetOutput) throw new Error("output unavailable")
			outputs.set(name, value)
		},
		writeSummary: async (markdown) => {
			summaries.push(markdown)
		},
		annotate: (level, message) => {
			annotations.push(`${level}:${message}`)
		},
	}
	const dependencies: RuntimeDependencies = {
		io,
		environment,
		readContext: async () => context,
		createClient: () => ({
			getEncryptedEnvironmentComparison: async () => ({
				base: [{ path: ".env.base.enc", content: "{}" }],
				head: [{ path: ".env.head.enc", content: "{}" }],
			}),
			upsertPullRequestComment: async (_number, _marker, body) => {
				comments.push(body)
				return "https://github.com/dotenc/example/pull/9#issuecomment-1"
			},
			deletePullRequestComment: async (pullRequestNumber, marker) => {
				deletions.push({ marker, pullRequestNumber })
				if (options.deleteCommentError) throw options.deleteCommentError
				return options.deleteCommentResult ?? true
			},
		}),
		createReport: async () => {
			if (options.reportError) throw options.reportError
			return options.report ?? changedReport
		},
	}

	return {
		dependencies,
		outputs,
		summaries,
		annotations,
		comments,
		deletions,
		environment,
	}
}

describe("diff action runtime", () => {
	test("writes one redacted report, summary, and marker comment", async () => {
		const harness = createHarness()
		expect(await runAction(harness.dependencies)).toEqual({
			ok: true,
			shouldFail: false,
		})
		expect(harness.outputs.get("report")).toBe(JSON.stringify(changedReport))
		expect(harness.outputs.get("has-changes")).toBe("true")
		expect(harness.outputs.get("comment-url")).toContain("issuecomment-1")
		expect(harness.summaries).toHaveLength(1)
		expect(harness.comments).toHaveLength(1)
		expect(harness.deletions).toHaveLength(0)
		expect(harness.comments[0].startsWith(COMMENT_MARKER)).toBe(true)
		expect(harness.environment.DOTENC_PRIVATE_KEY_BASE64).toBeUndefined()
		expect(harness.environment.DOTENC_PRIVATE_KEY_PASSPHRASE).toBeUndefined()
		expect(harness.environment.DOTENC_PRIVATE_KEY).toBeUndefined()
	})

	test("keeps a verified empty report silent and removes a stale marker comment", async () => {
		const harness = createHarness({ report: emptyReport })

		expect(await runAction(harness.dependencies)).toEqual({
			ok: true,
			shouldFail: false,
		})
		expect(harness.outputs.get("report")).toBe(JSON.stringify(emptyReport))
		expect(harness.outputs.get("has-changes")).toBe("false")
		expect(harness.outputs.get("comment-url")).toBe("")
		expect(harness.summaries).toHaveLength(0)
		expect(harness.comments).toHaveLength(0)
		expect(harness.deletions).toEqual([
			{ marker: COMMENT_MARKER, pullRequestNumber: context.pullRequestNumber },
		])
	})

	test("treats an absent stale marker comment as a successful empty report", async () => {
		const harness = createHarness({
			report: emptyReport,
			deleteCommentResult: false,
		})

		expect(await runAction(harness.dependencies)).toEqual({
			ok: true,
			shouldFail: false,
		})
		expect(harness.summaries).toHaveLength(0)
		expect(harness.comments).toHaveLength(0)
		expect(harness.deletions).toHaveLength(1)
	})

	test("fails closed without publishing unavailable surfaces when empty-report cleanup fails", async () => {
		for (const failOnError of ["false", "true"] as const) {
			const harness = createHarness({
				inputs: { "fail-on-error": failOnError },
				report: emptyReport,
				deleteCommentError: new Error("comment deletion unavailable"),
			})

			expect(await runAction(harness.dependencies)).toEqual({
				ok: false,
				shouldFail: true,
			})
			expect(harness.outputs.get("report")).toBe(JSON.stringify(emptyReport))
			expect(harness.outputs.get("has-changes")).toBe("false")
			expect(harness.outputs.get("comment-url")).toBe("")
			expect(harness.summaries).toHaveLength(0)
			expect(harness.comments).toHaveLength(0)
			expect(harness.annotations[0]).toStartWith("error:")
		}
	})

	test("never publishes unavailable surfaces after empty-report output failure", async () => {
		const harness = createHarness({
			report: emptyReport,
			failSetOutput: true,
		})

		expect(await runAction(harness.dependencies)).toEqual({
			ok: false,
			shouldFail: false,
		})
		expect(harness.summaries).toHaveLength(0)
		expect(harness.comments).toHaveLength(0)
		expect(harness.deletions).toHaveLength(1)
		expect(harness.annotations[0]).toStartWith("warning:")
	})

	test("defaults to informational and never reflects caught secret material", async () => {
		const sentinel = "SENTINEL_DECRYPTED_VALUE_AND_PRIVATE_KEY"
		const harness = createHarness({ reportError: new Error(sentinel) })

		expect(await runAction(harness.dependencies)).toEqual({
			ok: false,
			shouldFail: false,
		})
		const allSurfaces = [
			...harness.outputs.values(),
			...harness.summaries,
			...harness.annotations,
			...harness.comments,
		].join("\n")
		expect(allSurfaces).not.toContain(sentinel)
		expect(harness.annotations).toEqual([
			"warning:The redacted dotenc diff could not be completed safely. No secret content was emitted.",
		])
		expect(harness.outputs.get("report")).toBe("")
		expect(harness.outputs.get("has-changes")).toBe("")
		expect(harness.comments.at(-1)).toContain("temporarily unavailable")
	})

	test("updates a stale comment even when the dedicated key is missing", async () => {
		const harness = createHarness()
		delete harness.environment.DOTENC_PRIVATE_KEY_BASE64

		expect((await runAction(harness.dependencies)).ok).toBe(false)
		expect(harness.comments).toHaveLength(1)
		expect(harness.comments[0]).toContain("temporarily unavailable")
	})

	test("does not replace a valid comment when a later output write fails", async () => {
		const harness = createHarness({ failSetOutput: true })

		expect((await runAction(harness.dependencies)).ok).toBe(false)
		expect(harness.comments).toHaveLength(1)
		expect(harness.comments[0]).toContain("API_KEY")
		expect(harness.comments[0]).not.toContain("temporarily unavailable")
	})

	test("rejects non-schema report fields before they reach any output surface", async () => {
		const sentinel = "SENTINEL_PLAINTEXT_VALUE"
		const harness = createHarness({
			report: {
				schemaVersion: 1,
				environments: [
					{
						path: ".env.production.enc",
						name: "production",
						status: "modified",
						variables: {
							status: "available",
							added: [],
							changed: [],
							removed: [],
							plaintext: sentinel,
						},
						access: {
							status: "available",
							grants: [],
							revocations: [],
							renames: [],
						},
					},
				],
			} as unknown as EnvironmentDiffReport,
		})

		expect((await runAction(harness.dependencies)).ok).toBe(false)
		const allSurfaces = [
			...harness.outputs.values(),
			...harness.summaries,
			...harness.annotations,
			...harness.comments,
		].join("\n")
		expect(allSurfaces).not.toContain(sentinel)
	})

	test("never writes a report that exceeds the action output limit", async () => {
		const oversizedReport: EnvironmentDiffReport = {
			schemaVersion: 1,
			environments: [
				{
					path: ".env.production.enc",
					name: "production",
					status: "modified",
					variables: {
						status: "available",
						added: Array.from(
							{ length: 3000 },
							(_, index) => `VARIABLE_${index}_${"X".repeat(180)}`,
						),
						changed: [],
						removed: [],
					},
					access: {
						status: "available",
						grants: [],
						revocations: [],
						renames: [],
					},
				},
			],
		}
		const harness = createHarness({ report: oversizedReport })

		expect((await runAction(harness.dependencies)).ok).toBe(false)
		expect(harness.outputs.get("report")).toBe("")
		expect(harness.outputs.get("has-changes")).toBe("")
	})

	test("fail-on-error fails only after publishing a partial-decryption report", async () => {
		const partialReport: EnvironmentDiffReport = {
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
					access: {
						status: "available",
						grants: [],
						revocations: [],
						renames: [],
					},
				},
			],
		}
		const harness = createHarness({
			inputs: { "fail-on-error": "true" },
			report: partialReport,
		})

		expect(await runAction(harness.dependencies)).toEqual({
			ok: false,
			shouldFail: true,
		})
		expect(harness.outputs.get("report")).toBe(JSON.stringify(partialReport))
		expect(harness.outputs.get("has-changes")).toBe("true")
		expect(harness.summaries[0]).toContain("Variable diff unavailable")
		expect(harness.comments[0]).toContain("Variable diff unavailable")
		expect(harness.annotations[0]).toStartWith("error:")
	})

	test("can disable PR comments without disabling the step summary", async () => {
		const harness = createHarness({ inputs: { comment: "false" } })

		expect((await runAction(harness.dependencies)).ok).toBe(true)
		expect(harness.comments).toHaveLength(0)
		expect(harness.summaries).toHaveLength(1)
		expect(harness.outputs.get("comment-url")).toBe("")
	})

	test("comment false skips empty-report marker deletion", async () => {
		const harness = createHarness({
			inputs: { comment: "false" },
			report: emptyReport,
		})

		expect((await runAction(harness.dependencies)).ok).toBe(true)
		expect(harness.deletions).toHaveLength(0)
		expect(harness.comments).toHaveLength(0)
		expect(harness.summaries).toHaveLength(0)
		expect(harness.outputs.get("has-changes")).toBe("false")
	})
})
