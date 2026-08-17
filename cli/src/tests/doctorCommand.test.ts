import {
	afterAll,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test"

type Report = {
	schemaVersion: 1
	command: "doctor"
	complete: boolean
	scope: {
		mode: "effective" | "local" | "all"
		profile?: string
	}
	project?: {
		root: "."
		invocation: string
	}
	findings: Array<{
		id: string
		severity: "error" | "warning" | "info"
		subject: string
		message: string
		paths?: string[]
		commands?: string[][]
	}>
	passed: Array<{
		id: string
		subject: string
		message: string
		paths?: string[]
	}>
	summary: {
		errors: number
		warnings: number
		info: number
		passed: number
	}
	exitCode: 0 | 1 | 2
}

const makeReport = (exitCode: 0 | 1 | 2 = 0): Report => ({
	schemaVersion: 1,
	command: "doctor",
	complete: true,
	scope: { mode: "effective" },
	project: { root: ".", invocation: "." },
	findings: [],
	passed: [
		{
			id: "development.decryptable",
			subject: "development",
			message: "1 layer, decryptable",
		},
	],
	summary: { errors: 0, warnings: 0, info: 0, passed: 1 },
	exitCode,
})

const createDoctorReport = mock(async (_options?: unknown) => makeReport())

class DoctorInvocationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "DoctorInvocationError"
	}
}

mock.module("../helpers/doctor", () => ({
	createDoctorReport,
	DOCTOR_REPORT_SCHEMA_VERSION: 1,
	DoctorInvocationError,
}))

const {
	doctorCommand,
	formatDoctorCommand,
	renderDoctorHuman,
	renderDoctorJson,
} = await import("../commands/doctor")

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
const stripAnsi = (value: string) => value.replace(ansiPattern, "")
const originalExitCode = process.exitCode

beforeEach(() => {
	createDoctorReport.mockClear()
	createDoctorReport.mockImplementation(async () => makeReport())
	process.exitCode = undefined
})

afterAll(() => {
	process.exitCode = originalExitCode ?? 0
})

describe("doctor command renderers", () => {
	test("quotes shell arguments without changing safe argv", () => {
		expect(
			formatDoctorCommand([
				"dotenc",
				"env",
				"rename",
				"old profile",
				"personal.o'hara",
				"--all-layers",
				"",
			]),
		).toBe(
			`dotenc env rename 'old profile' 'personal.o'"'"'hara' --all-layers ''`,
		)
		expect(formatDoctorCommand(["git", "restore", "--", "a/b.env"])).toBe(
			"git restore -- a/b.env",
		)
		expect(
			formatDoctorCommand(
				[
					"dotenc",
					"env",
					"rename",
					"old profile",
					"personal.o'hara",
					"$HOME/profile",
					"--all-layers",
					"",
				],
				"win32",
			),
		).toBe(
			"dotenc env rename 'old profile' 'personal.o''hara' '$HOME/profile' --all-layers ''",
		)
	})

	test("renders passed checks, findings, paths, recovery commands, and summary", () => {
		const report: Report = {
			...makeReport(1),
			passed: [
				{
					id: "development.decryptable",
					subject: "development",
					message: "2 layers, decryptable",
					paths: [".env.development.enc", "apps/api/.env.development.enc"],
				},
			],
			findings: [
				{
					id: "personal.deleted",
					severity: "warning",
					subject: "personal.alice",
					message: "deleted from the working tree",
					paths: [".env.personal alice.enc"],
					commands: [["git", "restore", "--", ".env.personal o'hara.enc"]],
				},
				{
					id: "development.corrupt",
					severity: "error",
					subject: "development",
					message: "wrapped data key is invalid",
				},
				{
					id: "personal.none",
					severity: "info",
					subject: "personal",
					message: "no personal profiles found",
				},
			],
			summary: { errors: 1, warnings: 1, info: 1, passed: 1 },
		}

		const rendered = stripAnsi(renderDoctorHuman(report as never))

		expect(rendered).toContain("✓ development")
		expect(rendered).toContain("2 layers, decryptable")
		expect(rendered).toContain(
			"Paths: .env.development.enc, apps/api/.env.development.enc",
		)
		expect(rendered).toContain("! personal.alice")
		expect(rendered).toContain("✗ development")
		expect(rendered).toContain("i personal")
		expect(rendered).toContain(
			`Run: git restore -- '.env.personal o'"'"'hara.enc'`,
		)
		expect(rendered).toEndWith("1 error · 1 warning · 1 check passed")

		const windowsRendered = stripAnsi(
			renderDoctorHuman(report as never, "win32"),
		)
		expect(windowsRendered).toContain(
			"Run (PowerShell): git restore -- '.env.personal o''hara.enc'",
		)
	})

	test("renders the report as stable one-line JSON", () => {
		const report = makeReport(1)
		report.scope = { mode: "local", profile: "personal.alice" }
		report.findings.push({
			id: "personal.inaccessible",
			severity: "warning",
			subject: "personal.alice",
			message: "profile is inaccessible",
			commands: [["dotenc", "auth", "grant", "personal.alice", "ivan"]],
		})

		const rendered = renderDoctorJson(report as never)

		expect(rendered).toBe(JSON.stringify(report))
		expect(rendered).not.toContain("\n")
		expect(JSON.parse(rendered)).toEqual(report)
	})
})

