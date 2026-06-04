import crypto, { type KeyObject } from "node:crypto"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import chalk from "chalk"
import { isPassphraseProtected } from "../../helpers/isPassphraseProtected"
import { parseOpenSSHPrivateKey } from "../../helpers/parseOpenSSHKey"
import { parsePassphraseProtectedPrivateKey } from "../../helpers/parsePassphraseProtectedPrivateKey"
import { resolveProjectRoot } from "../../helpers/resolveProjectRoot"
import { validateKeyName } from "../../helpers/validateKeyName"
import { validatePublicKey } from "../../helpers/validatePublicKey"
import { choosePrivateKeyPrompt } from "../../prompts/choosePrivateKey"
import { inputKeyPrompt } from "../../prompts/inputKey"
import { inputNamePrompt } from "../../prompts/inputName"
import { prompt } from "../../prompts/prompt"

type Options = {
	fromSsh?: string
	fromPrivateKey?: string
	fromFile?: string
	fromString?: string
}

const parsePrivateKeyInput = async (
	keyContent: string,
	passphraseProtected: boolean,
): Promise<KeyObject> => {
	if (passphraseProtected) {
		const passphrase = process.env.DOTENC_PRIVATE_KEY_PASSPHRASE
		if (passphrase === undefined) {
			throw new Error(
				"passphrase-protected key cannot be parsed without a passphrase",
			)
		}

		const privateKey = await parsePassphraseProtectedPrivateKey(
			keyContent,
			passphrase,
		)

		if (!privateKey) {
			throw new Error(
				"failed to decrypt passphrase-protected key with DOTENC_PRIVATE_KEY_PASSPHRASE",
			)
		}

		return privateKey
	}

	return crypto.createPrivateKey(keyContent)
}

