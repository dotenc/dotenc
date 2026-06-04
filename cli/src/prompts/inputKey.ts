import { type GuardedPrompt, prompt } from "./prompt"

export const _runInputKeyPrompt = async (
	message: string,
	defaultValue?: string,
	promptImpl: GuardedPrompt = prompt,
) => {
	const result = await promptImpl(
		[
			{
				type: "password",
				name: "key",
				mask: "*",
				message,
				default: defaultValue,
			},
		],
		"No key content was provided in non-interactive mode. Pass --from-string, --from-file, or --from-ssh instead.",
	)

	return result.key as string
}

export const inputKeyPrompt = async (message: string, defaultValue?: string) =>
	_runInputKeyPrompt(message, defaultValue)
