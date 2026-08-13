import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { buildAncestorChain } from "./buildAncestorChain"
import {
	type DecryptEnvironmentDataContext,
	decryptEnvironmentData,
} from "./decryptEnvironment"
import { getEnvironmentByPath } from "./getEnvironmentByPath"
import { resolveProjectRoot } from "./resolveProjectRoot"
import { validateEnvironmentName } from "./validateEnvironmentName"

const PERSONAL_FILE_PATTERN = /^\.env\.(personal\.(.+))\.enc$/

export type PersonalProfileDiscovery = {
	discovered: string[]
	accessible: string[]
}

type Deps = {
	readdir: (dir: string) => Promise<string[]>
	exists: typeof existsSync
	resolveProjectRoot: typeof resolveProjectRoot
	buildAncestorChain: typeof buildAncestorChain
	getEnvironmentByPath: typeof getEnvironmentByPath
	decryptEnvironmentData: typeof decryptEnvironmentData
}

const defaultDeps: Deps = {
	readdir: (dir) => fs.readdir(dir),
	exists: existsSync,
	resolveProjectRoot,
	buildAncestorChain,
	getEnvironmentByPath,
	decryptEnvironmentData,
}

export const toPersonalEnvironmentName = (profile: string) =>
	`personal.${profile}`

export const discoverPersonalProfiles = async (
	options: {
		invocationDir: string
		localOnly?: boolean
		decryptionContext: DecryptEnvironmentDataContext
	},
	deps: Deps = defaultDeps,
): Promise<PersonalProfileDiscovery> => {
	const dirs = options.localOnly
		? [options.invocationDir]
		: deps.buildAncestorChain(
				deps.resolveProjectRoot(options.invocationDir, deps.exists),
				options.invocationDir,
			)
	const layersByEnvironment = new Map<string, string[]>()

	for (const dir of dirs) {
		let fileNames: string[]
		try {
			fileNames = await deps.readdir(dir)
		} catch {
			continue
		}

		for (const fileName of fileNames) {
			const match = PERSONAL_FILE_PATTERN.exec(fileName)
			if (!match) continue
			const environmentName = match[1]
			const validation = validateEnvironmentName(environmentName)
			if (!validation.valid) continue
			const layers = layersByEnvironment.get(environmentName) ?? []
			layers.push(path.join(dir, fileName))
			layersByEnvironment.set(environmentName, layers)
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
