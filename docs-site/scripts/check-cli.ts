import { spawnSync } from "node:child_process"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const cli = process.env.DOTENC_DOCS_CLI
	? resolve(process.env.DOTENC_DOCS_CLI)
	: join(root, "cli/src/cli.ts")
const runtime = process.env.DOTENC_DOCS_RUNTIME || process.execPath
const sandbox = mkdtempSync(join(tmpdir(), "dotenc-docs-smoke-"))
const home = join(sandbox, "home")
const project = join(sandbox, "project")
mkdirSync(join(home, ".ssh"), { recursive: true, mode: 0o700 })
mkdirSync(project)
const env: NodeJS.ProcessEnv = {
	PATH: process.env.PATH,
	HOME: home,
	XDG_CONFIG_HOME: join(home, ".config"),
	XDG_CACHE_HOME: join(home, ".cache"),
	DOTENC_SKIP_UPDATE_CHECK: "1",
	NO_COLOR: "1",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
}
let checks = 0
function verify(condition: unknown, label: string): asserts condition {
	if (!condition) throw new Error(`Documentation smoke failed: ${label}`)
	checks++
}
function exec(
	command: string,
	args: string[],
	options: {
		cwd?: string
		input?: string
		status?: number
		extraEnv?: NodeJS.ProcessEnv
	} = {},
) {
	const result = spawnSync(command, args, {
		cwd: options.cwd || project,
		env: { ...env, ...options.extraEnv },
		input: options.input,
		encoding: "utf8",
		timeout: 30000,
	})
	// Do not include raw subprocess output: it can contain generated key material.
	verify(
		result.status === (options.status ?? 0),
		`${command === runtime ? "dotenc" : command} ${command === runtime ? args.slice(1, 3).join(" ") : args[0]} exit (received ${result.status}, expected ${options.status ?? 0})`,
	)
	return result.stdout
}
function dotenc(args: string[], options: Parameters<typeof exec>[2] = {}) {
	return exec(runtime, [cli, ...args], options)
}
function encrypt(name: string, content: string, cwd = project) {
	verify(
		JSON.parse(
			dotenc(["env", "encrypt", name, "--stdin", "--json"], {
				input: content,
				cwd,
			}),
		).ok,
		"JSON encryption",
	)
}
function decrypt(name: string) {
	const data = JSON.parse(dotenc(["env", "decrypt", name, "--json"]))
	verify(
		data.ok &&
			typeof data.content === "string" &&
			Array.isArray(data.grantedUsers),
		"JSON decryption schema",
	)
	return data
}
try {
	exec("git", ["init", "-q"])
	exec("git", ["config", "user.email", "docs@example.invalid"])
	exec("git", ["config", "user.name", "Docs smoke"])
	exec("ssh-keygen", [
		"-q",
		"-t",
		"ed25519",
		"-N",
		"",
		"-f",
		join(home, ".ssh/id_ed25519"),
	])
	dotenc(["init", "--name", "alice", "--private-key", "id_ed25519"])
	verify(
		existsSync(join(project, ".env.development.enc")) &&
			existsSync(join(project, ".env.personal.alice.enc")),
		"quick start environment names",
	)
	const beforeInit = readFileSync(join(project, ".env.development.enc"), "utf8")
	dotenc(["init"])
	verify(
		readFileSync(join(project, ".env.development.enc"), "utf8") === beforeInit,
		"existing clone init preserves ciphertext",
	)
	const quickstart = readFileSync(
		join(root, "docs-site/src/content/docs/getting-started/quickstart.md"),
		"utf8",
	)
	const app = quickstart.match(/```js\n([\s\S]*?)```/)?.[1]
	const example = quickstart.match(/```dotenv\n([\s\S]*?)```/)?.[1]
	verify(app && example, "quick start executable fixtures")
	writeFileSync(join(project, "app.js"), app)
	// Drive the real editor path with a deterministic local editor, not a mock of the CLI.
	const editor = join(sandbox, "editor.js")
	writeFileSync(
		editor,
		`require('node:fs').writeFileSync(process.argv[2], ${JSON.stringify(example)})`,
	)
	dotenc(["env", "edit", "development"], {
		extraEnv: { EDITOR: `node ${editor}` },
	})
	verify(
		dotenc(["dev", "node", "app.js"]).includes("Hello from dotenc!"),
		"documented quick start result",
	)
	encrypt("personal.alice", "GREETING=Hello, Alice!\n")
	verify(
		dotenc(["dev", "--profile", "alice", "node", "app.js"]).includes(
			"Hello, Alice!",
		),
		"personal override",
	)
	verify(
		!existsSync(join(project, ".env.development")),
		"editor plaintext cleanup",
	)
	// Configuration and identity commands use the same isolated home.
	dotenc(["config", "editor", "node"])
	verify(
		dotenc(["config", "editor"]).includes("node"),
		"editor setting round trip",
	)
	dotenc(["config", "editor", "--remove"])
	verify(dotenc(["whoami"]).includes("alice"), "identity alias")
	verify(dotenc(["key", "list"]).includes("alice"), "public key list")
	writeFileSync(join(project, "exit.js"), "process.exit(7)")
	dotenc(["run", "--strict", "-e", "development", "node", "exit.js"], {
		status: 7,
	})
	const listing = JSON.parse(dotenc(["env", "list", "--json"]))
	verify(Array.isArray(listing.environments), "env list JSON object contract")
	dotenc(["env", "create", "base", "alice"])
	dotenc(["env", "create", "production", "alice"])
	encrypt("base", "GREETING=Base example\n")
	encrypt("production", "GREETING=Production example\n")
	verify(
		dotenc([
			"run",
			"--strict",
			"-e",
			"base,production",
			"node",
			"app.js",
		]).includes("Production example"),
		"last requested environment wins",
	)
	const nested = join(project, "packages/web")
	mkdirSync(nested, { recursive: true })
	dotenc(["env", "create", "production", "alice"], { cwd: nested })
	encrypt("production", "GREETING=Nested example\n", nested)
	verify(
		dotenc(
			["run", "--strict", "-e", "production", "node", join(project, "app.js")],
			{ cwd: nested },
		).includes("Nested example"),
		"nested environment overrides root",
	)
	verify(
		dotenc(
			[
				"run",
				"--local-only",
				"--strict",
				"-e",
				"production",
				"node",
				join(project, "app.js"),
			],
			{ cwd: nested },
		).includes("Nested example"),
		"local-only nested load",
	)
	dotenc(["run", "--strict", "-e", "missing", "node", "app.js"], { status: 1 })
	dotenc(["dev", "--strict", "--profile", "missing", "node", "app.js"], {
		status: 1,
	})
	const recipients = decrypt("base").grantedUsers
	dotenc(["env", "rename", "base", "renamed", "--yes"])
	verify(!existsSync(join(project, ".env.base.enc")), "rename removes old path")
	verify(
		JSON.stringify(decrypt("renamed").grantedUsers) ===
			JSON.stringify(recipients),
		"rename preserves recipients",
	)
	const key = join(sandbox, "teammate")
	exec("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key])
	// Teammate derives their public key locally; the maintainer receives only PEM.
	const teammateProject = join(sandbox, "teammate-project")
	mkdirSync(teammateProject)
	exec("git", ["init", "-q"], { cwd: teammateProject })
	dotenc(["key", "add", "bob", "--from-ssh", key], { cwd: teammateProject })
	dotenc([
		"key",
		"add",
		"bob",
		"--from-file",
		join(teammateProject, ".dotenc/bob.pub"),
	])
	dotenc(["auth", "grant", "production", "bob"])
	verify(decrypt("production").grantedUsers.includes("bob"), "teammate grant")
	dotenc(["auth", "revoke", "production", "bob"])
	verify(
		!decrypt("production").grantedUsers.includes("bob"),
		"single environment revoke",
	)
	dotenc(["auth", "grant", "production", "bob"])
	dotenc(["auth", "purge", "bob", "--yes"])
	verify(
		!existsSync(join(project, ".dotenc/bob.pub")) &&
			!decrypt("production").grantedUsers.includes("bob"),
		"offboarding removes key and access",
	)
	// Bootstrap identity is captured only in memory and is stripped from the child.
	const bootstrap = readFileSync(join(home, ".ssh/id_ed25519")).toString(
		"base64",
	)
	writeFileSync(
		join(project, "check-bootstrap.js"),
		"process.exit(['DOTENC_PRIVATE_KEY_BASE64','DOTENC_PRIVATE_KEY','DOTENC_PRIVATE_KEY_PASSPHRASE','DOTENC_ENV'].some(k => k in process.env) ? 1 : 0)",
	)
	dotenc(
		["run", "--strict", "-e", "production", "node", "check-bootstrap.js"],
		{
			extraEnv: {
				DOTENC_PRIVATE_KEY_BASE64: bootstrap,
				DOTENC_ENV: "production",
			},
		},
	)
	const ciHome = join(sandbox, "ci-home")
	mkdirSync(ciHome)
	dotenc(
		["run", "--strict", "-e", "production", "node", "check-bootstrap.js"],
		{
			extraEnv: {
				HOME: ciHome,
				XDG_CONFIG_HOME: ciHome,
				XDG_CACHE_HOME: ciHome,
				DOTENC_PRIVATE_KEY_BASE64: bootstrap,
			},
		},
	)
	const beforeRotate = readFileSync(join(project, ".env.renamed.enc"), "utf8")
	dotenc(["env", "rotate", "renamed"])
	verify(
		readFileSync(join(project, ".env.renamed.enc"), "utf8") !== beforeRotate,
		"rotation changes ciphertext",
	)
	verify(
		decrypt("renamed").content.includes("Base example"),
		"rotation preserves plaintext",
	)
	dotenc(["env", "delete", "renamed", "--yes"])
	verify(
		!existsSync(join(project, ".env.renamed.enc")),
		"delete removes only the selected environment",
	)
	dotenc(["env", "delete", "personal.alice", "--yes"])
	verify(
		dotenc(["dev", "node", "app.js"]).includes("Hello from dotenc!"),
		"development works without personal profile",
	)
	const doctor = JSON.parse(dotenc(["doctor", "--json"]))
	verify(
		doctor.schemaVersion === 1 && doctor.complete && doctor.exitCode === 0,
		"doctor complete JSON contract",
	)
	const invalid = JSON.parse(
		dotenc(["doctor", "--all", "--profile", "alice", "--json"], { status: 2 }),
	)
	verify(invalid.exitCode === 2, "doctor invalid invocation")
	if (process.env.DOTENC_DOCS_PUBLISHED !== "1") {
		const artifacts = join(sandbox, "artifacts")
		mkdirSync(artifacts)
		writeFileSync(join(artifacts, "app.js"), "console.log('public example')")
		verify(
			JSON.parse(dotenc(["doctor", "artifacts", artifacts, "--json"]))
				.exitCode === 0,
			"clean artifact scan",
		)
		writeFileSync(join(artifacts, ".env"), "EXAMPLE=not-a-real-secret\n")
		verify(
			JSON.parse(
				dotenc(["doctor", "artifacts", artifacts, "--json"], { status: 1 }),
			).exitCode === 1,
			"artifact plaintext detection",
		)
	}
	console.log(
		`Passed ${checks} documentation checks against ${process.env.DOTENC_DOCS_PUBLISHED === "1" ? "published CLI" : "source CLI"}. No fixture secrets or keys logged.`,
	)
} finally {
	rmSync(sandbox, { recursive: true, force: true })
}
