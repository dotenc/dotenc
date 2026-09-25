import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const site = join(root, "website/dist")
const docs = join(root, "docs-site/dist")
if (
	!existsSync(join(site, "index.html")) ||
	!existsSync(join(docs, "index.html"))
) {
	throw new Error(
		"Build the marketing website and documentation before assembling Pages.",
	)
}
cpSync(docs, join(site, "docs"), { recursive: true })
// Error documents are served for arbitrary URLs; do not advertise a nonexistent canonical route.
const errorPage = readFileSync(join(docs, "404.html"), "utf8").replace(
	/<link rel="canonical"[^>]*>/,
	"",
)
writeFileSync(join(site, "404.html"), errorPage)
writeFileSync(join(site, "docs/404.html"), errorPage)
writeFileSync(join(site, ".nojekyll"), "")
writeFileSync(
	join(site, "sitemap.xml"),
	'<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://dotenc.org/docs/sitemap-index.xml</loc></sitemap></sitemapindex>\n',
)
console.log("Combined GitHub Pages artifact: website/dist (homepage + /docs/).")
