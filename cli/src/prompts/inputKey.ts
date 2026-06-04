import { promptText } from "../ui/prompts"

export const _runInputKeyPrompt = async (
	message: string,
	defaultValue?: string,
	promptImpl: typeof promptText = promptText,
) => {
	return promptImpl(message, {
		default: defaultValue,
		nonInteractiveError:
			"No key content was provided in non-interactive mode. Pass --from-string, --from-file, or --from-ssh instead.",
	})
}

export const inputKeyPrompt = async (message: string, defaultValue?: string) =>
	_runInputKeyPrompt(message, defaultValue)
