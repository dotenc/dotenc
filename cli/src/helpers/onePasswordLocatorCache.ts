import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod/v4"
import type { KeyCandidate } from "./keyCandidate"

const ONE_PASSWORD_ID_PATTERN = /^[A-Za-z0-9]{26}$/
const MAX_CACHE_ENTRY_BYTES = 4 * 1024

const locatorSchema = z.strictObject({
	accountId: z.string().regex(ONE_PASSWORD_ID_PATTERN),
	vaultId: z.string().regex(ONE_PASSWORD_ID_PATTERN),
	itemId: z.string().regex(ONE_PASSWORD_ID_PATTERN),
})

const cacheEntrySchema = z.strictObject({
	version: z.literal(1),
	fingerprint: z.string().min(1).max(256),
	locator: locatorSchema,
})

export type OnePasswordLocator = z.infer<typeof locatorSchema>

type CacheDirectoryDeps = {
	env?: NodeJS.ProcessEnv
	homedir?: () => string
	platform?: NodeJS.Platform
}

type LocatorCacheOptions = {
	cacheDirectory?: string
}

export function getOnePasswordLocatorCacheDirectory(
	deps: CacheDirectoryDeps = {},
): string {
	const env = deps.env ?? process.env
	const homedir = deps.homedir ?? os.homedir
	const platform = deps.platform ?? process.platform

	if (env.XDG_CACHE_HOME && path.isAbsolute(env.XDG_CACHE_HOME)) {
		return path.join(env.XDG_CACHE_HOME, "dotenc")
	}
	if (
		platform === "win32" &&
		env.LOCALAPPDATA &&
		path.isAbsolute(env.LOCALAPPDATA)
	) {
		return path.join(env.LOCALAPPDATA, "dotenc", "Cache")
	}
	if (platform === "win32") {
		return path.join(homedir(), "AppData", "Local", "dotenc", "Cache")
	}
	return path.join(homedir(), ".cache", "dotenc")
}

export function parseOnePasswordSelector(
	selector: string,
): OnePasswordLocator | undefined {
	const match = selector.match(
		/^1password:([A-Za-z0-9]{26}):([A-Za-z0-9]{26}):([A-Za-z0-9]{26})$/,
	)
	if (!match) return undefined
	return {
		accountId: match[1],
		vaultId: match[2],
		itemId: match[3],
	}
}

function cacheEntryPath(fingerprint: string, cacheDirectory: string): string {
	const cacheKey = createHash("sha256").update(fingerprint).digest("hex")
	return path.join(
		cacheDirectory,
		"onepassword-locators-v1",
		`${cacheKey}.json`,
	)
}

export async function readOnePasswordLocator(
	fingerprint: string,
	options: LocatorCacheOptions = {},
): Promise<OnePasswordLocator | undefined> {
	const cacheDirectory =
		options.cacheDirectory ?? getOnePasswordLocatorCacheDirectory()
	const filePath = cacheEntryPath(fingerprint, cacheDirectory)

	try {
		const handle = await fs.open(filePath, "r")
		try {
			const stat = await handle.stat()
			if (!stat.isFile() || stat.size > MAX_CACHE_ENTRY_BYTES) return undefined
			const entry = cacheEntrySchema.parse(
				JSON.parse(await handle.readFile("utf8")),
			)
			return entry.fingerprint === fingerprint ? entry.locator : undefined
		} finally {
			await handle.close()
		}
	} catch {
		return undefined
	}
}

export async function writeOnePasswordLocator(
	fingerprint: string,
	locator: OnePasswordLocator,
	options: LocatorCacheOptions = {},
): Promise<boolean> {
	const parsedLocator = locatorSchema.safeParse(locator)
	if (
		!parsedLocator.success ||
		fingerprint.length === 0 ||
		fingerprint.length > 256
	) {
		return false
	}

	const cacheDirectory =
		options.cacheDirectory ?? getOnePasswordLocatorCacheDirectory()
	const filePath = cacheEntryPath(fingerprint, cacheDirectory)
	const directory = path.dirname(filePath)
	const temporaryPath = path.join(
		directory,
		`.${path.basename(filePath)}.${process.pid}-${randomUUID()}.tmp`,
	)

	try {
		await fs.mkdir(cacheDirectory, { recursive: true, mode: 0o700 })
		await fs.chmod(cacheDirectory, 0o700)
		await fs.mkdir(directory, { recursive: true, mode: 0o700 })
		await fs.chmod(directory, 0o700)
		await fs.writeFile(
			temporaryPath,
			JSON.stringify({
				version: 1,
				fingerprint,
				locator: parsedLocator.data,
			}),
			{ flag: "wx", mode: 0o600 },
		)
		await fs.rename(temporaryPath, filePath)
		await fs.chmod(filePath, 0o600)
		return true
	} catch {
		return false
	} finally {
		await fs.rm(temporaryPath, { force: true }).catch(() => {})
	}
}

export async function removeOnePasswordLocator(
	fingerprint: string,
	options: LocatorCacheOptions = {},
): Promise<void> {
	const cacheDirectory =
		options.cacheDirectory ?? getOnePasswordLocatorCacheDirectory()
	await fs
		.rm(cacheEntryPath(fingerprint, cacheDirectory), { force: true })
		.catch(() => {})
}

export async function rememberOnePasswordCandidate(
	candidate: KeyCandidate,
): Promise<void> {
	if (candidate.source !== "1password") return
	const locator = parseOnePasswordSelector(candidate.selector)
	if (!locator) return
	await writeOnePasswordLocator(candidate.fingerprint, locator)
}
