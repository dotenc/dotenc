import { realpathSync } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"

const isWithinRoot = (root: string, candidate: string) => {
	const relativePath = relative(root, candidate)
	return !(
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	)
}

export const resolveStaticPath = (
	root: string,
	pathname: string,
): string | undefined => {
	let decodedPathname: string
	try {
		decodedPathname = decodeURIComponent(pathname)
	} catch {
		return undefined
	}

	if (!decodedPathname.startsWith("/") || decodedPathname.includes("\0")) {
		return undefined
	}

	const candidate = resolve(root, `.${decodedPathname}`)
	if (!isWithinRoot(root, candidate)) {
		return undefined
	}

	try {
		const canonicalRoot = realpathSync(root)
		const canonicalCandidate = realpathSync(candidate)
		return isWithinRoot(canonicalRoot, canonicalCandidate)
			? canonicalCandidate
			: undefined
	} catch {
		return undefined
	}
}
