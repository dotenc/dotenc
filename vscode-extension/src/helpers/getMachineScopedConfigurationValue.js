function getMachineScopedConfigurationValue(configuration, setting, fallback) {
	const inspected = configuration?.inspect?.(setting)
	if (!inspected) {
		return fallback
	}

	if (inspected.globalValue !== undefined) {
		return inspected.globalValue
	}

	if (inspected.defaultValue !== undefined) {
		return inspected.defaultValue
	}

	return fallback
}

module.exports = {
	getMachineScopedConfigurationValue,
}
