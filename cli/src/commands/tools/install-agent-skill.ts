import { spawn } from "node:child_process"
import chalk from "chalk"
import { getErrorMessage } from "../../ui/errors"
import { logger } from "../../ui/logger"
import { promptSelect } from "../../ui/prompts"

type Options = {
	force?: boolean
	scope?: Scope
}

type Scope = "local" | "global"

const SKILL_SOURCE = "ivanfilhoz/dotenc"
const SKILL_NAME = "dotenc"
const NON_INTERACTIVE_SCOPE_FALLBACK =
	"Install scope prompt is unavailable in non-interactive mode."

export const _runNpx = (args: string[], spawnImpl: typeof spawn = spawn) =>
	new Promise<number>((resolve, reject) => {
		const child = spawnImpl("npx", args, {
			stdio: "inherit",
			shell: process.platform === "win32",
		})

		child.on("error", reject)
		child.on("exit", (code) => resolve(code ?? 1))
	})

export const installAgentSkillCommand = async (options: Options) => {
	let scope = options.scope

	if (!scope) {
		try {
			scope = await promptSelect<Scope>("Install locally or globally?", {
				options: [
					{ label: "Locally (this project)", value: "local" },
					{ label: "Globally (all projects)", value: "global" },
				],
				initial: "local",
				nonInteractiveError: NON_INTERACTIVE_SCOPE_FALLBACK,
			})
		} catch (error) {
			if (getErrorMessage(error) !== NON_INTERACTIVE_SCOPE_FALLBACK) {
				throw error
			}

			scope = "local"
			logger.info(
				`No ${chalk.gray("--scope")} provided in non-interactive mode. Defaulting to ${chalk.cyan("local")}.`,
			)
		}
	}

	const args = ["skills", "add", SKILL_SOURCE, "--skill", SKILL_NAME]

	if (scope === "global") {
		args.push("-g")
	}

	if (options.force) {
		args.push("-y")
	}

	const npxCommand = `npx ${args.join(" ")}`
	let exitCode = 0

	try {
		exitCode = await _runNpx(args)
	} catch (error) {
		console.error(
			`${chalk.red("Error:")} failed to run ${chalk.gray(npxCommand)}.`,
		)
		console.error(
			`${chalk.red("Details:")} ${error instanceof Error ? error.message : String(error)}`,
		)
		process.exit(1)
	}

	if (exitCode !== 0) {
		console.error(
			`${chalk.red("Error:")} skill installation command exited with code ${exitCode}.`,
		)
		process.exit(exitCode)
	}

	console.log(
		`${chalk.green("✓")} Agent skill installation completed via ${chalk.gray(npxCommand)}.`,
	)
	console.log(`Run ${chalk.gray("/dotenc")} in your agent to use it.`)
}
