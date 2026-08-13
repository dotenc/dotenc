const path = require("node:path")
const vscode = require("vscode")
const { EnvironmentsProvider } = require("./EnvironmentsProvider")
const { KeysProvider } = require("./KeysProvider")
const { appendProcessLogs } = require("./helpers/appendProcessLogs")
const { closeFileTabs } = require("./helpers/closeFileTabs")
const {
	DOTENC_SCHEME,
	INSTALL_ACTION_LABEL,
	VIEW_DECRYPTED_COMMAND,
	VIEW_ENCRYPTED_COMMAND,
	SHOW_LOGS_ACTION_LABEL,
	UPDATE_ACTION_LABEL,
} = require("./helpers/constants")
const {
	ensureEnvironmentLanguage,
} = require("./helpers/ensureEnvironmentLanguage")
const { fallbackFailure } = require("./helpers/fallbackFailure")
const { fetchLatestCliVersion } = require("./helpers/fetchLatestCliVersion")
const { formatDetectedVersion } = require("./helpers/formatDetectedVersion")
const { getDotencExecutable } = require("./helpers/getDotencExecutable")
const { getDotencInstallCommand } = require("./helpers/getDotencInstallCommand")
const { getDotencTarget } = require("./helpers/getDotencTarget")
const {
	isAutoViewDecryptedEnabled,
} = require("./helpers/isAutoViewDecryptedEnabled")
const {
	isDotencEnvironmentFileUri,
} = require("./helpers/isDotencEnvironmentFileUri")
const { isUpdateMethodFallback } = require("./helpers/isUpdateMethodFallback")
const { isVersionNewer } = require("./helpers/isVersionNewer")
const { isVersionSupported } = require("./helpers/isVersionSupported")
const {
	mapFailureToFileSystemError,
} = require("./helpers/mapFailureToFileSystemError")
const { MIN_DOTENC_VERSION } = require("./helpers/minDotencVersion")
const { parseJsonPayload } = require("./helpers/parseJsonPayload")
const { resolveSourceUri } = require("./helpers/resolveSourceUri")
const { runProcess } = require("./helpers/runProcess")
const {
	shouldSkipCliUpdateCheck,
} = require("./helpers/shouldSkipCliUpdateCheck")
const { stripAnsi } = require("./helpers/stripAnsi")
const { toDotencUri } = require("./helpers/toDotencUri")
const { toErrorMessage } = require("./helpers/toErrorMessage")
const { toFileUri } = require("./helpers/toFileUri")

const EXTENSION_PROCESS_CWD = path.resolve(__dirname, "..")
const UNTRUSTED_WORKSPACE_MESSAGE =
	"Trust this workspace before using dotenc to decrypt, encrypt, or manage environments."
const versionCompatibilityCache = new Map()
let cliActivityHandler = () => {}

function isWorkspaceTrusted() {
	return vscode.workspace.isTrusted === true
}

function untrustedWorkspaceFailure() {
	return {
		code: "WORKSPACE_UNTRUSTED",
		message: UNTRUSTED_WORKSPACE_MESSAGE,
	}
}

function untrustedWorkspaceProcessResult() {
	return {
		code: 1,
		stdout: "",
		stderr: UNTRUSTED_WORKSPACE_MESSAGE,
		error: new Error(UNTRUSTED_WORKSPACE_MESSAGE),
	}
}

function assertWorkspaceTrusted() {
	if (!isWorkspaceTrusted()) {
		throw new Error(UNTRUSTED_WORKSPACE_MESSAGE)
	}
}

class DotencFileSystemProvider {
	constructor() {
		this._onDidChangeFile = new vscode.EventEmitter()
		this.onDidChangeFile = this._onDidChangeFile.event
	}

	watch() {
		assertWorkspaceTrusted()
		return new vscode.Disposable(() => {})
	}

	async stat(uri) {
		assertWorkspaceTrusted()
		return vscode.workspace.fs.stat(toFileUri(uri))
	}

	async readDirectory(uri) {
		assertWorkspaceTrusted()
		return vscode.workspace.fs.readDirectory(toFileUri(uri))
	}

	async createDirectory(uri) {
		assertWorkspaceTrusted()
		await vscode.workspace.fs.createDirectory(toFileUri(uri))
	}

