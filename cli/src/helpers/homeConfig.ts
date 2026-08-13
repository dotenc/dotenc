import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

const updateConfigSchema = z.object({
	lastCheckedAt: z.string().nullish(),
	latestVersion: z.string().nullish(),
	notifiedVersion: z.string().nullish(),
})

const homeConfigSchema = z.object({
	editor: z.string().nullish(),
	update: updateConfigSchema.nullish(),
})

type HomeConfig = z.infer<typeof homeConfigSchema>

const getConfigPath = () => path.join(os.homedir(), ".dotenc", "config.json")

export const setHomeConfig = async (config: HomeConfig) => {
	const parsedConfig = homeConfigSchema.parse(config)
	const configPath = getConfigPath()
	const configDir = path.dirname(configPath)
	await fs.mkdir(configDir, { recursive: true, mode: 0o700 })
	await fs.chmod(configDir, 0o700)
	await fs.writeFile(configPath, JSON.stringify(parsedConfig, null, 2), {
		encoding: "utf-8",
		mode: 0o600,
	})
	await fs.chmod(configPath, 0o600)
}

export const getHomeConfig = async () => {
	const configPath = getConfigPath()
	if (existsSync(configPath)) {
		await fs.chmod(path.dirname(configPath), 0o700)
		await fs.chmod(configPath, 0o600)
		const config = JSON.parse(await fs.readFile(configPath, "utf-8"))
		return homeConfigSchema.parse(config)
	}

	return {} as HomeConfig
}
