import { exec, execFile } from "node:child_process"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import chalk from "chalk"
import { promptConfirm } from "../../ui/prompts"
import { isInteractive } from "../../ui/tty"

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

const EXTENSION_ID = "dotenc.dotenc"

const EDITOR_PROTOCOL_URLS: Record<string, string> = {
	vscode: `vscode:extension/${EXTENSION_ID}`,
	cursor: `cursor:extension/${EXTENSION_ID}`,
	windsurf: `windsurf:extension/${EXTENSION_ID}`,
	vscodium: `vscodium:extension/${EXTENSION_ID}`,
}

const EDITOR_NAMES: Record<string, string> = {
	vscode: "VS Code",
	cursor: "Cursor",
	windsurf: "Windsurf",
	vscodium: "VSCodium",
}

async function addToExtensionsJson(): Promise<void> {
	const extensionsJsonPath = path.join(
		process.cwd(),
		".vscode",
		"extensions.json",
	)

	let json: { recommendations?: string[] } = {}

	if (existsSync(extensionsJsonPath)) {
		const content = await fs.readFile(extensionsJsonPath, "utf-8")
		try {
			json = JSON.parse(content)
		} catch {
			json = {}
		}
	} else {
		await fs.mkdir(path.join(process.cwd(), ".vscode"), { recursive: true })
	}

	if (!Array.isArray(json.recommendations)) {
		json.recommendations = []
	}

	if (!json.recommendations.includes(EXTENSION_ID)) {
		json.recommendations.push(EXTENSION_ID)
		await fs.writeFile(
			extensionsJsonPath,
			JSON.stringify(json, null, 2),
			"utf-8",
		)
		console.log(
			`${chalk.green("✓")} Added dotenc to ${chalk.gray(".vscode/extensions.json")}`,
		)
	} else {
		console.log(
			`${chalk.green("✓")} dotenc already in ${chalk.gray(".vscode/extensions.json")}`,
		)
	}
}

async function which(bin: string): Promise<boolean> {
	try {
		await execFileAsync("which", [bin])
		return true
	} catch {
		return false
	}
}

export async function detectEditors(): Promise<string[]> {
	const detected: string[] = []

	if (existsSync(path.join(process.cwd(), ".cursor"))) detected.push("cursor")
	if (existsSync(path.join(process.cwd(), ".windsurf")))
		detected.push("windsurf")
	if (existsSync(path.join(process.cwd(), ".vscode"))) detected.push("vscode")

	const checks: Array<{ key: string; bins: string[] }> = [
		{ key: "cursor", bins: ["cursor"] },
		{ key: "windsurf", bins: ["windsurf"] },
		{ key: "vscode", bins: ["code"] },
		{ key: "vscodium", bins: ["codium", "vscodium"] },
	]

	if (process.platform === "darwin") {
		const macApps: Record<string, string> = {
			cursor: "/Applications/Cursor.app",
			windsurf: "/Applications/Windsurf.app",
			vscode: "/Applications/Visual Studio Code.app",
			vscodium: "/Applications/VSCodium.app",
		}
		for (const [key, appPath] of Object.entries(macApps)) {
			if (!detected.includes(key) && existsSync(appPath)) {
				detected.push(key)
			}
		}
	}

	for (const { key, bins } of checks) {
		if (detected.includes(key)) continue
		for (const bin of bins) {
			if (await which(bin)) {
				detected.push(key)
				break
			}
		}
	}

	return detected
}

async function openUrl(url: string): Promise<void> {
	if (process.platform === "darwin") {
		await execFileAsync("open", [url])
	} else if (process.platform === "win32") {
		await execAsync(`start ${url}`)
	} else {
		await execFileAsync("xdg-open", [url])
	}
}

// Exported for testing — allows injecting getEditors and openUrl without
// spawning real processes or depending on installed editors.
export async function _runInstallVscodeExtension(
	getEditors: () => Promise<string[]> = detectEditors,
	_openUrl: (url: string) => Promise<void> = openUrl,
	options: InstallVscodeExtensionOptions = {},
) {
	if (options.open && options.manual) {
		throw new Error("Options --open and --manual are mutually exclusive.")
	}

	const editors = await getEditors()

	await addToExtensionsJson()

	if (editors.length === 0) {
		console.log(
			`\nInstall the extension in VS Code: ${chalk.cyan(EDITOR_PROTOCOL_URLS.vscode)}`,
		)
		return
	}

	if (editors.length === 1) {
		const editor = editors[0]
		const url = EDITOR_PROTOCOL_URLS[editor]
		const name = EDITOR_NAMES[editor]
		const shouldOpen = options.manual ? false : options.open

		const open =
			shouldOpen ??
			(isInteractive()
				? await promptConfirm(`Open extension page in ${name} now?`, {
						initial: true,
						nonInteractiveError:
							"Opening the extension page requires an interactive terminal. Pass --open to force it or --manual to print the URL.",
					})
				: false)

		if (open) {
			try {
				await _openUrl(url)
			} catch {
				console.log(`Open manually: ${chalk.cyan(url)}`)
			}
		} else {
			console.log(`Install manually: ${chalk.cyan(url)}`)
		}

		return
	}

	console.log("\nInstall the extension in your editor:")
	for (const editor of editors) {
		const name = EDITOR_NAMES[editor] ?? editor
		const url = EDITOR_PROTOCOL_URLS[editor]
		console.log(`  ${name}: ${chalk.cyan(url)}`)
	}
}

export async function installVscodeExtensionCommand(
	options: InstallVscodeExtensionOptions = {},
) {
	await _runInstallVscodeExtension(detectEditors, openUrl, options)
}
type InstallVscodeExtensionOptions = {
	manual?: boolean
	open?: boolean
}
