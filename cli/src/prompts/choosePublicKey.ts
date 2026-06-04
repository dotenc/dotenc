import { getPublicKeys } from "../helpers/getPublicKeys"
import { promptMultiSelect, promptSelect } from "../ui/prompts"
import { isInteractive } from "../ui/tty"

type ChoosePublicKeyPromptDeps = {
	getPublicKeys: typeof getPublicKeys
	isInteractive: typeof isInteractive
	promptSelect: typeof promptSelect
	promptMultiSelect: typeof promptMultiSelect
}

const defaultDeps: ChoosePublicKeyPromptDeps = {
	getPublicKeys,
	isInteractive,
	promptSelect,
	promptMultiSelect,
}

export async function _runChoosePublicKeyPrompt(
	message: string,
	multiple: true,
	depsOverrides?: Partial<ChoosePublicKeyPromptDeps>,
): Promise<string[]>
export async function _runChoosePublicKeyPrompt(
	message: string,
	multiple?: false,
	depsOverrides?: Partial<ChoosePublicKeyPromptDeps>,
): Promise<string>
export async function _runChoosePublicKeyPrompt(
	message: string,
	multiple?: boolean,
	depsOverrides: Partial<ChoosePublicKeyPromptDeps> = {},
): Promise<string | string[]> {
	const deps: ChoosePublicKeyPromptDeps = {
		...defaultDeps,
		...depsOverrides,
	}

	const publicKeys = (await deps.getPublicKeys()).map((key) =>
		key.name.replace(".pub", ""),
	)

	if (publicKeys.length === 0) {
		throw new Error(
			'No public keys found. Add one with "dotenc key add" before continuing.',
		)
	}

	if (!multiple) {
		if (publicKeys.length === 1) {
			return publicKeys[0]
		}

		if (!deps.isInteractive()) {
			throw new Error(
				`Multiple public keys found. Pass the public key name explicitly. Available public keys: ${publicKeys.join(", ")}`,
			)
		}

		return deps.promptSelect(message, {
			options: publicKeys,
		})
	}

	if (!deps.isInteractive()) {
		throw new Error(
			`Multiple public key selection is not available in non-interactive mode. Pass one or more --public-key values instead. Available public keys: ${publicKeys.join(", ")}`,
		)
	}

	return deps.promptMultiSelect(message, {
		options: publicKeys,
		required: true,
	})
}

export async function choosePublicKeyPrompt(
	message: string,
	multiple: true,
): Promise<string[]>
export async function choosePublicKeyPrompt(
	message: string,
	multiple?: false,
): Promise<string>
export async function choosePublicKeyPrompt(
	message: string,
	multiple?: boolean,
): Promise<string | string[]> {
	if (multiple) {
		return _runChoosePublicKeyPrompt(message, true)
	}
	return _runChoosePublicKeyPrompt(message, false)
}
