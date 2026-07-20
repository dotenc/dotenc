export const ENVIRONMENT_DIFF_REPORT_SCHEMA_VERSION = 1 as const

/** Fixed resource limits shared by every environment-diff consumer. */
export const ENVIRONMENT_DIFF_LIMITS = {
	maxFilesPerSide: 100,
	maxFileBytes: 1024 * 1024,
	maxTotalBytes: 10 * 1024 * 1024,
	maxPathBytes: 1024,
	maxEnvironmentNameBytes: 255,
	maxJsonDepth: 16,
	maxRecipientsPerEnvironment: 256,
	maxRecipientNameBytes: 256,
	maxFingerprintBytes: 256,
	maxEncryptedDataKeyBytes: 16 * 1024,
	maxPlaintextBytes: 1024 * 1024,
	maxVariablesPerEnvironment: 4096,
	maxVariableNameBytes: 256,
} as const

export type EncryptedEnvironmentInput = {
	path: string
	/** UTF-8 JSON from the encrypted environment blob, not base64-wrapped. */
	content: string
}

export type EnvironmentDiffInput = {
	base: EncryptedEnvironmentInput[]
	head: EncryptedEnvironmentInput[]
}

export type EnvironmentDiffReasonCode =
	| "base_environment_invalid"
	| "head_environment_invalid"
	| "base_and_head_environments_invalid"
	| "base_recipient_metadata_invalid"
	| "head_recipient_metadata_invalid"
	| "base_and_head_recipient_metadata_invalid"
	| "base_decryption_failed"
	| "head_decryption_failed"
	| "base_and_head_decryption_failed"
	| "base_plaintext_invalid"
	| "head_plaintext_invalid"
	| "base_and_head_plaintexts_invalid"
	| "base_and_head_variables_unavailable"

export type EnvironmentDiffReason = {
	code: EnvironmentDiffReasonCode
	/** A fixed, bounded diagnostic. Never derived from caught error messages. */
	message: string
}

export type VariableDiff = {
	status: "available" | "unavailable"
	added: string[]
	changed: string[]
	removed: string[]
	reason?: EnvironmentDiffReason
}

export type RecipientIdentity = {
	name: string
	fingerprint: string
}

export type RecipientRename = {
	fingerprint: string
	from: string
	to: string
}

export type AccessDiff = {
	status: "available" | "unavailable"
	grants: RecipientIdentity[]
	revocations: RecipientIdentity[]
	renames: RecipientRename[]
	reason?: EnvironmentDiffReason
}

/**
 * A modified environment whose available variable/access change arrays are all
 * empty is reserved for a cryptographically verified data-key-only rotation.
 */
export type EnvironmentDiff = {
	path: string
	name: string
	status: "added" | "deleted" | "modified"
	variables: VariableDiff
	access: AccessDiff
}

export type EnvironmentDiffReport = {
	schemaVersion: typeof ENVIRONMENT_DIFF_REPORT_SCHEMA_VERSION
	environments: EnvironmentDiff[]
}

export type EnvironmentDiffInputErrorCode =
	| "invalid_request"
	| "too_many_files"
	| "file_too_large"
	| "input_too_large"
	| "invalid_path"
	| "duplicate_path"
