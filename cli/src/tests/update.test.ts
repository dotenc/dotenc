import { describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import { _runPackageManagerCommand } from "../commands/update"
import {
	compareVersions,
	detectInstallMethod,
	fetchLatestVersion,
	isVersionNewer,
} from "../helpers/update"

describe("update helpers", () => {
	test("detectInstallMethod detects Homebrew install path", () => {
		const method = detectInstallMethod({
			execPath: "/opt/homebrew/bin/dotenc",
			argv: ["dotenc", "whoami"],
			resolveRealPath: () => "/opt/homebrew/Cellar/dotenc/0.5.0/bin/dotenc",
		})
		expect(method).toBe("homebrew")
	})

	test("detectInstallMethod detects Scoop install path", () => {
		const method = detectInstallMethod({
			execPath: "C:\\Users\\ivan\\scoop\\shims\\dotenc.exe",
			argv: ["dotenc", "whoami"],
			resolveRealPath: () =>
				"C:\\Users\\ivan\\scoop\\apps\\dotenc\\current\\dotenc.exe",
		})
		expect(method).toBe("scoop")
	})

	test("detectInstallMethod detects npm global path", () => {
		const method = detectInstallMethod({
			execPath: "/usr/local/bin/node",
			argv: [
				"node",
				"/usr/local/lib/node_modules/@dotenc/cli/dist/cli.js",
				"whoami",
			],
			resolveRealPath: (input) => input,
		})
		expect(method).toBe("npm")
	})

	test("detectInstallMethod falls back to binary", () => {
		const method = detectInstallMethod({
			execPath: "/usr/local/bin/dotenc",
			argv: ["dotenc", "whoami"],
			resolveRealPath: (input) => input,
		})
		expect(method).toBe("binary")
	})

	test.each([
		"apt",
		"rpm",
		"apk",
		"aur",
	] as const)("detectInstallMethod detects %s native Linux package marker", (expectedMethod) => {
		let readPath = ""
		const method = detectInstallMethod({
			execPath: "/usr/bin/dotenc",
			argv: ["dotenc", "whoami"],
			platform: "linux",
			resolveRealPath: (input) => input,
			installMethodMarkerPath: "/test/install-method",
			readInstallMethodMarker: (filePath) => {
				readPath = filePath
				return ` ${expectedMethod.toUpperCase()}\n`
			},
		})

		expect(readPath).toBe("/test/install-method")
		expect(method).toBe(expectedMethod)
	})

	test("detectInstallMethod does not trust marker for a non-system binary", () => {
		let reads = 0
		const method = detectInstallMethod({
			execPath: "/usr/local/bin/dotenc",
			argv: ["dotenc", "whoami"],
			platform: "linux",
			resolveRealPath: (input) => input,
			readInstallMethodMarker: () => {
				reads += 1
				return "apt"
			},
		})

		expect(reads).toBe(0)
		expect(method).toBe("binary")
	})

	test("detectInstallMethod ignores invalid native package marker", () => {
		const method = detectInstallMethod({
			execPath: "/usr/bin/dotenc",
			argv: ["dotenc", "whoami"],
			platform: "linux",
			resolveRealPath: (input) => input,
			readInstallMethodMarker: () => "pacman",
		})

		expect(method).toBe("unknown")
	})

	test("detectInstallMethod treats marker-less /usr/bin install as unknown", () => {
		const method = detectInstallMethod({
			execPath: "/usr/bin/dotenc",
			argv: ["dotenc", "whoami"],
			platform: "linux",
			resolveRealPath: (input) => input,
			readInstallMethodMarker: () => {
				throw new Error("ENOENT")
			},
		})

		expect(method).toBe("unknown")
	})

	test("detectInstallMethod does not read Linux marker on other platforms", () => {
		let reads = 0
		const method = detectInstallMethod({
			execPath: "/usr/local/bin/dotenc",
			argv: ["dotenc", "whoami"],
			platform: "darwin",
			resolveRealPath: (input) => input,
			readInstallMethodMarker: () => {
				reads += 1
				return "apt"
			},
		})

		expect(reads).toBe(0)
		expect(method).toBe("binary")
	})

	test("detectInstallMethod returns unknown for local src/cli.ts runs", () => {
		const method = detectInstallMethod({
			execPath: "/usr/local/bin/bun",
			argv: ["bun", "/Users/dev/repo/cli/src/cli.ts", "whoami"],
			resolveRealPath: (input) => input,
		})
		expect(method).toBe("unknown")
	})

	test("detectInstallMethod returns unknown for local dist/cli.js runs", () => {
		const method = detectInstallMethod({
			execPath: "/usr/local/bin/node",
			argv: ["node", "/Users/dev/repo/cli/dist/cli.js", "whoami"],
			resolveRealPath: (input) => input,
		})
		expect(method).toBe("unknown")
	})

	test("detectInstallMethod falls back to Scoop on win32 path fragments", () => {
		const method = detectInstallMethod({
			execPath: "C:\\tools\\custom\\scoop\\dotenc.exe",
			argv: ["dotenc", "whoami"],
			platform: "win32",
			resolveRealPath: (input) => input,
		})
		expect(method).toBe("scoop")
	})

	test("detectInstallMethod handles realpath errors by using original paths", () => {
		const method = detectInstallMethod({
			execPath: "/opt/homebrew/Cellar/dotenc/0.5.0/bin/dotenc",
			argv: ["dotenc", "whoami"],
			resolveRealPath: () => {
				throw new Error("realpath failed")
			},
		})
		expect(method).toBe("homebrew")
	})

	test("compareVersions handles semantic versions", () => {
		expect(compareVersions("0.5.0", "0.4.9")).toBe(1)
		expect(compareVersions("0.5.0", "0.5.0")).toBe(0)
		expect(compareVersions("0.5.0", "0.5.1")).toBe(-1)
		expect(isVersionNewer("1.0.0", "0.9.9")).toBe(true)
	})

	test("compareVersions returns 0 for invalid versions", () => {
		expect(compareVersions("invalid", "0.5.1")).toBe(0)
		expect(compareVersions("0.5.x", "0.5.1")).toBe(0)
	})

	test("fetchLatestVersion returns latest semver when registry responds with version", async () => {
		const version = await fetchLatestVersion({
			fetchImpl: async () =>
				({
					ok: true,
					json: async () => ({ version: "0.9.0" }),
				}) as Response,
		})

		expect(version).toBe("0.9.0")
	})

	test("fetchLatestVersion returns null when registry response is not ok", async () => {
		const version = await fetchLatestVersion({
			fetchImpl: async () =>
				({
					ok: false,
					json: async () => ({ version: "0.9.0" }),
				}) as Response,
		})

		expect(version).toBeNull()
	})

	test("fetchLatestVersion returns null when payload has no valid version", async () => {
		const version = await fetchLatestVersion({
			fetchImpl: async () =>
				({
					ok: true,
					json: async () => ({ version: 10 }),
				}) as Response,
		})

		expect(version).toBeNull()
	})

	test("fetchLatestVersion returns null when fetch throws", async () => {
		const version = await fetchLatestVersion({
			fetchImpl: async () => {
				throw new Error("network down")
			},
		})

		expect(version).toBeNull()
	})
})

describe("_runPackageManagerCommand", () => {
	test("resolves with process exit code", async () => {
		const child = new EventEmitter()
		const spawnImpl = mock(() => {
			queueMicrotask(() => child.emit("exit", 0))
			return child as never
		})

		const code = await _runPackageManagerCommand(
			"npm",
			["--version"],
			spawnImpl as never,
		)
		expect(code).toBe(0)
	})

	test("rejects when the child process emits an error", async () => {
		const child = new EventEmitter()
		const spawnImpl = mock(() => {
			queueMicrotask(() => child.emit("error", new Error("spawn failed")))
			return child as never
		})

		await expect(
			_runPackageManagerCommand("npm", ["--version"], spawnImpl as never),
		).rejects.toThrow("spawn failed")
	})
})
