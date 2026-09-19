import { spawnSync } from "node:child_process"
import { existsSync, rmSync, statSync, writeFileSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import chalk from "chalk"
import { createHash } from "../../helpers/createHash"
import { decryptEnvironment } from "../../helpers/decryptEnvironment"
import { encryptEnvironment } from "../../helpers/encryptEnvironment"
import { getDefaultEditor } from "../../helpers/getDefaultEditor"
import { getEnvironmentByName } from "../../helpers/getEnvironmentByName"
import { secureEraseFile } from "../../helpers/secureEraseFile"
import { splitCommand } from "../../helpers/splitCommand"
import { validateEnvironmentName } from "../../helpers/validateEnvironmentName"
import { chooseEnvironmentPrompt } from "../../prompts/chooseEnvironment"
import type { Environment } from "../../schemas/environment"

export const editCommand = async (
	environmentNameArg: string,
	_options: Record<string, never> = {},
) => {
	const environmentName =
		environmentNameArg ||
		(await chooseEnvironmentPrompt("What environment do you want to edit?"))

	const nameValidation = validateEnvironmentName(environmentName)
	if (!nameValidation.valid) {
		console.error(`${chalk.red("Error:")} ${nameValidation.reason}`)
		process.exit(1)
	}

	const invocationDir = process.cwd()
	const environmentFilePath = path.join(
		invocationDir,
		`.env.${environmentName}.enc`,
	)
	const environmentFile = path.basename(environmentFilePath)
	const envDir = invocationDir

	if (!existsSync(environmentFilePath)) {
		console.error(`Environment file not found: ${environmentFilePath}`)
		process.exit(1)
	}

	let environment: Environment
	let content: string
	try {
		environment = await getEnvironmentByName(environmentName, envDir)
		content = await decryptEnvironment(environmentName)
	} catch (error: unknown) {
		console.error(
			error instanceof Error
				? error.message
				: "Unknown error occurred while decrypting the environment.",
		)
		process.exit(1)
	}

	// Create header
	const separator = "# ---\n"
	content = `# Editing environment: ${environmentName}
# This file is encrypted. Do not share it.
# Any changes made here will be encrypted and saved back to the environment file.
# The following public keys have access to this environment:
${environment.keys.map((key) => `# - ${key.name}`).join("\n")}
# Use 'dotenc auth grant' and/or 'dotenc auth revoke' to manage access.
# Make sure to save your changes before closing the editor.
${separator}${content}`

	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dotenc-"))
	const tempFilePath = path.join(tempDir, `.env.${environmentName}`)
	const cleanup = async () => {
		await secureEraseFile(tempFilePath)
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
	}

	// Synchronous variant used in signal handlers to guarantee completion before exit.
	const onSignal = () => {
		try {
			const stat = statSync(tempFilePath)
			writeFileSync(tempFilePath, Buffer.alloc(stat.size, 0))
		} catch {
			// File may not exist; best effort.
		}
		rmSync(tempDir, { recursive: true, force: true })
		process.exit(130)
	}

	process.on("SIGINT", onSignal)
	process.on("SIGTERM", onSignal)

	try {
		await fs.writeFile(tempFilePath, content, {
			encoding: "utf-8",
			mode: 0o600,
		})
		const initialHash = createHash(content)
		const editorCommand = await getDefaultEditor()
		const [editorExecutable, ...editorArgs] = splitCommand(editorCommand)
		if (!editorExecutable) {
			throw new Error("No editor command configured.")
		}

		// This will block until the editor process is closed
		const result = spawnSync(editorExecutable, [...editorArgs, tempFilePath], {
			stdio: "inherit",
		})

		if (result.error) {
			throw result.error
		}

		if (result.status !== 0) {
			throw new Error(
				result.signal
					? `Editor terminated by signal ${result.signal}`
					: `Editor exited with code ${result.status}`,
			)
		}

		let newContent = await fs.readFile(tempFilePath, "utf-8")
		const finalHash = createHash(newContent)

		if (initialHash === finalHash) {
			console.log(
				`\nNo changes were made to the ${chalk.cyan(environmentName)} environment.`,
			)
		} else {
			// strip the header and separator if they exist
			const separatorIndex = newContent.indexOf(separator)
			if (separatorIndex !== -1) {
				const headerEndIndex = newContent.indexOf(separator) + separator.length
				newContent = newContent.slice(headerEndIndex).trim()
			}

			await encryptEnvironment(environmentName, newContent, { baseDir: envDir })

			console.log(
				`\nEncrypted ${chalk.cyan(environmentName)} environment and saved it to ${chalk.gray(environmentFile)}.`,
			)
		}
	} catch (error: unknown) {
		process.exitCode = 1
		console.error("\nFailed to edit environment.")
		console.error(error instanceof Error ? error.message : String(error))
	} finally {
		process.removeListener("SIGINT", onSignal)
		process.removeListener("SIGTERM", onSignal)
		await cleanup()
	}
}
