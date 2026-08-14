import { z } from "zod"
import { ENVIRONMENT_DIFF_LIMITS } from "./environmentDiffReport"

const containsControlCharacters = (value: string) => {
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0
		if (codePoint <= 0x1f || codePoint === 0x7f) return true
	}
	return false
}

const boundedText = (maximumBytes: number) =>
	z
		.string()
		.min(1)
		.refine(
			(value) => Buffer.byteLength(value, "utf-8") <= maximumBytes,
			`must not exceed ${maximumBytes} UTF-8 bytes`,
		)
		.refine((value) => !containsControlCharacters(value), {
			message: "must not contain control characters",
		})

const canonicalBase64 = (maximumBytes: number) =>
	z
		.string()
		.min(1)
		.refine(
			(value) => Buffer.byteLength(value, "utf-8") <= maximumBytes,
			`must not exceed ${maximumBytes} UTF-8 bytes`,
		)
		.refine(
			(value) =>
				value.length % 4 === 0 &&
				/^[A-Za-z0-9+/]*={0,2}$/.test(value) &&
				Buffer.from(value, "base64").toString("base64") === value,
			{ message: "must be canonical base64" },
		)

const recipientSchema = z
	.object({
		name: boundedText(ENVIRONMENT_DIFF_LIMITS.maxRecipientNameBytes),
		fingerprint: boundedText(ENVIRONMENT_DIFF_LIMITS.maxFingerprintBytes),
		encryptedDataKey: canonicalBase64(
			ENVIRONMENT_DIFF_LIMITS.maxEncryptedDataKeyBytes,
		),
		algorithm: z.enum(["rsa", "ed25519"]),
	})
	.strict()

export const environmentSchema = z
	.object({
		version: z.union([z.literal(1), z.literal(2)]).optional(),
		keys: z
			.array(recipientSchema)
			.min(1)
			.max(ENVIRONMENT_DIFF_LIMITS.maxRecipientsPerEnvironment),
		encryptedContent: canonicalBase64(ENVIRONMENT_DIFF_LIMITS.maxFileBytes),
	})
	.strict()
	.superRefine((environment, context) => {
		const names = new Set<string>()
		const fingerprints = new Set<string>()

		for (const [index, recipient] of environment.keys.entries()) {
			if (names.has(recipient.name)) {
				context.addIssue({
					code: "custom",
					message: "recipient names must be unique",
					path: ["keys", index, "name"],
				})
			}
			if (fingerprints.has(recipient.fingerprint)) {
				context.addIssue({
					code: "custom",
					message: "recipient fingerprints must be unique",
					path: ["keys", index, "fingerprint"],
				})
			}
			names.add(recipient.name)
			fingerprints.add(recipient.fingerprint)
		}
	})

export type Environment = z.infer<typeof environmentSchema>
