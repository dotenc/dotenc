import { promptText } from "../ui/prompts"

export const inputNamePrompt = async (
	message: string,
	defaultValue?: string,
) => {
	const result = await promptText(message, {
		default: defaultValue,
		nonInteractiveError:
			"No name was provided in non-interactive mode. Pass --name <name> instead.",
	})

	return (
		result
			// allow only alphanumeric characters, underscores, and hyphens
			.replace(/[^a-zA-Z0-9_-]/g, "")
			// remove leading and trailing whitespace
			.trim()
			.toLocaleLowerCase()
	)
}
