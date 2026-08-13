const fs = require("node:fs")
const os = require("node:os")
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
	const extensionTestsPath = path.resolve(__dirname, "suite", "index.js")
	const fixtureWorkspacePath = path.resolve(__dirname, "fixtures", "workspace-integration")

	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dotenc-vscode-it-"))
	const workspacePath = path.join(tmpRoot, "workspace")
	fs.cpSync(fixtureWorkspacePath, workspacePath, { recursive: true })

	try {
		const downloadedExecutable = await downloadAndUnzipVSCode()
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			vscodeExecutablePath: resolveVSCodeExecutable(downloadedExecutable),
			launchArgs: [workspacePath, "--disable-extensions"],
			extensionTestsEnv: {
				DOTENC_VSCODE_TEST: "1",
			},
		})
	} finally {
		fs.rmSync(tmpRoot, { recursive: true, force: true })
	}
}

main().catch((error) => {
	console.error("Failed to run VS Code integration tests.")
	console.error(error)
	process.exit(1)
})
