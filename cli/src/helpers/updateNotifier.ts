import chalk from "chalk"
import { box } from "consola/utils"
import pkg from "../../package.json"
import { logger } from "../ui/logger"
import { getHomeConfig, setHomeConfig } from "./homeConfig"
import { fetchLatestVersion, isVersionNewer } from "./update"

type HomeConfig = Awaited<ReturnType<typeof getHomeConfig>>

type UpdateNotifierDeps = {
	getHomeConfig: typeof getHomeConfig
	setHomeConfig: typeof setHomeConfig
	fetchLatestVersion: typeof fetchLatestVersion
	currentVersion: string
	log: (message: string) => void
	args: string[]
}

const UPDATE_BOX_TITLE = "UPDATE AVAILABLE"

export const formatUpdateNotice = (
	currentVersion: string,
	latestVersion: string,
): string =>
	box(
		[
			`Update available: ${chalk.gray(currentVersion)} -> ${chalk.cyan(latestVersion)}`,
			"",
			`Run ${chalk.gray("dotenc update")} to update`,
		].join("\n"),
		{
			title: UPDATE_BOX_TITLE,
			style: {
				borderColor: "yellow",
				padding: 2,
				marginTop: 0,
				marginBottom: 0,
				marginLeft: 0,
			},
		},
	)

const defaultDeps: UpdateNotifierDeps = {
	getHomeConfig,
	setHomeConfig,
	fetchLatestVersion,
	currentVersion: pkg.version,
	log: (message) => logger.log(message),
	args: process.argv.slice(2),
}

const shouldCheckForUpdate = (args: string[]): boolean => args[0] === "dev"

const persistUpdateState = async (
	config: HomeConfig,
	updateState: NonNullable<HomeConfig["update"]>,
	deps: UpdateNotifierDeps,
) => {
	try {
		await deps.setHomeConfig({
			...config,
			update: updateState,
		})
	} catch {
		// Never fail command execution because of update-check persistence.
	}
}

export const maybeNotifyAboutUpdate = async (
	depsOverrides: Partial<UpdateNotifierDeps> = {},
) => {
	const deps: UpdateNotifierDeps = {
		...defaultDeps,
		...depsOverrides,
	}

	if (!shouldCheckForUpdate(deps.args)) {
		return
	}

	let config: HomeConfig = {}
	try {
		config = await deps.getHomeConfig()
	} catch {
		config = {}
	}

	let updateState = config.update ?? {}
	const latestVersion = await deps.fetchLatestVersion()

	if (!latestVersion || !isVersionNewer(latestVersion, deps.currentVersion)) {
		return
	}

	if (updateState.notifiedVersion === latestVersion) {
		return
	}

	deps.log(formatUpdateNotice(deps.currentVersion, latestVersion))

	updateState = {
		...updateState,
		latestVersion,
		notifiedVersion: latestVersion,
	}
	await persistUpdateState(config, updateState, deps)
}
