import { ConfirmPrompt, isCancel, PasswordPrompt, Prompt } from "@clack/core"
import chalk from "chalk"
import { isInteractive } from "../ui/tty"

type PromptQuestion = ConfirmQuestion | ListQuestion | PasswordQuestion

type QuestionChoice =
	| string
	| {
			disabled?: boolean
			hint?: string
			name: string
			value: string
	  }

type BaseQuestion = {
	message: string
	name: string
}

type ConfirmQuestion = BaseQuestion & {
	default?: boolean
	type: "confirm"
}

type ListQuestion = BaseQuestion & {
	choices: QuestionChoice[]
	default?: string
	type: "list"
}

type PasswordQuestion = BaseQuestion & {
	default?: string
	mask?: string
	type: "password"
}

type SelectOption = {
	disabled?: boolean
	hint?: string
	label: string
	value: string
}

type SelectOptionState = "active" | "cancelled" | "inactive" | "selected"

export type GuardedPrompt = (
	questions: unknown,
	nonInteractiveError?: string,
) => Promise<Record<string, unknown>>

const VERTICAL = chalk.gray("│")
const ACTIVE_VERTICAL = chalk.cyan("│")
const ACTIVE_END = chalk.cyan("└")
const ACTIVE_CHOICE = chalk.green("●")
const INACTIVE_CHOICE = chalk.gray("○")
const STATUS_SYMBOL = {
	active: chalk.cyan("◆"),
	cancel: chalk.red("■"),
	error: chalk.yellow("▲"),
	initial: chalk.cyan("◆"),
	submit: chalk.green("◇"),
} as const

const getStatusSymbol = (state: Prompt["state"]) => STATUS_SYMBOL[state]

const formatHint = (hint?: string) => (hint ? ` ${chalk.dim(`(${hint})`)}` : "")

const formatSelectOption = (
	option: SelectOption | undefined,
	state: SelectOptionState,
) => {
	if (!option) {
		return ""
	}

	const hint = formatHint(option.hint)
	if (option.disabled) {
		return option.label
	}

	switch (state) {
		case "active":
			return `${ACTIVE_CHOICE} ${option.label}${hint}`
		case "cancelled":
			return `${chalk.strikethrough(chalk.dim(option.label))}${hint}`
		case "selected":
			return `${chalk.dim(option.label)}${hint}`
		default:
			return `${INACTIVE_CHOICE} ${chalk.dim(option.label)}${hint}`
	}
}

const findInitialSelectCursor = (
	options: SelectOption[],
	initialValue?: string,
) => {
	if (initialValue) {
		const initialCursor = options.findIndex(
			(option) => option.value === initialValue && !option.disabled,
		)
		if (initialCursor !== -1) {
			return initialCursor
		}
	}

	const firstSelectable = options.findIndex((option) => !option.disabled)
	return firstSelectable === -1 ? 0 : firstSelectable
}

const renderSelectPrompt = (
	state: Prompt["state"],
	message: string,
	options: SelectOption[],
	cursor: number,
) => {
	const header = `${VERTICAL}\n${getStatusSymbol(state)}  ${message}\n`

	switch (state) {
		case "submit":
			return `${header}${VERTICAL}  ${formatSelectOption(options[cursor], "selected")}`
		case "cancel":
			return `${header}${VERTICAL}  ${formatSelectOption(options[cursor], "cancelled")}\n${VERTICAL}`
		default:
			return `${header}${ACTIVE_VERTICAL}  ${options
				.map((option, index) =>
					formatSelectOption(option, index === cursor ? "active" : "inactive"),
				)
				.join(`\n${ACTIVE_VERTICAL}  `)}\n${ACTIVE_END}\n`
	}
}

class SelectPromptWithDisabled extends Prompt {
	options: SelectOption[]
	cursor: number

	constructor({
		initialValue,
		message,
		options,
	}: {
		initialValue?: string
		message: string
		options: SelectOption[]
	}) {
		const renderState = {
			cursor: findInitialSelectCursor(options, initialValue),
			options,
		}

		super(
			{
				initialValue,
				render() {
					return renderSelectPrompt(
						this.state,
						message,
						renderState.options,
						renderState.cursor,
					)
				},
			},
			false,
		)

		this.options = options
		this.cursor = renderState.cursor
		this.updateValue()

		this.on("cursor", (key) => {
			switch (key) {
				case "left":
				case "up":
					this.moveCursor(-1)
					break
				case "down":
				case "right":
					this.moveCursor(1)
					break
			}

			renderState.cursor = this.cursor
			this.updateValue()
		})
	}

