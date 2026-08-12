import { timingSafeEqual } from "node:crypto"
import chalk from "chalk"
import type { Environment } from "../schemas/environment"
import { decryptData } from "./crypto"
import { decryptDataKey } from "./decryptDataKey"
import { passphraseProtectedKeyError } from "./errors"
import { getEnvironmentByName } from "./getEnvironmentByName"
import { getPrivateKeys, type PrivateKeyEntry } from "./getPrivateKeys"
import type { KeyCandidate } from "./keyCandidate"
import { discoverOnePasswordKeyCandidates } from "./onePasswordKeyProvider"

type DecryptionKeyDeps = {
	getPrivateKeys: typeof getPrivateKeys
	discoverOnePasswordKeyCandidates?: typeof discoverOnePasswordKeyCandidates
	loadPrivateKey?: (candidate: KeyCandidate) => Promise<PrivateKeyEntry>
}

type DecryptEnvironmentDataDeps = DecryptionKeyDeps & {
	decryptDataKey: typeof decryptDataKey
	decryptData: typeof decryptData
}

const defaultDecryptEnvironmentDataDeps: DecryptEnvironmentDataDeps = {
	getPrivateKeys,
	discoverOnePasswordKeyCandidates,
	decryptDataKey,
	decryptData,
}

export type DecryptionKeyContext = DecryptionKeyDeps & {
	loadPrivateKey: NonNullable<DecryptionKeyDeps["loadPrivateKey"]>
	dispose: () => void
}

export const createDecryptionKeyContext = (
	deps: DecryptionKeyDeps = {
		getPrivateKeys,
		discoverOnePasswordKeyCandidates,
	},
): DecryptionKeyContext => {
	let privateKeysPromise: ReturnType<typeof deps.getPrivateKeys> | undefined
	let discoveryPromise:
		| ReturnType<typeof discoverOnePasswordKeyCandidates>
		| undefined
	const privateKeyPromises = new Map<string, Promise<PrivateKeyEntry>>()
	let disposed = false
	const discoverOnePassword = deps.discoverOnePasswordKeyCandidates
	const loadPrivateKey =
		deps.loadPrivateKey ??
		((candidate: KeyCandidate) => candidate.loadPrivateKey())

	return {
		getPrivateKeys: () => {
			privateKeysPromise ??= deps.getPrivateKeys()
			return privateKeysPromise
		},
		discoverOnePasswordKeyCandidates: discoverOnePassword
			? () => {
					discoveryPromise ??= discoverOnePassword()
					return discoveryPromise
				}
			: undefined,
		loadPrivateKey: (candidate) => {
			let privateKeyPromise = privateKeyPromises.get(candidate.selector)
			if (!privateKeyPromise) {
				privateKeyPromise = loadPrivateKey(candidate)
				privateKeyPromises.set(candidate.selector, privateKeyPromise)
			}
			return privateKeyPromise
		},
		dispose: () => {
			if (disposed) return
			disposed = true
			privateKeysPromise = undefined
			discoveryPromise = undefined
			privateKeyPromises.clear()
		},
	}
}

export type DecryptEnvironmentDataContext = DecryptEnvironmentDataDeps & {
	dispose: () => void
}

export const createDecryptEnvironmentDataContext = (
	deps: DecryptEnvironmentDataDeps = defaultDecryptEnvironmentDataDeps,
): DecryptEnvironmentDataContext => {
	const keyContext = createDecryptionKeyContext(deps)
	return {
		...deps,
		...keyContext,
	}
}

type EnvironmentDataKeyComparisonDeps = Pick<
	DecryptEnvironmentDataDeps,
	| "getPrivateKeys"
	| "discoverOnePasswordKeyCandidates"
	| "loadPrivateKey"
	| "decryptDataKey"
>

class EnvironmentAccessDeniedError extends Error {
	constructor(readonly availablePrivateKeyNames: string[]) {
		super("Access denied to the environment.")
		this.name = "EnvironmentAccessDeniedError"
	}
}

