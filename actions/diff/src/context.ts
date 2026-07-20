import fs from "node:fs/promises"
import { ACTION_LIMITS, type ActionLimits } from "./limits"
import {
	assertBoundedString,
	byteLength,
	isFullGitObjectId,
	isRecord,
	SafeActionError,
} from "./safety"

export type PullRequestContext = {
	repository: string
	pullRequestNumber: number
	baseSha: string
	headSha: string
}

const validateRepository = (value: unknown): string => {
	const repository = assertBoundedString(value, 201, "invalid_event")
	const parts = repository.split("/")
	if (
		parts.length !== 2 ||
		parts.some(
			(part) =>
				!part ||
				part.length > 100 ||
				!/[a-z0-9]/i.test(part) ||
				!/^[a-z0-9_.-]+$/i.test(part),
		)
	) {
		throw new SafeActionError("invalid_event")
	}

	return repository
}

export const parsePullRequestEvent = (payload: unknown): PullRequestContext => {
	if (!isRecord(payload) || !isRecord(payload.pull_request)) {
		throw new SafeActionError("invalid_event")
	}

	const pullRequest = payload.pull_request
	if (
		!isRecord(payload.repository) ||
		!isRecord(pullRequest.base) ||
		!isRecord(pullRequest.head)
	) {
		throw new SafeActionError("invalid_event")
	}

	const repository = validateRepository(payload.repository.full_name)
	const pullRequestNumber = payload.number
	const baseSha = pullRequest.base.sha
	const headSha = pullRequest.head.sha

	if (
		!Number.isSafeInteger(pullRequestNumber) ||
		(pullRequestNumber as number) < 1 ||
		(pullRequestNumber as number) > 2_147_483_647 ||
		!isFullGitObjectId(baseSha) ||
		!isFullGitObjectId(headSha)
	) {
		throw new SafeActionError("invalid_event")
	}

	if (
		pullRequest.number !== undefined &&
		pullRequest.number !== pullRequestNumber
	) {
		throw new SafeActionError("invalid_event")
	}

	return {
		repository,
		pullRequestNumber: pullRequestNumber as number,
		baseSha: baseSha.toLowerCase(),
		headSha: headSha.toLowerCase(),
	}
}

export const readPullRequestEvent = async (
	eventPath: string | undefined,
	limits: ActionLimits = ACTION_LIMITS,
): Promise<PullRequestContext> => {
	if (!eventPath) throw new SafeActionError("missing_event")

	let raw: string
	try {
		const stat = await fs.stat(eventPath)
		if (!stat.isFile() || stat.size > limits.eventBytes) {
			throw new SafeActionError("invalid_event")
		}
		raw = await fs.readFile(eventPath, "utf8")
	} catch (error) {
		if (error instanceof SafeActionError) throw error
		throw new SafeActionError("invalid_event")
	}

	if (byteLength(raw) > limits.eventBytes) {
		throw new SafeActionError("invalid_event")
	}

	let payload: unknown
	try {
		payload = JSON.parse(raw)
	} catch {
		throw new SafeActionError("invalid_event")
	}

	return parsePullRequestEvent(payload)
}
