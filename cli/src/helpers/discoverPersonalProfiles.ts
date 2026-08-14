import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { buildAncestorChain } from "./buildAncestorChain"
import {
	type DecryptEnvironmentDataContext,
	decryptEnvironmentData,
} from "./decryptEnvironment"
import {
	addEnvironmentLayer,
	isPossibleLegacyProfileName,
	personalEnvironmentNameFromFileName,
} from "./environmentProfileSemantics"
import { getEnvironmentByPath } from "./getEnvironmentByPath"
import { getKeyFingerprint } from "./getKeyFingerprint"
import { parseSpkiPublicKey } from "./parseSpkiPublicKey"
import { resolveProjectRoot } from "./resolveProjectRoot"
import { validateEnvironmentName } from "./validateEnvironmentName"
import { validatePublicKey } from "./validatePublicKey"

export type PersonalProfileDiscovery = {
	discovered: string[]
	accessible: string[]
}

export type LegacyProfileCandidate = {
	name: string
	layerCount: number
	requiresAllLayers: boolean
}

type Deps = {
	readdir: (dir: string) => Promise<string[]>
	readFile: (filePath: string) => Promise<string>
	exists: typeof existsSync
	resolveProjectRoot: typeof resolveProjectRoot
	buildAncestorChain: typeof buildAncestorChain
	getEnvironmentByPath: typeof getEnvironmentByPath
	decryptEnvironmentData: typeof decryptEnvironmentData
	parseSpkiPublicKey: typeof parseSpkiPublicKey
	getKeyFingerprint: typeof getKeyFingerprint
	validatePublicKey: typeof validatePublicKey
}

const defaultDeps: Deps = {
	readdir: (dir) => fs.readdir(dir),
	readFile: (filePath) => fs.readFile(filePath, "utf-8"),
	exists: existsSync,
	resolveProjectRoot,
	buildAncestorChain,
	getEnvironmentByPath,
	decryptEnvironmentData,
	parseSpkiPublicKey,
	getKeyFingerprint,
	validatePublicKey,
}

export const toPersonalEnvironmentName = (profile: string) =>
	`personal.${profile}`

const effectiveDirs = (
	options: { invocationDir: string; localOnly?: boolean },
	deps: Deps,
	projectRoot?: string,
) => {
	if (options.localOnly) return [options.invocationDir]
	const root =
		projectRoot ?? deps.resolveProjectRoot(options.invocationDir, deps.exists)
	return deps.buildAncestorChain(root, options.invocationDir)
}

const findExactEnvironmentLayers = async (
	environmentName: string,
	dirs: string[],
	deps: Deps,
) => {
	const fileName = `.env.${environmentName}.enc`
	const layers: string[] = []

	for (const dir of dirs) {
		try {
			const fileNames = await deps.readdir(dir)
			if (fileNames.includes(fileName)) layers.push(path.join(dir, fileName))
		} catch {
			// If any effective layer cannot be inspected, do not make an advisory claim.
			return undefined
		}
	}

	return layers
}

const verifyLegacyProfile = async (
	name: string,
	dirs: string[],
	invocationDir: string,
	decryptionContext: DecryptEnvironmentDataContext,
	deps: Deps,
	requiredRecipientFingerprint?: string,
): Promise<LegacyProfileCandidate | undefined> => {
	const validation = validateEnvironmentName(name)
	if (!validation.valid) return undefined

	const layers = await findExactEnvironmentLayers(name, dirs, deps)
	if (!layers || layers.length === 0) return undefined

	try {
		for (const filePath of layers) {
			const environment = await deps.getEnvironmentByPath(filePath)
			if (
				requiredRecipientFingerprint !== undefined &&
				!environment.keys.some(
					(recipient) => recipient.fingerprint === requiredRecipientFingerprint,
				)
			) {
				return undefined
			}
			await deps.decryptEnvironmentData(name, environment, decryptionContext)
		}
		return {
			name,
			layerCount: layers.length,
			requiresAllLayers: layers.some(
				(filePath) =>
					path.resolve(path.dirname(filePath)) !== path.resolve(invocationDir),
			),
		}
	} catch {
		return undefined
	}
}

/**
 * Check one explicitly requested old-style environment without ever selecting
 * or loading it into a child process.
 */
