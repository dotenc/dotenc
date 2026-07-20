import { spawn } from "node:child_process"
import chalk from "chalk"
import {
	detectInstallMethod,
	GITHUB_RELEASES_URL,
	type InstallMethod,
	isSystemInstallMethod,
	type SystemInstallMethod,
} from "../helpers/update"

const updateCommands: Record<
	Extract<InstallMethod, "homebrew" | "scoop" | "npm">,
	{ command: string; args: string[]; label: string }
> = {
	homebrew: {
		command: "brew",
		args: ["upgrade", "dotenc"],
		label: "Homebrew",
	},
	scoop: {
		command: "scoop",
		args: ["update", "dotenc"],
		label: "Scoop",
	},
	npm: {
		command: "npm",
		args: ["install", "-g", "@dotenc/cli"],
		label: "npm",
	},
}

const systemUpdateCommands: Record<
	SystemInstallMethod,
	{ label: string; commands: string[] }
> = {
	apt: {
		label: "APT",
		commands: ["sudo apt update && sudo apt install --only-upgrade dotenc"],
	},
	rpm: {
		label: "an RPM package manager",
		commands: ["sudo dnf upgrade dotenc", "sudo yum update dotenc"],
	},
	apk: {
		label: "APK",
		commands: ["sudo apk upgrade dotenc"],
	},
	aur: {
		label: "an AUR helper",
		commands: ["yay -Syu dotenc-bin", "paru -Syu dotenc-bin"],
	},
}

export const _runPackageManagerCommand = (
	command: string,
	args: string[],
	spawnImpl: typeof spawn = spawn,
) =>
	new Promise<number>((resolve, reject) => {
		const child = spawnImpl(command, args, {
			stdio: "inherit",
			shell: process.platform === "win32",
		})

		child.on("error", reject)
		child.on("exit", (code) => resolve(code ?? 1))
	})

export const updateCommand = async () => {
	const method = detectInstallMethod()

	if (isSystemInstallMethod(method)) {
		const updater = systemUpdateCommands[method]
		console.log(`dotenc is managed by ${updater.label}.`)
		console.log(
			updater.commands.length === 1
				? "Run this command to update:"
				: "Run the command for your system:",
		)
		for (const command of updater.commands) {
			console.log(`  ${chalk.gray(command)}`)
		}
		return
	}

	if (method === "binary") {
		console.log(
			`Standalone binary detected. Download the latest release at ${chalk.cyan(GITHUB_RELEASES_URL)}.`,
		)
		return
	}

	if (method === "unknown") {
		console.log("Could not determine installation method automatically.")
		console.log(`Try one of these commands:`)
		console.log(
			`  ${chalk.gray("sudo apt update && sudo apt install --only-upgrade dotenc")}`,
		)
		console.log(`  ${chalk.gray("sudo dnf upgrade dotenc")}`)
		console.log(`  ${chalk.gray("sudo yum update dotenc")}`)
		console.log(`  ${chalk.gray("sudo apk upgrade dotenc")}`)
		console.log(`  ${chalk.gray("yay -Syu dotenc-bin")}`)
		console.log(`  ${chalk.gray("paru -Syu dotenc-bin")}`)
		console.log(`  ${chalk.gray("brew update && brew upgrade dotenc")}`)
		console.log(`  ${chalk.gray("scoop update dotenc")}`)
		console.log(`  ${chalk.gray("npm install -g @dotenc/cli")}`)
		console.log(`Or download from ${chalk.cyan(GITHUB_RELEASES_URL)}.`)
		return
	}

	const updater = updateCommands[method]
	console.log(`Updating dotenc via ${updater.label}...`)

	if (method === "homebrew") {
		try {
			const brewUpdateCode = await _runPackageManagerCommand("brew", ["update"])

			if (brewUpdateCode !== 0) {
				console.error(
					`${chalk.red("Error:")} update command exited with code ${brewUpdateCode}.`,
				)
				process.exit(brewUpdateCode)
			}
		} catch (error) {
			console.error(
				`${chalk.red("Error:")} failed to run ${chalk.gray("brew update")}.`,
			)
			console.error(
				`${chalk.red("Details:")} ${error instanceof Error ? error.message : String(error)}`,
			)
			process.exit(1)
		}
	}

	let exitCode = 0
	try {
		exitCode = await _runPackageManagerCommand(updater.command, updater.args)
	} catch (error) {
		console.error(
			`${chalk.red("Error:")} failed to run ${chalk.gray([updater.command, ...updater.args].join(" "))}.`,
		)
		console.error(
			`${chalk.red("Details:")} ${error instanceof Error ? error.message : String(error)}`,
		)
		process.exit(1)
	}

	if (exitCode !== 0) {
		console.error(
			`${chalk.red("Error:")} update command exited with code ${exitCode}.`,
		)
		process.exit(exitCode)
	}
}
