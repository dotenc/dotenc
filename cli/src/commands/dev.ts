import chalk from "chalk"
import { createDecryptEnvironmentDataContext } from "../helpers/decryptEnvironment"
import {
	discoverLegacyProfile,
	discoverPersonalProfiles,
	discoverPossibleLegacyProfiles,
	type LegacyProfileCandidate,
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

const legacyRenameCommand = (candidate: LegacyProfileCandidate) =>
	candidate.name.startsWith("-")
		? `dotenc env rename${candidate.requiresAllLayers ? " --all-layers" : ""} -- ${candidate.name} personal.${candidate.name}`
		: `dotenc env rename ${candidate.name} personal.${candidate.name}${candidate.requiresAllLayers ? " --all-layers" : ""}`

const legacyProfileHint = (candidate: LegacyProfileCandidate) =>
	` A possible legacy personal environment following the old key-alias convention was found: ${candidate.name}. It was not loaded.`

const legacyRenameHint = (candidate: LegacyProfileCandidate) =>
	` Rename it with ${legacyRenameCommand(candidate)}.`

const warnAboutPossibleLegacyProfiles = (
	candidates: LegacyProfileCandidate[],
) => {
	if (candidates.length === 0) return
	const names = candidates.map((candidate) => candidate.name).join(", ")
	const renameCommands = candidates
		.map((candidate) => `- ${legacyRenameCommand(candidate)}`)
		.join("\n")
	console.error(
		`${chalk.yellow("Warning:")} possible legacy personal environments following the old key-alias convention were found: ${names}. None were loaded. Rename them explicitly:\n${renameCommands}`,
	)
}

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
				const namespacedProfileExists =
					discovery.discovered.includes(requestedEnvironment)
				const legacyCandidate = namespacedProfileExists
					? undefined
					: await discoverLegacyProfile(options.profile, {
							invocationDir: process.cwd(),
							localOnly: options.localOnly,
							decryptionContext,
						})
				const message = namespacedProfileExists
					? `personal profile ${options.profile} is not accessible`
					: `personal profile ${options.profile} was not found`
				const legacyHint = legacyCandidate
					? legacyProfileHint(legacyCandidate)
					: ""
				const renameHint = legacyCandidate
					? legacyRenameHint(legacyCandidate)
					: ""
				if (options.strict) {
					console.error(
						`${chalk.red("Error:")} ${message}.${legacyHint}${renameHint}`,
					)
					process.exit(1)
				}
				console.error(
					`${chalk.yellow("Warning:")} ${message}.${legacyHint} Continuing with development only.${renameHint}`,
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

		if (options.profile === undefined && selectedEnvironment === undefined) {
			const possibleLegacyProfiles = (
				await discoverPossibleLegacyProfiles({
					invocationDir: process.cwd(),
					localOnly: options.localOnly,
					decryptionContext,
				})
			).filter(
				(candidate) =>
					!discovery.discovered.includes(
						toPersonalEnvironmentName(candidate.name),
					),
			)
			warnAboutPossibleLegacyProfiles(possibleLegacyProfiles)
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
