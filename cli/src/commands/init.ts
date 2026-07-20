import crypto from "node:crypto"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import chalk from "chalk"
import pkg from "../../package.json"
import { resolveProjectRoot } from "../helpers/resolveProjectRoot"
import { setupGitDiff } from "../helpers/setupGitDiff"
import { choosePrivateKeyPrompt } from "../prompts/choosePrivateKey"
import { inputNamePrompt } from "../prompts/inputName"
import { createCommand } from "./env/create"
import { keyAddCommand } from "./key/add"

type Options = {
	name?: string
	privateKey?: string
}

export const _resolveDocsUrl = () => {
	if (typeof pkg.homepage === "string" && pkg.homepage.trim().length > 0) {
		return pkg.homepage
	}

	const repositoryUrl =
		typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url
	if (typeof repositoryUrl !== "string" || repositoryUrl.trim().length === 0) {
		return undefined
	}

	return repositoryUrl.replace(/^git\+/, "").replace(/\.git$/, "")
}

export const initCommand = async (options: Options) => {
	const invocationDir = process.cwd()
	let existingProjectRoot: string | undefined

	try {
		existingProjectRoot = resolveProjectRoot(invocationDir, existsSync)
	} catch {
		// No existing project: continue with first-time initialization below.
	}

	if (existingProjectRoot) {
		if (options.name || options.privateKey) {
			console.warn(
				`${chalk.yellow("Warning:")} ${chalk.gray("--name")} and ${chalk.gray("--private-key")} only apply when creating a new project and were ignored. Use ${chalk.gray("dotenc key add")} to register another key.`,
			)
		}
		setupGitDiff(existingProjectRoot)
		console.log(`\n${chalk.green("✔")} Existing dotenc project detected.`)
		console.log(
			`${chalk.green("✔")} Git diff driver configured for this clone.`,
		)
		console.log("\nNo keys or environments were changed.")
		return
	}

	const username =
		options.name ||
		(await inputNamePrompt("What's your name?", os.userInfo().username))

	if (!username) {
		console.error(`${chalk.red("Error:")} no name provided.`)
		process.exit(1)
	}

	let keyEntry: Awaited<ReturnType<typeof choosePrivateKeyPrompt>>
	try {
		keyEntry = await choosePrivateKeyPrompt(
			"Which SSH key would you like to use?",
			{
				nonInteractiveHint: "--private-key <name>",
				preferredKeyName: options.privateKey,
			},
		)
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	}

	console.log(`Adding key: ${chalk.cyan(username)} (${keyEntry.algorithm})`)

	const publicKey = crypto.createPublicKey(keyEntry.privateKey)
	const publicKeyPem = publicKey
		.export({ type: "spki", format: "pem" })
		.toString()

	await keyAddCommand(username, {
		fromString: publicKeyPem,
	})

	try {
		setupGitDiff(invocationDir)
	} catch (_error) {
		console.warn(
			`${chalk.yellow("Warning:")} could not set up git diff driver. You can run ${chalk.gray("dotenc init")} again inside a git repository.`,
		)
	}

	let initialContent: string | undefined
	const envPath = path.join(process.cwd(), ".env")

	if (existsSync(envPath)) {
		initialContent = await fs.readFile(envPath, "utf-8")
	}

	await createCommand("development", username, initialContent)

	if (initialContent !== undefined) {
		await fs.unlink(envPath)
		console.log(
			`Migrated ${chalk.gray(".env")} contents to ${chalk.cyan("development")} environment.`,
		)
	}

	if (username !== "development") {
		await createCommand(username, username)
	}

	console.log(`\n${chalk.green("✔")} Initialization complete!`)
	console.log("\nSome useful tips:")
	const developmentEditCmd = chalk.gray("dotenc env edit development")
	const personalEditCmd = chalk.gray(`dotenc env edit ${username}`)
	console.log(`- Edit the development environment:\t${developmentEditCmd}`)
	if (username !== "development") {
		console.log(`- Edit your personal environment:\t${personalEditCmd}`)
	}

	const devEnvironmentChain =
		username === "development" ? "development" : `development,${username}`
	const devCmd = chalk.gray("dotenc dev <command>")
	console.log(
		`- Run in development mode:\t\t${devCmd} ${chalk.gray(`(loads ${devEnvironmentChain})`)}`,
	)
	const docsUrl = _resolveDocsUrl()
	if (docsUrl) {
		console.log(`- Full docs:\t\t\t${chalk.gray(docsUrl)}`)
	}

	if (existsSync(".claude") || existsSync("CLAUDE.md")) {
		console.log(
			`- Install the agent skill:\t\t${chalk.gray("dotenc tools install-agent-skill")}`,
		)
	}
	if (
		existsSync(".vscode") ||
		existsSync(".cursor") ||
		existsSync(".windsurf")
	) {
		console.log(
			`- Add the editor extension:\t\t${chalk.gray("dotenc tools install-vscode-extension")}`,
		)
	}
}
