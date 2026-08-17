import { decryptEnvironmentData } from "../../helpers/decryptEnvironment"
import { getEnvironmentByName } from "../../helpers/getEnvironmentByName"
import { validateEnvironmentName } from "../../helpers/validateEnvironmentName"

type DecryptOptions = {
	json?: boolean
}

type CliErrorCode =
	| "INVALID_ENVIRONMENT_NAME"
	| "ENVIRONMENT_NOT_FOUND"
	| "ACCESS_DENIED"
	| "NO_PRIVATE_KEYS"
	| "PASSPHRASE_PROTECTED_KEYS"
	| "UNKNOWN"

type JsonSuccess = {
	ok: true
	content: string
	grantedUsers: string[]
}

type JsonFailure = {
	ok: false
	error: {
		code: CliErrorCode
		message: string
	}
}

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
const stripAnsi = (value: string) => value.replace(ansiPattern, "")

const mapErrorCode = (message: string): CliErrorCode => {
	if (message.includes("Environment file not found")) {
		return "ENVIRONMENT_NOT_FOUND"
	}
	if (
		message === "Access denied to the environment." ||
		message === "Failed to decrypt the data key."
	) {
		return "ACCESS_DENIED"
	}
	if (message.includes("No private keys found")) {
		return "NO_PRIVATE_KEYS"
	}
	if (message.toLowerCase().includes("passphrase-protected")) {
		return "PASSPHRASE_PROTECTED_KEYS"
	}
	return "UNKNOWN"
}

const writeJson = (message: JsonSuccess | JsonFailure) => {
	process.stdout.write(`${JSON.stringify(message)}\n`)
}

export const decryptCommand = async (
	environmentName: string,
	options: DecryptOptions,
) => {
	const validation = validateEnvironmentName(environmentName)

	if (!validation.valid) {
		if (options.json) {
			writeJson({
				ok: false,
				error: {
					code: "INVALID_ENVIRONMENT_NAME",
					message: validation.reason,
				},
			})
		} else {
			console.error(validation.reason)
		}
		process.exit(1)
	}

	try {
		const environment = await getEnvironmentByName(environmentName)
		const plaintext = await decryptEnvironmentData(environmentName, environment)
		const grantedUsers = Array.from(
			new Set(
				environment.keys
					.map((key) => key.name.trim())
					.filter((name) => name.length > 0),
			),
		)

		if (options.json) {
			writeJson({ ok: true, content: plaintext, grantedUsers })
		} else {
			process.stdout.write(plaintext)
		}
	} catch (error: unknown) {
		const rawMessage =
			error instanceof Error
				? error.message
				: "Unknown error occurred while decrypting the environment."
		const message = stripAnsi(rawMessage)
		const code = mapErrorCode(message)

		if (options.json) {
			writeJson({ ok: false, error: { code, message } })
		} else {
			console.error(message)
		}
		process.exit(1)
	}
}
