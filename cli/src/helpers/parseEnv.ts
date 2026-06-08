import { parseEnv as parseNodeEnv } from "node:util"

export const parseEnv = (lines: string): Record<string, string> => {
	const parsed = parseNodeEnv(lines)
	const env: Record<string, string> = {}

	for (const [key, value] of Object.entries(parsed)) {
		if (value !== undefined) {
			env[key] = value
		}
	}

	return env
}
