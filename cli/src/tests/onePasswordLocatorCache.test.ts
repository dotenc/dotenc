import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
	getOnePasswordLocatorCacheDirectory,
	parseOnePasswordSelector,
	readOnePasswordLocator,
	removeOnePasswordLocator,
	writeOnePasswordLocator,
} from "../helpers/onePasswordLocatorCache"

const ACCOUNT_ID = "A".repeat(26)
const VAULT_ID = "V".repeat(26)
const ITEM_ID = "I".repeat(26)
const FINGERPRINT = "SHA256:example-fingerprint"
const temporaryDirectories: string[] = []

async function makeTemporaryDirectory() {
	const directory = await fs.mkdtemp(
		path.join(os.tmpdir(), "dotenc-locator-cache-test-"),
	)
	temporaryDirectories.push(directory)
	return directory
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			fs.rm(directory, {
				recursive: true,
				force: true,
			}),
		),
	)
})

describe("1Password locator cache", () => {
	test("uses the XDG cache directory and safe platform fallbacks", () => {
		expect(
			getOnePasswordLocatorCacheDirectory({
				env: { XDG_CACHE_HOME: "/tmp/cache" },
				homedir: () => "/home/alice",
				platform: "linux",
			}),
		).toBe("/tmp/cache/dotenc")
		expect(
			getOnePasswordLocatorCacheDirectory({
				env: {},
				homedir: () => "/home/alice",
				platform: "linux",
			}),
		).toBe("/home/alice/.cache/dotenc")
		expect(
			getOnePasswordLocatorCacheDirectory({
				env: { LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" },
				homedir: () => "C:\\Users\\alice",
				platform: "win32",
			}),
		).toBe("C:\\Users\\alice/AppData/Local/dotenc/Cache")
	})

	test("parses only complete ID-backed selectors", () => {
		expect(
			parseOnePasswordSelector(
				`1password:${ACCOUNT_ID}:${VAULT_ID}:${ITEM_ID}`,
			),
		).toEqual({
			accountId: ACCOUNT_ID,
			vaultId: VAULT_ID,
			itemId: ITEM_ID,
		})
		expect(parseOnePasswordSelector("1password:account:vault:item")).toBe(
			undefined,
		)
	})

	test("round-trips only the fingerprint and opaque locator with private modes", async () => {
		const cacheDirectory = await makeTemporaryDirectory()
		const locator = {
			accountId: ACCOUNT_ID,
			vaultId: VAULT_ID,
			itemId: ITEM_ID,
		}

		expect(
			await writeOnePasswordLocator(FINGERPRINT, locator, { cacheDirectory }),
		).toBe(true)
		expect(
			await readOnePasswordLocator(FINGERPRINT, { cacheDirectory }),
		).toEqual(locator)

		const locatorDirectory = path.join(
			cacheDirectory,
			"onepassword-locators-v1",
		)
		const files = await fs.readdir(locatorDirectory)
		expect(files).toHaveLength(1)
		const content = await fs.readFile(
			path.join(locatorDirectory, files[0]),
			"utf8",
		)
		expect(content).not.toContain("private_key")
		expect(content).not.toContain("vaultName")
		expect(content).not.toContain("itemName")
		expect((await fs.stat(cacheDirectory)).mode & 0o777).toBe(0o700)
		expect((await fs.stat(locatorDirectory)).mode & 0o777).toBe(0o700)
		expect(
			(await fs.stat(path.join(locatorDirectory, files[0]))).mode & 0o777,
		).toBe(0o600)

		await removeOnePasswordLocator(FINGERPRINT, { cacheDirectory })
		expect(
			await readOnePasswordLocator(FINGERPRINT, { cacheDirectory }),
		).toBeUndefined()
	})

	test("treats malformed and fingerprint-mismatched entries as misses", async () => {
		const cacheDirectory = await makeTemporaryDirectory()
		await writeOnePasswordLocator(
			FINGERPRINT,
			{ accountId: ACCOUNT_ID, vaultId: VAULT_ID, itemId: ITEM_ID },
			{ cacheDirectory },
		)
		const locatorDirectory = path.join(
			cacheDirectory,
			"onepassword-locators-v1",
		)
		const [file] = await fs.readdir(locatorDirectory)
		await fs.writeFile(
			path.join(locatorDirectory, file),
			JSON.stringify({
				version: 1,
				fingerprint: "SHA256:different",
				locator: {
					accountId: ACCOUNT_ID,
					vaultId: VAULT_ID,
					itemId: ITEM_ID,
				},
			}),
		)

		expect(
			await readOnePasswordLocator(FINGERPRINT, { cacheDirectory }),
		).toBeUndefined()
	})
})
