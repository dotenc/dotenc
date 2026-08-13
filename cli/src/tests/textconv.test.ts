import { describe, expect, mock, test } from "bun:test"
import { _textconvCommand } from "../commands/textconv"
import type { decryptEnvironmentData as decryptEnvironmentDataHelper } from "../helpers/decryptEnvironment"
import type { Environment } from "../schemas/environment"

const environment = {
	keys: [],
	encryptedContent: "",
} as Environment

describe("textconvCommand", () => {
	test("allows the locator-cache fast path without enabling full discovery", async () => {
		const output: string[] = []
		const decryptEnvironmentData = mock(
			async (
				_name: string,
				_environment: Environment,
				deps?: Parameters<typeof decryptEnvironmentDataHelper>[2],
			) => {
				expect(deps?.loadCachedOnePasswordPrivateKey).toBeFunction()
				expect(deps?.discoverOnePasswordKeyCandidates).toBeUndefined()
				return "TOKEN=decrypted"
			},
		)

		await _textconvCommand("/tmp/.env.development.enc", {
			readFile: async () => "encrypted",
			getEnvironmentByPath: async () => environment,
			decryptEnvironmentData,
			writeStdout: (content) => output.push(content),
		})

		expect(output).toEqual(["TOKEN=decrypted"])
	})

	test("emits encrypted content when cached decryption is unavailable", async () => {
		const output: string[] = []

		await _textconvCommand("/tmp/.env.development.enc", {
			readFile: async () => "encrypted",
			getEnvironmentByPath: async () => environment,
			decryptEnvironmentData: async () => {
				throw new Error("cache miss")
			},
			writeStdout: (content) => output.push(content),
		})

		expect(output).toEqual(["encrypted"])
	})
})
