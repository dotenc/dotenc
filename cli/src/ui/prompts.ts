import { isCancel, SelectPrompt } from "@clack/core"
import chalk from "chalk"
import type {
	ConfirmPromptOptions,
	MultiSelectOptions,
	SelectPromptOptions,
	TextPromptOptions,
} from "consola"
import { consola } from "consola"
import { isInteractive } from "./tty"

type PromptDeps = {
	isInteractive: typeof isInteractive
	prompt: typeof consola.prompt
}

const defaultDeps: PromptDeps = {
	isInteractive,
	prompt: (...args) => consola.prompt(...args),
}

const DEFAULT_NON_INTERACTIVE_PROMPT_ERROR =
	"An interactive terminal is required. Pass explicit arguments instead."

export class NonInteractivePromptError extends Error {
	constructor(message = DEFAULT_NON_INTERACTIVE_PROMPT_ERROR) {
		super(message)
		this.name = "NonInteractivePromptError"
	}
}

export type GroupedSelectOption<T extends string> = {
	group: string
	hint?: string
	label: string
	value: T
}

export function _renderGroupedSelect<T extends string>(
	message: string,
	options: GroupedSelectOption<T>[],
	cursor: number,
	state: "active" | "submit" | "cancel" | "initial" | "error",
): string {
	if (state === "submit") {
		return `${chalk.green("◇")} ${message}\n${chalk.gray(options[cursor]?.label ?? "")}`
	}
	if (state === "cancel") return `${chalk.red("■")} ${message}`

	const lines = [`${chalk.cyan("◆")} ${message}`]
	let previousGroup: string | undefined
	for (const [index, option] of options.entries()) {
		if (option.group !== previousGroup) {
			if (previousGroup !== undefined) lines.push("")
			lines.push(chalk.bold(option.group))
			previousGroup = option.group
		}
		const marker = index === cursor ? chalk.cyan("❯") : " "
		const label = index === cursor ? chalk.cyan(option.label) : option.label
		const hint = option.hint ? chalk.gray(`  ${option.hint}`) : ""
		lines.push(`${marker} ${label}${hint}`)
	}
	return lines.join("\n")
}

export const promptGroupedSelect = async <T extends string>(
	message: string,
	options: {
		options: GroupedSelectOption<T>[]
		nonInteractiveError?: string
	},
): Promise<T> => {
	if (!isInteractive()) {
		throw new NonInteractivePromptError(options.nonInteractiveError)
	}
	if (options.options.length === 0) {
		throw new Error("A grouped select requires at least one option.")
	}

	const prompt = new SelectPrompt({
		options: options.options,
		render() {
			return _renderGroupedSelect(
				message,
				options.options,
				this.cursor,
				this.state,
			)
		},
	})
	const selected = await prompt.prompt()
	if (isCancel(selected)) process.exit(0)
	return selected as T
}

const isCancelledPromptError = (error: unknown) =>
	error instanceof Error && error.name === "ConsolaPromptCancelledError"

const runPrompt = async <T>(
	message: string,
	options:
		| TextPromptOptions
		| ConfirmPromptOptions
		| SelectPromptOptions
		| MultiSelectOptions,
	nonInteractiveError?: string,
	deps: PromptDeps = defaultDeps,
): Promise<T> => {
	if (!deps.isInteractive()) {
		throw new NonInteractivePromptError(nonInteractiveError)
	}

	try {
		return (await deps.prompt(message, {
			cancel: "reject",
			...options,
		})) as T
	} catch (error) {
		if (isCancelledPromptError(error)) {
			process.exit(0)
		}

		throw error
	}
}

export const promptText = async (
	message: string,
	options: Omit<TextPromptOptions, "type" | "cancel"> & {
		nonInteractiveError?: string
	},
	deps?: PromptDeps,
) =>
	runPrompt<string>(
		message,
		{
			type: "text",
			default: options.default,
			initial: options.initial,
			placeholder: options.placeholder,
		},
		options.nonInteractiveError,
		deps,
	)

export const promptConfirm = async (
	message: string,
	options: Omit<ConfirmPromptOptions, "type" | "cancel"> & {
		nonInteractiveError?: string
	},
	deps?: PromptDeps,
) =>
	runPrompt<boolean>(
		message,
		{
			type: "confirm",
			initial: options.initial,
		},
		options.nonInteractiveError,
		deps,
	)

export const promptSelect = async <T extends string>(
	message: string,
	options: Omit<SelectPromptOptions, "type" | "cancel"> & {
		nonInteractiveError?: string
	},
	deps?: PromptDeps,
) =>
	runPrompt<T>(
		message,
		{
			type: "select",
			initial: options.initial,
			options: options.options,
		},
		options.nonInteractiveError,
		deps,
	)

export const promptMultiSelect = async <T extends string>(
	message: string,
	options: Omit<MultiSelectOptions, "type" | "cancel"> & {
		nonInteractiveError?: string
	},
	deps?: PromptDeps,
) =>
	runPrompt<T[]>(
		message,
		{
			type: "multiselect",
			initial: options.initial,
			options: options.options,
			required: options.required,
		},
		options.nonInteractiveError,
		deps,
	)
