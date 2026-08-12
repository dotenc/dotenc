import os from "node:os"
import path from "node:path"
import chalk from "chalk"
import { createEd25519SshKey } from "../helpers/createEd25519SshKey"
import { createPasswordlessSshKeyCopy } from "../helpers/createPasswordlessSshKeyCopy"
import { passphraseProtectedKeyError } from "../helpers/errors"
import {
	type GetKeyCandidatesResult,
	getKeyCandidates,
} from "../helpers/getKeyCandidates"
import type { KeyCandidate } from "../helpers/keyCandidate"
import { logger } from "../ui/logger"
import {
	type GroupedSelectOption,
	promptConfirm,
	promptGroupedSelect,
	runWithGroupedSpinner,
} from "../ui/prompts"
import { isInteractive } from "../ui/tty"
import { CREATE_NEW_PRIVATE_KEY_CHOICE } from "./choosePrivateKey"

const PASSPHRASE_CHOICE_PREFIX = "__dotenc_passphrase_protected_key__:"
const ONE_PASSWORD_CHOICE = "__dotenc_one_password__"

function isEnvironmentKeyName(name: string): boolean {
	return name.startsWith("env.")
}

type ChooseKeyCandidateOptions = {
	nonInteractiveHint?: string
	preferredKeyName?: string
}

type ChooseKeyCandidateDeps = {
	getKeyCandidates: typeof getKeyCandidates
	promptConfirm: typeof promptConfirm
	promptGroupedSelect: typeof promptGroupedSelect
	runWithGroupedSpinner: typeof runWithGroupedSpinner
	createEd25519SshKey: typeof createEd25519SshKey
	createPasswordlessSshKeyCopy: typeof createPasswordlessSshKeyCopy
	homedir: typeof os.homedir
	isInteractive: typeof isInteractive
	logInfo: (message: string) => void
	logWarn: (message: string) => void
}

const defaultDeps: ChooseKeyCandidateDeps = {
	getKeyCandidates,
	promptConfirm,
	promptGroupedSelect,
	runWithGroupedSpinner,
	createEd25519SshKey,
	createPasswordlessSshKeyCopy,
	homedir: os.homedir,
	isInteractive,
	logInfo: (message) => logger.info(message),
	logWarn: (message) => logger.warn(message),
}

function unsupportedSummary(
	keys: NonNullable<GetKeyCandidatesResult["unsupportedKeys"]>,
): string {
	return keys.map((key) => `  - ${key.name}: ${key.reason}`).join("\n")
}

function selectPreferred(
	preferred: string,
	result: GetKeyCandidatesResult,
): KeyCandidate | undefined {
	const exact = result.keys.find((key) => key.selector === preferred)
	if (exact) return exact

	if (result.passphraseProtectedKeys.includes(preferred)) {
		throw new Error(passphraseProtectedKeyError([preferred]))
	}

	const titleMatches = result.keys.filter(
		(key) => key.source === "1password" && key.name === preferred,
	)
	if (titleMatches.length === 1) return titleMatches[0]
	if (titleMatches.length > 1) {
		throw new Error(
			`SSH key ${chalk.cyan(preferred)} is ambiguous. Use one of these qualified selectors:\n${titleMatches.map((key) => `  ${key.selector}`).join("\n")}`,
		)
	}

	const unsupported = (result.unsupportedKeys ?? []).find(
		(key) => key.name === preferred,
	)
	if (unsupported) {
		throw new Error(
			`SSH key ${chalk.cyan(preferred)} is not supported: ${unsupported.reason}.`,
		)
	}
	if (result.onePassword.status === "not-requested") return undefined

	const availableLocalKeys = result.keys
		.filter((key) => key.source !== "1password")
		.map((key) => key.selector)
	const providerCount = result.keys.filter(
		(key) => key.source === "1password",
	).length
	const available = [
		...availableLocalKeys,
		...(providerCount > 0 ? [`${providerCount} 1Password key(s)`] : []),
	]
	throw new Error(
		available.length
			? `SSH key ${chalk.cyan(preferred)} was not found. Available keys: ${available.join(", ")}`
			: `SSH key ${chalk.cyan(preferred)} was not found.`,
	)
}

