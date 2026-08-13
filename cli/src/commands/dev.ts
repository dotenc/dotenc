import chalk from "chalk"
import { createDecryptEnvironmentDataContext } from "../helpers/decryptEnvironment"
import {
	discoverPersonalProfiles,
	toPersonalEnvironmentName,
} from "../helpers/discoverPersonalProfiles"
import { validateEnvironmentName } from "../helpers/validateEnvironmentName"
import { promptSelect } from "../ui/prompts"
import { isInteractive } from "../ui/tty"
import { runCommand } from "./run"

type Options = {
	localOnly?: boolean
	profile?: string
	strict?: boolean
	allowProcessEnv?: string[]
}

const profileFromEnvironmentName = (environmentName: string) =>
	environmentName.slice("personal.".length)

export const devCommand = async (
	command: string,
	args: string[],
	options: Options = {},
) => {
	const decryptionContext = createDecryptEnvironmentDataContext()
	try {
		let discovery: Awaited<ReturnType<typeof discoverPersonalProfiles>>
		try {
			discovery = await discoverPersonalProfiles({
				invocationDir: process.cwd(),
				localOnly: options.localOnly,
				decryptionContext,
			})
		} catch (error) {
			console.error(
				error instanceof Error
					? error.message
					: "Failed to discover personal environments.",
			)
			process.exit(1)
		}

		let selectedEnvironment: string | undefined
		if (options.profile !== undefined) {
			const requestedEnvironment = toPersonalEnvironmentName(options.profile)
			const validation = validateEnvironmentName(requestedEnvironment)
			if (!options.profile || !validation.valid) {
				console.error(
					`${chalk.red("Error:")} invalid personal profile ${chalk.cyan(options.profile)}.`,
				)
				process.exit(1)
			}

			if (discovery.accessible.includes(requestedEnvironment)) {
				selectedEnvironment = requestedEnvironment
			} else {
				const message = discovery.discovered.includes(requestedEnvironment)
					? `personal profile ${options.profile} is not accessible`
					: `personal profile ${options.profile} was not found`
				if (options.strict) {
					console.error(`${chalk.red("Error:")} ${message}.`)
					process.exit(1)
				}
				console.error(
					`${chalk.yellow("Warning:")} ${message}; continuing with development only.`,
				)
			}
		} else if (discovery.accessible.length === 1) {
			selectedEnvironment = discovery.accessible[0]
		} else if (discovery.accessible.length > 1) {
			const profiles = discovery.accessible.map(profileFromEnvironmentName)
			if (!isInteractive()) {
				console.error(
					`${chalk.red("Error:")} multiple personal profiles are accessible. Pass ${chalk.gray("--profile <name>")} to choose one. Available profiles: ${profiles.join(", ")}`,
				)
				process.exit(1)
			}

			const selectedProfile = await promptSelect(
				"Multiple personal profiles are accessible. Which one do you want to use?",
				{
					options: profiles.map((profile) => ({
						label: profile,
						value: profile,
					})),
				},
			)
			selectedEnvironment = toPersonalEnvironmentName(selectedProfile)
		} else if (discovery.discovered.length > 0) {
			const message = `no accessible personal profiles were found (${discovery.discovered.map(profileFromEnvironmentName).join(", ")})`
			if (options.strict) {
				console.error(`${chalk.red("Error:")} ${message}.`)
				process.exit(1)
			}
			console.error(
				`${chalk.yellow("Warning:")} ${message}; continuing with development only.`,
			)
		}

		await runCommand(command, args, {
			env: selectedEnvironment
				? `development,${selectedEnvironment}`
				: "development",
			localOnly: options.localOnly,
			strict: options.strict,
			allowProcessEnv: options.allowProcessEnv,
			requiredEnvs: ["development"],
			decryptionContext,
		})
	} finally {
		decryptionContext.dispose()
	}
}
