import fs from "node:fs/promises"
import path from "node:path"
import { decryptData } from "../helpers/crypto"
import { decryptDataKey } from "../helpers/decryptDataKey"
import { decryptEnvironmentData } from "../helpers/decryptEnvironment"
import { getEnvironmentByPath } from "../helpers/getEnvironmentByPath"
import { getPrivateKeys } from "../helpers/getPrivateKeys"

export const textconvCommand = async (filePath: string) => {
	const absolutePath = path.isAbsolute(filePath)
		? filePath
		: path.join(process.cwd(), filePath)

	try {
		const environment = await getEnvironmentByPath(absolutePath)
		const nameMatch = absolutePath.match(/\.env\.(.+)\.enc$/)
		const environmentName = nameMatch
			? nameMatch[1]
			: path.basename(absolutePath)
		const plaintext = await decryptEnvironmentData(
			environmentName,
			environment,
			{
				getPrivateKeys,
				decryptDataKey,
				decryptData,
			},
		)
		process.stdout.write(plaintext)
	} catch {
		const raw = await fs.readFile(absolutePath, "utf-8")
		process.stdout.write(raw)
	}
}
