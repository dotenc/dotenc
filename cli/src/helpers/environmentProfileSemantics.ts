import { validateEnvironmentName } from "./validateEnvironmentName"

const ENVIRONMENT_FILE_PATTERN = /^\.env\.(.+)\.enc$/

export const encryptedEnvironmentNameFromFileName = (
	fileName: string,
): string | undefined => ENVIRONMENT_FILE_PATTERN.exec(fileName)?.[1]

export const isPersonalEnvironmentName = (name: string): boolean =>
	name.startsWith("personal.") && validateEnvironmentName(name).valid

export const personalEnvironmentNameFromFileName = (
	fileName: string,
): string | undefined => {
	const name = encryptedEnvironmentNameFromFileName(fileName)
	return name && isPersonalEnvironmentName(name) ? name : undefined
}

export const isPossibleLegacyProfileName = (name: string): boolean => {
	const normalizedName = name.toLowerCase()
	return (
		normalizedName !== "development" &&
		!normalizedName.startsWith("personal.") &&
		validateEnvironmentName(name).valid
	)
}

export const addEnvironmentLayer = (
	layersByEnvironment: Map<string, string[]>,
	environmentName: string,
	filePath: string,
) => {
	const layers = layersByEnvironment.get(environmentName) ?? []
	layers.push(filePath)
	layersByEnvironment.set(environmentName, layers)
}
