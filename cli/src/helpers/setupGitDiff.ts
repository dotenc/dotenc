import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

export const setupGitDiff = (projectRoot = process.cwd()) => {
	// Configure git first so a failure cannot leave a tracked attribute change.
	const result = spawnSync(
		"git",
		["config", "--local", "diff.dotenc.textconv", "dotenc textconv"],
		{
			cwd: projectRoot,
			stdio: "ignore",
		},
	)

	if (result.error) {
		throw new Error(
			`Could not configure the Git diff driver: ${result.error.message}`,
		)
	}

	if (result.status !== 0) {
		throw new Error(
			`Could not configure the Git diff driver in ${projectRoot}. Make sure this is a Git repository.`,
		)
	}

	// Append *.enc diff=dotenc to .gitattributes if not already present
	const gitattributesPath = path.join(projectRoot, ".gitattributes")
	const marker = "*.enc diff=dotenc"

	let content = ""
	if (fs.existsSync(gitattributesPath)) {
		content = fs.readFileSync(gitattributesPath, "utf-8")
	}

	if (!content.includes(marker)) {
		const newline = content.length > 0 && !content.endsWith("\n") ? "\n" : ""
		fs.writeFileSync(gitattributesPath, `${content}${newline}${marker}\n`)
	}
}
