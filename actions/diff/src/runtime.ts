import { Buffer } from "node:buffer"
import {
	createEnvironmentDiffReport,
	type EnvironmentDiffInput,
} from "../../../cli/src/helpers/createEnvironmentDiffReport"
import { type ActionIo, defaultActionIo } from "./action-io"
import { type PullRequestContext, readPullRequestEvent } from "./context"
import { GitHubClient } from "./github"
import { ACTION_LIMITS } from "./limits"
import {
	COMMENT_MARKER,
	canonicalizeReport,
	type EnvironmentDiffReport,
	renderReport,
	renderUnavailableReport,
	reportHasChanges,
} from "./report"
import { byteLength, parseBoolean, SafeActionError } from "./safety"

type ActionClient = Pick<
	GitHubClient,
	| "deletePullRequestComment"
	| "getEncryptedEnvironmentComparison"
	| "upsertPullRequestComment"
>

export type RuntimeDependencies = {
	io: ActionIo
	environment: NodeJS.ProcessEnv
	readContext(eventPath: string | undefined): Promise<PullRequestContext>
	createClient(options: {
		token: string
		repository: string
		apiUrl?: string
	}): ActionClient
	createReport(
		input: EnvironmentDiffInput,
		options: { privateKeySource: "environment" },
	): Promise<EnvironmentDiffReport>
}

const defaultDependencies: RuntimeDependencies = {
	io: defaultActionIo,
	environment: process.env,
	readContext: (eventPath) => readPullRequestEvent(eventPath),
	createClient: (options) => new GitHubClient(options),
	createReport: createEnvironmentDiffReport,
}

export type ActionRunResult = {
	ok: boolean
	shouldFail: boolean
}

const requireDedicatedKey = (environment: NodeJS.ProcessEnv): void => {
	const privateKeyBase64 = environment.DOTENC_PRIVATE_KEY_BASE64
	if (
		!privateKeyBase64 ||
		byteLength(privateKeyBase64) > ACTION_LIMITS.maxPrivateKeyBase64Bytes
	) {
		throw new SafeActionError("missing_or_oversized_private_key")
	}

	if (
		environment.DOTENC_PRIVATE_KEY_PASSPHRASE !== undefined &&
		byteLength(environment.DOTENC_PRIVATE_KEY_PASSPHRASE) >
			ACTION_LIMITS.maxPassphraseBytes
	) {
		throw new SafeActionError("oversized_passphrase")
	}

	// The diff action accepts only the dedicated base64 bootstrap key. Do not let
	// a raw key inherited from the runner become an accidental fallback.
	delete environment.DOTENC_PRIVATE_KEY
}

const reportHasUnavailableSections = (report: EnvironmentDiffReport): boolean =>
	report.environments.some(
		(environment) =>
			environment.variables.status === "unavailable" ||
			environment.access.status === "unavailable",
	)

const clearDedicatedKeys = (environment: NodeJS.ProcessEnv): void => {
	delete environment.DOTENC_PRIVATE_KEY_BASE64
	delete environment.DOTENC_PRIVATE_KEY_PASSPHRASE
	delete environment.DOTENC_PRIVATE_KEY
}

