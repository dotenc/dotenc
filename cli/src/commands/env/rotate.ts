import { existsSync } from "node:fs"
import path from "node:path"
import chalk from "chalk"
import {
	createDecryptEnvironmentDataContext,
	decryptEnvironmentData,
} from "../../helpers/decryptEnvironment"
import { encryptEnvironment } from "../../helpers/encryptEnvironment"
import { findEnvironmentsRecursive } from "../../helpers/findEnvironmentsRecursive"
import { getEnvironmentByPath } from "../../helpers/getEnvironmentByPath"
import { resolveProjectRoot } from "../../helpers/resolveProjectRoot"
import { validateEnvironmentName } from "../../helpers/validateEnvironmentName"
import { chooseEnvironmentPrompt } from "../../prompts/chooseEnvironment"
import { confirmPrompt } from "../../prompts/confirm"

export const rotateCommand = async (
	environmentNameArg: string,
	all: boolean,
	yes: boolean,
) => {
	if (all) {
		let projectRoot: string
		try {
			projectRoot = resolveProjectRoot(process.cwd(), existsSync)
		} catch {
			projectRoot = process.cwd()
		}

		const envFiles = await findEnvironmentsRecursive(projectRoot)

		if (envFiles.length === 0) {
			console.log("No environments found.")
			return
		}

		console.log("Environments to rotate:")
		for (const envFile of envFiles) {
			const label = path.relative(projectRoot, envFile.dir) || "."
			console.log(`  - ${envFile.name} (${label})`)
		}

		if (!yes) {
			const confirmed = await confirmPrompt(
				`Rotate data keys for all ${envFiles.length} environment${envFiles.length !== 1 ? "s" : ""}?`,
			)
			if (!confirmed) {
				console.log("Operation cancelled.")
				return
			}
		}

		const decryptionContext = createDecryptEnvironmentDataContext()
		try {
			for (const envFile of envFiles) {
				try {
					const envJson = await getEnvironmentByPath(envFile.filePath)
					const content = await decryptEnvironmentData(
						envFile.name,
						envJson,
						decryptionContext,
					)
					await encryptEnvironment(envFile.name, content, {
						baseDir: envFile.dir,
					})
					const label = path.relative(projectRoot, envFile.dir) || "."
					console.log(`${chalk.green("✓")} ${envFile.name} (${label})`)
				} catch (error) {
					const label = path.relative(projectRoot, envFile.dir) || "."
					console.error(
						`${chalk.red("✗")} ${envFile.name} (${label}): ${error instanceof Error ? error.message : "unknown error"}`,
					)
				}
			}
		} finally {
			decryptionContext.dispose()
		}
		return
	}

	// Single environment rotation
	const environmentName =
		environmentNameArg ||
		(await chooseEnvironmentPrompt(
			"What environment do you want to rotate the data key for?",
		))

	const validation = validateEnvironmentName(environmentName)
	if (!validation.valid) {
		console.error(`${chalk.red("Error:")} ${validation.reason}`)
		process.exit(1)
	}

	const targetDir = process.cwd()
	const targetFilePath = path.join(targetDir, `.env.${environmentName}.enc`)

	if (!existsSync(targetFilePath)) {
		console.error(
			`${chalk.red("Error:")} environment ${chalk.cyan(environmentName)} not found.`,
		)
		process.exit(1)
	}

	let currentContent!: string
	try {
		const envJson = await getEnvironmentByPath(targetFilePath)
		currentContent = await decryptEnvironmentData(environmentName, envJson)
	} catch (error) {
		console.error(
			error instanceof Error
				? error.message
				: "Unknown error occurred while decrypting the environment.",
		)
		process.exit(1)
	}

	try {
		await encryptEnvironment(environmentName, currentContent, {
			baseDir: targetDir,
		})
	} catch (error) {
		console.error(
			error instanceof Error
				? error.message
				: "Unknown error occurred while encrypting the environment.",
		)
		process.exit(1)
	}

	console.log(`Data key for ${environmentName} has been rotated.`)
}
