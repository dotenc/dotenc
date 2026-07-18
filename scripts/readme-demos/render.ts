import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
	assertTerminalizer,
	assetPath,
	createToolEnvironment,
	ensureOutputDirectories,
	gifsicleBin,
	parseSceneSelection,
	recordingPath,
	removeRendererData,
	type Scene,
	terminalizerBin,
} from "./lib"

export const renderScene = async (scene: Scene, temporaryHome?: string) => {
	await ensureOutputDirectories()
	const ownsHome = !temporaryHome
	const rendererHome =
		temporaryHome ??
		(await fs.mkdtemp(path.join(os.tmpdir(), "dotenc-render-")))
	const env = await createToolEnvironment(rendererHome)
	assertTerminalizer(env)
	const rawAsset = path.join(rendererHome, `${scene}.raw.gif`)

	try {
		await runTerminalizer(
			[
				"render",
				recordingPath(scene),
				"--output",
				rawAsset,
				"--quality",
				"88",
				"--step",
				"1",
			],
			env,
		)
		await runCommand(
			gifsicleBin,
			[
				"--optimize=3",
				"--resize-fit",
				"960x540",
				"--colors",
				"128",
				rawAsset,
				"--output",
				assetPath(scene),
			],
			env,
		)
		await fs.chmod(assetPath(scene), 0o644)
	} finally {
		await fs.rm(rawAsset, { force: true }).catch(() => {})
		await removeRendererData()
		if (ownsHome) await fs.rm(rendererHome, { recursive: true, force: true })
	}
}

const runTerminalizer = async (args: string[], env: NodeJS.ProcessEnv) => {
	await runCommand(terminalizerBin, args, env)
}

const runCommand = async (
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
) => {
	const child = spawn(command, args, {
		env,
		stdio: "inherit",
	})
	const exitCode = await new Promise<number>((resolve, reject) => {
		child.once("error", reject)
		child.once("exit", (code) => resolve(code ?? 1))
	})
	if (exitCode !== 0)
		throw new Error(`${command} exited with code ${exitCode}.`)
}

if (import.meta.main) {
	for (const scene of parseSceneSelection(process.argv[2])) {
		await renderScene(scene)
	}
}
