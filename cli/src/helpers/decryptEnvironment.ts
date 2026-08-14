import { timingSafeEqual } from "node:crypto"
import chalk from "chalk"
import type { Environment } from "../schemas/environment"
import { decryptData, encryptData } from "./crypto"
import { decryptDataKey } from "./decryptDataKey"
import { passphraseProtectedKeyError } from "./errors"
import { getEnvironmentByName } from "./getEnvironmentByName"
import { getPrivateKeys, type PrivateKeyEntry } from "./getPrivateKeys"
import type { KeyCandidate } from "./keyCandidate"
import {
	type CachedOnePasswordPrivateKeyResult,
	discoverOnePasswordKeyCandidates,
	loadCachedOnePasswordPrivateKey,
} from "./onePasswordKeyProvider"

type DecryptionKeyDeps = {
	getPrivateKeys: typeof getPrivateKeys
	loadCachedOnePasswordPrivateKey?: typeof loadCachedOnePasswordPrivateKey
	discoverOnePasswordKeyCandidates?: typeof discoverOnePasswordKeyCandidates
	loadPrivateKey?: (candidate: KeyCandidate) => Promise<PrivateKeyEntry>
}

type DecryptEnvironmentDataDeps = DecryptionKeyDeps & {
	decryptDataKey: typeof decryptDataKey
	decryptData: typeof decryptData
}

