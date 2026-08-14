import { spawn } from "node:child_process"
import chalk from "chalk"
import { resolveExecutable } from "../../helpers/resolveExecutable"
import { logger } from "../../ui/logger"
import { NonInteractivePromptError, promptSelect } from "../../ui/prompts"

type Options = {
	force?: boolean
	scope?: Scope
}

type Scope = "local" | "global"

const SKILL_SOURCE =
	"https://github.com/dotenc/skills/archive/dc3245191988923fced07c63b31df8184a1d1853.tar.gz"
const SKILL_NAME = "dotenc"
// skills@1.5.22 accepts direct archive downloads, so both the runner and the
// separately maintained dotenc skill source are immutable inputs.
const SKILLS_CLI_SPEC = "skills@1.5.22"
const NON_INTERACTIVE_SCOPE_FALLBACK =
	"Install scope prompt is unavailable in non-interactive mode."

const reportMissingBun = (): void => {
	console.error(
		`${chalk.red("Error:")} ${chalk.gray("bun")} was not found on ${chalk.gray("PATH")}.`,
	)
	console.error(
		`${chalk.gray("dotenc tools install-agent-skill")} requires Bun's package runner; standalone dotenc binaries do not bundle Bun.`,
	)
	console.error(
		`Install Bun, ensure ${chalk.gray("bun")} is executable on ${chalk.gray("PATH")}, and retry.`,
	)
}

const reportBunStartFailure = (): void => {
	console.error(
		`${chalk.red("Error:")} Bun's package runner could not be started.`,
	)
	console.error(
		`Ensure ${chalk.gray("bun")} is executable on ${chalk.gray("PATH")}, and retry.`,
	)
}

export const _runBunX = (
	bunExecutable: string,
	args: string[],
	spawnImpl: typeof spawn = spawn,
) =>
	new Promise<number>((resolve, reject) => {
		const child = spawnImpl(bunExecutable, ["x", ...args], {
			stdio: "inherit",
			shell: false,
		})

		child.on("error", reject)
		child.on("exit", (code) => resolve(code ?? 1))
	})

type InstallAgentSkillDependencies = {
	originalEnv: NodeJS.ProcessEnv
	resolveExecutable: typeof resolveExecutable
	runBunX: typeof _runBunX
}

export const _installAgentSkillCommand = async (
	options: Options,
	dependencyOverrides: Partial<InstallAgentSkillDependencies> = {},
) => {
	const originalEnv = dependencyOverrides.originalEnv ?? process.env
	const resolveExecutableImpl =
		dependencyOverrides.resolveExecutable ?? resolveExecutable
	const runBunX = dependencyOverrides.runBunX ?? _runBunX
	const bunExecutable = resolveExecutableImpl("bun", originalEnv)

	if (!bunExecutable) {
		reportMissingBun()
		process.exit(1)
	}

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
			if (!(error instanceof NonInteractivePromptError)) {
				throw error
			}

			scope = "local"
			logger.info(
				`No ${chalk.gray("--scope")} provided in non-interactive mode. Defaulting to ${chalk.cyan("local")}.`,
			)
		}
	}

	const args = [SKILLS_CLI_SPEC, "add", SKILL_SOURCE, "--skill", SKILL_NAME]

	if (scope === "global") {
		args.push("-g")
	}

	if (options.force) {
		args.push("-y")
	}

	const bunCommand = `bun x ${args.join(" ")}`
	let exitCode = 0

	try {
		exitCode = await runBunX(bunExecutable, args)
	} catch {
		reportBunStartFailure()
		process.exit(1)
	}

	if (exitCode !== 0) {
		console.error(
			`${chalk.red("Error:")} skill installation command exited with code ${exitCode}.`,
		)
		process.exit(exitCode)
	}

	console.log(
		`${chalk.green("✓")} Agent skill installation completed via ${chalk.gray(bunCommand)}.`,
	)
	console.log(`Run ${chalk.gray("/dotenc")} in your agent to use it.`)
}

export const installAgentSkillCommand = async (
	options: Options,
): Promise<void> => {
	await _installAgentSkillCommand(options)
}
