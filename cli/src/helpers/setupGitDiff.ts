import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

export const DOTENC_DIFF_TEXTCONV = "dotenc textconv"
export const DOTENC_DIFF_CACHE_TEXTCONV = "false"
export const DOTENC_DIFF_ATTRIBUTE = ".env.*.enc diff=dotenc"

export const setupGitDiff = (projectRoot = process.cwd()) => {
	// Configure git first so a failure cannot leave a tracked attribute change.
	for (const [key, value] of [
		["diff.dotenc.textconv", DOTENC_DIFF_TEXTCONV],
		["diff.dotenc.cachetextconv", DOTENC_DIFF_CACHE_TEXTCONV],
	] as const) {
		const result = spawnSync("git", ["config", "--local", key, value], {
			cwd: projectRoot,
			stdio: "ignore",
		})

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
	}

	// Limit the driver to dotenc environment envelopes. The legacy broad marker
	// is migrated only when it is an exact line so user-owned attributes remain
	// untouched.
	const gitattributesPath = path.join(projectRoot, ".gitattributes")
	const legacyMarker = "*.enc diff=dotenc"
	const marker = DOTENC_DIFF_ATTRIBUTE

	let content = ""
	if (fs.existsSync(gitattributesPath)) {
		content = fs.readFileSync(gitattributesPath, "utf-8")
	}

	const lines = content.split(/\r?\n/)
	let changed = false
	const migratedLines = lines.flatMap((line) => {
		if (line === legacyMarker) {
			changed = true
			return content.includes(marker) ? [] : [marker]
		}

		return [line]
	})

	content = migratedLines.join("\n")

	if (!content.split(/\r?\n/).includes(marker)) {
		const newline = content.length > 0 && !content.endsWith("\n") ? "\n" : ""
		content = `${content}${newline}${marker}\n`
		changed = true
	}

	if (changed) {
		fs.writeFileSync(gitattributesPath, content)
	}
}
