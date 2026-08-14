import { spawnSync } from "node:child_process"
import { getHomeConfig, HomeConfigUnavailableError } from "./homeConfig"

type GetDefaultEditorDeps = {
	getHomeConfig: typeof getHomeConfig
	commandExists: (command: string) => boolean
	platform: NodeJS.Platform
}

const SHELL_METACHARACTERS = /[$`();|<>&!\n\r]/

export const isEditorCommandFreeOfShellMetacharacters = (
	value: string,
): boolean => !SHELL_METACHARACTERS.test(value)

export const commandExists = (command: string) => {
	const result = spawnSync("which", [command], { stdio: "ignore" })
	return result.status === 0
}

const defaultGetDefaultEditorDeps: GetDefaultEditorDeps = {
	getHomeConfig,
	commandExists,
	platform: process.platform,
}

/**
 * Determines the default text editor for the system.
 * @returns {string} The command to launch the default text editor.
 */
export const getDefaultEditor = async (
	deps: GetDefaultEditorDeps = defaultGetDefaultEditorDeps,
) => {
	let config: Awaited<ReturnType<typeof getHomeConfig>> = {}
	try {
		config = await deps.getHomeConfig()
	} catch (error) {
		// Home configuration deliberately fails closed on platforms where the
		// runtime cannot prevent path replacement. Editor discovery can still use
		// process environment variables and platform defaults without reading it.
		if (!(error instanceof HomeConfigUnavailableError)) throw error
	}

	// Check the editor field in the config file
	if (config.editor) {
		if (!isEditorCommandFreeOfShellMetacharacters(config.editor)) {
			throw new Error(
				'The configured editor command contains unsafe characters. Please update it using "dotenc config editor <command>".',
			)
		}
		return config.editor
	}

	// Check the EDITOR environment variable (skip if it contains shell metacharacters)
	if (
		process.env.EDITOR &&
		isEditorCommandFreeOfShellMetacharacters(process.env.EDITOR)
	) {
		return process.env.EDITOR
	}

	// Check the VISUAL environment variable (skip if it contains shell metacharacters)
	if (
		process.env.VISUAL &&
		isEditorCommandFreeOfShellMetacharacters(process.env.VISUAL)
	) {
		return process.env.VISUAL
	}
	// Platform-specific defaults
	const platform = deps.platform

	if (platform === "win32") {
		// Windows: Use notepad as the fallback editor
		return "notepad"
	}

	// Linux/macOS: Try nano, vim, or vi
	const editors = ["nano", "vim", "vi"]
	for (const editor of editors) {
		// Check if the editor is available
		if (deps.commandExists(editor)) {
			return editor // Return the first available editor
		}
	}

	// If no editor is found, throw an error
	throw new Error(
		'No text editor found. Please set the EDITOR environment variable, configure an editor using "dotenc config editor <command>", or install a text editor (e.g., nano, vim, or notepad).',
	)
}
