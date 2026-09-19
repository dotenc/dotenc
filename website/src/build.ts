import { createHash } from "node:crypto"
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { extname, join } from "node:path"
import { $ } from "bun"
import { inlineSvgPlaceholders } from "./helpers"

const ROOT = join(import.meta.dir, "..")
const SRC = join(ROOT, "src")
const PUBLIC = join(ROOT, "public")
const DIST = join(ROOT, "dist")

// Clean dist/
if (existsSync(DIST)) {
	rmSync(DIST, { recursive: true })
}
mkdirSync(DIST, { recursive: true })

// Copy public assets before compiling so dev styles cannot overwrite production CSS.
console.log("📁 Copying public assets...")
cpSync(PUBLIC, DIST, { recursive: true })

// Build + minify CSS with Tailwind
console.log("🎨 Building CSS...")
await $`bunx @tailwindcss/cli -i ${join(SRC, "styles/main.css")} -o ${join(DIST, "styles.css")} --minify`

// Copy JS before fingerprinting the production entrypoints.
console.log("📦 Copying JS...")
mkdirSync(join(DIST, "scripts"), { recursive: true })
cpSync(join(SRC, "scripts"), join(DIST, "scripts"), { recursive: true })

/** Name an asset after its content so cached files cannot cross deployment versions. */
function fingerprintAsset(relativePath: string): string {
	const path = join(DIST, relativePath)
	const hash = createHash("sha256")
		.update(readFileSync(path))
		.digest("hex")
		.slice(0, 16)
	const extension = extname(relativePath)
	const fingerprintedPath = `${relativePath.slice(0, -extension.length)}.${hash}${extension}`
	renameSync(path, join(DIST, fingerprintedPath))
	return fingerprintedPath
}
const stylesheet = fingerprintAsset("styles.css")
const script = fingerprintAsset("scripts/main.js")

console.log("📄 Copying HTML...")
let html = readFileSync(join(SRC, "index.html"), "utf-8")
html = inlineSvgPlaceholders(html, PUBLIC)
html = html.replace('href="/styles.css"', `href="./${stylesheet}"`)
html = html.replace('src="/scripts/main.js"', `src="./${script}"`)
writeFileSync(join(DIST, "index.html"), html)

console.log("✅ Build complete! Output in dist/")
