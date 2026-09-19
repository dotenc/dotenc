import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test"
import * as realFs from "node:fs/promises"
import * as realCrypto from "../helpers/crypto"

const encryptData = realCrypto.encryptData
let failure: "encrypt" | "wrap" | "write" | undefined
let ownedKey: Buffer | undefined
const recipient = {
	name: "alice",
	fingerprint: "SHA256:synthetic-recipient",
	algorithm: "ed25519" as const,
	publicKey: {} as never,
	rawPublicKey: Buffer.alloc(32, 1),
}

mock.module("../helpers/crypto", () => ({
	...realCrypto,
	createDataKey: () => {
		ownedKey = Buffer.alloc(32, 7)
		return ownedKey
	},
	encryptData: async (key: Buffer, content: string, aad?: Buffer) => {
		expect(key.some((byte) => byte !== 0)).toBe(true)
		if (failure === "encrypt") throw new Error("synthetic encryption failure")
		return encryptData(key, content, aad)
	},
}))
mock.module("../helpers/encryptDataKey", () => ({
	encryptDataKey: (_recipient: unknown, key: Buffer) => {
		expect(key.some((byte) => byte !== 0)).toBe(true)
		if (failure === "wrap") throw new Error("synthetic wrapping failure")
		return Buffer.from("synthetic-wrapped-key")
	},
}))
mock.module("../helpers/getPublicKeys", () => ({
	getPublicKeys: async () => [recipient],
}))
mock.module("../helpers/getEnvironmentByName", () => ({
	getEnvironmentByName: async () => ({
		version: 2,
		keys: [recipient],
		encryptedContent: "synthetic-old-content",
	}),
}))
mock.module("../helpers/environmentExists", () => ({
	environmentExists: () => false,
}))
mock.module("../helpers/resolveProjectRoot", () => ({
	resolveProjectRoot: () => "/synthetic-project",
}))
mock.module("node:fs/promises", () => ({
	...realFs,
	default: {
		...realFs,
		writeFile: async () => {
			if (failure === "write") throw new Error("synthetic write failure")
		},
	},
}))

const { createCommand } = await import("../commands/env/create")
const { encryptEnvironment } = await import("../helpers/encryptEnvironment")

describe("owned encryption data-key buffers", () => {
	let logSpy: ReturnType<typeof spyOn>
	beforeEach(() => {
		failure = undefined
		ownedKey = undefined
		logSpy = spyOn(console, "log").mockImplementation(() => {})
	})
	afterEach(() => logSpy.mockRestore())

	for (const [name, operation] of [
		["create", () => createCommand("staging", "alice", "SYNTHETIC=yes")],
		["encrypt", () => encryptEnvironment("staging", "SYNTHETIC=yes")],
	] as const) {
		for (const stage of [undefined, "encrypt", "wrap", "write"] as const) {
			test(`${name} clears its key after ${stage ?? "success"}`, async () => {
				failure = stage
				if (stage) {
					await expect(operation()).rejects.toThrow("synthetic")
				} else {
					await operation()
				}
				expect(ownedKey).toBeDefined()
				expect(ownedKey).toEqual(Buffer.alloc(32))
			})
		}
	}

	test("revoking the final recipient clears the key before rejecting", async () => {
		await expect(
			encryptEnvironment("staging", "SYNTHETIC=yes", {
				revokePublicKeys: ["alice"],
			}),
		).rejects.toThrow("No valid public keys")
		expect(ownedKey).toEqual(Buffer.alloc(32))
	})
})
