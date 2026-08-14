const { AUTO_VIEW_DECRYPTED_SETTING } = require("./constants")
const {
	getMachineScopedConfigurationValue,
} = require("./getMachineScopedConfigurationValue")

function isAutoViewDecryptedEnabled(getConfiguration) {
	const configuration =
		typeof getConfiguration === "function"
			? getConfiguration()
			: require("vscode").workspace.getConfiguration("dotenc")
	return (
		getMachineScopedConfigurationValue(
			configuration,
			AUTO_VIEW_DECRYPTED_SETTING,
			true,
		) === true
	)
}

module.exports = {
	isAutoViewDecryptedEnabled,
}
