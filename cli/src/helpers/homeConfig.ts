import { constants } from "node:fs"
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

const UNSAFE_CONFIG_PATH_ERROR =
	"Refusing to use a symbolic link or non-standard file for dotenc home configuration."

const isNotFound = (error: unknown) =>
	error instanceof Error &&
	"code" in error &&
	(error as NodeJS.ErrnoException).code === "ENOENT"

const getConfigPaths = async () => {
	// The operating system's home directory is the trust anchor. Canonicalize it
	// once so a legitimate platform-level home symlink does not make every config
	// access fail, then reject symlinks in the dotenc-managed components below it.
	const homeDir = await fs.realpath(os.homedir())
	const configDir = path.join(homeDir, ".dotenc")
	return { configDir, configPath: path.join(configDir, "config.json") }
}

const inspectConfigDirectory = async (
	configDir: string,
): Promise<"missing" | "safe"> => {
	let stat: Awaited<ReturnType<typeof fs.lstat>>
	try {
		stat = await fs.lstat(configDir)
	} catch (error) {
		if (isNotFound(error)) return "missing"
		throw error
	}

	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(UNSAFE_CONFIG_PATH_ERROR)
	}
	return "safe"
}

const ensureConfigDirectory = async (configDir: string) => {
	if ((await inspectConfigDirectory(configDir)) === "missing") {
		try {
			await fs.mkdir(configDir, { mode: 0o700 })
		} catch (error) {
			if (
				!(
					error instanceof Error &&
					"code" in error &&
					(error as NodeJS.ErrnoException).code === "EEXIST"
				)
			) {
				throw error
			}
		}
		await inspectConfigDirectory(configDir)
	}

	if (process.platform === "win32") {
		await fs.chmod(configDir, 0o700)
		return
	}

	// On POSIX, bind permission changes to an opened, non-symlink directory
	// handle instead of resolving the path again after validation.
	const handle = await fs.open(
		configDir,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	)
	try {
		if (!(await handle.stat()).isDirectory()) {
			throw new Error(UNSAFE_CONFIG_PATH_ERROR)
		}
		await handle.chmod(0o700)
	} finally {
		await handle.close()
	}
}

const inspectConfigFile = async (
	configPath: string,
): Promise<"missing" | "safe"> => {
	let stat: Awaited<ReturnType<typeof fs.lstat>>
	try {
		stat = await fs.lstat(configPath)
	} catch (error) {
		if (isNotFound(error)) return "missing"
		throw error
	}

	if (stat.isSymbolicLink() || !stat.isFile()) {
		throw new Error(UNSAFE_CONFIG_PATH_ERROR)
	}
	return "safe"
}

const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW
const nonBlock = process.platform === "win32" ? 0 : constants.O_NONBLOCK

export const setHomeConfig = async (config: HomeConfig) => {
	const parsedConfig = homeConfigSchema.parse(config)
	const { configDir, configPath } = await getConfigPaths()
	await ensureConfigDirectory(configDir)
	await inspectConfigFile(configPath)

	const handle = await fs.open(
		configPath,
		constants.O_WRONLY | constants.O_CREAT | noFollow | nonBlock,
		0o600,
	)
	try {
		if (!(await handle.stat()).isFile()) {
			throw new Error(UNSAFE_CONFIG_PATH_ERROR)
		}
		await handle.chmod(0o600)
		// Validate the opened object before truncating it. This avoids mutating a
		// non-regular object substituted between the lstat and open calls.
		await handle.truncate(0)
		await handle.writeFile(JSON.stringify(parsedConfig, null, 2), "utf-8")
	} finally {
		await handle.close()
	}
}

export const getHomeConfig = async () => {
	const { configDir, configPath } = await getConfigPaths()
	if ((await inspectConfigDirectory(configDir)) === "missing") return {}
	await ensureConfigDirectory(configDir)
	if ((await inspectConfigFile(configPath)) === "missing") return {}

	const handle = await fs.open(
		configPath,
		constants.O_RDONLY | noFollow | nonBlock,
	)
	try {
		if (!(await handle.stat()).isFile()) {
			throw new Error(UNSAFE_CONFIG_PATH_ERROR)
		}
		await handle.chmod(0o600)
		const config = JSON.parse(await handle.readFile("utf-8"))
		return homeConfigSchema.parse(config)
	} finally {
		await handle.close()
	}
}
