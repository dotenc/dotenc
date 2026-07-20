import { Command, Option } from "commander"
import pkg from "../package.json"
import { grantCommand } from "./commands/auth/grant"
import { authListCommand } from "./commands/auth/list"
import { authPurgeCommand } from "./commands/auth/purge"
import { revokeCommand } from "./commands/auth/revoke"
import { configCommand } from "./commands/config"
import { devCommand } from "./commands/dev"
import {
	_resolvePublicKeySelectionForCreate,
	createCommand,
} from "./commands/env/create"
import { decryptCommand } from "./commands/env/decrypt"
import { envDeleteCommand } from "./commands/env/delete"
import { editCommand } from "./commands/env/edit"
import { encryptCommand } from "./commands/env/encrypt"
import { envListCommand } from "./commands/env/list"
import { rotateCommand } from "./commands/env/rotate"

import { initCommand } from "./commands/init"
import { keyAddCommand } from "./commands/key/add"
import { keyListCommand } from "./commands/key/list"
import { keyRemoveCommand } from "./commands/key/remove"
import { mockUpdateCommand } from "./commands/mockupdate"
import { runCommand } from "./commands/run"
import { textconvCommand } from "./commands/textconv"
import { installAgentSkillCommand } from "./commands/tools/install-agent-skill"
import { installVscodeExtensionCommand } from "./commands/tools/install-vscode-extension"
import { updateCommand } from "./commands/update"
import { whoamiCommand } from "./commands/whoami"
import { maybeNotifyAboutUpdate } from "./helpers/updateNotifier"
import { getErrorMessage } from "./ui/errors"
import { logger } from "./ui/logger"

const program = new Command()
const collectValues = (value: string, previous: string[] = []) => [
	...previous,
	value,
]

program.name("dotenc").description(pkg.description).version(pkg.version)
program.enablePositionalOptions()

program
	.command("init")
	.addOption(new Option("-n, --name <name>", "your username for the project"))
	.addOption(
		new Option("-k, --private-key <name>", "the SSH key to use for dotenc"),
	)
	.description("initialize a dotenc project or configure an existing clone")
	.action(initCommand)

const env = program.command("env").description("manage environments")

env
	.command("create")
	.argument("[environment]", "the name of the new environment")
	.argument(
		"[publicKey]",
		"the name of the public key to grant access to the environment",
	)
	.addOption(
		new Option(
			"-k, --public-key <name>",
			"grant access to a public key (repeatable)",
		).argParser(collectValues),
	)
	.description("create a new environment")
	.action((env, pubKey, options) =>
		createCommand(
			env,
			_resolvePublicKeySelectionForCreate(pubKey, options.publicKey),
		),
	)

env
	.command("edit")
	.argument("[environment]", "the environment to edit")
	.description("edit an environment")
	.action((env) => editCommand(env))

env
	.command("decrypt", { hidden: true })
	.argument("<environment>", "the environment to decrypt")
	.addOption(new Option("--json", "output machine-readable JSON"))
	.description("decrypt an environment and print plaintext to stdout")
	.action(decryptCommand)

env
	.command("encrypt", { hidden: true })
	.argument("<environment>", "the environment to encrypt")
	.addOption(new Option("--stdin", "read plaintext content from stdin"))
	.addOption(new Option("--json", "output machine-readable JSON"))
	.description("encrypt plaintext content and write it to an environment file")
	.action(encryptCommand)

env
	.command("rotate")
	.argument("[environment]", "the environment to rotate the data key for")
	.addOption(
		new Option(
			"--all",
			"rotate all environments recursively from project root",
		),
	)
	.addOption(
		new Option("--yes", "skip confirmation prompt (only applies with --all)"),
	)
	.description(
		"rotate the data key for an environment, or all environments with --all",
	)
	.action((env, options) =>
		rotateCommand(env, options.all ?? false, options.yes ?? false),
	)

env
	.command("delete")
	.argument("[environment]", "the environment to delete")
	.addOption(new Option("--yes", "skip confirmation prompt"))
	.description("delete an environment file")
	.action((environment, options) =>
		envDeleteCommand(environment, options.yes ?? false),
	)

env
	.command("list")
	.addOption(
		new Option(
			"--all",
			"recursively list all environments from the project root",
		),
	)
	.addOption(new Option("--json", "output as JSON array"))
	.description("list environments in the current directory")
	.action((options) => envListCommand(options))

const auth = program.command("auth").description("manage environment access")

auth
	.command("grant")
	.argument("[environment]", "the environment to grant access to")
	.argument(
		"[publicKey]",
		"the name of the public key to grant access to the environment",
	)
	.description("grant access to an environment")
	.action(grantCommand)

