import crypto from "node:crypto"
import {
	type GetPrivateKeysResult,
	getPrivateKeys,
	type PrivateKeyEntry,
} from "./getPrivateKeys"
import type { KeyCandidate } from "./keyCandidate"
import {
	discoverOnePasswordKeyCandidates,
	type OnePasswordDiscoveryResult,
} from "./onePasswordKeyProvider"
import { validatePublicKey } from "./validatePublicKey"

type DeferredOnePasswordDiscoveryResult = Omit<
	OnePasswordDiscoveryResult,
	"status"
> & {
	status: "not-requested"
}

export type GetKeyCandidatesResult = Pick<
	GetPrivateKeysResult,
	"passphraseProtectedKeys" | "unsupportedKeys"
> & {
	keys: KeyCandidate[]
	onePassword: OnePasswordDiscoveryResult | DeferredOnePasswordDiscoveryResult
}

export type GetKeyCandidatesOptions = {
	includeOnePassword?: boolean
}

type GetKeyCandidatesDeps = {
	getPrivateKeys: typeof getPrivateKeys
	discoverOnePasswordKeyCandidates: typeof discoverOnePasswordKeyCandidates
}

const defaultDeps: GetKeyCandidatesDeps = {
	getPrivateKeys,
	discoverOnePasswordKeyCandidates,
}

function localCandidate(entry: PrivateKeyEntry): KeyCandidate {
	const source = entry.name.startsWith("env.") ? "environment" : "filesystem"
	const publicKey = crypto.createPublicKey(entry.privateKey)
	return {
		source,
		selector: entry.name,
		name: entry.name,
		hint: entry.algorithm,
		group:
			source === "environment"
				? { id: "environment", label: "Environment" }
				: { id: "filesystem", label: "Local - ~/.ssh" },
		publicKey,
		fingerprint: entry.fingerprint,
		algorithm: entry.algorithm,
		loadPrivateKey: async () => entry,
	}
}

export async function getKeyCandidates(
	options: GetKeyCandidatesOptions = {},
	deps: GetKeyCandidatesDeps = defaultDeps,
): Promise<GetKeyCandidatesResult> {
	const local = await deps.getPrivateKeys()
	const onePassword =
		options.includeOnePassword === true
			? await deps.discoverOnePasswordKeyCandidates()
			: {
					status: "not-requested" as const,
					keys: [],
					unsupportedKeys: [],
					unavailableAccounts: [],
				}

	const localCandidates: KeyCandidate[] = []
	const policyUnsupported = []
	for (const entry of local.keys) {
		const candidate = localCandidate(entry)
		const validation = validatePublicKey(candidate.publicKey)
		if (validation.valid) localCandidates.push(candidate)
		else policyUnsupported.push({ name: entry.name, reason: validation.reason })
	}

	return {
		keys: [...localCandidates, ...onePassword.keys],
		passphraseProtectedKeys: local.passphraseProtectedKeys,
		unsupportedKeys: [
			...(local.unsupportedKeys ?? []),
			...policyUnsupported,
			...onePassword.unsupportedKeys,
		],
		onePassword,
	}
}
