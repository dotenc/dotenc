const path = require("node:path")
const {
	downloadAndUnzipVSCode,
	runTests,
} = require("@vscode/test-electron")
const {
	resolveVSCodeExecutable,
} = require("./resolve-vscode-executable")

async function main() {
	const extensionDevelopmentPath = path.resolve(__dirname, "..")
	const extensionTestsPath = path.resolve(__dirname, "suite", "manual-setup.js")
	const workspacePath = path.resolve(__dirname, "fixtures", "workspace-dev")

	console.log("Opening VS Code with dotenc extension... close the window when done.\n")

	const downloadedExecutable = await downloadAndUnzipVSCode()
	try {
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			vscodeExecutablePath: resolveVSCodeExecutable(downloadedExecutable),
			launchArgs: [workspacePath, "--disable-extensions"],
		})
	} catch {
		// VS Code closed by the user — expected
	}
}

main().catch((error) => {
	console.error("Failed to launch VS Code.")
	console.error(error)
	process.exit(1)
})