export const discoverLegacyProfile = async (
	name: string,
	options: {
		invocationDir: string
		localOnly?: boolean
		decryptionContext: DecryptEnvironmentDataContext
	},
	deps: Deps = defaultDeps,
): Promise<LegacyProfileCandidate | undefined> => {
	if (!isPossibleLegacyProfileName(name)) {
		return undefined
	}

	try {
		const projectRoot = deps.resolveProjectRoot(
			options.invocationDir,
			deps.exists,
		)
		const publicKey = deps.parseSpkiPublicKey(
			await deps.readFile(path.join(projectRoot, ".dotenc", `${name}.pub`)),
		)
		if (!deps.validatePublicKey(publicKey).valid) return undefined
		const recipientFingerprint = deps.getKeyFingerprint(publicKey)
		return await verifyLegacyProfile(
			name,
			effectiveDirs(options, deps, projectRoot),
			options.invocationDir,
			options.decryptionContext,
			deps,
			recipientFingerprint,
		)
	} catch {
		return undefined
	}
}

/**
 * Find decryptable environments that may follow the pre-personal.* key-alias
 * convention. Repository public-key basenames are hints, not identity truth.
 */
export const discoverPossibleLegacyProfiles = async (
	options: {
		invocationDir: string
		localOnly?: boolean
		decryptionContext: DecryptEnvironmentDataContext
	},
	deps: Deps = defaultDeps,
): Promise<LegacyProfileCandidate[]> => {
	try {
		const projectRoot = deps.resolveProjectRoot(
			options.invocationDir,
			deps.exists,
		)
		const dotencDir = path.join(projectRoot, ".dotenc")
		const publicKeyFiles = await deps.readdir(dotencDir)
		const aliases = (
			await Promise.all(
				publicKeyFiles
					.filter((fileName) => fileName.endsWith(".pub"))
					.map(async (fileName) => {
						const name = fileName.slice(0, -4)
						if (!isPossibleLegacyProfileName(name)) {
							return undefined
						}

						try {
							const publicKey = deps.parseSpkiPublicKey(
								await deps.readFile(path.join(dotencDir, fileName)),
							)
							if (!deps.validatePublicKey(publicKey).valid) return undefined
							return {
								name,
								fingerprint: deps.getKeyFingerprint(publicKey),
							}
						} catch {
							return undefined
						}
					}),
			)
		).filter(
			(
				alias,
			): alias is {
				name: string
				fingerprint: string
			} => alias !== undefined,
		)
		aliases.sort((left, right) => left.name.localeCompare(right.name))
		const dirs = effectiveDirs(options, deps, projectRoot)
		const candidates = await Promise.all(
			aliases.map((alias) =>
				verifyLegacyProfile(
					alias.name,
					dirs,
					options.invocationDir,
					options.decryptionContext,
					deps,
					alias.fingerprint,
				),
			),
		)
		return candidates.filter(
			(candidate): candidate is LegacyProfileCandidate =>
				candidate !== undefined,
		)
	} catch {
		return []
	}
}

export const discoverPersonalProfiles = async (
	options: {
		invocationDir: string
		localOnly?: boolean
		decryptionContext: DecryptEnvironmentDataContext
	},
	deps: Deps = defaultDeps,
): Promise<PersonalProfileDiscovery> => {
	const dirs = effectiveDirs(options, deps)
	const layersByEnvironment = new Map<string, string[]>()

	for (const dir of dirs) {
		let fileNames: string[]
		try {
			fileNames = await deps.readdir(dir)
		} catch {
			continue
		}

		for (const fileName of fileNames) {
			const environmentName = personalEnvironmentNameFromFileName(fileName)
			if (!environmentName) continue
			addEnvironmentLayer(
				layersByEnvironment,
				environmentName,
				path.join(dir, fileName),
			)
		}
	}

	const discovered = [...layersByEnvironment.keys()].sort((left, right) =>
		left.localeCompare(right),
	)
	const accessible = (
		await Promise.all(
			discovered.map(async (environmentName) => {
				try {
					for (const filePath of layersByEnvironment.get(environmentName) ??
						[]) {
						const environment = await deps.getEnvironmentByPath(filePath)
						await deps.decryptEnvironmentData(
							environmentName,
							environment,
							options.decryptionContext,
						)
					}
					return environmentName
				} catch {
					return undefined
				}
			}),
		)
	).filter((name): name is string => name !== undefined)

	return { discovered, accessible }
}
