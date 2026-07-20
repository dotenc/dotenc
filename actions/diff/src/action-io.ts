import fs from "node:fs/promises"
import { escapeWorkflowCommand, SafeActionError } from "./safety"

export type ActionIo = {
	getInput(name: string): string
	setOutput(name: string, value: string): Promise<void>
	writeSummary(markdown: string): Promise<void>
	annotate(level: "warning" | "error", message: string): void
}

const inputEnvironmentName = (name: string): string =>
	`INPUT_${name.replaceAll(" ", "_").toUpperCase()}`

export const defaultActionIo: ActionIo = {
	getInput(name) {
		return process.env[inputEnvironmentName(name)]?.trim() ?? ""
	},
	async setOutput(name, value) {
		if (!/^[a-z][a-z0-9-]*$/.test(name) || /[\r\n]/.test(value)) {
			throw new SafeActionError("invalid_action_output")
		}
		const outputPath = process.env.GITHUB_OUTPUT
		if (!outputPath) throw new SafeActionError("missing_action_output")
		await fs.appendFile(outputPath, `${name}=${value}\n`, "utf8")
	},
	async writeSummary(markdown) {
		const summaryPath = process.env.GITHUB_STEP_SUMMARY
		if (!summaryPath) throw new SafeActionError("missing_step_summary")
		await fs.appendFile(summaryPath, markdown, "utf8")
	},
	annotate(level, message) {
		const command = level === "error" ? "error" : "warning"
		console.error(`::${command}::${escapeWorkflowCommand(message)}`)
	},
}