	async readFile(uri) {
		assertWorkspaceTrusted()
		const target = getDotencTarget(uri)
		const result = await decryptEnvironment(target)
		if (!result.ok) {
			throw mapFailureToFileSystemError(target.environmentName, result.error)
		}

		return Buffer.from(result.content, "utf-8")
	}

	async writeFile(uri, content) {
		assertWorkspaceTrusted()
		const target = getDotencTarget(uri)
		const plaintext = Buffer.from(content).toString("utf-8")
		const result = await encryptEnvironment(target, plaintext)
		if (!result.ok) {
			throw mapFailureToFileSystemError(target.environmentName, result.error)
		}
	}

	async delete(uri, options) {
		assertWorkspaceTrusted()
		await vscode.workspace.fs.delete(toFileUri(uri), options)
	}

	async rename(oldUri, newUri, options) {
		assertWorkspaceTrusted()
		await vscode.workspace.fs.rename(
			toFileUri(oldUri),
			toFileUri(newUri),
			options,
		)
	}
}

async function ensureDotencCompatibility(uri) {
	if (!isWorkspaceTrusted()) {
		return { ok: false, error: untrustedWorkspaceFailure() }
	}

	const executable = getDotencExecutable(uri)
	const cacheKey = executable
	const cached = versionCompatibilityCache.get(cacheKey)
	if (cached) {
		return cached
	}

	const versionResult = await runProcess(executable, EXTENSION_PROCESS_CWD, [
		"--version",
	])

	if (versionResult.error && versionResult.error.code === "ENOENT") {
		const failure = fallbackFailure(versionResult)
		return { ok: false, error: failure }
	}

	if (versionResult.code !== 0) {
		const failure = fallbackFailure(versionResult)
		return { ok: false, error: failure }
	}

	const versionOutput = stripAnsi(
		`${versionResult.stdout}\n${versionResult.stderr}`.trim(),
	)
	if (!isVersionSupported(versionOutput, MIN_DOTENC_VERSION)) {
		const detectedVersion = formatDetectedVersion(versionOutput)
		return {
			ok: false,
			error: {
				code: "CLI_VERSION_UNSUPPORTED",
				message: `dotenc CLI version ${detectedVersion} is not supported. This extension requires dotenc >= ${MIN_DOTENC_VERSION}.`,
			},
		}
	}

	const compatibility = { ok: true }
	versionCompatibilityCache.set(cacheKey, compatibility)
	return compatibility
}

async function runDotenc(uri, cwd, args, stdinInput) {
	if (!isWorkspaceTrusted()) {
		return untrustedWorkspaceProcessResult()
	}

	const compatibility = await ensureDotencCompatibility(uri)
	if (!compatibility.ok) {
		// A user-initiated operation may legitimately need the install flow.
		cliActivityHandler()
		return {
			code: 1,
			stdout: "",
			stderr: compatibility.error.message,
			error: undefined,
		}
	}

	if (!isWorkspaceTrusted()) {
		return untrustedWorkspaceProcessResult()
	}

	const result = await runProcess(
		getDotencExecutable(uri),
		cwd,
		args,
		stdinInput,
	)
	// Avoid racing an update against the operation that triggered the first CLI
	// activity. The check remains lazy and starts only after that operation ends.
	cliActivityHandler()
	return result
}

async function decryptEnvironment(document) {
	if (!isWorkspaceTrusted()) {
		return { ok: false, error: untrustedWorkspaceFailure() }
	}

	const result = await runDotenc(
		document.uri,
		document.cwd,
		["env", "decrypt", document.environmentName, "--json"],
		undefined,
	)

	const parsed = parseJsonPayload(result.stdout)
	if (parsed && parsed.ok === true && typeof parsed.content === "string") {
		return { ok: true, content: parsed.content }
	}

	if (parsed && parsed.ok === false && parsed.error) {
		return {
			ok: false,
			error: {
				code: parsed.error.code || "UNKNOWN",
				message: stripAnsi(
					parsed.error.message || "Failed to decrypt environment.",
				),
			},
		}
	}

	return { ok: false, error: fallbackFailure(result) }
}

