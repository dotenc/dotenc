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
import { promptConfirm, promptSelect } from "../ui/prompts"
import { isInteractive } from "../ui/tty"

export const CREATE_NEW_PRIVATE_KEY_CHOICE = "__dotenc_create_new_private_key__"
const PASSPHRASE_PROTECTED_KEY_CHOICE_PREFIX =
	"__dotenc_passphrase_protected_key__:"

type PromptOption = {
	hint?: string
	label: string
	value: string
}

type ChoosePrivateKeyPromptDeps = {
	getPrivateKeys: typeof getPrivateKeys
	promptConfirm: typeof promptConfirm
	promptSelect: typeof promptSelect
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
	promptConfirm,
	promptSelect,
	createEd25519SshKey,
	createPasswordlessSshKeyCopy,
	homedir: os.homedir,
	logInfo: (message) => logger.info(message),
	logWarn: (message) => logger.warn(message),
	isInteractive,
}

function toSupportedOption(key: PrivateKeyEntry): PromptOption {
	return {
		hint: key.algorithm,
		label: key.name,
		value: key.name,
	}
}

function toPassphraseOption(name: string): PromptOption {
	return {
		hint: "passphrase-protected",
		label: name,
		value: `${PASSPHRASE_PROTECTED_KEY_CHOICE_PREFIX}${name}`,
	}
}

const buildPromptOptions = (
	keys: PrivateKeyEntry[],
	passphraseProtectedKeys: string[],
): PromptOption[] => [
	...keys.map(toSupportedOption),
	...passphraseProtectedKeys.map(toPassphraseOption),
	{
		hint: "ed25519, recommended",
		label: "Create a new SSH key",
		value: CREATE_NEW_PRIVATE_KEY_CHOICE,
	},
]

const formatUnsupportedKeys = (keys: UnsupportedPrivateKeyEntry[]) =>
	keys.map((key) => `  - ${key.name}: ${key.reason}`).join("\n")

const logUnsupportedKeys = (
	keys: UnsupportedPrivateKeyEntry[],
	logWarn: (message: string) => void,
) => {
	if (keys.length === 0) {
		return
	}

	logWarn(
		`${chalk.yellow("Warning:")} unsupported SSH keys will be ignored:\n${formatUnsupportedKeys(keys)}`,
	)
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
				throw new Error(
					`No supported SSH keys found.\n\nUnsupported keys:\n${formatUnsupportedKeys(allUnsupportedKeys)}\n\nGenerate a new key with:\n  ssh-keygen -t ed25519 -N ""`,
				)
			}

			throw new Error(
				'No SSH keys found in ~/.ssh/. Generate one with: ssh-keygen -t ed25519 -N ""',
			)
		}

		logUnsupportedKeys(promptUnsupportedKeys, deps.logWarn)

		const selected = await deps.promptSelect<string>(message, {
			options: buildPromptOptions(supportedKeys, passphraseProtectedKeys),
		})

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

			const shouldCreatePasswordlessCopy = await deps.promptConfirm(
				"Create a passwordless copy of this key now? (optional if DOTENC_PRIVATE_KEY_PASSPHRASE is set)",
				{
					initial: true,
				},
			)

			if (!shouldCreatePasswordlessCopy) {
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
