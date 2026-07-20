import { readFileSync, realpathSync } from "node:fs"

export type InstallMethod =
	| "homebrew"
	| "scoop"
	| "npm"
	| "apt"
	| "rpm"
	| "apk"
	| "aur"
	| "binary"
	| "unknown"

export const NPM_LATEST_URL = "https://registry.npmjs.org/@dotenc%2fcli/latest"
export const GITHUB_RELEASES_URL = "https://github.com/dotenc/dotenc/releases"
export const SYSTEM_INSTALL_METHOD_MARKER = "/usr/share/dotenc/install-method"

export type SystemInstallMethod = Extract<
	InstallMethod,
	"apt" | "rpm" | "apk" | "aur"
>

export const isSystemInstallMethod = (
	method: InstallMethod,
): method is SystemInstallMethod =>
	method === "apt" || method === "rpm" || method === "apk" || method === "aur"

type DetectInstallMethodOptions = {
	execPath?: string
	argv?: string[]
	platform?: NodeJS.Platform
	resolveRealPath?: (filePath: string) => string
	installMethodMarkerPath?: string
	readInstallMethodMarker?: (filePath: string) => string
}

const normalizePath = (value: string) => value.replace(/\\/g, "/").toLowerCase()

const safeRealPath = (
	resolveRealPath: (filePath: string) => string,
	filePath: string,
) => {
	try {
		return resolveRealPath(filePath)
	} catch {
		return filePath
	}
}

const readSystemInstallMethod = (
	markerPath: string,
	readMarker: (filePath: string) => string,
): SystemInstallMethod | null => {
	try {
		const method = readMarker(markerPath).trim().toLowerCase()
		if (
			method === "apt" ||
			method === "rpm" ||
			method === "apk" ||
			method === "aur"
		) {
			return method
		}
	} catch {
		// The marker is only present for native Linux packages.
	}

	return null
}

export const detectInstallMethod = (
	options: DetectInstallMethodOptions = {},
): InstallMethod => {
	const execPath = options.execPath ?? process.execPath
	const argv = options.argv ?? process.argv
	const platform = options.platform ?? process.platform
	const resolveRealPath = options.resolveRealPath ?? realpathSync
	const installMethodMarkerPath =
		options.installMethodMarkerPath ?? SYSTEM_INSTALL_METHOD_MARKER
	const readInstallMethodMarker =
		options.readInstallMethodMarker ??
		((filePath: string) => readFileSync(filePath, "utf8"))

	const scriptPath = argv[1] ?? ""

	const resolvedPaths = [execPath, scriptPath]
		.filter(Boolean)
		.map((value) => normalizePath(safeRealPath(resolveRealPath, value)))

	const allPaths = resolvedPaths.join(" ")
	const normalizedScriptPath = normalizePath(scriptPath)

	if (
		allPaths.includes("/cellar/dotenc/") ||
		allPaths.includes("/homebrew/cellar/dotenc/")
	) {
		return "homebrew"
	}

	if (
		allPaths.includes("/scoop/apps/dotenc/") ||
		allPaths.includes("/scoop/shims/")
	) {
		return "scoop"
	}

	if (allPaths.includes("/node_modules/@dotenc/cli/")) {
		return "npm"
	}

	// Local development run (e.g. bun src/cli.ts) shouldn't pick a package manager.
	if (
		normalizedScriptPath.endsWith("/src/cli.ts") ||
		(normalizedScriptPath.endsWith("/dist/cli.js") &&
			!allPaths.includes("/node_modules/@dotenc/cli/"))
	) {
		return "unknown"
	}

	if (platform === "linux" && resolvedPaths.includes("/usr/bin/dotenc")) {
		const systemInstallMethod = readSystemInstallMethod(
			installMethodMarkerPath,
			readInstallMethodMarker,
		)
		if (systemInstallMethod) {
			return systemInstallMethod
		}

		// `/usr/bin` is normally owned by the OS package manager. Without a valid
		// marker, avoid incorrectly directing users to replace it as a standalone
		// binary; the update command can offer safe, manager-specific guidance.
		return "unknown"
	}

	// Fallback for Windows Scoop paths that may not include expected segments above.
	if (platform === "win32" && allPaths.includes("/scoop/")) {
		return "scoop"
	}

	return "binary"
}

const parseVersionParts = (version: string): number[] | null => {
	const cleaned = version.trim().replace(/^v/i, "").split("-")[0]
	if (!cleaned) return null

	const parts = cleaned.split(".").map((part) => Number.parseInt(part, 10))
	if (parts.some((part) => Number.isNaN(part))) {
		return null
	}

	return parts
}

export const compareVersions = (left: string, right: string): number => {
	const leftParts = parseVersionParts(left)
	const rightParts = parseVersionParts(right)

	if (!leftParts || !rightParts) return 0

	const maxLen = Math.max(leftParts.length, rightParts.length)
	for (let i = 0; i < maxLen; i += 1) {
		const leftPart = leftParts[i] ?? 0
		const rightPart = rightParts[i] ?? 0
		if (leftPart > rightPart) return 1
		if (leftPart < rightPart) return -1
	}

	return 0
}

export const isVersionNewer = (candidate: string, current: string): boolean =>
	compareVersions(candidate, current) > 0

type FetchLatestVersionOptions = {
	fetchImpl?: (
		input: string,
		init?: {
			headers?: Record<string, string>
			signal?: AbortSignal
		},
	) => Promise<{
		ok: boolean
		json: () => Promise<{ version?: unknown }>
	}>
	timeoutMs?: number
}

export const fetchLatestVersion = async (
	options: FetchLatestVersionOptions = {},
): Promise<string | null> => {
	const fetchImpl = options.fetchImpl ?? fetch
	const timeoutMs = options.timeoutMs ?? 1500
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)

	try {
		const response = await fetchImpl(NPM_LATEST_URL, {
			headers: {
				accept: "application/json",
			},
			signal: controller.signal,
		})

		if (!response.ok) {
			return null
		}

		const payload = (await response.json()) as { version?: unknown }
		return typeof payload.version === "string" ? payload.version : null
	} catch {
		return null
	} finally {
		clearTimeout(timer)
	}
}
