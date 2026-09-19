import { expect, mock, test } from "bun:test"

const libraryOutput = new Uint8Array([0, 7, 8, 0])
mock.module("eciesjs", () => ({
	ECIES_CONFIG: {},
	encrypt: () => new Uint8Array(),
	decrypt: () => libraryOutput.subarray(1, 3),
}))
const { eciesDecrypt } = await import("../helpers/ecies")

test("ECIES plaintext Buffer shares the exact library output slice for zeroing", () => {
	const plaintext = eciesDecrypt(Buffer.alloc(32), Buffer.alloc(1))
	expect(Buffer.isBuffer(plaintext)).toBe(true)
	expect(plaintext).toEqual(Buffer.from([7, 8]))
	plaintext.fill(0)
	expect(libraryOutput).toEqual(new Uint8Array(4))
})
