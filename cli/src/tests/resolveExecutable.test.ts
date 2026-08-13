import { describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { resolveExecutable } from "../helpers/resolveExecutable"

describe("resolveExecutable", () => {
	test("resolves a bare command against the original PATH", () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "dotenc-resolve-command-"))
		const command = path.join(dir, "safe-command")
		try {
			writeFileSync(command, "#!/bin/sh\nexit 0\n")
			chmodSync(command, 0o700)

			expect(resolveExecutable("safe-command", { PATH: dir })).toBe(command)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	test("preserves explicit and unresolved commands", () => {
		expect(resolveExecutable("./bin/tool", { PATH: "/tmp" })).toBe("./bin/tool")
		expect(resolveExecutable("missing-tool", { PATH: "/tmp" })).toBeUndefined()
		expect(resolveExecutable("missing-tool", {})).toBeUndefined()
	})
})
