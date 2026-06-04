import { getEnvironments } from "../helpers/getEnvironments"
import { promptSelect } from "../ui/prompts"
import { isInteractive } from "../ui/tty"

type ChooseEnvironmentPromptDeps = {
	getEnvironments: typeof getEnvironments
	promptSelect: typeof promptSelect
	isInteractive: typeof isInteractive
}

const defaultDeps: ChooseEnvironmentPromptDeps = {
	getEnvironments,
	promptSelect,
	isInteractive,
}

export const _runChooseEnvironmentPrompt = async (
	message: string,
	depsOverrides: Partial<ChooseEnvironmentPromptDeps> = {},
) => {
	const deps: ChooseEnvironmentPromptDeps = {
		...defaultDeps,
		...depsOverrides,
	}

	const environments = await deps.getEnvironments()

	if (!environments.length) {
		throw new Error(
			'No environment files found. To create a new environment, run "dotenc env create".',
		)
	}

	if (!deps.isInteractive()) {
		if (environments.length === 1) {
			return environments[0]
		}

		throw new Error(
			`Multiple environments found. Pass the environment name explicitly. Available environments: ${environments.join(", ")}`,
		)
	}

	return deps.promptSelect<string>(message, {
		options: environments,
	})
}

export const chooseEnvironmentPrompt = async (message: string) => {
	return _runChooseEnvironmentPrompt(message)
}
