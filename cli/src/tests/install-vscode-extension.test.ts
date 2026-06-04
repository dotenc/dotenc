import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test"
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

const promptConfirmMock = mock(async () => false)
const isInteractiveMock = mock(() => true)

mock.module("../ui/prompts", () => ({ promptConfirm: promptConfirmMock }))
mock.module("../ui/tty", () => ({ isInteractive: isInteractiveMock }))

const { _runInstallVscodeExtension } = await import(
	"../commands/tools/install-vscode-extension"
)

describe("installVscodeExtensionCommand", () => {
	let tmpDir: string
	let cwdSpy: ReturnType<typeof spyOn>
	let logSpy: ReturnType<typeof spyOn>

	beforeEach(() => {
		tmpDir = mkdtempSync(path.join(os.tmpdir(), "test-vscode-ext-"))
		cwdSpy = spyOn(process, "cwd").mockReturnValue(tmpDir)
		logSpy = spyOn(console, "log").mockImplementation(() => {})
		promptConfirmMock.mockClear()
		promptConfirmMock.mockImplementation(async () => false)
		isInteractiveMock.mockClear()
		isInteractiveMock.mockImplementation(() => true)
	})

	afterEach(() => {
		cwdSpy.mockRestore()
		logSpy.mockRestore()
		rmSync(tmpDir, { recursive: true, force: true })
	})

	// extensions.json management

	test("creates .vscode/extensions.json with recommendation when file is absent", async () => {
		await _runInstallVscodeExtension(async () => [])

		const jsonPath = path.join(tmpDir, ".vscode", "extensions.json")
		expect(existsSync(jsonPath)).toBe(true)
		const json = JSON.parse(readFileSync(jsonPath, "utf-8"))
		expect(json.recommendations).toContain("dotenc.dotenc")
	})

	test("appends to existing extensions.json without removing other entries", async () => {
		mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true })
		writeFileSync(
			path.join(tmpDir, ".vscode", "extensions.json"),
			JSON.stringify({ recommendations: ["other.extension"] }),
		)

		await _runInstallVscodeExtension(async () => [])

		const json = JSON.parse(
			readFileSync(path.join(tmpDir, ".vscode", "extensions.json"), "utf-8"),
		)
		expect(json.recommendations).toContain("dotenc.dotenc")
		expect(json.recommendations).toContain("other.extension")
	})

	test("does not duplicate if dotenc.dotenc already in recommendations", async () => {
		mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true })
		writeFileSync(
			path.join(tmpDir, ".vscode", "extensions.json"),
			JSON.stringify({ recommendations: ["dotenc.dotenc"] }),
		)

		await _runInstallVscodeExtension(async () => [])

		const json = JSON.parse(
			readFileSync(path.join(tmpDir, ".vscode", "extensions.json"), "utf-8"),
		)
		expect(
			json.recommendations.filter((x: string) => x === "dotenc.dotenc"),
		).toHaveLength(1)
	})

	test("recovers gracefully from malformed extensions.json", async () => {
		mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true })
		writeFileSync(
			path.join(tmpDir, ".vscode", "extensions.json"),
			"not valid json{{{",
		)

		await _runInstallVscodeExtension(async () => [])

		const json = JSON.parse(
			readFileSync(path.join(tmpDir, ".vscode", "extensions.json"), "utf-8"),
		)
		expect(json.recommendations).toContain("dotenc.dotenc")
	})

	test("handles missing recommendations key in existing file", async () => {
		mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true })
		writeFileSync(
			path.join(tmpDir, ".vscode", "extensions.json"),
			JSON.stringify({ unwantedKey: true }),
		)

		await _runInstallVscodeExtension(async () => [])

		const json = JSON.parse(
			readFileSync(path.join(tmpDir, ".vscode", "extensions.json"), "utf-8"),
		)
		expect(json.recommendations).toContain("dotenc.dotenc")
	})

	// Editor detection + URL handling

	test("prints VS Code fallback URL when no editors detected", async () => {
		await _runInstallVscodeExtension(async () => [])

		const allLogs = logSpy.mock.calls
			.map((c: unknown[]) => String(c[0]))
			.join("\n")
		expect(allLogs).toContain("vscode:extension/dotenc.dotenc")
	})

	test("prompts to open when exactly one editor detected", async () => {
		await _runInstallVscodeExtension(async () => ["cursor"])

		expect(promptConfirmMock).toHaveBeenCalledWith(
			"Open extension page in Cursor now?",
			{
				initial: true,
				nonInteractiveError:
					"Opening the extension page requires an interactive terminal. Pass --open to force it or --manual to print the URL.",
			},
		)
	})

	test("prints install URL when user declines to open", async () => {
		promptConfirmMock.mockImplementation(async () => false)

		await _runInstallVscodeExtension(async () => ["cursor"])

		const allLogs = logSpy.mock.calls
			.map((c: unknown[]) => String(c[0]))
			.join("\n")
		expect(allLogs).toContain("cursor:extension/dotenc.dotenc")
	})

	test("calls openUrl when user confirms open", async () => {
		promptConfirmMock.mockImplementation(async () => true)
		const fakeOpen = mock(async (_url: string) => {})

		await _runInstallVscodeExtension(async () => ["vscode"], fakeOpen)

		expect(fakeOpen).toHaveBeenCalledWith("vscode:extension/dotenc.dotenc")
	})

	test("falls back to print URL if openUrl throws", async () => {
		promptConfirmMock.mockImplementation(async () => true)
		const failingOpen = mock(async (_url: string) => {
			throw new Error("open failed")
		})

		await _runInstallVscodeExtension(async () => ["windsurf"], failingOpen)

		const allLogs = logSpy.mock.calls
			.map((c: unknown[]) => String(c[0]))
			.join("\n")
		expect(allLogs).toContain("windsurf:extension/dotenc.dotenc")
		expect(allLogs).toContain("Open manually")
	})

	test("prints manual URL in non-interactive mode without prompting", async () => {
		isInteractiveMock.mockImplementation(() => false)

		await _runInstallVscodeExtension(async () => ["vscode"])

		const allLogs = logSpy.mock.calls
			.map((c: unknown[]) => String(c[0]))
			.join("\n")
		expect(promptConfirmMock).not.toHaveBeenCalled()
		expect(allLogs).toContain("Install manually")
	})

	test("prints all editor URLs when multiple editors detected", async () => {
		await _runInstallVscodeExtension(async () => ["vscode", "cursor"])

		const allLogs = logSpy.mock.calls
			.map((c: unknown[]) => String(c[0]))
			.join("\n")
		expect(allLogs).toContain("vscode:extension/dotenc.dotenc")
		expect(allLogs).toContain("cursor:extension/dotenc.dotenc")
		expect(promptConfirmMock).not.toHaveBeenCalled()
	})

	test("uses editor key as name fallback for unknown editors", async () => {
		// Pass an editor key that has no entry in EDITOR_NAMES
		await _runInstallVscodeExtension(async () => ["vscode", "unknown-editor"])

		const allLogs = logSpy.mock.calls
			.map((c: unknown[]) => String(c[0]))
			.join("\n")
		expect(allLogs).toContain("unknown-editor")
	})

	// detectEditors integration (real implementation, project dirs)

	test("detectEditors: detects editors via project directories", async () => {
		mkdirSync(path.join(tmpDir, ".cursor"), { recursive: true })
		mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true })

		// Run with real detectEditors — multiple editors found, no prompt
		await _runInstallVscodeExtension()

		const allLogs = logSpy.mock.calls
			.map((c: unknown[]) => String(c[0]))
			.join("\n")
		expect(allLogs).toContain("cursor:extension/dotenc.dotenc")
		expect(allLogs).toContain("vscode:extension/dotenc.dotenc")
	})
})
