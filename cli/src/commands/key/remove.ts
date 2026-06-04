import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import chalk from "chalk"
import { resolveProjectRoot } from "../../helpers/resolveProjectRoot"
import { validateKeyName } from "../../helpers/validateKeyName"
import { choosePublicKeyPrompt } from "../../prompts/choosePublicKey"
import { confirmPrompt } from "../../prompts/confirm"

export const keyRemoveCommand = async (nameArg: string, yes = false) => {
	let name = nameArg

	if (!name) {
		name = await choosePublicKeyPrompt(
			"Which public key do you want to remove?",
		)
	}

	const keyNameValidation = validateKeyName(name)
	if (!keyNameValidation.valid) {
		console.error(`${chalk.red("Error:")} ${keyNameValidation.reason}`)
		process.exit(1)
	}

	let projectRoot: string
	try {
		projectRoot = resolveProjectRoot(process.cwd(), existsSync)
	} catch {
		projectRoot = process.cwd()
	}
	const filePath = path.join(projectRoot, ".dotenc", `${name}.pub`)
	if (!existsSync(filePath)) {
		console.error(`Public key ${chalk.cyan(name)} not found.`)
		process.exit(1)
	}

	if (!yes) {
		const confirmed = await confirmPrompt(
			`Are you sure you want to remove key ${name}?`,
		)
		if (!confirmed) {
			console.log("Operation cancelled.")
			return
		}
	}

	await fs.unlink(filePath)
	console.log(`Public key ${chalk.cyan(name)} removed.`)
	console.log(
		`To fully offboard this key, run: ${chalk.gray(`dotenc auth purge ${name}`)}`,
	)
}
