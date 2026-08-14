import fs from "node:fs/promises"
import path from "node:path"
import { parseSpkiPublicKey } from "./parseSpkiPublicKey"
import { validateKeyName } from "./validateKeyName"
import { validatePublicKey } from "./validatePublicKey"

export const getPublicKeyByName = async (name: string) => {
	const keyNameValidation = validateKeyName(name)
	if (!keyNameValidation.valid) {
		throw new Error(keyNameValidation.reason)
	}

	const filePath = path.join(process.cwd(), ".dotenc", `${name}.pub`)
	let publicKeyInput: string

	try {
		publicKeyInput = await fs.readFile(filePath, "utf-8")
	} catch (error) {
		throw new Error(`No public key found with name ${name}.`, {
			cause: error,
		})
	}

	try {
		const publicKey = parseSpkiPublicKey(publicKeyInput)
		const validation = validatePublicKey(publicKey)
		if (!validation.valid) throw new Error(validation.reason)
		return publicKey
	} catch (error) {
		throw new Error(
			`Invalid public key format for ${name}. Please provide a valid PEM formatted public key.`,
			{ cause: error },
		)
	}
}
