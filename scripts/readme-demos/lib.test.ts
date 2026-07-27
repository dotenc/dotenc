import { describe, expect, test } from "bun:test"
import { assetPath, parseSceneSelection, recordingPath, scenes } from "./lib"

describe("README demo scene paths", () => {
	test("accepts only the declared scene names", () => {
		expect(parseSceneSelection("all")).toEqual([...scenes])
		expect(parseSceneSelection("quickstart")).toEqual(["quickstart"])
		expect(() => parseSceneSelection("../private")).toThrow("Unknown demo")
	})

	test("rejects invalid runtime values before constructing output paths", () => {
		expect(() => recordingPath("../private" as never)).toThrow("Unknown demo")
		expect(() => assetPath("/tmp/private" as never)).toThrow("Unknown demo")
	})
})
