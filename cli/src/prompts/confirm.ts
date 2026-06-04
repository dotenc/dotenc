import { promptConfirm } from "../ui/prompts"

export const confirmPrompt = async (message: string) => {
	return promptConfirm(message, {
		nonInteractiveError:
			"Confirmation is required in non-interactive mode. Re-run with --yes to continue.",
	})
}
