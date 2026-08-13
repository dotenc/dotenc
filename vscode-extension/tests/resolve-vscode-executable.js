const fs = require("node:fs")
const path = require("node:path")

function resolveVSCodeExecutable(downloadedExecutable) {
	if (fs.existsSync(downloadedExecutable)) {
		return downloadedExecutable
	}

	// Recent macOS archives name the app executable `Code`, while older
	// @vscode/test-electron releases still return the historical `Electron` path.
	if (
		process.platform === "darwin" &&
		path.basename(downloadedExecutable) === "Electron"
	) {
		const codeExecutable = path.join(
			path.dirname(downloadedExecutable),
			"Code",
		)
		if (fs.existsSync(codeExecutable)) {
			return codeExecutable
		}
	}

	return downloadedExecutable
}

module.exports = { resolveVSCodeExecutable }