describe("doctorCommand", () => {
	test.each([
		0, 1,
	] as const)("forwards engine options, renders JSON, and applies exit code %d", async (exitCode) => {
		const report = makeReport(exitCode)
		createDoctorReport.mockImplementation(async () => report)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const options = {
			profile: "alice",
			localOnly: true,
			strict: true,
			json: true,
		}

		try {
			await doctorCommand(options)

			expect(createDoctorReport).toHaveBeenCalledTimes(1)
			expect(createDoctorReport).toHaveBeenCalledWith(options)
			expect(logSpy).toHaveBeenCalledTimes(1)
			expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual(report)
			expect(process.exitCode).toBe(exitCode)
		} finally {
			logSpy.mockRestore()
		}
	})

	test("reports an invalid human invocation without rendering a report", async () => {
		createDoctorReport.mockImplementation(async () => {
			throw new DoctorInvocationError(
				"--all cannot be combined with --local-only.",
			)
		})
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})

		try {
			await doctorCommand({ all: true, localOnly: true })

			expect(createDoctorReport).toHaveBeenCalledWith({
				all: true,
				localOnly: true,
			})
			expect(logSpy).not.toHaveBeenCalled()
			expect(stripAnsi(String(errorSpy.mock.calls[0][0]))).toBe(
				"Error: --all cannot be combined with --local-only.",
			)
			expect(process.exitCode).toBe(2)
		} finally {
			logSpy.mockRestore()
			errorSpy.mockRestore()
		}
	})

	test("returns a sanitized JSON report for an invalid invocation", async () => {
		createDoctorReport.mockImplementation(async () => {
			throw new DoctorInvocationError("private invocation detail")
		})
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})

		try {
			await doctorCommand({
				all: true,
				localOnly: true,
				profile: "alice",
				json: true,
			})

			const rendered = String(logSpy.mock.calls[0][0])
			const report = JSON.parse(rendered)
			expect(report).toMatchObject({
				schemaVersion: 1,
				command: "doctor",
				complete: false,
				scope: { mode: "all", profile: "personal.alice" },
				findings: [
					{
						id: "invocation.invalid",
						severity: "error",
						message: "The doctor invocation is invalid.",
					},
				],
				exitCode: 2,
			})
			expect(rendered).not.toContain("private invocation detail")
			expect(errorSpy).not.toHaveBeenCalled()
			expect(process.exitCode).toBe(2)
		} finally {
			logSpy.mockRestore()
			errorSpy.mockRestore()
		}
	})

	test("converts an unexpected engine failure into a generic incomplete scan", async () => {
		createDoctorReport.mockImplementation(async () => {
			throw new Error("raw provider exception with private account detail")
		})
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})

		try {
			await doctorCommand({ localOnly: true })

			const rendered = stripAnsi(String(logSpy.mock.calls[0][0]))
			expect(rendered).toContain("! scan")
			expect(rendered).toContain("The diagnostic scan could not complete.")
			expect(rendered).toEndWith("0 errors · 1 warning · 0 checks passed")
			expect(rendered).not.toContain("private account detail")
			expect(errorSpy).not.toHaveBeenCalled()
			expect(process.exitCode).toBe(2)
		} finally {
			logSpy.mockRestore()
			errorSpy.mockRestore()
		}
	})
})
