import { getPrivateKeys } from "./getPrivateKeys"
import { getPublicKeys } from "./getPublicKeys"
import { discoverOnePasswordKeyCandidates } from "./onePasswordKeyProvider"

type GetCurrentKeyNameDeps = {
	getPrivateKeys: typeof getPrivateKeys
	getPublicKeys: typeof getPublicKeys
	discoverOnePasswordKeyCandidates?: typeof discoverOnePasswordKeyCandidates
}

export const getCurrentKeyName = async (
	deps: GetCurrentKeyNameDeps = {
		getPrivateKeys,
		getPublicKeys,
		discoverOnePasswordKeyCandidates,
	},
): Promise<string[]> => {
	const { keys: privateKeys } = await deps.getPrivateKeys()
	const publicKeys = await deps.getPublicKeys()

	const privateFingerprints = new Set(privateKeys.map((k) => k.fingerprint))

	const localMatches = publicKeys.filter((pub) =>
		privateFingerprints.has(pub.fingerprint),
	)
	if (localMatches.length > 0 || !deps.discoverOnePasswordKeyCandidates) {
		return localMatches.map((match) => match.name)
	}

	const onePassword = await deps.discoverOnePasswordKeyCandidates()
	const providerFingerprints = new Set(
		onePassword.keys.map((key) => key.fingerprint),
	)
	return publicKeys
		.filter((publicKey) => providerFingerprints.has(publicKey.fingerprint))
		.map((match) => match.name)
}