async function encryptEnvironment(document, plaintext) {
	if (!isWorkspaceTrusted()) {
		return { ok: false, error: untrustedWorkspaceFailure() }
	}

	const result = await runDotenc(
		document.uri,
		document.cwd,
		["env", "encrypt", document.environmentName, "--stdin", "--json"],
		plaintext,
	)

	const parsed = parseJsonPayload(result.stdout)
	if (parsed && parsed.ok === true) {
		return { ok: true }
	}

	if (parsed && parsed.ok === false && parsed.error) {
		return {
			ok: false,
			error: {
				code: parsed.error.code || "UNKNOWN",
				message: stripAnsi(
					parsed.error.message || "Failed to encrypt environment.",
				),
			},
		}
	}

	return { ok: false, error: fallbackFailure(result) }
}

async function runCliUpdate(outputChannel, currentVersion, latestVersion) {
	if (!isWorkspaceTrusted()) {
		return
	}

	const executable = getDotencExecutable()
	const updateResult = await runProcess(executable, EXTENSION_PROCESS_CWD, [
		"update",
	])
	const output = stripAnsi(
		`${updateResult.stdout}\n${updateResult.stderr}`.trim(),
	)

	appendProcessLogs(
		outputChannel,
		`[dotenc] ${executable} update (current: ${currentVersion}, latest: ${latestVersion})`,
		updateResult,
	)

	if (isUpdateMethodFallback(output)) {
		const action = await vscode.window.showWarningMessage(
			"dotenc could not self-update automatically for this installation method. Check logs for manual update instructions.",
			SHOW_LOGS_ACTION_LABEL,
		)
		if (action === SHOW_LOGS_ACTION_LABEL) {
			outputChannel.show(true)
		}
		return
	}

	if (updateResult.error && updateResult.error.code === "ENOENT") {
		vscode.window.showErrorMessage(
			'dotenc CLI was not found. Configure "dotenc.executablePath" in VS Code settings.',
		)
		return
	}

	if (updateResult.code !== 0) {
		const action = await vscode.window.showErrorMessage(
			"dotenc update failed. Check logs for details.",
			SHOW_LOGS_ACTION_LABEL,
		)
		if (action === SHOW_LOGS_ACTION_LABEL) {
			outputChannel.show(true)
		}
		return
	}

	vscode.window.showInformationMessage(
		`dotenc update completed (${currentVersion} -> ${latestVersion}). Restart terminal sessions if needed.`,
	)
}

async function maybePromptCliInstall(outputChannel, executable) {
	if (!isWorkspaceTrusted()) {
		return false
	}

	if (executable !== "dotenc") {
		return false
	}

	const action = await vscode.window.showInformationMessage(
		"dotenc CLI was not found on PATH. Install it now using the official installer?",
		INSTALL_ACTION_LABEL,
	)
	if (action !== INSTALL_ACTION_LABEL) {
		return false
	}

	const installCommand = getDotencInstallCommand()
	if (!installCommand) {
		vscode.window.showWarningMessage(
			'Automatic installation via curl is currently unavailable on this platform. Install dotenc manually or configure "dotenc.executablePath".',
		)
		return false
	}

	if (!isWorkspaceTrusted()) {
		return false
	}

	const downloadResult = await runProcess(
		installCommand.download.executable,
		EXTENSION_PROCESS_CWD,
		installCommand.download.args,
	)
	appendProcessLogs(
		outputChannel,
		`[dotenc] ${installCommand.download.executable} ${installCommand.download.args.join(" ")}`,
		downloadResult,
	)

	if (downloadResult.error || downloadResult.code !== 0) {
		const logsAction = await vscode.window.showErrorMessage(
			"dotenc installation failed. Check logs for details.",
			SHOW_LOGS_ACTION_LABEL,
		)
		if (logsAction === SHOW_LOGS_ACTION_LABEL) {
			outputChannel.show(true)
		}
		return false
	}

	if (!isWorkspaceTrusted()) {
		return false
	}

	const installResult = await runProcess(
		installCommand.install.executable,
		EXTENSION_PROCESS_CWD,
		installCommand.install.args,
		downloadResult.stdout,
	)
	appendProcessLogs(
		outputChannel,
		`[dotenc] ${installCommand.install.executable} ${installCommand.install.args.join(" ") || "(stdin installer)"}`,
		installResult,
	)

	if (installResult.error || installResult.code !== 0) {
		const logsAction = await vscode.window.showErrorMessage(
			"dotenc installation failed. Check logs for details.",
			SHOW_LOGS_ACTION_LABEL,
		)
		if (logsAction === SHOW_LOGS_ACTION_LABEL) {
			outputChannel.show(true)
		}
		return false
	}

	if (!isWorkspaceTrusted()) {
		return false
	}

	const postInstallVersion = await runProcess(
		executable,
		EXTENSION_PROCESS_CWD,
		["--version"],
	)
	appendProcessLogs(
		outputChannel,
		`[dotenc] ${executable} --version (after install)`,
		postInstallVersion,
	)

	if (postInstallVersion.error || postInstallVersion.code !== 0) {
		const logsAction = await vscode.window.showWarningMessage(
			"dotenc was installed, but it is not yet available in this VS Code session. Restart VS Code or set dotenc.executablePath manually.",
			SHOW_LOGS_ACTION_LABEL,
		)
		if (logsAction === SHOW_LOGS_ACTION_LABEL) {
			outputChannel.show(true)
		}
		return false
	}

	versionCompatibilityCache.clear()
	vscode.window.showInformationMessage("dotenc CLI installed successfully.")
	return true
}

