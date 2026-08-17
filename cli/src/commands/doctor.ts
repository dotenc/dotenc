import chalk from "chalk"
import {
	createDoctorReport,
	DOCTOR_REPORT_SCHEMA_VERSION,
	type DoctorFinding,
	DoctorInvocationError,
	type DoctorOptions,
	type DoctorReport,
} from "../helpers/doctor"
import { validateEnvironmentName } from "../helpers/validateEnvironmentName"

export type DoctorCommandOptions = Omit<DoctorOptions, "invocationDir"> & {
	json?: boolean
}

const posixShellArgument = (argument: string) => {
	if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(argument)) return argument
	return `'${argument.replace(/'/g, `'"'"'`)}'`
}

const powershellArgument = (argument: string) => {
	if (/^[a-zA-Z0-9_+=:,./-]+$/.test(argument)) return argument
	return `'${argument.replace(/'/g, "''")}'`
}

export const formatDoctorCommand = (
	argv: string[],
	platform: NodeJS.Platform = process.platform,
) =>
	argv
		.map(platform === "win32" ? powershellArgument : posixShellArgument)
		.join(" ")

const symbolForFinding = (finding: DoctorFinding) => {
	if (finding.severity === "error") return chalk.red("✗")
	if (finding.severity === "warning") return chalk.yellow("!")
	return chalk.cyan("i")
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
	`${count} ${count === 1 ? singular : pluralForm}`

export const renderDoctorHuman = (
	report: DoctorReport,
	platform: NodeJS.Platform = process.platform,
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
		if (check.paths && check.paths.length > 0) {
			lines.push(`  Paths: ${check.paths.join(", ")}`)
		}
	}

	for (const entry of report.findings) {
		lines.push(
			`${symbolForFinding(entry)} ${entry.subject.padEnd(subjectWidth)}  ${entry.message}`,
		)
		if (entry.paths && entry.paths.length > 0) {
			lines.push(`  Paths: ${entry.paths.join(", ")}`)
		}
		for (const command of entry.commands ?? []) {
			const label = platform === "win32" ? "Run (PowerShell)" : "Run"
			lines.push(`  ${label}: ${formatDoctorCommand(command, platform)}`)
		}
	}

	if (lines.length > 0) lines.push("")
	lines.push(
		[
			plural(report.summary.errors, "error"),
			plural(report.summary.warnings, "warning"),
			plural(report.summary.passed, "check passed", "checks passed"),
		].join(" · "),
	)
	return lines.join("\n")
}

export const renderDoctorJson = (report: DoctorReport): string =>
	JSON.stringify(report)

export const createDoctorFailureReport = (
	options: DoctorCommandOptions,
	id: "invocation.invalid" | "scan.incomplete",
): DoctorReport => {
	const requestedProfile = options.profile
		? `personal.${options.profile}`
		: undefined
	const safeProfile =
		requestedProfile && validateEnvironmentName(requestedProfile).valid
			? requestedProfile
			: undefined
	return {
		schemaVersion: DOCTOR_REPORT_SCHEMA_VERSION,
		command: "doctor",
		complete: false,
		scope: {
			mode: options.all ? "all" : options.localOnly ? "local" : "effective",
			...(safeProfile ? { profile: safeProfile } : {}),
		},
		findings: [
			{
				id,
				severity: id === "invocation.invalid" ? "error" : "warning",
				subject: id === "invocation.invalid" ? "invocation" : "scan",
				message:
					id === "invocation.invalid"
						? "The doctor invocation is invalid."
						: "The diagnostic scan could not complete.",
			},
		],
		passed: [],
		summary: {
			errors: id === "invocation.invalid" ? 1 : 0,
			warnings: id === "scan.incomplete" ? 1 : 0,
			info: 0,
			passed: 0,
		},
		exitCode: 2,
	}
}

export const doctorCommand = async (options: DoctorCommandOptions = {}) => {
	let report: DoctorReport
	try {
		report = await createDoctorReport(options)
	} catch (error) {
		const invalidInvocation = error instanceof DoctorInvocationError
		report = createDoctorFailureReport(
			options,
			invalidInvocation ? "invocation.invalid" : "scan.incomplete",
		)
		if (!options.json && invalidInvocation) {
			console.error(`${chalk.red("Error:")} ${error.message}`)
			process.exitCode = 2
			return
		}
	}

	console.log(
		options.json ? renderDoctorJson(report) : renderDoctorHuman(report),
	)
	process.exitCode = report.exitCode
}
