import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import path from "node:path"
import {
	assetPath,
	isSupportedDemoNode,
	parseSceneSelection,
	recordingPath,
	scenes,
} from "./lib"

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

// The argparse override removes sprintf-js while retaining js-yaml 3's CLI API.
describe("README demo YAML CLI compatibility", () => {
	const yamlCli = path.join(
		import.meta.dir,
		"node_modules/js-yaml/bin/js-yaml.js",
	)
	const runYaml = (args: string[], input = "") =>
		spawnSync("node", [yamlCli, ...args], {
			input,
			encoding: "utf8",
			timeout: 5000,
		})

	test("preserves legacy argument aliases and stdin conversion", () => {
		const help = runYaml(["--help"])
		expect(help.status).toBe(0)
		expect(help.stdout).toContain("--compact")
		const parsed = runYaml(["--to-json"], "greeting: synthetic-demo\n")
		expect(parsed.status).toBe(0)
		expect(JSON.parse(parsed.stdout)).toEqual({ greeting: "synthetic-demo" })
		const dumped = runYaml([], '{"greeting":"synthetic-demo"}')
		expect(dumped.status).toBe(0)
		expect(dumped.stdout).toContain("greeting: synthetic-demo")
	})

	test("rejects invalid options and malformed YAML without hanging", () => {
		const invalid = runYaml(["--unknown-option"])
		expect(invalid.status).toBe(2)
		expect(invalid.stderr).toContain("unrecognized arguments")
		const malformed = runYaml(["--compact"], "key: [unterminated")
		expect(malformed.status).toBe(1)
		expect(malformed.stderr).toContain("YAMLException")
	})
})

describe("README demo Node security baseline", () => {
	test.each([
		"v24.22.1",
		"v24.22.2",
		"v24.23.0",
	])("accepts patched %s", (version) => {
		expect(isSupportedDemoNode(version)).toBe(true)
	})
	test.each([
		"v24.21.0",
		"v24.22.0",
		"v22.23.4",
		"v26.12.1",
		"v24.22.1-rc.1",
		"unavailable",
	])("rejects unsupported %s", (version) => {
		expect(isSupportedDemoNode(version)).toBe(false)
	})
})
