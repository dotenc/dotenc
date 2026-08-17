import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
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

export type OnePasswordLocatorProbeResult =
	| { status: "present"; locator: OnePasswordLocator }
	| { status: "absent" }
	| { status: "incomplete" }

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

export async function probeOnePasswordLocator(
	fingerprint: string,
	options: LocatorCacheOptions = {},
): Promise<OnePasswordLocatorProbeResult> {
	const cacheDirectory =
		options.cacheDirectory ?? getOnePasswordLocatorCacheDirectory()
	const filePath = cacheEntryPath(fingerprint, cacheDirectory)

	let pathStat: Awaited<ReturnType<typeof fs.lstat>>
	try {
		pathStat = await fs.lstat(filePath)
	} catch (error) {
		return error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ENOENT"
			? { status: "absent" }
			: { status: "incomplete" }
	}
	if (
		pathStat.isSymbolicLink() ||
		!pathStat.isFile() ||
		pathStat.size > MAX_CACHE_ENTRY_BYTES
	) {
		return { status: "incomplete" }
	}

	let handle: Awaited<ReturnType<typeof fs.open>>
	try {
		handle = await fs.open(
			filePath,
			constants.O_RDONLY |
				(constants.O_NOFOLLOW ?? 0) |
				(constants.O_NONBLOCK ?? 0),
		)
	} catch {
		return { status: "incomplete" }
	}
	const input = Buffer.alloc(MAX_CACHE_ENTRY_BYTES + 1)
	let offset = 0
	try {
		try {
			const openedStat = await handle.stat()
			if (
				!openedStat.isFile() ||
				openedStat.dev !== pathStat.dev ||
				openedStat.ino !== pathStat.ino ||
				openedStat.size > MAX_CACHE_ENTRY_BYTES
			) {
				return { status: "incomplete" }
			}
			while (offset < input.byteLength) {
				const { bytesRead } = await handle.read(
					input,
					offset,
					input.byteLength - offset,
					null,
				)
				if (bytesRead === 0) break
				offset += bytesRead
			}
		} catch {
			return { status: "incomplete" }
		}
		if (offset > MAX_CACHE_ENTRY_BYTES) return { status: "incomplete" }
		try {
			const entry = cacheEntrySchema.parse(
				JSON.parse(input.subarray(0, offset).toString("utf8")),
			)
			return entry.fingerprint === fingerprint
				? { status: "present", locator: entry.locator }
				: { status: "incomplete" }
		} catch {
			return { status: "incomplete" }
		}
	} finally {
		input.fill(0)
		try {
			await handle.close()
		} catch {}
	}
}

export async function readOnePasswordLocator(
	fingerprint: string,
	options: LocatorCacheOptions = {},
): Promise<OnePasswordLocator | undefined> {
	const result = await probeOnePasswordLocator(fingerprint, options)
	return result.status === "present" ? result.locator : undefined
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
