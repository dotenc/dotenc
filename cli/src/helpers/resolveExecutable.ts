import { accessSync, constants } from "node:fs"
import path from "node:path"

const canExecute = (candidate: string) => {
	try {
		accessSync(
			candidate,
			process.platform === "win32" ? constants.F_OK : constants.X_OK,
		)
		return true
	} catch {
		return false
	}
}

/** Resolve only the initial executable against the caller's original PATH. */
export const resolveExecutable = (
	command: string,
	originalEnv: NodeJS.ProcessEnv = process.env,
): string | undefined => {
	if (
		path.isAbsolute(command) ||
		command.includes("/") ||
		command.includes("\\")
	) {
		return command
	}

	const searchPath = originalEnv.PATH ?? originalEnv.Path ?? originalEnv.path
	if (!searchPath) return undefined

	const hasWindowsExtension = path.extname(command).length > 0
	const extensions =
		process.platform === "win32" && !hasWindowsExtension
			? (originalEnv.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
			: [""]

	for (const rawDir of searchPath.split(path.delimiter)) {
		const dir = rawDir.replace(/^"|"$/g, "")
		if (!dir) continue
		for (const extension of extensions) {
			const candidate = path.join(dir, `${command}${extension}`)
			if (canExecute(candidate)) return candidate
		}
	}

	return undefined
}
