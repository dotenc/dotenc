import { Buffer } from "node:buffer"

export class SafeActionError extends Error {
	readonly code: string

	constructor(code: string) {
		super("The redacted dotenc diff could not be completed safely.")
		this.name = "SafeActionError"
		this.code = code
	}
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

export const byteLength = (value: string): number =>
	Buffer.byteLength(value, "utf8")

export const assertBoundedString = (
	value: unknown,
	maxBytes: number,
	code: string,
): string => {
	if (typeof value !== "string" || byteLength(value) > maxBytes) {
		throw new SafeActionError(code)
	}

	return value
}

export const isFullGitObjectId = (value: unknown): value is string =>
	typeof value === "string" && /^[0-9a-f]{40}$/i.test(value)

export const parseBoolean = (value: string, code: string): boolean => {
	if (value === "true") return true
	if (value === "false") return false
	throw new SafeActionError(code)
}

export const escapeWorkflowCommand = (value: string): string =>
	value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")

export const escapeMarkdown = (value: string, maxCodePoints = 512): string => {
	const visible = Array.from(value)
		.slice(0, maxCodePoints)
		.map((character) => {
			const codePoint = character.codePointAt(0) ?? 0
			if (
				codePoint <= 0x1f ||
				codePoint === 0x7f ||
				/[\p{C}\p{Zl}\p{Zp}]/u.test(character)
			) {
				return `U${codePoint.toString(16).toUpperCase().padStart(4, "0")}`
			}
			return character
		})
		.join("")
	const truncated = Array.from(value).length > maxCodePoints ? "…" : ""

	return `${visible}${truncated}`
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replace(/([\\`*_[\]{}()#+\-.!|])/g, "\\$1")
		.replaceAll("@", "&#64;")
}
