import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

export const scenes = ["quickstart", "git-diff"] as const
export type Scene = (typeof scenes)[number]

export const demoDir = import.meta.dir
export const repoRoot = path.resolve(demoDir, "../..")
export const recordingsDir = path.join(demoDir, "recordings")
export const assetsDir = path.join(repoRoot, "assets", "demos")
export const terminalizerConfig = path.join(demoDir, "terminalizer.yml")
export const terminalizerBin = path.join(
	demoDir,
	"node_modules",
	".bin",
	"terminalizer",
)

const nodeVersionPattern = /^v16\./

export const parseSceneSelection = (value = "all"): Scene[] => {
	if (value === "all") return [...scenes]
	if (scenes.includes(value as Scene)) return [value as Scene]
	throw new Error(
		`Unknown demo "${value}". Expected: ${scenes.join(", ")}, or all.`,
	)
}

const commandOutput = (command: string, args: string[], env = process.env) => {
	const result = spawnSync(command, args, {
		env,
		encoding: "utf8",
	})
	return {
		status: result.status,
		stdout: result.stdout?.trim() ?? "",
		stderr: result.stderr?.trim() ?? "",
	}
}

export const getNode16Path = () => {
	const node = commandOutput("node", ["--version"])
	if (node.status !== 0 || !nodeVersionPattern.test(node.stdout)) {
		throw new Error(
			`Terminalizer 0.12.0 requires Node 16 for its native PTY on this project. ` +
				`Activate Node 16 before recording or rendering (current: ${node.stdout || "unavailable"}).`,
		)
	}

	const resolved = commandOutput("node", ["-p", "process.execPath"])
	if (resolved.status !== 0 || !resolved.stdout) {
		throw new Error("Could not resolve the active Node 16 executable.")
	}
	return path.dirname(resolved.stdout)
}

export const assertTerminalizer = (env: NodeJS.ProcessEnv) => {
	if (!existsSync(terminalizerBin)) {
		throw new Error(
			"Terminalizer is not installed. Run `bun install --cwd scripts/readme-demos --frozen-lockfile` with Node 16 active.",
		)
	}

	const version = commandOutput(terminalizerBin, ["--version"], env)
	if (version.status !== 0 || version.stdout !== "0.12.0") {
		throw new Error(
			`Expected Terminalizer 0.12.0, received ${version.stdout || version.stderr || "no version"}.`,
		)
	}
}

export const getWebPTools = () => ({
	gif2webp: resolveAuthoringTool("gif2webp"),
	webpmux: resolveAuthoringTool("webpmux"),
})

const resolveAuthoringTool = (command: "gif2webp" | "webpmux") => {
	const executable = Bun.which(command)
	if (!executable) {
		throw new Error(
			`${command} is required to render README demos. Install the WebP tools before rendering.`,
		)
	}
	return executable
}

export const createToolEnvironment = async (
	temporaryHome: string,
	extra: Record<string, string> = {},
) => {
	const nodeBin = getNode16Path()
	const bunBin = path.dirname(process.execPath)
	const temporaryDirectory = path.join(temporaryHome, "tmp")
	const configDirectory = path.join(temporaryHome, ".config")
	await fs.mkdir(temporaryDirectory, { recursive: true, mode: 0o700 })
	await fs.mkdir(configDirectory, { recursive: true, mode: 0o700 })

	return {
		HOME: temporaryHome,
		PATH: [nodeBin, bunBin, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(
			path.delimiter,
		),
		TERM: "xterm-256color",
		SHELL: "/bin/bash",
		USER: "dotenc-demo",
		LOGNAME: "dotenc-demo",
		LANG: "C",
		LC_ALL: "C",
		TMPDIR: temporaryDirectory,
		XDG_CONFIG_HOME: configDirectory,
		GIT_CONFIG_NOSYSTEM: "1",
		...extra,
	} satisfies NodeJS.ProcessEnv
}

export const sanitizeRecording = (raw: string, temporaryRoot: string) => {
	let recordIndex = 0
	const sanitized = raw
		.replace(/^ {2}command:.*$/m, "  command: bun scene.ts")
		.replace(/^ {2}cwd:.*$/m, "  cwd: .")
		.replace(/^ {2}frameDelay:.*$/m, "  frameDelay: auto")
		.replace(/^ {2}maxIdleTime:.*$/m, "  maxIdleTime: 3000")
		.replace(
			/index [0-9a-f]+\.\.[0-9a-f]+ 100644/g,
			"index 1234567..89abcde 100644",
		)
		.replace(/^[ \t]+$/gm, "")
		.replace(/^ {2}- delay: (\d+)$/gm, (_, rawDelay: string) => {
			// Terminalizer uses the first record's delay for the final GIF frame.
			const delay =
				recordIndex === 0 ? 3000 : normalizeRecordedDelay(Number(rawDelay))
			recordIndex++
			return `  - delay: ${delay}`
		})

	const forbidden: Array<[RegExp, string]> = [
		[/-----BEGIN [^-]*PRIVATE KEY-----/i, "private key material"],
		[/DOTENC_PRIVATE_KEY/i, "dotenc private-key environment variable"],
		[/\/(?:Users|home|root|tmp)\//i, "home or temporary path"],
		[/\/(?:private\/var|var\/folders)\//i, "macOS temporary path"],
		[/[A-Z]:\\Users\\/i, "Windows home-directory path"],
		[/\b[\w.-]+@[\w.-]+(?=[:~][^\r\n]*[$#])/i, "shell prompt identity"],
		[
			/\b(?:AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|NPM_TOKEN)\b/i,
			"credential name",
		],
		[new RegExp(escapeRegExp(temporaryRoot), "i"), "temporary demo path"],
		[new RegExp(escapeRegExp(repoRoot), "i"), "repository path"],
	]

	for (const [pattern, label] of forbidden) {
		if (pattern.test(sanitized)) {
			throw new Error(`Recording contains forbidden ${label}.`)
		}
	}

	return sanitized
}

const normalizeRecordedDelay = (delay: number) => {
	if (delay <= 65) return 55
	if (delay <= 85) return 75
	if (delay <= 115) return 95
	if (delay <= 165) return 140
	if (delay <= 350) return 250
	if (delay <= 650) return 500
	if (delay <= 1100) return 900
	return 1400
}

export const assertSanitizedRecording = (raw: string) =>
	assertUnchanged(raw, sanitizeRecording(raw, "/path-that-must-not-appear"))

export const ensureOutputDirectories = async () => {
	await fs.mkdir(recordingsDir, { recursive: true })
	await fs.mkdir(assetsDir, { recursive: true })
}

export const recordingPath = (scene: Scene) =>
	path.join(recordingsDir, `${scene}.yml`)

export const assetPath = (scene: Scene) => path.join(assetsDir, `${scene}.webp`)

export const removeRendererData = async () => {
	await fs
		.rm(
			path.join(demoDir, "node_modules", "terminalizer", "render", "data.json"),
			{
				force: true,
			},
		)
		.catch(() => {})
}

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const assertUnchanged = (raw: string, sanitized: string) => {
	if (raw !== sanitized) {
		throw new Error(
			"Recording contains an unsanitized command or working directory.",
		)
	}
	return raw
}
