import { describe, expect, test } from "bun:test"
import { maybeNotifyAboutUpdate } from "../helpers/updateNotifier"

type UpdateConfig = {
	lastCheckedAt?: string | null
	latestVersion?: string | null
	notifiedVersion?: string | null
}

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
const stripAnsi = (value: string) => value.replace(ansiPattern, "")

describe("maybeNotifyAboutUpdate", () => {
	test("logs update notice and persists notified version", async () => {
		let config: { update?: UpdateConfig | null; editor?: string | null } = {}
		const logs: string[] = []

		await maybeNotifyAboutUpdate({
			args: ["dev", "echo"],
			currentVersion: "0.5.0",
			getHomeConfig: async () => config,
			setHomeConfig: async (next) => {
				config = next
			},
			fetchLatestVersion: async () => "0.6.0",
			log: (message: string) => {
				logs.push(message)
			},
		})

		expect(logs).toHaveLength(1)
		const rendered = stripAnsi(logs[0])
		expect(rendered).toContain("╭")
		expect(rendered).toContain("UPDATE AVAILABLE")
		expect(rendered).toContain("Update available: 0.5.0 -> 0.6.0")
		expect(rendered).toContain("Run dotenc update to update")
		expect(rendered).toContain("╰")
		expect(config.update?.notifiedVersion).toBe("0.6.0")
		expect(config.update?.latestVersion).toBe("0.6.0")
	})

	test("does not check for non-dev commands", async () => {
		let fetchCalls = 0

		await maybeNotifyAboutUpdate({
			args: ["whoami"],
			currentVersion: "0.5.0",
			getHomeConfig: async () => ({}),
			setHomeConfig: async () => {},
			fetchLatestVersion: async () => {
				fetchCalls += 1
				return "0.6.0"
			},
			log: () => {},
		})

		expect(fetchCalls).toBe(0)
	})

	test.each([
		"apt",
		"rpm",
		"apk",
		"aur",
	] as const)("does not check for updates for %s system package installs", async (installMethod) => {
		let fetchCalls = 0

		await maybeNotifyAboutUpdate({
			args: ["dev", "echo"],
			currentVersion: "0.5.0",
			detectInstallMethod: () => installMethod,
			getHomeConfig: async () => ({}),
			setHomeConfig: async () => {},
			fetchLatestVersion: async () => {
				fetchCalls += 1
				return "0.6.0"
			},
			log: () => {},
		})

		expect(fetchCalls).toBe(0)
	})

	test("skips checks for mockupdate command", async () => {
		let fetchCalls = 0

		await maybeNotifyAboutUpdate({
			args: ["mockupdate"],
			currentVersion: "0.5.0",
			getHomeConfig: async () => ({}),
			setHomeConfig: async () => {},
			fetchLatestVersion: async () => {
				fetchCalls += 1
				return "0.6.0"
			},
			log: () => {},
		})

		expect(fetchCalls).toBe(0)
	})

	test("fetches latest version on every dev command even when cache is recent", async () => {
		let fetchCalls = 0
		const logs: string[] = []

		await maybeNotifyAboutUpdate({
			args: ["dev", "echo"],
			currentVersion: "0.5.0",
			getHomeConfig: async () => ({
				update: {
					lastCheckedAt: "2026-02-18T11:59:00.000Z",
					latestVersion: "0.6.0",
				},
			}),
			setHomeConfig: async () => {},
			fetchLatestVersion: async () => {
				fetchCalls += 1
				return "0.7.0"
			},
			log: (message: string) => {
				logs.push(message)
			},
		})

		expect(fetchCalls).toBe(1)
		expect(logs).toHaveLength(1)
		expect(stripAnsi(logs[0])).toContain("Update available: 0.5.0 -> 0.7.0")
	})

	test("does not log when latest version is already notified", async () => {
		const logs: string[] = []

		await maybeNotifyAboutUpdate({
			args: ["dev", "echo"],
			currentVersion: "0.5.0",
			getHomeConfig: async () => ({
				update: {
					lastCheckedAt: "2026-02-18T11:59:00.000Z",
					latestVersion: "0.6.0",
					notifiedVersion: "0.6.0",
				},
			}),
			setHomeConfig: async () => {},
			fetchLatestVersion: async () => "0.6.0",
			log: (message: string) => {
				logs.push(message)
			},
		})

		expect(logs).toHaveLength(0)
	})
})
