import type { Dirent } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

export type EnvFile = { name: string; filePath: string; dir: string }

export const DOTENC_RECURSIVE_IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"coverage",
	"vendor",
])

const ENV_FILE_PATTERN = /^\.env\.(.+)\.enc$/

type ReaddirFn = (
	dir: string,
	options: { withFileTypes: true },
) => Promise<Dirent<string>[]>

const defaultReaddir: ReaddirFn = (dir, options) =>
	fs.readdir(dir, options) as Promise<Dirent<string>[]>

export const findEnvironmentsRecursive = async (
	rootDir: string,
	readdir: ReaddirFn = defaultReaddir,
): Promise<EnvFile[]> => {
	const results: EnvFile[] = []

	const walk = async (dir: string) => {
		let entries: Dirent<string>[]
		try {
			entries = await readdir(dir, { withFileTypes: true })
		} catch {
			return
		}

		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (!DOTENC_RECURSIVE_IGNORED_DIRS.has(entry.name)) {
					await walk(path.join(dir, entry.name))
				}
			} else if (entry.isFile()) {
				const match = ENV_FILE_PATTERN.exec(entry.name)
				if (match) {
					results.push({
						name: match[1],
						filePath: path.join(dir, entry.name),
						dir,
					})
				}
			}
		}
	}

	await walk(rootDir)
	return results
}
