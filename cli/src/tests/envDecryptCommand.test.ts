import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

const validateEnvironmentName = mock((_name: string) => ({
	valid: true as boolean,
	reason: undefined as string | undefined,
}))
const getEnvironmentByName = mock(async (_name: string) => ({
	keys: [] as { name: string }[],
	encryptedContent: "",
}))
const decryptEnvironmentData = mock(async () => "API_KEY=abc123")

mock.module("../helpers/validateEnvironmentName", () => ({
	validateEnvironmentName,
}))
mock.module("../helpers/getEnvironmentByName", () => ({ getEnvironmentByName }))
mock.module("../helpers/decryptEnvironment", () => ({ decryptEnvironmentData }))

const { decryptCommand } = await import("../commands/env/decrypt")

describe("env decrypt command", () => {
	beforeEach(() => {
		validateEnvironmentName.mockClear()
		getEnvironmentByName.mockClear()
		decryptEnvironmentData.mockClear()
		validateEnvironmentName.mockImplementation(() => ({
			valid: true,
			reason: undefined,
		}))
		getEnvironmentByName.mockImplementation(async () => ({
			keys: [],
			encryptedContent: "",
		}))
		decryptEnvironmentData.mockImplementation(async () => "API_KEY=abc123")
	})

	test("prints plaintext on success", async () => {
		const writeSpy = spyOn(process.stdout, "write").mockImplementation(
			() => true,
		)

		await decryptCommand("development", {})

		expect(writeSpy).toHaveBeenCalledWith("API_KEY=abc123")
		writeSpy.mockRestore()
	})

	test("returns granted users in JSON success output", async () => {
		getEnvironmentByName.mockImplementation(async () => ({
			keys: [
				{
					name: "alice",
					fingerprint: "fp-1",
					encryptedDataKey: "ZW5jcnlwdGVk",
					algorithm: "ed25519",
				},
				{
					name: "bob",
					fingerprint: "fp-2",
					encryptedDataKey: "ZW5jcnlwdGVk",
					algorithm: "ed25519",
				},
			],
			encryptedContent: "",
		}))

		const writeSpy = spyOn(process.stdout, "write").mockImplementation(
			() => true,
		)

		await decryptCommand("development", { json: true })

		const [rawJson] = writeSpy.mock.calls[0] as [string]
		const parsed = JSON.parse(rawJson) as {
			ok: boolean
			content: string
			grantedUsers: string[]
		}

		expect(parsed.ok).toBe(true)
		expect(parsed.content).toBe("API_KEY=abc123")
		expect(parsed.grantedUsers).toEqual(["alice", "bob"])
		writeSpy.mockRestore()
	})

	test("returns JSON error for invalid environment names", async () => {
		validateEnvironmentName.mockImplementation(() => ({
			valid: false,
			reason: "Environment name must not be empty.",
		}))

		const writeSpy = spyOn(process.stdout, "write").mockImplementation(
			() => true,
		)
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(decryptCommand("", { json: true })).rejects.toThrow("exit(1)")

		const [rawJson] = writeSpy.mock.calls[0] as [string]
		const parsed = JSON.parse(rawJson) as {
			ok: boolean
			error: { code: string }
		}

		expect(parsed.ok).toBe(false)
		expect(parsed.error.code).toBe("INVALID_ENVIRONMENT_NAME")
		writeSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("maps access denied errors in JSON mode", async () => {
		decryptEnvironmentData.mockImplementation(async () => {
			throw new Error("Access denied to the environment.")
		})

		const writeSpy = spyOn(process.stdout, "write").mockImplementation(
			() => true,
		)
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(decryptCommand("production", { json: true })).rejects.toThrow(
			"exit(1)",
		)

		const [rawJson] = writeSpy.mock.calls[0] as [string]
		const parsed = JSON.parse(rawJson) as {
			ok: boolean
			error: { code: string; message: string }
		}

		expect(parsed.ok).toBe(false)
		expect(parsed.error.code).toBe("ACCESS_DENIED")
		expect(parsed.error.message).toContain("Access denied")
		writeSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("maps corrupt wrapped data-key errors to access denied in JSON mode", async () => {
		decryptEnvironmentData.mockImplementation(async () => {
			throw new Error("Failed to decrypt the data key.")
		})

		const writeSpy = spyOn(process.stdout, "write").mockImplementation(
			() => true,
		)
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(decryptCommand("production", { json: true })).rejects.toThrow(
			"exit(1)",
		)

		const [rawJson] = writeSpy.mock.calls[0] as [string]
		const parsed = JSON.parse(rawJson) as {
			ok: boolean
			error: { code: string; message: string }
		}

		expect(parsed.ok).toBe(false)
		expect(parsed.error.code).toBe("ACCESS_DENIED")
		expect(parsed.error.message).toBe("Failed to decrypt the data key.")
		writeSpy.mockRestore()
		exitSpy.mockRestore()
	})
})
