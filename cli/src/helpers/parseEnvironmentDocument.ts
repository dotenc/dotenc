import { type Environment, environmentSchema } from "../schemas/environment"
import { ENVIRONMENT_DIFF_LIMITS } from "../schemas/environmentDiffReport"

class InvalidJsonEnvelope extends Error {}

/** JSON.parse keeps the last duplicate member, so reject duplicates first. */
const hasDuplicateJsonMembers = (source: string): boolean => {
	let offset = 0
	let hasDuplicates = false

	const skipWhitespace = () => {
		while (offset < source.length && /\s/.test(source[offset])) offset += 1
	}

	const parseString = (): string => {
		const start = offset
		offset += 1
		while (offset < source.length) {
			if (source[offset] === "\\") {
				offset += 2
				continue
			}
			if (source[offset] === '"') {
				offset += 1
				return JSON.parse(source.slice(start, offset)) as string
			}
			offset += 1
		}
		throw new InvalidJsonEnvelope()
	}

	const parsePrimitive = () => {
		const start = offset
		while (offset < source.length && !/[\s,\]}]/.test(source[offset])) {
			offset += 1
		}
		if (offset === start) throw new InvalidJsonEnvelope()
	}

	const parseValue = (depth: number): void => {
		if (depth > ENVIRONMENT_DIFF_LIMITS.maxJsonDepth) {
			throw new InvalidJsonEnvelope()
		}
		skipWhitespace()
		const token = source[offset]
		if (token === '"') {
			parseString()
			return
		}
		if (token === "{") {
			offset += 1
			skipWhitespace()
			const members = new Set<string>()
			if (source[offset] === "}") {
				offset += 1
				return
			}
			while (offset < source.length) {
				skipWhitespace()
				if (source[offset] !== '"') throw new InvalidJsonEnvelope()
				const member = parseString()
				if (members.has(member)) hasDuplicates = true
				members.add(member)
				skipWhitespace()
				if (source[offset] !== ":") throw new InvalidJsonEnvelope()
				offset += 1
				parseValue(depth + 1)
				skipWhitespace()
				if (source[offset] === "}") {
					offset += 1
					return
				}
				if (source[offset] !== ",") throw new InvalidJsonEnvelope()
				offset += 1
			}
			throw new InvalidJsonEnvelope()
		}
		if (token === "[") {
			offset += 1
			skipWhitespace()
			if (source[offset] === "]") {
				offset += 1
				return
			}
			while (offset < source.length) {
				parseValue(depth + 1)
				skipWhitespace()
				if (source[offset] === "]") {
					offset += 1
					return
				}
				if (source[offset] !== ",") throw new InvalidJsonEnvelope()
				offset += 1
			}
			throw new InvalidJsonEnvelope()
		}
		parsePrimitive()
	}

	parseValue(0)
	skipWhitespace()
	if (offset !== source.length) throw new InvalidJsonEnvelope()
	return hasDuplicates
}

export const parseEnvironmentDocument = (source: string): Environment => {
	if (
		Buffer.byteLength(source, "utf-8") > ENVIRONMENT_DIFF_LIMITS.maxFileBytes ||
		hasDuplicateJsonMembers(source)
	) {
		throw new InvalidJsonEnvelope()
	}

	return environmentSchema.parse(JSON.parse(source))
}
