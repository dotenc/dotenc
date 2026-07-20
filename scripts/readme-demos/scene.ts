import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { devCommand } from "../../cli/src/commands/dev"
import { encryptEnvironment } from "../../cli/src/helpers/encryptEnvironment"
import { parseSceneSelection, repoRoot, type Scene } from "./lib"

const green = "\u001b[32m"
const cyan = "\u001b[36m"
const reset = "\u001b[0m"

process.umask(0o077)

const scene = parseSceneSelection(process.argv[2])[0]
const demoHome = requiredEnvironment("DOTENC_DEMO_HOME")
const projectDir = requiredEnvironment("DOTENC_DEMO_PROJECT")
const sentinelPath = requiredEnvironment("DOTENC_DEMO_SENTINEL")
const cliEntry = path.join(repoRoot, "cli", "src", "cli.ts")
const nanoEditorEntry = path.join(import.meta.dir, "nano-editor.ts")

const childEnvironment = {
	...process.env,
	HOME: demoHome,
	USER: "alice",
	LOGNAME: "alice",
	GIT_PAGER: "cat",
	EDITOR: [process.execPath, nanoEditorEntry]
		.map((argument) => JSON.stringify(argument))
		.join(" "),
}
for (const key of Object.keys(childEnvironment)) {
	if (key.startsWith("DOTENC_PRIVATE_KEY")) delete childEnvironment[key]
}

const run = async (
	command: string,
	args: string[],
	options: { quiet?: boolean; cwd?: string } = {},
) => {
	const child = spawn(command, args, {
		cwd: options.cwd ?? projectDir,
		env: childEnvironment,
		stdio: options.quiet ? "ignore" : "inherit",
	})
	const exitCode = await new Promise<number>((resolve, reject) => {
		child.once("error", reject)
		child.once("exit", (code) => resolve(code ?? 1))
	})
	if (exitCode !== 0) {
		throw new Error(`${command} exited with code ${exitCode}`)
	}
}

const runCli = (args: string[], quiet = false) =>
	run(process.execPath, [cliEntry, ...args], { quiet })

let visibleCommandCount = 0

const showCommand = async (command: string) => {
	if (visibleCommandCount > 0) await Bun.sleep(1500)
	const prefix = visibleCommandCount === 0 ? "\u001b[2J\u001b[H" : "\n"
	process.stdout.write(`${prefix}${green}$${reset} ${cyan}`)
	visibleCommandCount++
	await Bun.sleep(450)

	for (const [index, character] of [...command].entries()) {
		process.stdout.write(character)
		await Bun.sleep(getTypingDelay(character, index))
	}

	await Bun.sleep(300)
	process.stdout.write(`${reset}\n`)
	await Bun.sleep(300)
}

const getTypingDelay = (character: string, index: number) => {
	if (character === " ") return 140
	if (/[./-]/.test(character)) return 110
	return [55, 75, 95][index % 3]
}

const generateKey = async (fileName: string, comment: string) => {
	const sshDirectory = path.join(demoHome, ".ssh")
	await fs.mkdir(sshDirectory, { recursive: true, mode: 0o700 })
	await run(
		"ssh-keygen",
		[
			"-q",
			"-t",
			"ed25519",
			"-N",
			"",
			"-C",
			comment,
			"-f",
			path.join(sshDirectory, fileName),
		],
		{ quiet: true },
	)
}

const initializeFixture = async () => {
	await fs.mkdir(projectDir, { recursive: true, mode: 0o700 })
	await run("git", ["init", "-q"], { quiet: true })
	await run("git", ["config", "user.name", "Dotenc Demo"], { quiet: true })
	await run("git", ["config", "user.email", "demo@dotenc.invalid"], {
		quiet: true,
	})
	await generateKey("id_ed25519", "alice@dotenc-demo.invalid")
}

const quickstart = async () => {
	await initializeFixture()
	await runCli(["init", "--name", "alice", "--private-key", "id_ed25519"], true)
	await fs.writeFile(
		path.join(projectDir, "app.js"),
		'console.log(process.env.GREETING ?? "No greeting")\n',
		{ mode: 0o644 },
	)

	await showCommand("cat app.js")
	await run("cat", ["app.js"])

	await showCommand("node app.js")
	await run("node", ["app.js"])

	await showCommand("dotenc env edit development")
	await runCli(["env", "edit", "development"])

	await showCommand("dotenc dev node app.js")
	// Run the real dev action directly so authoring never performs the CLI's
	// unrelated npm update check or depends on network availability.
	await devCommand("node", ["app.js"])
}

const gitDiff = async () => {
	await initializeFixture()
	await fs.writeFile(
		path.join(projectDir, ".env"),
		[
			"APP_NAME=dotenc-demo",
			"FEATURE_CHECKOUT=false",
			"API_URL=https://sandbox.example.test",
			"LOG_LEVEL=info",
			"CACHE_TTL=300",
			"REGION=local",
			"",
		].join("\n"),
		{ mode: 0o600 },
	)
	await runCli(["init", "--name", "alice", "--private-key", "id_ed25519"], true)

	// Git invokes the same hidden textconv command configured by `dotenc init`.
	// Point it at this checkout's CLI because the authoring environment must not
	// depend on a globally installed dotenc binary.
	const textconv = [process.execPath, cliEntry, "textconv"]
		.map((argument) => JSON.stringify(argument))
		.join(" ")
	await run("git", ["config", "--local", "diff.dotenc.textconv", textconv], {
		quiet: true,
	})
	await run("git", ["add", "."], { quiet: true })
	await run("git", ["commit", "-q", "-m", "Add encrypted environment"], {
		quiet: true,
	})

	await encryptEnvironment(
		"development",
		[
			"APP_NAME=dotenc-demo",
			"FEATURE_CHECKOUT=true",
			"API_URL=https://sandbox.example.test",
			"LOG_LEVEL=info",
			"CACHE_TTL=300",
			"REGION=local",
			"",
		].join("\n"),
		{ baseDir: projectDir },
	)

	await showCommand("git status --short")
	await run("git", ["status", "--short"])

	await showCommand("git diff -- .env.development.enc")
	await run("git", ["diff", "--", ".env.development.enc"])
}

const scenes: Record<Scene, () => Promise<void>> = {
	quickstart,
	"git-diff": gitDiff,
}

try {
	await scenes[scene]()
	await fs.writeFile(sentinelPath, "complete\n", { mode: 0o600 })
	await Bun.sleep(300)
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
}

function requiredEnvironment(name: string) {
	const value = process.env[name]
	if (!value) throw new Error(`${name} is required.`)
	return value
}