export const keyAddCommand = async (nameArg?: string, options?: Options) => {
	let publicKey: KeyObject | undefined

	if (options?.fromSsh) {
		const sshPath = options.fromSsh.startsWith("~")
			? path.join(os.homedir(), options.fromSsh.slice(1))
			: options.fromSsh

		if (!existsSync(sshPath)) {
			console.error(
				`File ${chalk.cyan(sshPath)} does not exist. Please provide a valid SSH key path.`,
			)
			process.exit(1)
		}

		const keyContent = await fs.readFile(sshPath, "utf-8")
		const passphraseProtected = isPassphraseProtected(keyContent)

		if (
			passphraseProtected &&
			process.env.DOTENC_PRIVATE_KEY_PASSPHRASE === undefined
		) {
			console.error(
				`${chalk.red("Error:")} the provided key is passphrase-protected. Set ${chalk.gray("DOTENC_PRIVATE_KEY_PASSPHRASE")} to use it, or provide a passwordless key.`,
			)
			process.exit(1)
		}

		try {
			const privateKey = await parsePrivateKeyInput(
				keyContent,
				passphraseProtected,
			)
			publicKey = crypto.createPublicKey(privateKey)
		} catch {
			if (
				passphraseProtected &&
				process.env.DOTENC_PRIVATE_KEY_PASSPHRASE !== undefined
			) {
				console.error(
					`${chalk.red("Error:")} failed to decrypt the provided key with ${chalk.gray("DOTENC_PRIVATE_KEY_PASSPHRASE")}. Please verify the passphrase.`,
				)
				process.exit(1)
			}

			const parsed = parseOpenSSHPrivateKey(keyContent)
			if (parsed) {
				publicKey = crypto.createPublicKey(parsed)
			} else {
				try {
					publicKey = crypto.createPublicKey(keyContent)
				} catch (error) {
					console.error(
						"Invalid SSH key format. Please provide a valid SSH key file.",
					)
					console.error(
						`Details: ${error instanceof Error ? error.message : error}`,
					)
					process.exit(1)
				}
			}
		}
	}

	if (options?.fromFile) {
		if (!existsSync(options.fromFile)) {
			console.error(
				`File ${chalk.cyan(options.fromFile)} does not exist. Please provide a valid file path.`,
			)
			process.exit(1)
		}

		const keyContent = await fs.readFile(options.fromFile, "utf-8")
		const passphraseProtected = isPassphraseProtected(keyContent)

		if (
			passphraseProtected &&
			process.env.DOTENC_PRIVATE_KEY_PASSPHRASE === undefined
		) {
			console.error(
				`${chalk.red("Error:")} the provided key is passphrase-protected. Set ${chalk.gray("DOTENC_PRIVATE_KEY_PASSPHRASE")} to use it, or provide a passwordless key.`,
			)
			process.exit(1)
		}

		if (passphraseProtected) {
			try {
				const privateKey = await parsePrivateKeyInput(
					keyContent,
					passphraseProtected,
				)
				publicKey = crypto.createPublicKey(privateKey)
			} catch {
				console.error(
					`${chalk.red("Error:")} failed to decrypt the provided key with ${chalk.gray("DOTENC_PRIVATE_KEY_PASSPHRASE")}. Please verify the passphrase.`,
				)
				process.exit(1)
			}
		} else {
			try {
				publicKey = crypto.createPublicKey(keyContent)
			} catch {
				try {
					const privateKey = await parsePrivateKeyInput(
						keyContent,
						passphraseProtected,
					)
					publicKey = crypto.createPublicKey(privateKey)
				} catch {
					const parsed = parseOpenSSHPrivateKey(keyContent)
					if (parsed) {
						publicKey = crypto.createPublicKey(parsed)
					} else {
						console.error(
							"Invalid key format. Please provide a valid PEM formatted public or private key.",
						)
						process.exit(1)
					}
				}
			}
		}
	}

	if (options?.fromString) {
		const passphraseProtected = isPassphraseProtected(options.fromString)
		if (
			passphraseProtected &&
			process.env.DOTENC_PRIVATE_KEY_PASSPHRASE === undefined
		) {
			console.error(
				`${chalk.red("Error:")} the provided key is passphrase-protected. Set ${chalk.gray("DOTENC_PRIVATE_KEY_PASSPHRASE")} to use it, or provide a passwordless key.`,
			)
			process.exit(1)
		}

		if (passphraseProtected) {
			try {
				const privateKey = await parsePrivateKeyInput(
					options.fromString,
					passphraseProtected,
				)
				publicKey = crypto.createPublicKey(privateKey)
			} catch {
				console.error(
					`${chalk.red("Error:")} failed to decrypt the provided key with ${chalk.gray("DOTENC_PRIVATE_KEY_PASSPHRASE")}. Please verify the passphrase.`,
				)
				process.exit(1)
			}
		} else {
			try {
				publicKey = crypto.createPublicKey(options.fromString)
			} catch {
				try {
					const privateKey = await parsePrivateKeyInput(
						options.fromString,
						passphraseProtected,
					)
					publicKey = crypto.createPublicKey(privateKey)
				} catch {
					const parsed = parseOpenSSHPrivateKey(options.fromString)
					if (parsed) {
						publicKey = crypto.createPublicKey(parsed)
					} else {
						console.error(
							"Invalid key format. Please provide a valid PEM formatted public or private key.",
						)
						process.exit(1)
					}
				}
			}
		}
	}

	if (options?.fromPrivateKey) {
		let selectedKey: Awaited<ReturnType<typeof choosePrivateKeyPrompt>>
		try {
			selectedKey = await choosePrivateKeyPrompt(
				"Which SSH key do you want to add?",
				{
					nonInteractiveHint: "--from-private-key <name>",
					preferredKeyName: options.fromPrivateKey,
				},
			)
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error))
			process.exit(1)
		}

		publicKey = crypto.createPublicKey(selectedKey.privateKey)
		if (!nameArg) {
			nameArg = selectedKey.name
		}
	}

	if (!publicKey) {
		const modePrompt = await prompt(
			{
				type: "list",
				name: "mode",
				message:
					"Would you like to add one of your SSH keys or paste a public key?",
				choices: [
					{ name: "Choose or create an SSH key", value: "choose" },
					{ name: "Paste a public key (PEM format)", value: "paste" },
				],
			},
			"No key source was provided in non-interactive mode. Use --from-private-key, --from-ssh, --from-file, or --from-string instead.",
		)

		if (modePrompt.mode === "paste") {
			const publicKeyInput = await inputKeyPrompt(
				"Please paste your public key (PEM format):",
			)

			if (!publicKeyInput) {
				console.error("No public key provided. Add operation cancelled.")
				process.exit(1)
			}

			try {
				publicKey = crypto.createPublicKey(publicKeyInput)
			} catch (error: unknown) {
				console.error(
					"Invalid public key format. Please provide a valid PEM formatted public key.",
				)
				console.error(
					`Details: ${error instanceof Error ? error.message : error}`,
				)
				process.exit(1)
			}
		} else {
			let selectedKey: Awaited<ReturnType<typeof choosePrivateKeyPrompt>>
			try {
				selectedKey = await choosePrivateKeyPrompt(
					"Which SSH key do you want to add?",
					{
						nonInteractiveHint: "--from-private-key <name>",
					},
				)
			} catch (error) {
				console.error(error instanceof Error ? error.message : String(error))
				process.exit(1)
			}

			publicKey = crypto.createPublicKey(selectedKey.privateKey)
			if (!nameArg) {
				nameArg = selectedKey.name
			}
		}
	}

	if (!publicKey) {
		console.error(
			"An unexpected error occurred. No public key was inferred from the provided input.",
		)
		process.exit(1)
	}

	const validation = validatePublicKey(publicKey)
	if (!validation.valid) {
		console.error(validation.reason)
		process.exit(1)
	}

	const publicKeyOutput = publicKey.export({
		type: "spki",
		format: "pem",
	})

	let projectRoot: string
	try {
		projectRoot = resolveProjectRoot(process.cwd(), existsSync)
	} catch {
		projectRoot = process.cwd()
	}
	const dotencDir = path.join(projectRoot, ".dotenc")

	if (!existsSync(dotencDir)) {
		await fs.mkdir(dotencDir)
	}

	let name = nameArg
	if (!name) {
		name = await inputNamePrompt(
			"What name do you want to give to the new public key?",
		)
	}

	const keyNameValidation = validateKeyName(name)
	if (!keyNameValidation.valid) {
		console.error(`${chalk.red("Error:")} ${keyNameValidation.reason}`)
		process.exit(1)
	}

	const keyOutputPath = path.join(dotencDir, `${name}.pub`)

	try {
		await fs.writeFile(keyOutputPath, publicKeyOutput, {
			encoding: "utf-8",
			flag: "wx",
		})
	} catch (error) {
		if (
			error instanceof Error &&
			(error as NodeJS.ErrnoException).code === "EEXIST"
		) {
			console.error(
				`A public key with name ${chalk.cyan(name)} already exists. Please choose a different name.`,
			)
			process.exit(1)
		}
		throw error
	}
	console.log(`\nPublic key ${chalk.cyan(name)} added successfully!`)
}