auth
	.command("revoke")
	.argument("[environment]", "the environment to revoke access from")
	.argument(
		"[publicKey]",
		"the name of the public key to revoke access from the environment",
	)
	.description("revoke access from an environment")
	.action(revokeCommand)

auth
	.command("list")
	.argument("[environment]", "the environment to list access for")
	.description("list keys with access to an environment")
	.action(authListCommand)

auth
	.command("purge")
	.argument("<publicKey>", "the name of the public key to fully offboard")
	.addOption(new Option("--yes", "skip confirmation prompt"))
	.description("revoke and rotate all environments for a key, then remove it")
	.action((publicKey, options) =>
		authPurgeCommand(publicKey, options.yes ?? false),
	)

program
	.command("run")
	.argument("<command>", "the command to run")
	.argument("[args...]", "the arguments to pass to the command")
	.addOption(
		new Option(
			"-e, --env <env1>[,env2[,...]]",
			"the environments to run the command in",
		),
	)
	.addOption(
		new Option("--strict", "fail if any selected environment fails to load"),
	)
	.addOption(
		new Option(
			"--local-only",
			"load only from the current directory, skip ancestor dirs",
		),
	)
	.passThroughOptions()
	.description("run a command in an environment")
	.action(runCommand)

program
	.command("dev")
	.argument("<command>", "the command to run")
	.argument("[args...]", "the arguments to pass to the command")
	.addOption(
		new Option(
			"--local-only",
			"load only from the current directory, skip ancestor dirs",
		),
	)
	.addOption(new Option("-i, --identity <name>", "the identity to use"))
	.passThroughOptions()
	.description("shortcut for 'run -e development,<yourname> <command>'")
	.action((command, args, options) => devCommand(command, args, options))

const key = program.command("key").description("manage keys")

key
	.command("add")
	.argument("[name]", "the name of the public key in the project")
	.addOption(
		new Option(
			"--from-ssh <path>",
			"add a public key derived from an SSH key file",
		),
	)
	.addOption(
		new Option(
			"--from-private-key <name>",
			"add a public key from an SSH key in ~/.ssh by name",
		),
	)
	.addOption(
		new Option("-f, --from-file <file>", "add the key from a PEM file"),
	)
	.addOption(
		new Option("-s, --from-string <string>", "add a public key from a string"),
	)
	.description("add a public key to the project")
	.action(keyAddCommand)

key
	.command("list")
	.description("list all public keys in the project")
	.action(keyListCommand)

key
	.command("remove")
	.argument("[name]", "the name of the public key to remove")
	.addOption(new Option("--yes", "skip confirmation prompt"))
	.description("remove a public key from the project")
	.action((name, options) => keyRemoveCommand(name, options.yes ?? false))

const tools = program
	.command("tools")
	.description("install editor integrations")

tools
	.command("install-agent-skill")
	.addOption(
		new Option("--scope <scope>", "install scope").choices(["local", "global"]),
	)
	.addOption(
		new Option("--force", "run npx skills in non-interactive mode (-y)"),
	)
	.description("install the agent skill for this project")
	.action(installAgentSkillCommand)

tools
	.command("install-vscode-extension")
	.addOption(
		new Option(
			"--open",
			"open the extension page when a single editor is detected",
		),
	)
	.addOption(
		new Option(
			"--manual",
			"print the install URL instead of opening it automatically",
		),
	)
	.description(
		"add dotenc to VS Code / Cursor / Windsurf extension recommendations",
	)
	.action(installVscodeExtensionCommand)

program
	.command("textconv", { hidden: true })
	.argument("<filepath>", "path to the encrypted environment file")
	.description("decrypt an environment file for git diff")
	.action(textconvCommand)

program
	.command("update")
	.description("update dotenc based on your installation method")
	.action(updateCommand)

program
	.command("mockupdate", { hidden: true })
	.argument("[currentVersion]", "mock current version for preview")
	.argument("[latestVersion]", "mock latest version for preview")
	.description("print a mock update notification (hidden)")
	.action(mockUpdateCommand)

program
	.command("whoami")
	.description("show your identity in this project")
	.action(whoamiCommand)

program
	.command("config")
	.argument("<key>", "the key to get or set")
	.argument("[value]", "the value to set the key to")
	.addOption(new Option("-r, --remove", "remove a configuration key"))
	.description("manage global configuration")
	.action(configCommand)

await maybeNotifyAboutUpdate()

try {
	await program.parseAsync()
} catch (error) {
	if (error instanceof Error && error.name === "ExitPromptError") {
		process.exit(0)
	}

	logger.error(getErrorMessage(error))
	process.exit(1)
}
