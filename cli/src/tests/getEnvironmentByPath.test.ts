import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { getEnvironmentByPath } from "../helpers/getEnvironmentByPath"

describe("getEnvironmentByPath", () => {
	let tmpDir: string

	beforeAll(() => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), "test-envpath-"))
	})

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true })
	})

	test("parses a valid environment file", async () => {
		const env = {
			keys: [
				{
					name: "alice",
					fingerprint: "abc123",
					encryptedDataKey: "ZW5jcnlwdGVk",
					algorithm: "ed25519",
				},
			],
			encryptedContent: "ZW5jcnlwdGVk",
		}
		const filePath = path.join(tmpDir, ".env.test.enc")
		writeFileSync(filePath, JSON.stringify(env), "utf-8")

		const result = await getEnvironmentByPath(filePath)
		expect(result.keys).toHaveLength(1)
		expect(result.keys[0].name).toBe("alice")
		expect(result.encryptedContent).toBe("ZW5jcnlwdGVk")
	})

	test("throws when file does not exist", async () => {
		const filePath = path.join(tmpDir, "nonexistent.enc")
		await expect(getEnvironmentByPath(filePath)).rejects.toThrow(
			/Environment file not found/,
		)
	})

	test("throws when file contains invalid JSON", async () => {
		const filePath = path.join(tmpDir, "bad.enc")
		writeFileSync(filePath, "not json", "utf-8")

		await expect(getEnvironmentByPath(filePath)).rejects.toThrow(
			/Failed to parse the environment file/,
		)
	})

	test("throws when JSON does not match schema", async () => {
		const filePath = path.join(tmpDir, "bad-schema.enc")
		writeFileSync(filePath, JSON.stringify({ foo: "bar" }), "utf-8")

		await expect(getEnvironmentByPath(filePath)).rejects.toThrow(
			/Failed to parse the environment file/,
		)
	})

	test("rejects duplicate JSON members before JSON.parse can overwrite them", async () => {
		const filePath = path.join(tmpDir, "duplicate.enc")
		writeFileSync(
			filePath,
			'{"keys":[],"keys":[],"encryptedContent":"ZW5jcnlwdGVk"}',
			"utf-8",
		)

		await expect(getEnvironmentByPath(filePath)).rejects.toThrow(
			/Failed to parse the environment file/,
		)
	})

	test("rejects unsupported versions, extra fields, and non-canonical base64", async () => {
		const base = {
			keys: [
				{
					name: "alice",
					fingerprint: "abc123",
					encryptedDataKey: "ZW5jcnlwdGVk",
					algorithm: "ed25519",
				},
			],
			encryptedContent: "ZW5jcnlwdGVk",
		}

		for (const [name, value] of [
			["version", { ...base, version: 3 }],
			["extra", { ...base, unexpected: true }],
			["base64", { ...base, encryptedContent: "Zg" }],
		] as const) {
			const filePath = path.join(tmpDir, `${name}.enc`)
			writeFileSync(filePath, JSON.stringify(value), "utf-8")
			await expect(getEnvironmentByPath(filePath)).rejects.toThrow(
				/Failed to parse the environment file/,
			)
		}
	})

	test("rejects files larger than one MiB before parsing", async () => {
		const filePath = path.join(tmpDir, "oversized.enc")
		writeFileSync(filePath, "x".repeat(1024 * 1024 + 1), "utf-8")

		await expect(getEnvironmentByPath(filePath)).rejects.toThrow(
			/Failed to parse the environment file/,
		)
	})
})