export const runAction = async (
	dependencies: RuntimeDependencies = defaultDependencies,
): Promise<ActionRunResult> => {
	let failOnError = false
	let summaryWritten = false
	let outputsAttempted = false
	let commentEnabled = false
	let context: PullRequestContext | undefined
	let client: ActionClient | undefined
	let compactReport = ""
	let hasChanges: boolean | undefined
	let validEmptyReport = false
	let emptyCommentCleanupFailed = false
	let commentUrl = ""
	let validCommentPublished = false

	try {
		const token = dependencies.io.getInput("github-token")
		commentEnabled = parseBoolean(
			dependencies.io.getInput("comment") || "true",
			"invalid_comment_input",
		)
		failOnError = parseBoolean(
			dependencies.io.getInput("fail-on-error") || "false",
			"invalid_fail_on_error_input",
		)

		if (dependencies.environment.GITHUB_EVENT_NAME !== "pull_request_target") {
			throw new SafeActionError("invalid_event_name")
		}

		context = await dependencies.readContext(
			dependencies.environment.GITHUB_EVENT_PATH,
		)
		if (
			dependencies.environment.GITHUB_REPOSITORY?.toLowerCase() !==
			context.repository.toLowerCase()
		) {
			throw new SafeActionError("repository_mismatch")
		}

		client = dependencies.createClient({
			token,
			repository: context.repository,
			apiUrl: dependencies.environment.GITHUB_API_URL,
		})
		requireDedicatedKey(dependencies.environment)
		const { base, head } = await client.getEncryptedEnvironmentComparison(
			context.baseSha,
			context.headSha,
		)
		let report: EnvironmentDiffReport
		try {
			report = canonicalizeReport(
				await dependencies.createReport(
					{ base, head },
					{ privateKeySource: "environment" },
				),
			)
		} finally {
			clearDedicatedKeys(dependencies.environment)
		}

		const serializedReport = JSON.stringify(report)
		if (
			/[\r\n]/.test(serializedReport) ||
			Buffer.byteLength(serializedReport, "utf8") >
				ACTION_LIMITS.maxReportOutputBytes
		) {
			throw new SafeActionError("report_output_limit")
		}
		compactReport = serializedReport
		hasChanges = reportHasChanges(report)
		validEmptyReport = !hasChanges

		if (validEmptyReport) {
			if (commentEnabled) {
				try {
					await client.deletePullRequestComment(
						context.pullRequestNumber,
						COMMENT_MARKER,
					)
				} catch (error) {
					emptyCommentCleanupFailed = true
					throw error
				}
			}
		} else {
			const markdown = renderReport(report)
			await dependencies.io.writeSummary(markdown)
			summaryWritten = true

			if (commentEnabled) {
				commentUrl = await client.upsertPullRequestComment(
					context.pullRequestNumber,
					COMMENT_MARKER,
					renderReport(report, { includeMarker: true }),
				)
				validCommentPublished = true
			}
		}

		outputsAttempted = true
		await dependencies.io.setOutput("report", compactReport)
		await dependencies.io.setOutput("has-changes", String(hasChanges))
		await dependencies.io.setOutput("comment-url", commentUrl)

		if (failOnError && reportHasUnavailableSections(report)) {
			dependencies.io.annotate(
				"error",
				"The redacted dotenc diff contains unavailable sections. No secret content was emitted.",
			)
			return { ok: false, shouldFail: true }
		}

		return { ok: true, shouldFail: false }
	} catch {
		clearDedicatedKeys(dependencies.environment)
		if (!summaryWritten && !validEmptyReport) {
			try {
				await dependencies.io.writeSummary(renderUnavailableReport())
			} catch {
				// The final annotation below remains static and secret-free.
			}
		}

		if (
			commentEnabled &&
			context &&
			client &&
			!validCommentPublished &&
			!validEmptyReport
		) {
			try {
				commentUrl = await client.upsertPullRequestComment(
					context.pullRequestNumber,
					COMMENT_MARKER,
					`${COMMENT_MARKER}\n${renderUnavailableReport()}`,
				)
			} catch {
				// A stale comment is preferable to exposing an error body or creating spam.
			}
		}

		if (!outputsAttempted) {
			try {
				outputsAttempted = true
				await dependencies.io.setOutput("report", compactReport)
				await dependencies.io.setOutput(
					"has-changes",
					hasChanges === undefined ? "" : String(hasChanges),
				)
				await dependencies.io.setOutput("comment-url", commentUrl)
			} catch {
				// The final annotation below remains static and secret-free.
			}
		}

		const shouldFail = failOnError || emptyCommentCleanupFailed
		dependencies.io.annotate(
			shouldFail ? "error" : "warning",
			"The redacted dotenc diff could not be completed safely. No secret content was emitted.",
		)
		return { ok: false, shouldFail }
	}
}