function promptOptions(
	result: GetKeyCandidatesResult,
): GroupedSelectOption<string>[] {
	const environmentKeys = result.keys.filter(
		(key) => key.source === "environment",
	)
	const filesystemKeys = result.keys.filter(
		(key) => key.source === "filesystem",
	)
	const onePasswordKeys = result.keys.filter(
		(key) => key.source === "1password",
	)
	const filesystemPassphraseKeys = result.passphraseProtectedKeys.filter(
		(name) => !isEnvironmentKeyName(name),
	)
	const toOption = (key: KeyCandidate) => ({
		group: key.group.label,
		label: key.name,
		hint: key.hint,
		value: key.selector,
	})
	return [
		...environmentKeys.map(toOption),
		...filesystemKeys.map(toOption),
		...filesystemPassphraseKeys.map((name) => ({
			group: "Local - ~/.ssh",
			label: name,
			hint: "passphrase-protected",
			value: `${PASSPHRASE_CHOICE_PREFIX}${name}`,
		})),
		...onePasswordKeys.map(toOption),
		...(result.onePassword.status === "not-requested"
			? [
					{
						group: "Actions",
						label: "Use a key from 1Password",
						hint: "load available SSH keys",
						value: ONE_PASSWORD_CHOICE,
					},
				]
			: []),
		{
			group: "Actions",
			label: "Create a new SSH key",
			hint: "ed25519, recommended",
			value: CREATE_NEW_PRIVATE_KEY_CHOICE,
		},
	]
}

function logDiscoveryWarnings(
	result: GetKeyCandidatesResult,
	logWarn: (message: string) => void,
) {
	const passphraseProtectedKeySet = new Set(result.passphraseProtectedKeys)
	const unsupportedKeys = (result.unsupportedKeys ?? []).filter(
		(key) => !passphraseProtectedKeySet.has(key.name),
	)
	const environmentPassphraseKeys =
		result.passphraseProtectedKeys.filter(isEnvironmentKeyName)
	if (environmentPassphraseKeys.length > 0) {
		logWarn(passphraseProtectedKeyError(environmentPassphraseKeys))
	}
	if (unsupportedKeys.length > 0) {
		logWarn(
			`${chalk.yellow("Warning:")} unsupported SSH keys will be ignored:\n${unsupportedSummary(unsupportedKeys)}`,
		)
	}
	for (const account of result.onePassword.unavailableAccounts) {
		logWarn(
			`${chalk.yellow("Warning:")} ${account.label} was unavailable (${account.reason}).`,
		)
	}
	if (result.onePassword.status === "unavailable") {
		logWarn(
			`${chalk.yellow("Warning:")} the installed 1Password CLI was unavailable.`,
		)
	}
	if (result.onePassword.status === "not-installed") {
		logWarn(`${chalk.yellow("Warning:")} the 1Password CLI is not installed.`)
	}
	if (result.onePassword.status === "no-accounts") {
		logWarn(
			`${chalk.yellow("Warning:")} no configured 1Password accounts were found.`,
		)
	}
	if (result.onePassword.status === "unsupported-version") {
		logWarn(
			`${chalk.yellow("Warning:")} the installed 1Password CLI version is unsupported; dotenc requires op 2.x.`,
		)
	}
}

