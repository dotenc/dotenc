import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import {
	getHomeConfig,
	HomeConfigUnavailableError,
	setHomeConfig,
} from "../helpers/homeConfig"

const describePosix = process.platform === "win32" ? describe.skip : describe

describe("homeConfig", () => {
	let tmpHome: string
	let homeSpy: ReturnType<typeof spyOn>

	beforeEach(() => {
		tmpHome = mkdtempSync(path.join(os.tmpdir(), "test-homeconfig-"))
		mkdirSync(path.join(tmpHome, ".dotenc"), { recursive: true })
		homeSpy = spyOn(os, "homedir").mockReturnValue(tmpHome)
	})

	afterEach(() => {
		homeSpy.mockRestore()
		rmSync(tmpHome, { recursive: true, force: true })
	})

	describePosix("POSIX home configuration", () => {
		test("getHomeConfig returns empty object when no config exists", async () => {
			const result = await getHomeConfig()
			expect(result).toEqual({})
		})

		test("setHomeConfig writes and getHomeConfig reads config", async () => {
			await setHomeConfig({ editor: "vim" })
			const result = await getHomeConfig()
			expect(result.editor).toBe("vim")
			expect(statSync(path.join(tmpHome, ".dotenc")).mode & 0o777).toBe(0o700)
			expect(
				statSync(path.join(tmpHome, ".dotenc", "config.json")).mode & 0o777,
			).toBe(0o600)
		})

		test("tightens permissions on an existing config before reading", async () => {
			const configDir = path.join(tmpHome, ".dotenc")
			const configPath = path.join(configDir, "config.json")
			writeFileSync(configPath, JSON.stringify({ editor: "vim" }), "utf-8")
			chmodSync(configDir, 0o777)
			chmodSync(configPath, 0o666)

			const result = await getHomeConfig()

			expect(result.editor).toBe("vim")
			expect(statSync(configDir).mode & 0o777).toBe(0o700)
			expect(statSync(configPath).mode & 0o777).toBe(0o600)
		})

		test("setHomeConfig overwrites existing config", async () => {
			await setHomeConfig({ editor: "vim" })
			await setHomeConfig({ editor: "code" })
			const result = await getHomeConfig()
			expect(result.editor).toBe("code")
		})

		test("accepts an OS-reported home path that resolves through a symlink", async () => {
			const realHome = path.join(tmpHome, "real-home")
			const linkedHome = path.join(tmpHome, "linked-home")
			mkdirSync(realHome)
			symlinkSync(realHome, linkedHome, "dir")
			homeSpy.mockReturnValue(linkedHome)

			await setHomeConfig({ editor: "vim" })

			expect(
				JSON.parse(
					readFileSync(path.join(realHome, ".dotenc", "config.json"), "utf-8"),
				),
			).toEqual({ editor: "vim" })
		})

		test("rejects invalid config schema on set", async () => {
			await expect(
				setHomeConfig({ editor: 123 as unknown as string }),
			).rejects.toThrow()
		})

		test("rejects invalid config schema on get", async () => {
			const configPath = path.join(tmpHome, ".dotenc", "config.json")
			writeFileSync(configPath, JSON.stringify({ editor: 123 }), "utf-8")

			await expect(getHomeConfig()).rejects.toThrow()
		})

		test("rejects a symlinked dotenc home directory", async () => {
			const configDir = path.join(tmpHome, ".dotenc")
			const redirectedDir = path.join(tmpHome, "redirected")
			const redirectedConfig = path.join(redirectedDir, "config.json")
			rmSync(configDir, { recursive: true, force: true })
			mkdirSync(redirectedDir)
			writeFileSync(redirectedConfig, JSON.stringify({ editor: "victim" }))
			symlinkSync(redirectedDir, configDir, "dir")

			await expect(getHomeConfig()).rejects.toThrow(/symbolic link/)
			await expect(setHomeConfig({ editor: "code" })).rejects.toThrow(
				/symbolic link/,
			)
			expect(JSON.parse(readFileSync(redirectedConfig, "utf-8"))).toEqual({
				editor: "victim",
			})
		})

		test("rejects a symlinked config file without modifying its target", async () => {
			const configPath = path.join(tmpHome, ".dotenc", "config.json")
			const redirectedConfig = path.join(tmpHome, "redirected-config.json")
			writeFileSync(redirectedConfig, JSON.stringify({ editor: "victim" }))
			symlinkSync(redirectedConfig, configPath, "file")

			await expect(getHomeConfig()).rejects.toThrow(/symbolic link/)
			await expect(setHomeConfig({ editor: "code" })).rejects.toThrow(
				/symbolic link/,
			)
			expect(JSON.parse(readFileSync(redirectedConfig, "utf-8"))).toEqual({
				editor: "victim",
			})
		})
	})

	test("fails closed on Windows before accessing a replacement-prone path", async () => {
		const originalPlatform = Object.getOwnPropertyDescriptor(
			process,
			"platform",
		)
		const configPath = path.join(tmpHome, ".dotenc", "config.json")
		writeFileSync(configPath, JSON.stringify({ editor: "victim" }), "utf-8")
		homeSpy.mockImplementation(() => {
			throw new Error("home path must not be resolved")
		})

		try {
			Object.defineProperty(process, "platform", {
				...originalPlatform,
				value: "win32",
			})

			await expect(getHomeConfig()).rejects.toBeInstanceOf(
				HomeConfigUnavailableError,
			)
			await expect(setHomeConfig({ editor: "code" })).rejects.toBeInstanceOf(
				HomeConfigUnavailableError,
			)
			expect(homeSpy).not.toHaveBeenCalled()
			expect(JSON.parse(readFileSync(configPath, "utf-8"))).toEqual({
				editor: "victim",
			})
		} finally {
			if (originalPlatform) {
				Object.defineProperty(process, "platform", originalPlatform)
			}
		}
	})
})
