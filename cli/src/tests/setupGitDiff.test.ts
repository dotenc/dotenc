import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { execSync } from "node:child_process"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { setupGitDiff } from "../helpers/setupGitDiff"

describe("setupGitDiff", () => {
	let tmpDir: string
	const originalCwd = process.cwd()

	beforeAll(() => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), "test-gitdiff-"))
		execSync("git init --quiet", { cwd: tmpDir })
		process.chdir(tmpDir)
	})

	afterAll(() => {
		process.chdir(originalCwd)
		rmSync(tmpDir, { recursive: true, force: true })
	})

	test("creates .gitattributes with diff marker", () => {
		setupGitDiff()
		const content = readFileSync(path.join(tmpDir, ".gitattributes"), "utf-8")
		expect(content).toContain(".env.*.enc diff=dotenc")
		expect(content).not.toContain("\n*.enc diff=dotenc")
	})

	test("does not duplicate marker on repeated calls", () => {
		setupGitDiff()
		setupGitDiff()
		const content = readFileSync(path.join(tmpDir, ".gitattributes"), "utf-8")
		const count = content.split(".env.*.enc diff=dotenc").length - 1
		expect(count).toBe(1)
	})

	test("appends marker to existing .gitattributes content", () => {
		const attrPath = path.join(tmpDir, ".gitattributes")
		writeFileSync(attrPath, "*.md linguist-documentation", "utf-8")
		setupGitDiff()
		const content = readFileSync(attrPath, "utf-8")
		expect(content).toContain("*.md linguist-documentation")
		expect(content).toContain(".env.*.enc diff=dotenc")
	})

	test("migrates only the exact legacy broad marker", () => {
		const attrPath = path.join(tmpDir, ".gitattributes")
		writeFileSync(
			attrPath,
			"*.enc diff=dotenc\narchives/*.enc diff=custom\n",
			"utf-8",
		)

		setupGitDiff()

		const content = readFileSync(attrPath, "utf-8")
		expect(content).toContain(".env.*.enc diff=dotenc")
		expect(content).not.toContain("\n*.enc diff=dotenc")
		expect(content).toContain("archives/*.enc diff=custom")
	})

	test("configures git diff driver", () => {
		setupGitDiff()
		const result = execSync("git config --local diff.dotenc.textconv", {
			cwd: tmpDir,
			encoding: "utf-8",
		}).trim()
		expect(result).toBe("dotenc textconv")
	})

	test("explicitly disables textconv plaintext caching locally", () => {
		setupGitDiff()
		const result = execSync(
			"git config --local --get diff.dotenc.cachetextconv",
			{
				cwd: tmpDir,
				encoding: "utf-8",
			},
		).trim()
		expect(result).toBe("false")
	})

	test("targets an explicit project root from a nested directory", () => {
		const nestedDir = path.join(tmpDir, "packages", "app")
		mkdirSync(nestedDir, { recursive: true })
		process.chdir(nestedDir)

		try {
			setupGitDiff(tmpDir)
			expect(existsSync(path.join(tmpDir, ".gitattributes"))).toBe(true)
			expect(existsSync(path.join(nestedDir, ".gitattributes"))).toBe(false)
		} finally {
			process.chdir(tmpDir)
		}
	})

	test("throws when git cannot configure the local driver", () => {
		const nonGitDir = mkdtempSync(
			path.join(os.tmpdir(), "test-gitdiff-no-git-"),
		)

		try {
			expect(() => setupGitDiff(nonGitDir)).toThrow(
				"Make sure this is a Git repository",
			)
			expect(existsSync(path.join(nonGitDir, ".gitattributes"))).toBe(false)
		} finally {
			rmSync(nonGitDir, { recursive: true, force: true })
		}
	})
})