export async function _runChooseKeyCandidatePrompt(
	message: string,
	deps: ChooseKeyCandidateDeps = defaultDeps,
	options: ChooseKeyCandidateOptions = {},
): Promise<KeyCandidate> {
	let autoSelectName: string | undefined
	const interactive = deps.isInteractive()
	let result = await deps.getKeyCandidates({
		includeOnePassword:
			options.preferredKeyName?.startsWith("1password:") === true,
	})
	const loggedWarnings = new Set<string>()
	const logWarnOnce = (warning: string) => {
		if (loggedWarnings.has(warning)) return
		loggedWarnings.add(warning)
		deps.logWarn(warning)
	}

	for (;;) {
		if (options.preferredKeyName) {
			const selected = selectPreferred(options.preferredKeyName, result)
			if (selected) return selected
			result = await deps.runWithGroupedSpinner(
				"1Password",
				"Loading SSH keys...",
				() => deps.getKeyCandidates({ includeOnePassword: true }),
			)
			continue
		}
		if (autoSelectName) {
			const created = result.keys.find(
				(key) => key.source === "filesystem" && key.name === autoSelectName,
			)
			if (created) return created
			autoSelectName = undefined
		}

		if (!interactive) {
			if (result.keys.length === 1) return result.keys[0]
			if (result.keys.length > 1) {
				throw new Error(
					`Multiple supported SSH keys found: ${result.keys.map((key) => key.selector).join(", ")}\n\nPass ${options.nonInteractiveHint ?? "--private-key <name>"} to choose which key to use.`,
				)
			}
			if (result.onePassword.status === "not-requested") {
				result = await deps.getKeyCandidates({ includeOnePassword: true })
				continue
			}
			if (result.passphraseProtectedKeys.length > 0) {
				throw new Error(
					passphraseProtectedKeyError(result.passphraseProtectedKeys),
				)
			}
			if (result.onePassword.status === "unsupported-version") {
				throw new Error(
					"The installed 1Password CLI version is unsupported. dotenc requires op 2.x.",
				)
			}
			if ((result.unsupportedKeys ?? []).length > 0) {
				throw new Error(
					`No supported SSH keys found.\n\nUnsupported keys:\n${unsupportedSummary(result.unsupportedKeys ?? [])}\n\nGenerate a new key with:\n  ssh-keygen -t ed25519 -N ""`,
				)
			}
			throw new Error(
				result.onePassword.status === "no-accounts"
					? 'No SSH keys found in ~/.ssh/ or configured 1Password accounts. Generate one with: ssh-keygen -t ed25519 -N ""'
					: 'No SSH keys found in ~/.ssh/. Generate one with: ssh-keygen -t ed25519 -N ""',
			)
		}

		logDiscoveryWarnings(result, logWarnOnce)
		const selected = await deps.promptGroupedSelect<string>(message, {
			options: promptOptions(result),
		})

		if (selected === ONE_PASSWORD_CHOICE) {
			result = await deps.runWithGroupedSpinner(
				"1Password",
				"Loading SSH keys...",
				() => deps.getKeyCandidates({ includeOnePassword: true }),
			)
			continue
		}

		if (selected === CREATE_NEW_PRIVATE_KEY_CHOICE) {
			try {
				const createdPath = await deps.createEd25519SshKey()
				autoSelectName = path.basename(createdPath)
				deps.logInfo(
					`${chalk.green("✔")} Created ${chalk.cyan(autoSelectName)} at ${chalk.gray(createdPath)}.`,
				)
			} catch (error) {
				deps.logWarn(
					`${chalk.yellow("Warning:")} failed to create a new SSH key. ${error instanceof Error ? error.message : String(error)}`,
				)
			}
			result = await deps.getKeyCandidates({
				includeOnePassword: result.onePassword.status !== "not-requested",
			})
			continue
		}

		if (selected.startsWith(PASSPHRASE_CHOICE_PREFIX)) {
			const name = selected.slice(PASSPHRASE_CHOICE_PREFIX.length)
			if (
				isEnvironmentKeyName(name) ||
				!result.passphraseProtectedKeys.includes(name)
			) {
				deps.logWarn(passphraseProtectedKeyError([name]))
				continue
			}
			const confirmed = await deps.promptConfirm(
				"Create a passwordless copy of this key now? (optional if DOTENC_PRIVATE_KEY_PASSPHRASE is set)",
				{ initial: true },
			)
			if (!confirmed) continue
			try {
				const created = await deps.createPasswordlessSshKeyCopy(
					path.join(deps.homedir(), ".ssh", name),
				)
				autoSelectName = created.name
				result = await deps.getKeyCandidates({
					includeOnePassword: result.onePassword.status !== "not-requested",
				})
			} catch (error) {
				deps.logWarn(
					`${chalk.yellow("Warning:")} failed to create a passwordless SSH key copy. ${error instanceof Error ? error.message : String(error)}`,
				)
			}
			continue
		}

		const candidate = result.keys.find((key) => key.selector === selected)
		if (candidate) return candidate
	}
}

export const chooseKeyCandidatePrompt = (
	message: string,
	options: ChooseKeyCandidateOptions = {},
) => _runChooseKeyCandidatePrompt(message, defaultDeps, options)
