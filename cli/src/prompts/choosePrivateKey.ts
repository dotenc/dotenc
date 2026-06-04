import crypto from "node:crypto"
import os from "node:os"
import path from "node:path"
import chalk from "chalk"
import { createEd25519SshKey } from "../helpers/createEd25519SshKey"
import { createPasswordlessSshKeyCopy } from "../helpers/createPasswordlessSshKeyCopy"
import { passphraseProtectedKeyError } from "../helpers/errors"
import {
	getPrivateKeys,
	type PrivateKeyEntry,
	type UnsupportedPrivateKeyEntry,
} from "../helpers/getPrivateKeys"
import { validatePublicKey } from "../helpers/validatePublicKey"
import { logger } from "../ui/logger"
import { isInteractive } from "../ui/tty"
import { type GuardedPrompt, prompt } from "./prompt"

export const CREATE_NEW_PRIVATE_KEY_CHOICE = "__dotenc_create_new_private_key__"
const PASSPHRASE_PROTECTED_KEY_CHOICE_PREFIX =
	"__dotenc_passphrase_protected_key__:"

type PromptChoice = {
	name: string
	value: string
	disabled?: boolean
}

type ChoosePrivateKeyPromptDeps = {
	getPrivateKeys: typeof getPrivateKeys
	prompt: GuardedPrompt
	createEd25519SshKey: typeof createEd25519SshKey
	createPasswordlessSshKeyCopy: typeof createPasswordlessSshKeyCopy
	homedir: typeof os.homedir
	logInfo: (message: string) => void
	logWarn: (message: string) => void
	isInteractive: () => boolean
}

type ChoosePrivateKeyPromptOptions = {
	nonInteractiveHint?: string
	preferredKeyName?: string
}

const defaultChoosePrivateKeyPromptDeps: ChoosePrivateKeyPromptDeps = {
	getPrivateKeys,
	prompt,
	createEd25519SshKey,
	createPasswordlessSshKeyCopy,
	homedir: os.homedir,
	logInfo: (message) => logger.info(message),
	logWarn: (message) => logger.warn(message),
	isInteractive,
}

function toSupportedChoice(key: PrivateKeyEntry): PromptChoice {
	return {
		name: `${key.name} (${key.algorithm})`,
		value: key.name,
	}
}

function toUnsupportedChoice(
	key: UnsupportedPrivateKeyEntry,
	index: number,
): PromptChoice {
	return {
		name: `${chalk.gray(key.name)} (${chalk.yellow(key.reason)})`,
		value: `__unsupported_${index}__`,
		disabled: true,
	}
}

function toPassphraseChoice(name: string): PromptChoice {
	return {
		name: `${chalk.yellow(name)} (${chalk.yellow("passphrase-protected")})`,
		value: `${PASSPHRASE_PROTECTED_KEY_CHOICE_PREFIX}${name}`,
	}
}

const buildPromptChoices = (
	keys: PrivateKeyEntry[],
	passphraseProtectedKeys: string[],
	unsupportedKeys: UnsupportedPrivateKeyEntry[],
): PromptChoice[] => {
	const choices: PromptChoice[] = keys.map(toSupportedChoice)

	if (passphraseProtectedKeys.length > 0 || unsupportedKeys.length > 0) {
		if (choices.length > 0) {
			choices.push({
				name: chalk.gray("────────"),
				value: "__separator_supported_unsupported__",
				disabled: true,
			})
		}

		if (passphraseProtectedKeys.length > 0) {
			choices.push({
				name: chalk.gray(
					"Passphrase-protected keys (set DOTENC_PRIVATE_KEY_PASSPHRASE or create a passwordless copy)",
				),
				value: "__passphrase_protected_header__",
				disabled: true,
			})

			choices.push(...passphraseProtectedKeys.map(toPassphraseChoice))
		}

		if (unsupportedKeys.length > 0) {
			if (passphraseProtectedKeys.length > 0) {
				choices.push({
					name: chalk.gray("────────"),
					value: "__separator_passphrase_unsupported__",
					disabled: true,
				})
			}

			choices.push({
				name: chalk.gray("Unsupported keys (ignored)"),
				value: "__unsupported_header__",
				disabled: true,
			})

			choices.push(...unsupportedKeys.map(toUnsupportedChoice))
		}
	}

	if (choices.length > 0) {
		choices.push({
			name: chalk.gray("────────"),
			value: "__separator_create__",
			disabled: true,
		})
	}

	choices.push({
		name: "Create a new SSH key (ed25519, recommended)",
		value: CREATE_NEW_PRIVATE_KEY_CHOICE,
	})

	return choices
}

