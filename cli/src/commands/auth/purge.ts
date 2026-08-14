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
import { getPublicKeys } from "../../helpers/getPublicKeys"
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

	const dotencDir = path.join(projectRoot, ".dotenc")
	const publicKeys = await getPublicKeys(dotencDir)
	const targetPublicKey = publicKeys.find((key) => key.name === publicKeyName)
	if (!targetPublicKey) {
		console.error(
			`${chalk.red("Error:")} public key ${chalk.cyan(publicKeyName)} is invalid and cannot be purged safely.`,
		)
		process.exit(1)
	}

	const targetFingerprint = targetPublicKey.fingerprint
	const aliases = publicKeys
		.filter((key) => key.fingerprint === targetFingerprint)
		.map((key) => key.name)
		.sort()

	// Find all environments recursively under the project
	const allEnvFiles = await findEnvironmentsRecursive(projectRoot)
	const revocableEnvs: {
		name: string
		filePath: string
		dir: string
		environment: Awaited<ReturnType<typeof getEnvironmentByPath>>
	}[] = []
	const zeroRecipientErrors: { name: string; reason: string }[] = []
	const unreadableEnvironments: string[] = []

	for (const envFile of allEnvFiles) {
		try {
			const env = await getEnvironmentByPath(envFile.filePath)
			if (env.keys.some((key) => key.fingerprint === targetFingerprint)) {
				const remainingKeys = env.keys.filter(
					(key) => key.fingerprint !== targetFingerprint,
				)
				if (remainingKeys.length === 0) {
					zeroRecipientErrors.push({
						name: `${envFile.name} (${path.relative(projectRoot, envFile.dir) || "."})`,
						reason: "no remaining recipients after revocation",
					})
				} else {
					revocableEnvs.push({ ...envFile, environment: env })
				}
			}
		} catch {
			unreadableEnvironments.push(
				`${envFile.name} (${path.relative(projectRoot, envFile.dir) || "."})`,
			)
		}
	}

	if (unreadableEnvironments.length > 0 || zeroRecipientErrors.length > 0) {
		console.error(
			`${chalk.red("Error:")} offboarding preflight failed; no environments or public keys were changed.`,
		)
		for (const name of unreadableEnvironments) {
			console.error(`  - ${name}: environment could not be validated`)
		}
		for (const { name, reason } of zeroRecipientErrors) {
			console.error(`  - ${name}: ${reason}`)
		}
		process.exit(1)
	}

	// Print what will happen
	if (revocableEnvs.length > 0) {
		console.log("Environments to update (revoke + rotate):")
		for (const envFile of revocableEnvs) {
			const label = path.relative(projectRoot, envFile.dir) || "."
			console.log(`  - ${envFile.name} (${label})`)
		}
	}
	if (aliases.length > 1) {
		console.log(
			`Public key aliases with the same fingerprint to remove: ${aliases.join(", ")}`,
		)
	}

	if (!yes) {
		const confirmed = await confirmPrompt("Proceed with full offboarding?")
		if (!confirmed) {
			console.log("Operation cancelled.")
			return
		}
	}

	// Prove that every affected envelope can be decrypted before changing any of
	// them. This keeps an unavailable key or corrupt wrapper from turning a purge
	// into a false success.
	const preparedEnvironments: {
		name: string
		filePath: string
		dir: string
		content: string
	}[] = []
	const preflightFailures: string[] = []
	const decryptionContext = createDecryptEnvironmentDataContext()

	try {
		for (const envFile of revocableEnvs) {
			try {
				const content = await decryptEnvironmentData(
					envFile.name,
					envFile.environment,
					decryptionContext,
				)
				preparedEnvironments.push({
					name: envFile.name,
					filePath: envFile.filePath,
					dir: envFile.dir,
					content,
				})
			} catch {
				preflightFailures.push(
					`${envFile.name} (${path.relative(projectRoot, envFile.dir) || "."})`,
				)
			}
		}
	} finally {
		decryptionContext.dispose()
	}

	if (preflightFailures.length > 0) {
		console.error(
			`${chalk.red("Error:")} offboarding preflight could not decrypt every affected environment; nothing was changed.`,
		)
		for (const name of preflightFailures) {
			console.error(`  - ${name}: decryption failed`)
		}
		process.exit(1)
	}

	const rewriteFailures: string[] = []
	let successCount = 0
	for (const envFile of preparedEnvironments) {
		try {
			await encryptEnvironment(envFile.name, envFile.content, {
				revokePublicKeyFingerprints: [targetFingerprint],
				baseDir: envFile.dir,
			})
			successCount++
		} catch {
			rewriteFailures.push(
				`${envFile.name} (${path.relative(projectRoot, envFile.dir) || "."})`,
			)
		}
	}

	if (rewriteFailures.length > 0) {
		console.error(
			`${chalk.red("Error:")} offboarding is incomplete; the public key was retained for a safe retry.`,
		)
		for (const name of rewriteFailures) {
			console.error(`  - ${name}: rewrite failed`)
		}
		process.exit(1)
	}

	// Rescan after mutation. A successful command is allowed to remove the key
	// only when the fingerprint is absent from every readable envelope.
	const verificationFailures: string[] = []
	for (const envFile of await findEnvironmentsRecursive(projectRoot)) {
		try {
			const environment = await getEnvironmentByPath(envFile.filePath)
			if (
				environment.keys.some((key) => key.fingerprint === targetFingerprint)
			) {
				verificationFailures.push(
					`${envFile.name} (${path.relative(projectRoot, envFile.dir) || "."})`,
				)
			}
		} catch {
			verificationFailures.push(
				`${envFile.name} (${path.relative(projectRoot, envFile.dir) || "."})`,
			)
		}
	}

	if (verificationFailures.length > 0) {
		console.error(
			`${chalk.red("Error:")} offboarding verification failed; the public key was retained for a safe retry.`,
		)
		for (const name of verificationFailures) {
			console.error(`  - ${name}: target fingerprint may still have access`)
		}
		process.exit(1)
	}

	for (const alias of aliases) {
		await fs.unlink(path.join(dotencDir, `${alias}.pub`))
	}

	// Print summary
	console.log(
		`Offboarding complete. ${successCount} environment${successCount !== 1 ? "s" : ""} updated, 0 failed.`,
	)
}