async function maybePromptCliUpdate(outputChannel) {
	if (!isWorkspaceTrusted() || shouldSkipCliUpdateCheck()) {
		return
	}

	const executable = getDotencExecutable()
	let versionResult = await runProcess(executable, EXTENSION_PROCESS_CWD, [
		"--version",
	])

	if (versionResult.error && versionResult.error.code === "ENOENT") {
		const installed = await maybePromptCliInstall(outputChannel, executable)
		if (!installed) {
			return
		}

		if (!isWorkspaceTrusted()) {
			return
		}

		versionResult = await runProcess(executable, EXTENSION_PROCESS_CWD, [
			"--version",
		])
	}

	if (versionResult.error || versionResult.code !== 0) {
		return
	}

	const currentVersion = formatDetectedVersion(
		stripAnsi(`${versionResult.stdout}\n${versionResult.stderr}`.trim()),
	)
	if (currentVersion === "unknown") {
		return
	}

	if (!isWorkspaceTrusted()) {
		return
	}

	const latestVersion = await fetchLatestCliVersion()
	if (!latestVersion || !isVersionNewer(latestVersion, currentVersion)) {
		return
	}

	const action = await vscode.window.showInformationMessage(
		`A newer dotenc CLI version is available (${currentVersion} -> ${latestVersion}).`,
		UPDATE_ACTION_LABEL,
	)

	if (action !== UPDATE_ACTION_LABEL) {
		return
	}

	await runCliUpdate(outputChannel, currentVersion, latestVersion)
}

async function viewDecrypted(resource) {
	try {
		assertWorkspaceTrusted()
		const fileUri = resolveSourceUri(resource)
		const dotencUri = toDotencUri(fileUri)
		let document = await vscode.workspace.openTextDocument(dotencUri)
		document = await ensureEnvironmentLanguage(document)
		await vscode.window.showTextDocument(document)
		await closeFileTabs(fileUri)
	} catch (error) {
		const message = toErrorMessage(error)
		vscode.window.showErrorMessage(message)
		throw new Error(message)
	}
}

async function viewEncrypted(resource, suppressAutoRedirectOnce) {
	assertWorkspaceTrusted()
	const fileUri = resolveSourceUri(resource)
	const key = fileUri.toString()
	suppressAutoRedirectOnce.add(key)

	try {
		const document = await vscode.workspace.openTextDocument(fileUri)
		await vscode.window.showTextDocument(document)
	} catch (error) {
		suppressAutoRedirectOnce.delete(key)
		const message = toErrorMessage(error)
		vscode.window.showErrorMessage(message)
		throw new Error(message)
	}
}