function classifySupportedKeys(keys: PrivateKeyEntry[]): {
	supportedKeys: PrivateKeyEntry[]
	policyUnsupportedKeys: UnsupportedPrivateKeyEntry[]
} {
	const supportedKeys: PrivateKeyEntry[] = []
	const policyUnsupportedKeys: UnsupportedPrivateKeyEntry[] = []

	for (const key of keys) {
		try {
			const publicKey = crypto.createPublicKey(key.privateKey)
			const validation = validatePublicKey(publicKey)
			if (!validation.valid) {
				policyUnsupportedKeys.push({
					name: key.name,
					reason: validation.reason,
				})
				continue
			}
		} catch {
			policyUnsupportedKeys.push({
				name: key.name,
				reason: "invalid private key format",
			})
			continue
		}

		supportedKeys.push(key)
	}

	return { supportedKeys, policyUnsupportedKeys }
}

const describeNonInteractivePrivateKeySelectionError = (
	supportedKeys: PrivateKeyEntry[],
	hint: string,
) =>
	`Multiple supported SSH keys found: ${supportedKeys.map((key) => key.name).join(", ")}\n\nPass ${hint} to choose which key to use.`

const selectPreferredPrivateKey = (
	preferredKeyName: string,
	supportedKeys: PrivateKeyEntry[],
	passphraseProtectedKeys: string[],
	unsupportedKeys: UnsupportedPrivateKeyEntry[],
): PrivateKeyEntry => {
	const supportedKey = supportedKeys.find(
		(key) => key.name === preferredKeyName,
	)

	if (supportedKey) {
		return supportedKey
	}

	if (passphraseProtectedKeys.includes(preferredKeyName)) {
		throw new Error(passphraseProtectedKeyError([preferredKeyName]))
	}

	const unsupportedKey = unsupportedKeys.find(
		(key) => key.name === preferredKeyName,
	)
	if (unsupportedKey) {
		throw new Error(
			`SSH key ${chalk.cyan(preferredKeyName)} is not supported: ${unsupportedKey.reason}.`,
		)
	}

	const availableKeys = supportedKeys.map((key) => key.name)
	throw new Error(
		availableKeys.length > 0
			? `SSH key ${chalk.cyan(preferredKeyName)} was not found. Available keys: ${availableKeys.join(", ")}`
			: `SSH key ${chalk.cyan(preferredKeyName)} was not found.`,
	)
}

