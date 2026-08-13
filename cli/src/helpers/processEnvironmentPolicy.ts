const RESERVED_EXACT_NAMES = new Set([
	"GITHUB_ENV",
	"GITHUB_OUTPUT",
	"GITHUB_PATH",
	"GITHUB_STATE",
	"GITHUB_STEP_SUMMARY",
])

const UNSAFE_EXACT_NAMES = new Set([
	"BASH_ENV",
	"BUN_OPTIONS",
	"COMSPEC",
	"ENV",
	"_JAVA_OPTIONS",
	"JAVA_TOOL_OPTIONS",
	"JDK_JAVA_OPTIONS",
	"NODE_OPTIONS",
	"NODE_PATH",
	"PATH",
	"PATHEXT",
	"PERL5LIB",
	"PERL5OPT",
	"PERLLIB",
	"PHP_INI_SCAN_DIR",
	"PYTHONHOME",
	"PYTHONPATH",
	"RUBYLIB",
	"RUBYOPT",
])

const normalizeName = (name: string) => name.toUpperCase()

export const isReservedDecryptedEnvironmentName = (name: string) => {
	const normalized = normalizeName(name)
	return (
		normalized.startsWith("DOTENC_") || RESERVED_EXACT_NAMES.has(normalized)
	)
}

export const isUnsafeDecryptedEnvironmentName = (name: string) => {
	const normalized = normalizeName(name)
	return (
		UNSAFE_EXACT_NAMES.has(normalized) ||
		normalized.startsWith("LD_") ||
		normalized.startsWith("DYLD_")
	)
}

export const findBlockedDecryptedEnvironmentNames = (
	decryptedEnv: Record<string, string>,
	allowedNames: string[] = [],
) => {
	const allowed = new Set(allowedNames.map(normalizeName))
	const reserved: string[] = []
	const unsafe: string[] = []

	for (const name of Object.keys(decryptedEnv)) {
		if (isReservedDecryptedEnvironmentName(name)) {
			reserved.push(name)
		} else if (
			isUnsafeDecryptedEnvironmentName(name) &&
			!allowed.has(normalizeName(name))
		) {
			unsafe.push(name)
		}
	}

	return {
		reserved: reserved.sort((left, right) => left.localeCompare(right)),
		unsafe: unsafe.sort((left, right) => left.localeCompare(right)),
	}
}