const defaultDecryptEnvironmentDataDeps: DecryptEnvironmentDataDeps = {
	getPrivateKeys,
	loadCachedOnePasswordPrivateKey,
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
		loadCachedOnePasswordPrivateKey,
		discoverOnePasswordKeyCandidates,
	},
): DecryptionKeyContext => {
	let privateKeysPromise: ReturnType<typeof deps.getPrivateKeys> | undefined
	let discoveryPromise:
		| ReturnType<typeof discoverOnePasswordKeyCandidates>
		| undefined
	const providerPrivateKeys = new Map<string, PrivateKeyEntry>()
	let cachedProviderTransientFailure:
		| Extract<
				CachedOnePasswordPrivateKeyResult,
				{ status: "transient-failure" }
		  >
		| undefined
	let providerPrivateKeyLoadTail: Promise<void> = Promise.resolve()
	let disposed = false
	const discoverOnePassword = deps.discoverOnePasswordKeyCandidates
	const loadPrivateKey =
		deps.loadPrivateKey ??
		((candidate: KeyCandidate) => candidate.loadPrivateKey())
	const loadedProviderPrivateKey = (fingerprints: string[]) => {
		for (const fingerprint of [...new Set(fingerprints)].sort()) {
			const privateKey = providerPrivateKeys.get(fingerprint)
			if (privateKey) return privateKey
		}
		return undefined
	}
	const serializeProviderPrivateKeyLoad = <T>(
		load: () => Promise<T>,
	): Promise<T> => {
		const result = providerPrivateKeyLoadTail.then(load, load)
		providerPrivateKeyLoadTail = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}

	return {
		getPrivateKeys: () => {
			privateKeysPromise ??= deps.getPrivateKeys()
			return privateKeysPromise
		},
		loadCachedOnePasswordPrivateKey: deps.loadCachedOnePasswordPrivateKey
			? (fingerprints) =>
					serializeProviderPrivateKeyLoad(async () => {
						if (cachedProviderTransientFailure) {
							return cachedProviderTransientFailure
						}
						const loaded = loadedProviderPrivateKey(fingerprints)
						if (loaded) {
							return { status: "loaded", privateKey: loaded } as const
						}
						const result =
							await deps.loadCachedOnePasswordPrivateKey?.(fingerprints)
						if (result?.status === "loaded") {
							providerPrivateKeys.set(
								result.privateKey.fingerprint,
								result.privateKey,
							)
						} else if (result?.status === "transient-failure") {
							cachedProviderTransientFailure = result
						}
						return result ?? { status: "miss" }
					})
			: undefined,
		discoverOnePasswordKeyCandidates: discoverOnePassword
			? () => {
					discoveryPromise ??= discoverOnePassword()
					return discoveryPromise
				}
			: undefined,
		loadPrivateKey: (candidate) =>
			serializeProviderPrivateKeyLoad(async () => {
				const loaded = providerPrivateKeys.get(candidate.fingerprint)
				if (loaded) return loaded
				const privateKey = await loadPrivateKey(candidate)
				providerPrivateKeys.set(privateKey.fingerprint, privateKey)
				return privateKey
			}),
		dispose: () => {
			if (disposed) return
			disposed = true
			privateKeysPromise = undefined
			discoveryPromise = undefined
			cachedProviderTransientFailure = undefined
			providerPrivateKeys.clear()
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
	| "loadCachedOnePasswordPrivateKey"
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
	let unavailableProviderAccountLabels: string[] = []
	let cachedProviderResult: CachedOnePasswordPrivateKeyResult = {
		status: "miss",
	}

	for (const privateKeyEntry of availablePrivateKeys) {
		grantedKey = environment.keys.find((key) => {
			return key.fingerprint === privateKeyEntry.fingerprint
		})

		if (grantedKey) {
			selectedPrivateKey = privateKeyEntry
			break
		}
	}

	if (!grantedKey && deps.loadCachedOnePasswordPrivateKey) {
		cachedProviderResult = await deps.loadCachedOnePasswordPrivateKey(
			environment.keys.map((key) => key.fingerprint),
		)
		if (cachedProviderResult.status === "loaded") {
			selectedPrivateKey = cachedProviderResult.privateKey
			grantedKey = environment.keys.find(
				(key) => key.fingerprint === selectedPrivateKey?.fingerprint,
			)
		} else if (cachedProviderResult.status === "transient-failure") {
			throw cachedProviderResult.error
		}
	}

	if (
		!grantedKey &&
		cachedProviderResult.status === "miss" &&
		availablePrivateKeys.length === 0 &&
		passphraseProtectedKeys.length > 0
	) {
		throw new Error(passphraseProtectedKeyError(passphraseProtectedKeys))
	}

	if (!grantedKey && deps.discoverOnePasswordKeyCandidates) {
		const discovery = await deps.discoverOnePasswordKeyCandidates()
		providerStatus = discovery.status
		providerKeyNames = discovery.keys.map(
			(candidate) => `${candidate.group.label} / ${candidate.name}`,
		)
		unavailableProviderAccountLabels = discovery.unavailableAccounts.map(
			(account) => account.label,
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
		if (providerStatus === "unsupported-version") {
			throw new Error(
				"The installed 1Password CLI version is unsupported. dotenc requires op 2.x.",
			)
		}
		if (availablePrivateKeys.length === 0 && providerKeyNames.length === 0) {
			const unavailableAccounts = [...new Set(unavailableProviderAccountLabels)]
			const providerGuidance =
				unavailableAccounts.length > 0
					? ` 1Password access was unavailable for: ${unavailableAccounts.join(", ")}.`
					: ""
			throw new Error(
				`No private keys found. Please ensure you have SSH keys in ~/.ssh/ or set DOTENC_PRIVATE_KEY_BASE64.${providerGuidance}`,
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

type ReencryptEnvironmentDataDeps = DecryptEnvironmentDataDeps & {
	encryptData?: typeof encryptData
}

/**
 * Rebind an envelope's plaintext to a new logical name without changing its
 * data key. The unwrapped key is never exposed to the caller and is cleared
 * before this function returns.
 */
export const reencryptEnvironmentData = async (
	sourceName: string,
	destinationName: string,
	environment: Environment,
	deps: ReencryptEnvironmentDataDeps = defaultDecryptEnvironmentDataDeps,
): Promise<{ encryptedContent: Buffer; plaintext: string }> => {
	const dataKey = await unwrapEnvironmentDataKey(environment, deps)
	const sourceAad =
		(environment.version ?? 1) >= 2
			? Buffer.from(sourceName, "utf-8")
			: undefined
	try {
		const plaintext = await deps.decryptData(
			dataKey,
			Buffer.from(environment.encryptedContent, "base64"),
			sourceAad,
		)
		const encryptedContent = await (deps.encryptData ?? encryptData)(
			dataKey,
			plaintext,
			Buffer.from(destinationName, "utf-8"),
		)
		return { encryptedContent, plaintext }
	} finally {
		dataKey.fill(0)
	}
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
				[
					"You do not have access to this environment.",
					"",
					"These are your available private keys:",
					...availablePrivateKeys.map((name) => `- ${chalk.green(name)}`),
					"",
					"Please ask the owners of any of the following keys to grant you access:",
					...environmentJson.keys.map((key) => `- ${chalk.green(key.name)}`),
					"",
				].join("\n"),
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
