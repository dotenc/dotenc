import { existsSync } from "node:fs"
import fs from "node:fs/promises"
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
import { validateKeyName } from "../../helpers/validateKeyName"
import { confirmPrompt } from "../../prompts/confirm"

export const authPurgeCommand = async (publicKeyName: string, yes: boolean) => {
	const keyNameValidation = validateKeyName(publicKeyName)
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

	const keyFilePath = path.join(projectRoot, ".dotenc", `${publicKeyName}.pub`)
	if (!existsSync(keyFilePath)) {
		console.error(`Public key ${chalk.cyan(publicKeyName)} not found.`)
		process.exit(1)
	}

	// Find all environments recursively under the project
	const allEnvFiles = await findEnvironmentsRecursive(projectRoot)
	const revocableEnvs: { name: string; filePath: string; dir: string }[] = []
	const zeroRecipientErrors: { name: string; reason: string }[] = []

	for (const envFile of allEnvFiles) {
		try {
			const env = await getEnvironmentByPath(envFile.filePath)
			if (env.keys.some((k) => k.name === publicKeyName)) {
				const remainingKeys = env.keys.filter((k) => k.name !== publicKeyName)
				if (remainingKeys.length === 0) {
					zeroRecipientErrors.push({
						name: `${envFile.name} (${path.relative(projectRoot, envFile.dir) || "."})`,
						reason: "no remaining recipients after revocation",
					})
				} else {
					revocableEnvs.push(envFile)
				}
			}
		} catch {
			// Skip environments that can't be read
		}
	}

	// Print what will happen
	if (revocableEnvs.length > 0) {
		console.log("Environments to update (revoke + rotate):")
		for (const envFile of revocableEnvs) {
			const label = path.relative(projectRoot, envFile.dir) || "."
			console.log(`  - ${envFile.name} (${label})`)
		}
	}
	if (zeroRecipientErrors.length > 0) {
		console.log("Environments skipped (would have zero recipients):")
		for (const { name, reason } of zeroRecipientErrors) {
			console.log(`  - ${name}: ${reason}`)
		}
	}

	if (!yes) {
		const confirmed = await confirmPrompt("Proceed with full offboarding?")
		if (!confirmed) {
			console.log("Operation cancelled.")
			return
		}
	}

	// Process each revocable environment (best-effort)
	const failures: { name: string; error: string }[] = []
	let successCount = 0
	const decryptionContext = createDecryptEnvironmentDataContext()

	try {
		for (const envFile of revocableEnvs) {
			try {
				const envJson = await getEnvironmentByPath(envFile.filePath)
				const content = await decryptEnvironmentData(
					envFile.name,
					envJson,
					decryptionContext,
				)
				await encryptEnvironment(envFile.name, content, {
					revokePublicKeys: [publicKeyName],
					baseDir: envFile.dir,
				})
				successCount++
			} catch (error) {
				failures.push({
					name: `${envFile.name} (${path.relative(projectRoot, envFile.dir) || "."})`,
					error: error instanceof Error ? error.message : "unknown error",
				})
			}
		}
	} finally {
		decryptionContext.dispose()
	}

	// Delete the .pub file
	await fs.unlink(keyFilePath)

	// Print summary
	const failCount = failures.length
	console.log(
		`Offboarding complete. ${successCount} environment${successCount !== 1 ? "s" : ""} updated, ${failCount} failed.`,
	)
	if (failures.length > 0) {
		console.log("Failed environments:")
		for (const { name, error } of failures) {
			console.error(`  - ${name}: ${error}`)
		}
	}
	if (zeroRecipientErrors.length > 0) {
		console.log(
			`${zeroRecipientErrors.length} environment${zeroRecipientErrors.length !== 1 ? "s" : ""} skipped (zero remaining recipients).`,
		)
	}
}
