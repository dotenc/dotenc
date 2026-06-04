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
