const vscode = require("vscode")
const { getFailureUserMessage } = require("./getFailureUserMessage")

function mapFailureToFileSystemError(environmentName, failure) {
	const message = getFailureUserMessage(environmentName, failure)
	if (
		failure?.code === "ACCESS_DENIED" ||
		failure?.code === "WORKSPACE_UNTRUSTED"
	) {
		return vscode.FileSystemError.NoPermissions(message)
	}
	if (failure?.code === "ENVIRONMENT_NOT_FOUND") {
		return vscode.FileSystemError.FileNotFound(message)
	}

	return vscode.FileSystemError.Unavailable(message)
}

module.exports = {
	mapFailureToFileSystemError,
}
