import { posix } from "node:path"
import anchors from "../legacy-anchors.json"
import { sources } from "./sources"

const repo = "https://github.com/dotenc/dotenc/blob/main/"
const published = new Map<string, string>(
	sources.map(({ file, slug }) => [file, `/docs/${slug}/`]),
)
const fragments = anchors as Record<string, string>

/** Resolve repository Markdown links without changing code examples. */
export function documentationLink(href: string, source: string): string {
	if (
		href.startsWith("#") ||
		(href.startsWith("/docs/") && !href.includes(".md"))
	)
		return href
	let target = href
	if (target.startsWith(repo)) target = `/${target.slice(repo.length)}`
	else if (target.startsWith("https://github.com/dotenc/dotenc#"))
		target = `/README.md#${target.split("#")[1]}`
	else if (/^[a-z]+:|^\/\//i.test(target)) return href
	const [path, fragment] = target.split("#")
	const file = path.startsWith("/")
		? path.slice(1)
		: posix.normalize(posix.join(posix.dirname(source), path))
	if (file === "README.md" || file === "cli/README.md") {
		if (!fragment || fragment === "readme") return "/docs/"
		if (fragment === "getting-started")
			return "/docs/getting-started/quickstart/"
		if (fragment === "installation")
			return "/docs/getting-started/installation/"
		if (fragments[fragment]) return `/docs/${fragments[fragment]}/#${fragment}`
		return `${repo}README.md#${fragment}`
	}
	const route = published.get(file)
	return `${route ?? repo + file}${fragment ? `#${fragment}` : ""}`
}

export function rewriteMarkdown(markdown: string, source: string): string {
	let fence = ""
	return markdown
		.split("\n")
		.map((line) => {
			const marker = line.match(/^\s*(`{3,}|~{3,})/)
			if (marker) {
				fence = fence ? "" : marker[1]
				return line
			}
			if (fence) return line
			return line.replace(
				/\]\(([^\s)]+)\)/g,
				(_, href: string) => `](${documentationLink(href, source)})`,
			)
		})
		.join("\n")
}