	private hasSelectableOptions() {
		return this.options.some((option) => !option.disabled)
	}

	private moveCursor(direction: -1 | 1) {
		if (!this.hasSelectableOptions()) {
			return
		}

		let nextCursor = this.cursor
		do {
			nextCursor =
				(nextCursor + direction + this.options.length) % this.options.length
		} while (this.options[nextCursor]?.disabled)

		this.cursor = nextCursor
	}

	private updateValue() {
		this.value = this.options[this.cursor]?.value
	}
}

const normalizeQuestions = (questions: unknown): PromptQuestion[] =>
	(Array.isArray(questions) ? questions : [questions]) as PromptQuestion[]

const normalizeChoices = (choices: QuestionChoice[]): SelectOption[] =>
	choices.map((choice) =>
		typeof choice === "string"
			? {
					label: choice,
					value: choice,
				}
			: {
					disabled: choice.disabled,
					hint: choice.hint,
					label: choice.name,
					value: choice.value,
				},
	)

const runConfirmPrompt = async (question: ConfirmQuestion) => {
	const result = await new ConfirmPrompt({
		active: "Yes",
		inactive: "No",
		initialValue: question.default ?? true,
		render() {
			const active = "Yes"
			const inactive = "No"
			const header = `${VERTICAL}\n${getStatusSymbol(this.state)}  ${question.message}\n`
			const current = this.value ? active : inactive

			switch (this.state) {
				case "submit":
					return `${header}${VERTICAL}  ${chalk.dim(current)}`
				case "cancel":
					return `${header}${VERTICAL}  ${chalk.strikethrough(chalk.dim(current))}\n${VERTICAL}`
				default:
					return `${header}${ACTIVE_VERTICAL}  ${
						this.value
							? `${ACTIVE_CHOICE} ${active}`
							: `${INACTIVE_CHOICE} ${chalk.dim(active)}`
					} ${chalk.dim("/")} ${
						this.value
							? `${INACTIVE_CHOICE} ${chalk.dim(inactive)}`
							: `${ACTIVE_CHOICE} ${inactive}`
					}\n${ACTIVE_END}\n`
			}
		},
	}).prompt()

	if (isCancel(result)) {
		process.exit(0)
	}

	return result as unknown as boolean
}

const runListPrompt = async (question: ListQuestion) => {
	const options = normalizeChoices(question.choices)
	if (!options.some((option) => !option.disabled)) {
		throw new Error("No selectable options are available.")
	}

	const result = await new SelectPromptWithDisabled({
		initialValue: question.default,
		message: question.message,
		options,
	}).prompt()

	if (isCancel(result)) {
		process.exit(0)
	}

	return result as string
}

const runPasswordPrompt = async (question: PasswordQuestion) => {
	const result = await new PasswordPrompt({
		initialValue: question.default,
		mask: question.mask ?? "*",
		render() {
			const header = `${VERTICAL}\n${getStatusSymbol(this.state)}  ${question.message}\n`
			const maskedValue = this.masked

			switch (this.state) {
				case "submit":
					return `${header}${VERTICAL}  ${chalk.dim(maskedValue)}`
				case "cancel":
					return `${header}${VERTICAL}  ${chalk.strikethrough(chalk.dim(maskedValue ?? ""))}${maskedValue ? `\n${VERTICAL}` : ""}`
				default:
					return `${header}${ACTIVE_VERTICAL}  ${this.valueWithCursor}\n${ACTIVE_END}\n`
			}
		},
	}).prompt()

	if (isCancel(result)) {
		process.exit(0)
	}

	return result as string
}

// Wraps Clack-core prompts so that Ctrl+C exits cleanly instead of showing
// a stack trace. Use this everywhere instead of calling the prompt engine
// directly.
export const prompt: GuardedPrompt = async (
	questions: unknown,
	nonInteractiveError = "An interactive terminal is required. Pass explicit arguments instead.",
) => {
	if (!isInteractive()) {
		throw new Error(nonInteractiveError)
	}

	const results: Record<string, unknown> = {}

	for (const question of normalizeQuestions(questions)) {
		switch (question.type) {
			case "confirm":
				results[question.name] = await runConfirmPrompt(question)
				break
			case "list":
				results[question.name] = await runListPrompt(question)
				break
			case "password":
				results[question.name] = await runPasswordPrompt(question)
				break
			default:
				throw new Error(
					`Unsupported prompt type: ${(question as PromptQuestion).type}`,
				)
		}
	}

	return results
}