export const _runChoosePrivateKeyPrompt = async (
	message: string,
	deps: ChoosePrivateKeyPromptDeps = defaultChoosePrivateKeyPromptDeps,
	options: ChoosePrivateKeyPromptOptions = {},
): Promise<PrivateKeyEntry> => {
	let autoSelectKeyName: string | undefined

	for (;;) {
		const {
			keys,
			passphraseProtectedKeys,
			unsupportedKeys = [],
		} = await deps.getPrivateKeys()
		const { supportedKeys, policyUnsupportedKeys } = classifySupportedKeys(keys)
		const allUnsupportedKeys = [...unsupportedKeys, ...policyUnsupportedKeys]
		const passphraseProtectedKeySet = new Set(passphraseProtectedKeys)
		const promptUnsupportedKeys = allUnsupportedKeys.filter(
			(key) => !passphraseProtectedKeySet.has(key.name),
		)
		const privateKeyMap = new Map(supportedKeys.map((key) => [key.name, key]))

		if (options.preferredKeyName) {
			return selectPreferredPrivateKey(
				options.preferredKeyName,
				supportedKeys,
				passphraseProtectedKeys,
				allUnsupportedKeys,
			)
		}

		if (autoSelectKeyName) {
			const autoSelectedKey = privateKeyMap.get(autoSelectKeyName)
			if (autoSelectedKey) {
				return autoSelectedKey
			}

			deps.logWarn(
				`${chalk.yellow("Warning:")} created key ${chalk.cyan(autoSelectKeyName)} was not found in ~/.ssh.`,
			)
			autoSelectKeyName = undefined
		}

		if (!deps.isInteractive()) {
			if (supportedKeys.length === 1) {
				return supportedKeys[0]
			}

			if (supportedKeys.length > 1) {
				throw new Error(
					describeNonInteractivePrivateKeySelectionError(
						supportedKeys,
						options.nonInteractiveHint ?? "--private-key <name>",
					),
				)
			}

			if (passphraseProtectedKeys.length > 0) {
				throw new Error(passphraseProtectedKeyError(passphraseProtectedKeys))
			}

			if (allUnsupportedKeys.length > 0) {
				const unsupportedList = allUnsupportedKeys
					.map((key) => `  - ${key.name}: ${key.reason}`)
					.join("\n")
				throw new Error(
					`No supported SSH keys found.\n\nUnsupported keys:\n${unsupportedList}\n\nGenerate a new key with:\n  ssh-keygen -t ed25519 -N ""`,
				)
			}

			throw new Error(
				'No SSH keys found in ~/.ssh/. Generate one with: ssh-keygen -t ed25519 -N ""',
			)
		}

		const result = await deps.prompt([
			{
				type: "list",
				name: "key",
				message,
				choices: buildPromptChoices(
					supportedKeys,
					passphraseProtectedKeys,
					promptUnsupportedKeys,
				),
			},
		])

		const selected = String(result.key || "")

		if (selected === CREATE_NEW_PRIVATE_KEY_CHOICE) {
			try {
				const createdPath = await deps.createEd25519SshKey()
				deps.logInfo(
					`${chalk.green("✔")} Created ${chalk.cyan(path.basename(createdPath))} at ${chalk.gray(createdPath)}.`,
				)
			} catch (error) {
				deps.logWarn(
					`${chalk.yellow("Warning:")} failed to create a new SSH key. ${error instanceof Error ? error.message : String(error)}`,
				)
			}
			continue
		}

		if (selected.startsWith(PASSPHRASE_PROTECTED_KEY_CHOICE_PREFIX)) {
			const selectedPassphraseKey = selected.slice(
				PASSPHRASE_PROTECTED_KEY_CHOICE_PREFIX.length,
			)

			deps.logInfo(
				`${chalk.yellow("Info:")} ${chalk.cyan(selectedPassphraseKey)} is passphrase-protected. You can set ${chalk.gray("DOTENC_PRIVATE_KEY_PASSPHRASE")} to use it directly, or create a passwordless copy.`,
			)

			const confirmation = await deps.prompt([
				{
					type: "confirm",
					name: "shouldCreatePasswordlessCopy",
					message:
						"Create a passwordless copy of this key now? (optional if DOTENC_PRIVATE_KEY_PASSPHRASE is set)",
					default: true,
				},
			])

			if (!confirmation.shouldCreatePasswordlessCopy) {
				continue
			}

			try {
				const selectedPassphraseKeyPath = path.join(
					deps.homedir(),
					".ssh",
					selectedPassphraseKey,
				)
				const createdCopy = await deps.createPasswordlessSshKeyCopy(
					selectedPassphraseKeyPath,
				)
				deps.logInfo(
					`${chalk.green("✔")} Created ${chalk.cyan(createdCopy.name)} at ${chalk.gray(createdCopy.path)}.`,
				)
				autoSelectKeyName = createdCopy.name
			} catch (error) {
				deps.logWarn(
					`${chalk.yellow("Warning:")} failed to create a passwordless SSH key copy. ${error instanceof Error ? error.message : String(error)}`,
				)
			}

			continue
		}

		const selectedKey = privateKeyMap.get(selected)
		if (selectedKey) {
			return selectedKey
		}
	}
}

export const choosePrivateKeyPrompt = async (
	message: string,
	options: ChoosePrivateKeyPromptOptions = {},
) =>
	_runChoosePrivateKeyPrompt(
		message,
		defaultChoosePrivateKeyPromptDeps,
		options,
	)