function activate(context) {
	if (!isWorkspaceTrusted()) {
		return
	}

	const fileSystemProvider = new DotencFileSystemProvider()
	const outputChannel = vscode.window.createOutputChannel("dotenc")
	const redirectInProgress = new Set()
	const suppressAutoRedirectOnce = new Set()
	const environmentsProvider = new EnvironmentsProvider()
	const keysProvider = new KeysProvider()
	let cliUpdateCheckStarted = false
	cliActivityHandler = () => {
		if (cliUpdateCheckStarted || !isWorkspaceTrusted()) {
			return
		}

		cliUpdateCheckStarted = true
		setTimeout(() => {
			void maybePromptCliUpdate(outputChannel).catch((error) => {
				outputChannel.appendLine(
					`Failed to check for CLI updates: ${error instanceof Error ? error.message : String(error)}`,
				)
			})
		}, 0)
	}

	const autoOpenCurrentEditorIfNeeded = async (editor) => {
		if (!isWorkspaceTrusted() || !editor || !editor.document) {
			return
		}

		const uri = editor.document.uri
		if (!isDotencEnvironmentFileUri(uri)) {
			return
		}
		if (!isAutoViewDecryptedEnabled()) {
			return
		}

		const key = uri.toString()
		if (suppressAutoRedirectOnce.has(key)) {
			suppressAutoRedirectOnce.delete(key)
			return
		}
		if (redirectInProgress.has(key)) {
			return
		}
		redirectInProgress.add(key)

		try {
			await viewDecrypted(uri)
		} catch {
			// Error already surfaced via showErrorMessage in viewDecrypted.
		} finally {
			redirectInProgress.delete(key)
		}
	}

	context.subscriptions.push(
		vscode.workspace.registerFileSystemProvider(
			DOTENC_SCHEME,
			fileSystemProvider,
			{
				isCaseSensitive: process.platform !== "win32",
			},
		),
		vscode.commands.registerCommand(VIEW_DECRYPTED_COMMAND, viewDecrypted),
		vscode.commands.registerCommand(VIEW_ENCRYPTED_COMMAND, (resource) =>
			viewEncrypted(resource, suppressAutoRedirectOnce),
		),
		vscode.commands.registerCommand("dotenc.editEnvironment", async (item) => {
			if (item?.fileUri) {
				await viewDecrypted(item.fileUri)
			}
		}),
		vscode.commands.registerCommand(
			"dotenc.rotateEnvironment",
			async (item) => {
				if (!isWorkspaceTrusted()) return
				if (!item?.envDir || !item?.environmentName) return
				const result = await runDotenc(item.fileUri, item.envDir, [
					"env",
					"rotate",
					item.environmentName,
					"--yes",
				])
				if (result.error || result.code !== 0) {
					vscode.window.showErrorMessage(
						`Rotate failed: ${result.stderr || result.error?.message}`,
					)
				} else {
					environmentsProvider.refresh()
				}
			},
		),
		vscode.commands.registerCommand(
			"dotenc.deleteEnvironment",
			async (item) => {
				if (!isWorkspaceTrusted()) return
				if (!item?.envDir || !item?.environmentName) return
				const answer = await vscode.window.showWarningMessage(
					`Delete environment "${item.environmentName}"?`,
					{ modal: true },
					"Delete",
				)
				if (answer !== "Delete") return
				const result = await runDotenc(item.fileUri, item.envDir, [
					"env",
					"delete",
					item.environmentName,
					"--yes",
				])
				if (result.error || result.code !== 0) {
					vscode.window.showErrorMessage(
						`Delete failed: ${result.stderr || result.error?.message}`,
					)
				} else {
					environmentsProvider.refresh()
				}
			},
		),
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			void autoOpenCurrentEditorIfNeeded(editor)
		}),
		outputChannel,
		environmentsProvider,
		keysProvider,
		vscode.window.createTreeView("dotenc.environments", {
			treeDataProvider: environmentsProvider,
			showCollapseAll: true,
		}),
		vscode.window.createTreeView("dotenc.keys", {
			treeDataProvider: keysProvider,
			showCollapseAll: false,
		}),
		new vscode.Disposable(() => {
			cliActivityHandler = () => {}
		}),
	)

	void autoOpenCurrentEditorIfNeeded(vscode.window.activeTextEditor)
}

function deactivate() {}

module.exports = {
	activate,
	deactivate,
}
