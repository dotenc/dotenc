const {
	getMachineScopedConfigurationValue,
} = require("./getMachineScopedConfigurationValue")

function normalizeExecutablePath(value) {
	if (typeof value !== "string") {
		return "dotenc"
	}

	const normalized = value.trim()
	return normalized.length > 0 ? normalized : "dotenc"
}

function getDotencExecutable(_uri, getConfiguration) {
	const configuration =
		typeof getConfiguration === "function"
			? getConfiguration()
			: require("vscode").workspace.getConfiguration("dotenc")
	const configured = getMachineScopedConfigurationValue(
		configuration,
		"executablePath",
		"dotenc",
	)

	return normalizeExecutablePath(configured)
}

module.exports = {
	getDotencExecutable,
	normalizeExecutablePath,
}
