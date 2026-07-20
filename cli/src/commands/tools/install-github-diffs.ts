import chalk from "chalk"
import {
	type InstallGithubDiffsDependencies,
	type InstallGithubDiffsOptions,
	installGithubDiffs,
} from "../../helpers/installGithubDiffs"

export const _runInstallGithubDiffs = async (
	options: InstallGithubDiffsOptions,
	dependencies: Partial<InstallGithubDiffsDependencies> = {},
) => {
	const result = await installGithubDiffs(options, dependencies)
	if (result.status === "cancelled") {
		console.log("Installation cancelled.")
		return result
	}

	console.log(
		`${chalk.green("✓")} GitHub redacted diffs are configured for ${chalk.cyan(result.repository)}.`,
	)
	console.log(
		`Review and commit ${result.keyPaths.map((filePath) => chalk.gray(filePath)).join(", ")}, the selected encrypted environments, and ${chalk.gray(result.workflowPath)}.`,
	)
	console.log(
		`${chalk.green("✓")} Stored the dedicated private identity as the Actions secret ${chalk.gray(result.secretName)}.`,
	)
	return result
}

export const installGithubDiffsCommand = async (
	options: InstallGithubDiffsOptions,
): Promise<void> => {
	await _runInstallGithubDiffs(options)
}
