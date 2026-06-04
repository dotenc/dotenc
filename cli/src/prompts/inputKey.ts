import { prompt } from "./prompt"

export const inputKeyPrompt = async (
	message: string,
	defaultValue?: string,
) => {
	const result = await prompt(
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
