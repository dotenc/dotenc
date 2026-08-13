import chalk from "chalk"
import { isEditorCommandFreeOfShellMetacharacters } from "../helpers/getDefaultEditor"
import { getHomeConfig, setHomeConfig } from "../helpers/homeConfig"

type Options = {
	remove: boolean
}

const SUPPORTED_CONFIG_KEYS = ["editor"] as const
type SupportedConfigKey = (typeof SUPPORTED_CONFIG_KEYS)[number]

const getSupportedConfigKey = (
	key: string,
): { valid: true; key: SupportedConfigKey } | { valid: false } => {
	if (SUPPORTED_CONFIG_KEYS.includes(key as SupportedConfigKey)) {
		return { valid: true, key: key as SupportedConfigKey }
	}
	return { valid: false }
}

export const configCommand = async (
	key: string,
	value: string | undefined,
	options: Options,
) => {
	const keyValidation = getSupportedConfigKey(key)
	if (!keyValidation.valid) {
		console.error(
			`${chalk.red("Error:")} unsupported config key "${key}". Supported keys: ${SUPPORTED_CONFIG_KEYS.join(", ")}.`,
		)
		process.exit(1)
	}

	const config = await getHomeConfig()
	const configKey = keyValidation.key

	if (options.remove) {
		delete config[configKey]
		await setHomeConfig(config)
		return
	}

	if (value !== undefined) {
		if (
			configKey === "editor" &&
			!isEditorCommandFreeOfShellMetacharacters(value)
		) {
			console.error(
				`${chalk.red("Error:")} editor commands must not contain shell metacharacters. A configured editor and its arguments are trusted to execute as the current user.`,
			)
			process.exit(1)
		}
		config[configKey] = value
		await setHomeConfig(config)
		return
	}

	console.log(config[configKey] ?? "")
}
