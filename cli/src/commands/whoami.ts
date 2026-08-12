import { existsSync } from "node:fs"
import path from "node:path"
import { passphraseProtectedKeyError } from "../helpers/errors"
import { findEnvironmentsRecursive } from "../helpers/findEnvironmentsRecursive"
import { getEnvironmentByPath } from "../helpers/getEnvironmentByPath"
import { getPrivateKeys } from "../helpers/getPrivateKeys"
import { getPublicKeys } from "../helpers/getPublicKeys"
import { discoverOnePasswordKeyCandidates } from "../helpers/onePasswordKeyProvider"
import { resolveProjectRoot } from "../helpers/resolveProjectRoot"

export const whoamiCommand = async () => {
	let projectRoot: string
	try {
		projectRoot = resolveProjectRoot(process.cwd(), existsSync)
	} catch {
		projectRoot = process.cwd()
	}
	const dotencDir = path.join(projectRoot, ".dotenc")

	const { keys: privateKeys, passphraseProtectedKeys } = await getPrivateKeys()
	const publicKeys = await getPublicKeys(dotencDir)

	const privateFingerprints = new Set(privateKeys.map((k) => k.fingerprint))

	const localMatchingPublicKeys = publicKeys.filter((pub) =>
		privateFingerprints.has(pub.fingerprint),
	)
	const onePasswordCandidates =
		localMatchingPublicKeys.length === 0
			? (await discoverOnePasswordKeyCandidates()).keys
			: []
	const onePasswordByFingerprint = new Map(
		onePasswordCandidates.map((candidate) => [
			candidate.fingerprint,
			candidate,
		]),
	)
	const matchingPublicKeys =
		localMatchingPublicKeys.length > 0
			? localMatchingPublicKeys
			: publicKeys.filter((pub) =>
					onePasswordByFingerprint.has(pub.fingerprint),
				)

	if (matchingPublicKeys.length === 0) {
		if (privateKeys.length === 0 && passphraseProtectedKeys.length > 0) {
			console.error(passphraseProtectedKeyError(passphraseProtectedKeys))
		} else {
			console.error(
				'No matching key found in this project. For a new project, run "dotenc init". In an existing project, ask a project member to add your public key and grant access.',
			)
		}
		process.exit(1)
	}

	const envFiles = await findEnvironmentsRecursive(projectRoot)

	for (let i = 0; i < matchingPublicKeys.length; i++) {
		const matchingPublicKey = matchingPublicKeys[i]

		if (i > 0) {
			console.log("")
		}

		const matchingPrivateKey = privateKeys.find(
			(pk) => pk.fingerprint === matchingPublicKey.fingerprint,
		)
		const matchingOnePasswordKey = onePasswordByFingerprint.get(
			matchingPublicKey.fingerprint,
		)
		const activeKeyName = matchingPrivateKey
			? matchingPrivateKey.name
			: matchingOnePasswordKey
				? `${matchingOnePasswordKey.group.label} / ${matchingOnePasswordKey.name}`
				: "unknown"

		console.log(`Name: ${matchingPublicKey.name}`)
		console.log(`Active SSH key: ${activeKeyName}`)
		console.log(`Fingerprint: ${matchingPublicKey.fingerprint}`)

		const authorizedEnvironments: string[] = []

		for (const envFile of envFiles) {
			try {
				const environment = await getEnvironmentByPath(envFile.filePath)
				const hasAccess = environment.keys.some(
					(key) => key.fingerprint === matchingPublicKey.fingerprint,
				)
				if (hasAccess) {
					const rel = path.relative(projectRoot, envFile.dir)
					authorizedEnvironments.push(
						rel ? `${envFile.name} (${rel})` : envFile.name,
					)
				}
			} catch {
				// Skip environments that can't be read
			}
		}

		if (authorizedEnvironments.length > 0) {
			console.log("Authorized environments:")
			for (const env of authorizedEnvironments) {
				console.log(`  - ${env}`)
			}
		} else {
			console.log("Authorized environments: none")
		}
	}
}
