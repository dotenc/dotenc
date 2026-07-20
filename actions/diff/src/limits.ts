import { ENVIRONMENT_DIFF_LIMITS } from "../../../cli/src/helpers/createEnvironmentDiffReport"

export const ACTION_LIMITS = Object.freeze({
	eventBytes: 2 * 1024 * 1024,
	commitResponseBytes: 256 * 1024,
	treeResponseBytes: 8 * 1024 * 1024,
	commentResponseBytes: 8 * 1024 * 1024,
	commentWriteResponseBytes: 512 * 1024,
	maxTreeEntries: 100_000,
	maxEnvironmentFilesPerSide: ENVIRONMENT_DIFF_LIMITS.maxFilesPerSide,
	maxEnvironmentFileBytes: ENVIRONMENT_DIFF_LIMITS.maxFileBytes,
	maxEnvironmentBytesPerSide: ENVIRONMENT_DIFF_LIMITS.maxTotalBytes,
	maxEnvironmentBytesTotal: ENVIRONMENT_DIFF_LIMITS.maxTotalBytes,
	maxPathBytes: ENVIRONMENT_DIFF_LIMITS.maxPathBytes,
	maxEnvironmentNameBytes: ENVIRONMENT_DIFF_LIMITS.maxEnvironmentNameBytes,
	maxCommentPages: 10,
	commentsPerPage: 100,
	maxCommentBytes: 60 * 1024,
	maxReportOutputBytes: 512 * 1024,
	maxPrivateKeyBase64Bytes: 512 * 1024,
	maxPassphraseBytes: 16 * 1024,
	requestTimeoutMs: 30_000,
})

export type ActionLimits = {
	[Key in keyof typeof ACTION_LIMITS]: number
}
