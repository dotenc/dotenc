import { getPrivateKeys } from "./getPrivateKeys"
import { getPublicKeys } from "./getPublicKeys"
import { discoverOnePasswordKeyCandidates } from "./onePasswordKeyProvider"

type GetCurrentKeyNameDeps = {
	getPrivateKeys: typeof getPrivateKeys
	getPublicKeys: typeof getPublicKeys
	discoverOnePasswordKeyCandidates?: typeof discoverOnePasswordKeyCandidates
}

type GetCurrentKeyNameOptions = {
	requestedIdentity?: string
}

export const getCurrentKeyName = async (
	deps: GetCurrentKeyNameDeps = {
		getPrivateKeys,
		getPublicKeys,
		discoverOnePasswordKeyCandidates,
	},
	options: GetCurrentKeyNameOptions = {},
): Promise<string[]> => {
	const { keys: privateKeys } = await deps.getPrivateKeys()
	const publicKeys = await deps.getPublicKeys()

	const privateFingerprints = new Set(privateKeys.map((k) => k.fingerprint))

	const localMatches = publicKeys.filter((pub) =>
		privateFingerprints.has(pub.fingerprint),
	)
	const unmatchedPublicKeys = publicKeys.filter(
		(publicKey) => !privateFingerprints.has(publicKey.fingerprint),
	)
	const requestedIdentityIsLocal = localMatches.some(
		(match) => match.name === options.requestedIdentity,
	)
	if (
		!deps.discoverOnePasswordKeyCandidates ||
		unmatchedPublicKeys.length === 0 ||
		requestedIdentityIsLocal ||
		(localMatches.length > 0 && options.requestedIdentity === undefined)
	) {
		return localMatches.map((match) => match.name)
	}

	const onePassword = await deps.discoverOnePasswordKeyCandidates()
	const providerFingerprints = new Set(
		onePassword.keys.map((key) => key.fingerprint),
	)
	return publicKeys
		.filter(
			(publicKey) =>
				privateFingerprints.has(publicKey.fingerprint) ||
				providerFingerprints.has(publicKey.fingerprint),
		)
		.map((match) => match.name)
}
