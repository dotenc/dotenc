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
	command: "doctor artifacts"
	complete: boolean
	scope: { directory: "."; selectedSecrets: number }
	findings: Array<{
		id: string
		severity: "error" | "warning"
		subject: string
		message: string
		count: number
		paths?: string[]
	}>
	passed: Array<{
		id: "artifacts.scanned"
		subject: "artifacts"
		message: string
	}>
	summary: {
		errors: number
		warnings: number
		filesScanned: number
		directoriesScanned: number
		bytesScanned: number
	}
	exitCode: 0 | 1 | 2
}

const makeReport = (exitCode: 0 | 1 | 2 = 0): Report => ({
	schemaVersion: 1,
	command: "doctor artifacts",
	complete: true,
	scope: { directory: ".", selectedSecrets: 0 },
	findings: [],
	passed: [
		{
			id: "artifacts.scanned",
			subject: "artifacts",
			message: "Scanned 2 files across 1 directory.",
		},
	],
	summary: {
		errors: 0,
		warnings: 0,
		filesScanned: 2,
		directoriesScanned: 1,
		bytesScanned: 42,
	},
	exitCode,
})

const createArtifactDoctorReport = mock(
	async (_directory?: unknown, _options?: unknown) => makeReport(),
)

class ArtifactDoctorInvocationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ArtifactDoctorInvocationError"
	}
}

mock.module("../helpers/artifactDoctor", () => ({
	ARTIFACT_DOCTOR_REPORT_SCHEMA_VERSION: 1,
	ArtifactDoctorInvocationError,
	createArtifactDoctorReport,
}))

const {
	artifactDoctorCommand,
	createArtifactDoctorFailureReport,
	renderArtifactDoctorHuman,
	renderArtifactDoctorJson,
} = await import("../commands/doctorArtifacts")

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
const stripAnsi = (value: string) => value.replace(ansiPattern, "")
const originalExitCode = process.exitCode

beforeEach(() => {
	createArtifactDoctorReport.mockClear()
	createArtifactDoctorReport.mockImplementation(async () => makeReport())
	process.exitCode = undefined
})

afterAll(() => {
	process.exitCode = originalExitCode ?? 0
})

describe("artifact doctor command renderers", () => {
	test("renders findings, bounded paths, and the scan summary", () => {
		const report: Report = {
			...makeReport(1),
			findings: [
				{
					id: "artifact.private-key",
					severity: "error",
					subject: "private key",
					message: "Private-key material appears in 1 artifact file.",
					count: 1,
					paths: ["assets/app.js"],
				},
				{
					id: "artifact.secret-name",
					severity: "warning",
					subject: "selected secret name",
					message: "A selected name appears in 1 artifact file.",
					count: 1,
				},
			],
			summary: {
				...makeReport().summary,
				errors: 1,
				warnings: 1,
			},
		}

		const rendered = stripAnsi(renderArtifactDoctorHuman(report as never))

		expect(rendered).toContain("✓ artifacts")
		expect(rendered).toContain("✗ private key")
		expect(rendered).toContain("! selected secret name")
		expect(rendered).toContain("Paths: assets/app.js")
		expect(rendered).toEndWith("1 error · 1 warning · 2 files scanned")
	})

	test("renders stable one-line JSON", () => {
		const report = makeReport(1)
		const rendered = renderArtifactDoctorJson(report as never)

		expect(rendered).toBe(JSON.stringify(report))
		expect(rendered).not.toContain("\n")
		expect(JSON.parse(rendered)).toEqual(report)
	})

	test("creates sanitized failure reports without selected names", () => {
		const report = createArtifactDoctorFailureReport(
			{
				secretNames: ["PRIVATE_CUSTOM_NAME", "PRIVATE_CUSTOM_NAME"],
				json: true,
			},
			"invocation.invalid",
		)
		const rendered = JSON.stringify(report)

		expect(report.scope.selectedSecrets).toBe(1)
		expect(report.exitCode).toBe(2)
		expect(rendered).not.toContain("PRIVATE_CUSTOM_NAME")
	})
})

describe("artifactDoctorCommand", () => {
	test("renders a successful human report", async () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {})

		try {
			await artifactDoctorCommand("dist")

			expect(stripAnsi(String(logSpy.mock.calls[0][0]))).toContain(
				"0 errors · 0 warnings · 2 files scanned",
			)
			expect(process.exitCode).toBe(0)
		} finally {
			logSpy.mockRestore()
		}
	})

	test.each([
		0, 1,
	] as const)("forwards options, renders JSON, and applies exit code %d", async (exitCode) => {
		const report = makeReport(exitCode)
		createArtifactDoctorReport.mockImplementation(async () => report)
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const options = {
			secretNames: ["SELECTED_SECRET"],
			strict: true,
			json: true,
		}

		try {
			await artifactDoctorCommand("dist", options)

			expect(createArtifactDoctorReport).toHaveBeenCalledTimes(1)
			expect(createArtifactDoctorReport).toHaveBeenCalledWith("dist", options)
			expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual(report)
			expect(process.exitCode).toBe(exitCode)
		} finally {
			logSpy.mockRestore()
		}
	})

	test("reports an invalid human invocation without rendering a report", async () => {
		createArtifactDoctorReport.mockImplementation(async () => {
			throw new ArtifactDoctorInvocationError(
				"The artifact directory is missing.",
			)
		})
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})

		try {
			await artifactDoctorCommand("missing")

			expect(logSpy).not.toHaveBeenCalled()
			expect(stripAnsi(String(errorSpy.mock.calls[0][0]))).toBe(
				"Error: The artifact directory is missing.",
			)
			expect(process.exitCode).toBe(2)
		} finally {
			logSpy.mockRestore()
			errorSpy.mockRestore()
		}
	})

	test("sanitizes invalid JSON invocations and unexpected failures", async () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		const errorSpy = spyOn(console, "error").mockImplementation(() => {})

		try {
			createArtifactDoctorReport.mockImplementationOnce(async () => {
				throw new ArtifactDoctorInvocationError("private invocation detail")
			})
			await artifactDoctorCommand("missing", { json: true })
			const invalid = String(logSpy.mock.calls[0][0])
			expect(JSON.parse(invalid)).toMatchObject({
				command: "doctor artifacts",
				complete: false,
				findings: [{ id: "invocation.invalid" }],
				exitCode: 2,
			})
			expect(invalid).not.toContain("private invocation detail")

			createArtifactDoctorReport.mockImplementationOnce(async () => {
				throw new Error("raw file content detail")
			})
			await artifactDoctorCommand("dist", { json: true })
			const incomplete = String(logSpy.mock.calls[1][0])
			expect(JSON.parse(incomplete)).toMatchObject({
				findings: [{ id: "scan.incomplete" }],
				exitCode: 2,
			})
			expect(incomplete).not.toContain("raw file content detail")
			expect(errorSpy).not.toHaveBeenCalled()
		} finally {
			logSpy.mockRestore()
			errorSpy.mockRestore()
		}
	})
})
