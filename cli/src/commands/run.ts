import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import chalk from "chalk"
import { buildAncestorChain } from "../helpers/buildAncestorChain"
import { decryptEnvironmentData } from "../helpers/decryptEnvironment"
import { getEnvironmentByPath } from "../helpers/getEnvironmentByPath"
import { parseEnv } from "../helpers/parseEnv"
import { resolveProjectRoot } from "../helpers/resolveProjectRoot"
import { validateEnvironmentName } from "../helpers/validateEnvironmentName"

type Options = {
	env?: string
	strict?: boolean
	localOnly?: boolean
}

export const runCommand = async (
	command: string,
	args: string[],
	options: Options,
) => {
	const environmentName = options.env || process.env.DOTENC_ENV

	if (!environmentName) {
		console.error(
			'No environment provided. Use -e or set DOTENC_ENV to the environment you want to run the command in.\nTo initialize dotenc, run "dotenc init --name <your-name>". To add environments later, use "dotenc env create <environment>".',
		)
		process.exit(1)
	}

	const environments = environmentName.split(",")

	for (const env of environments) {
		const validation = validateEnvironmentName(env)
		if (!validation.valid) {
			console.error(`${chalk.red("Error:")} ${validation.reason}`)
			process.exit(1)
		}
	}

	const invocationDir = process.cwd()
	let dirs: string[]

	if (options.localOnly) {
		dirs = [invocationDir]
	} else {
		let projectRoot: string
		try {
			projectRoot = resolveProjectRoot(invocationDir, existsSync)
		} catch (error) {
			console.error(
				error instanceof Error
					? error.message
					: "Failed to locate project root.",
			)
			process.exit(1)
		}
		dirs = buildAncestorChain(projectRoot, invocationDir)
	}

	let failureCount = 0
	const decryptedEnvs = await Promise.all(
		environments.map(async (envName) => {
			let merged: Record<string, string> = {}
			let foundAtAnyLevel = false

			for (const dir of dirs) {
				const filePath = path.join(dir, `.env.${envName}.enc`)
				if (!existsSync(filePath)) {
					continue
				}

				foundAtAnyLevel = true

				let content: string
				try {
					const envJson = await getEnvironmentByPath(filePath)
					content = await decryptEnvironmentData(envName, envJson)
				} catch (error: unknown) {
					console.error(
						error instanceof Error
							? error.message
							: `Unknown error occurred while decrypting the environment ${envName} at ${dir}.`,
					)
					failureCount++
					return {}
				}

				const vars = parseEnv(content)
				merged = { ...merged, ...vars }
			}

			if (!foundAtAnyLevel) {
				console.error(
					`${chalk.yellow("Warning:")} environment ${chalk.cyan(envName)} not found.`,
				)
				failureCount++
				return {}
			}

			return merged
		}),
	)

	if (failureCount === environments.length) {
		console.error(`${chalk.red("Error:")} All environments failed to load.`)
		process.exit(1)
	}

	if (failureCount > 0) {
		if (options.strict) {
			console.error(
				`${chalk.red("Error:")} ${failureCount} of ${environments.length} environment(s) failed to load and strict mode is enabled.`,
			)
			process.exit(1)
		}

		console.error(
			`${chalk.yellow("Warning:")} ${failureCount} of ${environments.length} environment(s) failed to load.`,
		)
	}

	const decryptedEnv = decryptedEnvs.reduce((acc, env) => {
		return { ...acc, ...env }
	}, {})

	const {
		DOTENC_PRIVATE_KEY_BASE64: _privateKeyBase64,
		DOTENC_PRIVATE_KEY: _privateKey,
		...baseEnv
	} = process.env
	const mergedEnv = { ...baseEnv, ...decryptedEnv }

	const child = spawn(command, args, {
		env: mergedEnv,
		stdio: "inherit",
	})

	child.on("exit", (code) => {
		process.exit(code ?? 0)
	})
}
