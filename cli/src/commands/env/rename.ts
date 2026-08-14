import path from "node:path"
import chalk from "chalk"
import { prepareEnvironmentRename } from "../../helpers/renameEnvironment"
import { confirmPrompt } from "../../prompts/confirm"

type Options = {
	allLayers?: boolean
	yes?: boolean
}

export const envRenameCommand = async (
	sourceName: string,
	destinationName: string,
	options: Options = {},
) => {
	const transaction = await prepareEnvironmentRename({
		sourceName,
		destinationName,
		allLayers: options.allLayers,
	})

	try {
		console.log("Environment layers to rename:")
		for (const layer of transaction.layers) {
			const source = path.relative(transaction.projectRoot, layer.sourcePath)
			const target = path.relative(transaction.projectRoot, layer.targetPath)
			console.log(`  - ${source} ${chalk.gray("→")} ${target}`)
		}

		if (!options.yes) {
			const confirmed = await confirmPrompt(
				`Rename ${transaction.layers.length} encrypted environment layer${transaction.layers.length === 1 ? "" : "s"}?`,
			)
			if (!confirmed) {
				console.log("Operation cancelled.")
				return
			}
		}

		await transaction.commit()
		console.log(
			`${chalk.green("✔")} Renamed ${sourceName} to ${destinationName} in ${transaction.layers.length} layer${transaction.layers.length === 1 ? "" : "s"}.`,
		)
	} finally {
		transaction.dispose()
	}
}
