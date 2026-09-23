import chalk from "chalk"
import {
	ARTIFACT_DOCTOR_REPORT_SCHEMA_VERSION,
	type ArtifactDoctorFinding,
	ArtifactDoctorInvocationError,
	type ArtifactDoctorOptions,
	type ArtifactDoctorReport,
	createArtifactDoctorReport,
} from "../helpers/artifactDoctor"

export type ArtifactDoctorCommandOptions = Omit<
	ArtifactDoctorOptions,
	"invocationDir"
> & {
	json?: boolean
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
	`${count} ${count === 1 ? singular : pluralForm}`

const symbolForFinding = (finding: ArtifactDoctorFinding) =>
	finding.severity === "error" ? chalk.red("✗") : chalk.yellow("!")

export const renderArtifactDoctorHuman = (
	report: ArtifactDoctorReport,
): string => {
	const subjects = [
		...report.passed.map((check) => check.subject),
		...report.findings.map((finding) => finding.subject),
	]
	const subjectWidth = Math.min(
		24,
		Math.max(0, ...subjects.map((subject) => subject.length)),
	)
	const lines: string[] = []

	for (const check of report.passed) {
		lines.push(
			`${chalk.green("✓")} ${check.subject.padEnd(subjectWidth)}  ${check.message}`,
		)
	}
	for (const entry of report.findings) {
		lines.push(
			`${symbolForFinding(entry)} ${entry.subject.padEnd(subjectWidth)}  ${entry.message}`,
		)
		if (entry.paths && entry.paths.length > 0) {
			lines.push(`  Paths: ${entry.paths.join(", ")}`)
		}
	}

	if (lines.length > 0) lines.push("")
	lines.push(
		[
			plural(report.summary.errors, "error"),
			plural(report.summary.warnings, "warning"),
			plural(report.summary.filesScanned, "file scanned", "files scanned"),
		].join(" · "),
	)
	return lines.join("\n")
}

export const renderArtifactDoctorJson = (
	report: ArtifactDoctorReport,
): string => JSON.stringify(report)

export const createArtifactDoctorFailureReport = (
	options: ArtifactDoctorCommandOptions,
	id: "invocation.invalid" | "scan.incomplete",
): ArtifactDoctorReport => ({
	schemaVersion: ARTIFACT_DOCTOR_REPORT_SCHEMA_VERSION,
	command: "doctor artifacts",
	complete: false,
	scope: {
		directory: ".",
		selectedSecrets: new Set(options.secretNames ?? []).size,
	},
	findings: [
		{
			id,
			severity: id === "invocation.invalid" ? "error" : "warning",
			subject: id === "invocation.invalid" ? "invocation" : "scan",
			message:
				id === "invocation.invalid"
					? "The artifact doctor invocation is invalid."
					: "The artifact scan could not complete.",
			count: 1,
		},
	],
	passed: [],
	summary: {
		errors: id === "invocation.invalid" ? 1 : 0,
		warnings: id === "scan.incomplete" ? 1 : 0,
		filesScanned: 0,
		directoriesScanned: 0,
		bytesScanned: 0,
	},
	exitCode: 2,
})

export const reportArtifactDoctorInvocationError = (
	options: ArtifactDoctorCommandOptions,
	message: string,
) => {
	if (options.json) {
		console.log(
			renderArtifactDoctorJson(
				createArtifactDoctorFailureReport(options, "invocation.invalid"),
			),
		)
	} else {
		console.error(`${chalk.red("Error:")} ${message}`)
	}
	process.exitCode = 2
}

export const artifactDoctorCommand = async (
	directory: string,
	options: ArtifactDoctorCommandOptions = {},
) => {
	let report: ArtifactDoctorReport
	try {
		report = await createArtifactDoctorReport(directory, options)
	} catch (error) {
		const invalidInvocation = error instanceof ArtifactDoctorInvocationError
		if (invalidInvocation) {
			reportArtifactDoctorInvocationError(options, error.message)
			return
		}
		report = createArtifactDoctorFailureReport(options, "scan.incomplete")
	}

	console.log(
		options.json
			? renderArtifactDoctorJson(report)
			: renderArtifactDoctorHuman(report),
	)
	process.exitCode = report.exitCode
}
