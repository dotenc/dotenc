import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
	assertTerminalizer,
	createToolEnvironment,
	ensureOutputDirectories,
	parseSceneSelection,
	recordingPath,
	type Scene,
	sanitizeRecording,
	terminalizerBin,
	terminalizerConfig,
} from "./lib"
import { renderScene } from "./render"

process.umask(0o077)

if (!process.stdin.isTTY || !process.stdout.isTTY) {
	throw new Error("Recording requires an interactive terminal (TTY).")
}

await ensureOutputDirectories()

for (const scene of parseSceneSelection(process.argv[2])) {
	await recordScene(scene)
}

async function recordScene(scene: Scene) {
	const temporaryRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), `dotenc-readme-${scene}-`),
	)
	await fs.chmod(temporaryRoot, 0o700)
	const temporaryHome = path.join(temporaryRoot, "home")
	const projectDir = path.join(temporaryRoot, "project")
	const sentinelPath = path.join(temporaryRoot, "complete")
	const temporaryRecordingBase = path.join(temporaryRoot, scene)
	const temporaryRecording = `${temporaryRecordingBase}.yml`
	await fs.mkdir(temporaryHome, { recursive: true, mode: 0o700 })
	await fs.mkdir(projectDir, { recursive: true, mode: 0o700 })

	const env = await createToolEnvironment(temporaryHome, {
		DOTENC_DEMO_HOME: temporaryHome,
		DOTENC_DEMO_PROJECT: projectDir,
		DOTENC_DEMO_SENTINEL: sentinelPath,
	})
	assertTerminalizer(env)

	try {
		console.log(`Recording ${scene}...`)
		const command = [
			process.execPath,
			path.join(import.meta.dir, "scene.ts"),
			scene,
		]
			.map((argument) => JSON.stringify(argument))
			.join(" ")
		await runTerminalizer(
			[
				"record",
				temporaryRecordingBase,
				"--config",
				terminalizerConfig,
				"--command",
				command,
				"--skip-sharing",
			],
			env,
			projectDir,
		)

		if (!existsSync(sentinelPath)) {
			throw new Error(
				`The ${scene} scene did not complete; refusing to keep its recording.`,
			)
		}

		const raw = await fs.readFile(temporaryRecording, "utf8")
		const sanitized = sanitizeRecording(raw, temporaryRoot)
		await fs.writeFile(recordingPath(scene), sanitized, { mode: 0o644 })
		await fs.chmod(recordingPath(scene), 0o644)
		await renderScene(scene, temporaryHome)
	} finally {
		await fs.rm(temporaryRoot, { recursive: true, force: true })
	}
}

async function runTerminalizer(
	args: string[],
	env: NodeJS.ProcessEnv,
	cwd: string,
) {
	const child = spawn(terminalizerBin, args, {
		cwd,
		env,
		stdio: "inherit",
	})
	const exitCode = await new Promise<number>((resolve, reject) => {
		child.once("error", reject)
		child.once("exit", (code) => resolve(code ?? 1))
	})
	if (exitCode !== 0)
		throw new Error(`Terminalizer exited with code ${exitCode}.`)
}
