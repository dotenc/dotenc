import chalk from "chalk"
import { getCurrentKeyName } from "../helpers/getCurrentKeyName"
import { promptSelect } from "../ui/prompts"
import { isInteractive } from "../ui/tty"
import { runCommand } from "./run"

export const devCommand = async (
	command: string,
	args: string[],
	options: { localOnly?: boolean; identity?: string } = {},
) => {
	const keyNames = await getCurrentKeyName()

	if (keyNames.length === 0) {
		console.error(
			`${chalk.red("Error:")} could not resolve your identity. Run ${chalk.gray("dotenc init")} first.`,
		)
		process.exit(1)
	}

	let keyName: string

	if (options.identity) {
		if (!keyNames.includes(options.identity)) {
			console.error(
				`${chalk.red("Error:")} identity ${chalk.cyan(options.identity)} was not found. Available identities: ${keyNames.join(", ")}`,
			)
			process.exit(1)
		}
		keyName = options.identity
	} else if (keyNames.length === 1) {
		keyName = keyNames[0]
	} else {
		if (!isInteractive()) {
			console.error(
				`${chalk.red("Error:")} multiple identities found. Pass ${chalk.gray("--identity <name>")} to choose one. Available identities: ${keyNames.join(", ")}`,
			)
			process.exit(1)
		}

		keyName = await promptSelect(
			"Multiple identities found. Which one do you want to use?",
			{
				options: keyNames.map((name) => ({ label: name, value: name })),
			},
		)
	}

	await runCommand(command, args, {
		env: `development,${keyName}`,
		localOnly: options.localOnly,
	})
}
