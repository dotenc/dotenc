import { timingSafeEqual } from "node:crypto"
import chalk from "chalk"
import type { Environment } from "../schemas/environment"
import { decryptData } from "./crypto"
import { decryptDataKey } from "./decryptDataKey"
import { passphraseProtectedKeyError } from "./errors"
import { getEnvironmentByName } from "./getEnvironmentByName"
import { getPrivateKeys, type PrivateKeyEntry } from "./getPrivateKeys"

type DecryptEnvironmentDataDeps = {
	getPrivateKeys: typeof getPrivateKeys
	decryptDataKey: typeof decryptDataKey
	decryptData: typeof decryptData
}

const defaultDecryptEnvironmentDataDeps: DecryptEnvironmentDataDeps = {
	getPrivateKeys,
	decryptDataKey,
	decryptData,
}

type EnvironmentDataKeyComparisonDeps = Pick<
	DecryptEnvironmentDataDeps,
	"getPrivateKeys" | "decryptDataKey"
>

const unwrapEnvironmentDataKey = async (
	environment: Environment,
	deps: EnvironmentDataKeyComparisonDeps,
): Promise<Buffer> => {
	const { keys: availablePrivateKeys, passphraseProtectedKeys } =
		await deps.getPrivateKeys()

	if (!availablePrivateKeys.length) {
		if (passphraseProtectedKeys.length > 0) {
			throw new Error(passphraseProtectedKeyError(passphraseProtectedKeys))
		}
		throw new Error(
			"No private keys found. Please ensure you have SSH keys in ~/.ssh/ or set DOTENC_PRIVATE_KEY_BASE64.",
		)
	}

	let grantedKey: Environment["keys"][number] | undefined
	let selectedPrivateKey: PrivateKeyEntry | undefined

	for (const privateKeyEntry of availablePrivateKeys) {
		grantedKey = environment.keys.find((key) => {
			return key.fingerprint === privateKeyEntry.fingerprint
		})

		if (grantedKey) {
			selectedPrivateKey = privateKeyEntry
			break
		}
	}

	if (!grantedKey || !selectedPrivateKey) {
		throw new Error("Access denied to the environment.")
	}

	let dataKey: Buffer
	try {
		dataKey = deps.decryptDataKey(
			selectedPrivateKey,
			Buffer.from(grantedKey.encryptedDataKey, "base64"),
		)
	} catch (error) {
		throw new Error("Failed to decrypt the data key.", { cause: error })
	}
	if (dataKey.byteLength !== 32) {
		dataKey.fill(0)
		throw new Error("Failed to decrypt the data key.")
	}

	return dataKey
}

/** Compare two unwrapped data keys without exposing either key to the caller. */
export const environmentDataKeysEqual = async (
	base: Environment,
	head: Environment,
	deps: EnvironmentDataKeyComparisonDeps = defaultDecryptEnvironmentDataDeps,
): Promise<boolean> => {
	let baseDataKey: Buffer | undefined
	let headDataKey: Buffer | undefined
	try {
		baseDataKey = await unwrapEnvironmentDataKey(base, deps)
		headDataKey = await unwrapEnvironmentDataKey(head, deps)
		return timingSafeEqual(baseDataKey, headDataKey)
	} finally {
		baseDataKey?.fill(0)
		headDataKey?.fill(0)
	}
}

export const decryptEnvironmentData = async (
	environmentName: string,
	environment: Environment,
	deps: DecryptEnvironmentDataDeps = defaultDecryptEnvironmentDataDeps,
): Promise<string> => {
	const dataKey = await unwrapEnvironmentDataKey(environment, deps)

	const aad =
		(environment.version ?? 1) >= 2
			? Buffer.from(environmentName, "utf-8")
			: undefined

	try {
		return await deps.decryptData(
			dataKey,
			Buffer.from(environment.encryptedContent, "base64"),
			aad,
		)
	} finally {
		dataKey.fill(0)
	}
}

type DecryptEnvironmentDeps = DecryptEnvironmentDataDeps & {
	getEnvironmentByName: typeof getEnvironmentByName
	logError: (message: string) => void
}

const defaultDecryptEnvironmentDeps: DecryptEnvironmentDeps = {
	...defaultDecryptEnvironmentDataDeps,
	getEnvironmentByName,
	logError: (message) => console.error(message),
}

export const decryptEnvironment = async (
	name: string,
	deps: DecryptEnvironmentDeps = defaultDecryptEnvironmentDeps,
) => {
	const environmentJson = await deps.getEnvironmentByName(name)

	try {
		return await decryptEnvironmentData(name, environmentJson, deps)
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "Access denied to the environment."
		) {
			const { keys: availablePrivateKeys } = await deps.getPrivateKeys()
			deps.logError(
				`You do not have access to this environment.\n
      These are your available private keys:\n
      ${availablePrivateKeys.map((key) => `- ${chalk.green(key.name)}`).join("\n")}\n
      Please ask the owners of any of the following keys to grant you access:\n
      ${environmentJson.keys.map((key) => `- ${chalk.green(key.name)}`).join("\n")}\n`,
			)
		}

		if (
			error instanceof Error &&
			error.message === "Failed to decrypt the data key."
		) {
			deps.logError(
				`${chalk.red("Error:")} failed to decrypt the data key. Please ensure you have the correct private key.`,
			)
		}

		throw error
	}
}