const unwrapEnvironmentDataKey = async (
	environment: Environment,
	deps: EnvironmentDataKeyComparisonDeps,
): Promise<Buffer> => {
	const { keys: availablePrivateKeys, passphraseProtectedKeys } =
		await deps.getPrivateKeys()

	let grantedKey: Environment["keys"][number] | undefined
	let selectedPrivateKey: PrivateKeyEntry | undefined
	let providerStatus:
		| Awaited<ReturnType<typeof discoverOnePasswordKeyCandidates>>["status"]
		| undefined
	let providerKeyNames: string[] = []

	for (const privateKeyEntry of availablePrivateKeys) {
		grantedKey = environment.keys.find((key) => {
			return key.fingerprint === privateKeyEntry.fingerprint
		})

		if (grantedKey) {
			selectedPrivateKey = privateKeyEntry
			break
		}
	}

	if (!grantedKey && deps.discoverOnePasswordKeyCandidates) {
		const discovery = await deps.discoverOnePasswordKeyCandidates()
		providerStatus = discovery.status
		providerKeyNames = discovery.keys.map(
			(candidate) => `${candidate.group.label} / ${candidate.name}`,
		)
		const matchingCandidates = discovery.keys
			.filter((candidate) =>
				environment.keys.some(
					(key) => key.fingerprint === candidate.fingerprint,
				),
			)
			.sort((left, right) => left.selector.localeCompare(right.selector))

		if (matchingCandidates.length > 0) {
			const candidate = matchingCandidates[0]
			selectedPrivateKey = await (deps.loadPrivateKey?.(candidate) ??
				candidate.loadPrivateKey())
			grantedKey = environment.keys.find(
				(key) => key.fingerprint === selectedPrivateKey?.fingerprint,
			)
		}
	}

	if (!grantedKey || !selectedPrivateKey) {
		if (
			availablePrivateKeys.length === 0 &&
			passphraseProtectedKeys.length > 0
		) {
			throw new Error(passphraseProtectedKeyError(passphraseProtectedKeys))
		}
		if (providerStatus === "unsupported-version") {
			throw new Error(
				"The installed 1Password CLI version is unsupported. dotenc requires op 2.x.",
			)
		}
		if (
			availablePrivateKeys.length === 0 &&
			(!deps.discoverOnePasswordKeyCandidates ||
				providerStatus === "not-installed" ||
				providerStatus === "no-accounts" ||
				providerStatus === "unavailable")
		) {
			throw new Error(
				"No private keys found. Please ensure you have SSH keys in ~/.ssh/ or set DOTENC_PRIVATE_KEY_BASE64.",
			)
		}
		throw new EnvironmentAccessDeniedError([
			...new Set([
				...availablePrivateKeys.map((key) => key.name),
				...providerKeyNames,
			]),
		])
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
	const keyContext = createDecryptionKeyContext(deps)
	let baseDataKey: Buffer | undefined
	let headDataKey: Buffer | undefined
	try {
		baseDataKey = await unwrapEnvironmentDataKey(base, {
			...deps,
			...keyContext,
		})
		headDataKey = await unwrapEnvironmentDataKey(head, {
			...deps,
			...keyContext,
		})
		return timingSafeEqual(baseDataKey, headDataKey)
	} finally {
		baseDataKey?.fill(0)
		headDataKey?.fill(0)
		keyContext.dispose()
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
		if (error instanceof EnvironmentAccessDeniedError) {
			const availablePrivateKeys =
				error.availablePrivateKeyNames.length > 0
					? error.availablePrivateKeyNames
					: ["(none)"]
			deps.logError(
				`You do not have access to this environment.\n
		      These are your available private keys:\n
		      ${availablePrivateKeys.map((name) => `- ${chalk.green(name)}`).join("\n")}\n
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
