import fs from "node:fs/promises"
import path from "node:path"
import { decryptData } from "../helpers/crypto"
import { decryptDataKey } from "../helpers/decryptDataKey"
import { decryptEnvironmentData } from "../helpers/decryptEnvironment"
import { getEnvironmentByPath } from "../helpers/getEnvironmentByPath"
import { getPrivateKeys } from "../helpers/getPrivateKeys"
import { loadCachedOnePasswordPrivateKey } from "../helpers/onePasswordKeyProvider"

type TextconvDeps = {
	readFile: (filePath: string, encoding: "utf-8") => Promise<string>
	getEnvironmentByPath: typeof getEnvironmentByPath
	decryptEnvironmentData: typeof decryptEnvironmentData
	writeStdout: (content: string) => void
}

const defaultDeps: TextconvDeps = {
	readFile: (filePath, encoding) => fs.readFile(filePath, encoding),
	getEnvironmentByPath,
	decryptEnvironmentData,
	writeStdout: (content) => process.stdout.write(content),
}

export const _textconvCommand = async (
	filePath: string,
	deps: TextconvDeps = defaultDeps,
) => {
	const absolutePath = path.isAbsolute(filePath)
		? filePath
		: path.join(process.cwd(), filePath)

	try {
		const environment = await deps.getEnvironmentByPath(absolutePath)
		const nameMatch = absolutePath.match(/\.env\.(.+)\.enc$/)
		const environmentName = nameMatch
			? nameMatch[1]
			: path.basename(absolutePath)
		const plaintext = await deps.decryptEnvironmentData(
			environmentName,
			environment,
			{
				getPrivateKeys,
				loadCachedOnePasswordPrivateKey,
				decryptDataKey,
				decryptData,
			},
		)
		deps.writeStdout(plaintext)
	} catch {
		const raw = await deps.readFile(absolutePath, "utf-8")
		deps.writeStdout(raw)
	}
}

export const textconvCommand = (filePath: string) => _textconvCommand(filePath)
