import { promptText } from "../ui/prompts"

export const createEnvironmentPrompt = async (
	message: string,
	defaultValue?: string,
) => {
	return promptText(message, {
		default: defaultValue,
		nonInteractiveError:
			"No environment was provided in non-interactive mode. Pass the environment name explicitly.",
	})
}
