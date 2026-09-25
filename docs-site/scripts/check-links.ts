import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../website/dist",
)
const origin = "https://dotenc.org"
const files: string[] = []
function walk(directory: string) {
	for (const item of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, item.name)
		if (item.isDirectory()) walk(path)
		else if (item.name.endsWith(".html")) files.push(path)
	}
}
walk(root)
const ids = new Map<string, Set<string>>()
const links: { file: string; href: string }[] = []
for (const file of files) {
	const pageIds = new Set<string>()
	const parser = new HTMLRewriter()
		.on("[id]", {
			element: (el) => {
				const id = el.getAttribute("id")
				if (id) pageIds.add(id)
			},
		})
		.on("[href], [src]", {
			element: (el) => {
				for (const attr of ["href", "src"]) {
					const href = el.getAttribute(attr)
					if (href) links.push({ file, href })
				}
			},
		})
	await parser.transform(new Response(readFileSync(file))).text()
	ids.set(file, pageIds)
}
const errors = new Set<string>()
for (const { file, href } of links) {
	const page = relative(root, file).replace(/index\.html$/, "")
	const url = new URL(href, `${origin}/${page}`)
	if (url.origin !== origin) continue
	let target = join(root, decodeURIComponent(url.pathname))
	if (existsSync(target) && statSync(target).isDirectory())
		target = join(target, "index.html")
	if (!existsSync(target)) errors.add(`${page}: missing ${url.pathname}`)
	else if (
		url.hash &&
		ids.has(target) &&
		!ids.get(target)?.has(decodeURIComponent(url.hash.slice(1)))
	)
		errors.add(`${page}: missing anchor ${url.pathname}${url.hash}`)
}
if (errors.size) throw new Error([...errors].join("\n"))
console.log(
	`Verified ${links.length} links/assets across ${files.length} HTML pages, including fragment targets.`,
)
