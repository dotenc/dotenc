import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
	assertTerminalizer,
	assetPath,
	assetsDir,
	createToolEnvironment,
	ensureOutputDirectories,
	getWebPTools,
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
	const rawAsset = path.join(rendererHome, `${scene}.raw.gif`)
	const encodedAsset = path.join(rendererHome, `${scene}.encoded.webp`)
	const stagedAsset = path.join(assetsDir, `.${scene}.${process.pid}.tmp.webp`)

	try {
		const env = await createToolEnvironment(rendererHome)
		assertTerminalizer(env)
		const webPTools = getWebPTools()
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
			webPTools.gif2webp,
			[
				"-q",
				"100",
				"-m",
				"4",
				"-mt",
				"-min_size",
				rawAsset,
				"-o",
				encodedAsset,
			],
			env,
		)
		await runCommand(
			webPTools.webpmux,
			["-set", "bgcolor", "255,13,17,23", encodedAsset, "-o", stagedAsset],
			env,
		)
		await fs.chmod(stagedAsset, 0o644)
		await fs.rename(stagedAsset, assetPath(scene))
	} finally {
		await fs.rm(rawAsset, { force: true }).catch(() => {})
		await fs.rm(encodedAsset, { force: true }).catch(() => {})
		await fs.rm(stagedAsset, { force: true }).catch(() => {})
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
