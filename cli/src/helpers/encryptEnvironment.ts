import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import chalk from "chalk"
import type { Environment } from "../schemas/environment"
import { createDataKey, encryptData } from "./crypto"
import { encryptDataKey } from "./encryptDataKey"
import { getEnvironmentByName } from "./getEnvironmentByName"
import { getPublicKeys } from "./getPublicKeys"
import { resolveProjectRoot } from "./resolveProjectRoot"

type Options = {
	grantPublicKeys?: string[]
	revokePublicKeys?: string[]
	revokePublicKeyFingerprints?: string[]
	baseDir?: string
}

export const encryptEnvironment = async (
	name: string,
	newContent: string,
	options?: Options,
) => {
	const baseDir = options?.baseDir ?? process.cwd()
	let projectRoot: string
	try {
		projectRoot = resolveProjectRoot(baseDir, existsSync)
	} catch {
		projectRoot = baseDir
	}
	const dotencDir = path.join(projectRoot, ".dotenc")
	const availablePublicKeys = await getPublicKeys(dotencDir)

	if (!availablePublicKeys.length) {
		throw new Error(
			"No public keys found. Please add a public key using 'dotenc key add'.",
		)
	}

	const environmentJson = await getEnvironmentByName(name, baseDir)

	const removedKeys = environmentJson.keys.filter(
		(key) =>
			!availablePublicKeys.find((pk) => pk.fingerprint === key.fingerprint),
	)
	if (removedKeys.length) {
		console.log(
			`The following keys were removed from the environment: ${removedKeys
				.map((key) => chalk.red(key.name))
				.join(", ")}. They will not have access to the new content.`,
		)
	}

	const dataKey = createDataKey()
	const keys: Environment["keys"] = []

	for (const key of environmentJson.keys) {
		const availableKey = availablePublicKeys.find(
			(pk) => pk.fingerprint === key.fingerprint,
		)

		if (!availableKey) {
			continue
		}

		if (
			options?.revokePublicKeys?.includes(availableKey.name) ||
			options?.revokePublicKeyFingerprints?.includes(availableKey.fingerprint)
		) {
			console.log(
				`Public key ${chalk.green(availableKey.name)} has been revoked from the environment.`,
			)
			continue
		}

		if (key.name !== availableKey.name) {
			console.log(
				`Public key ${chalk.red(
					key.name,
				)} renamed to ${chalk.green(availableKey.name)}.`,
			)
		}

		const encrypted = encryptDataKey(availableKey, dataKey)

		keys.push({
			name: availableKey.name,
			fingerprint: availableKey.fingerprint,
			encryptedDataKey: encrypted.toString("base64"),
			algorithm: availableKey.algorithm,
		})
	}

	if (options?.grantPublicKeys) {
		for (const publicKeyName of options.grantPublicKeys) {
			const publicKey = availablePublicKeys.find(
				(key) => key.name === publicKeyName,
			)

			if (!publicKey) {
				console.error(
					`${chalk.red("Error:")} public key ${chalk.green(publicKeyName)} not found.`,
				)
				continue
			}

			const existingPublicKey = keys.find(
				(key) => key.fingerprint === publicKey.fingerprint,
			)
			if (existingPublicKey) {
				if (existingPublicKey.name === publicKey.name) {
					console.log(
						`Public key ${chalk.green(
							publicKey.name,
						)} already has access to the environment.`,
					)
				} else {
					console.log(
						`Public key ${chalk.red(
							existingPublicKey.name,
						)} renamed to ${chalk.green(publicKey.name)}.`,
					)
				}
				continue
			}

			const encrypted = encryptDataKey(publicKey, dataKey)

			keys.push({
				name: publicKey.name,
				fingerprint: publicKey.fingerprint,
				encryptedDataKey: encrypted.toString("base64"),
				algorithm: publicKey.algorithm,
			})

			console.log(
				`Public key ${chalk.green(publicKey.name)} has been granted access to the environment.`,
			)
		}
	}

	if (!keys.length) {
		throw new Error(
			"No valid public keys are left to encrypt the environment. Please ensure you have valid public keys added. Operation aborted.",
		)
	}

	const aad = Buffer.from(name, "utf-8")
	const encryptedContent = await encryptData(dataKey, newContent, aad)
	const newEnvironmentJson: Environment = {
		version: 2,
		keys,
		encryptedContent: encryptedContent.toString("base64"),
	}

	await fs.writeFile(
		path.join(baseDir, `.env.${name}.enc`),
		JSON.stringify(newEnvironmentJson, null, 2),
		"utf-8",
	)
}
