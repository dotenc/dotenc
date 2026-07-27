import { watch } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"
import { inlineSvgPlaceholders } from "./helpers"
import { resolveStaticPath } from "./resolveStaticPath"

const ROOT = join(import.meta.dir, "..")
const SRC = join(ROOT, "src")
const PUBLIC = join(ROOT, "public")

// Build CSS once before starting
console.log("🎨 Building CSS...")
await $`bunx @tailwindcss/cli -i ${join(SRC, "styles/main.css")} -o ${join(PUBLIC, "styles.css")}`.quiet()
console.log("✔ CSS ready")

// Start Tailwind watcher in background
const cssWatcher = Bun.spawn(
	[
		"bunx",
		"@tailwindcss/cli",
		"-i",
		join(SRC, "styles/main.css"),
		"-o",
		join(PUBLIC, "styles.css"),
		"--watch",
	],
	{ stdout: "ignore", stderr: "ignore" },
)
process.on("exit", () => cssWatcher.kill())

const clients: Set<ReadableStreamDefaultController> = new Set()

function notifyClients() {
	for (const controller of clients) {
		try {
			controller.enqueue("data: reload\n\n")
		} catch {
			clients.delete(controller)
		}
	}
}

// Watch src/ and public/ for changes
for (const dir of [SRC, PUBLIC]) {
	watch(dir, { recursive: true }, () => {
		notifyClients()
	})
}

const MIME_TYPES: Record<string, string> = {
	".html": "text/html",
	".css": "text/css",
	".js": "application/javascript",
	".png": "image/png",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".sh": "text/plain",
	".json": "application/json",
}

function getMime(path: string): string {
	const ext = path.substring(path.lastIndexOf("."))
	return MIME_TYPES[ext] || "application/octet-stream"
}

const LIVE_RELOAD_SCRIPT = `
<script>
(function() {
	const es = new EventSource('/__reload');
	es.onmessage = () => location.reload();
	es.onerror = () => setTimeout(() => location.reload(), 1000);
})();
</script>
`

// Paths that should resolve to index.html (navigation routes only)
function isPageRoute(pathname: string): boolean {
	return pathname === "/" || pathname === "/index.html"
}

const server = Bun.serve({
	port: 3000,
	async fetch(req) {
		const url = new URL(req.url)
		const pathname = url.pathname

		// SSE endpoint for live reload
		if (pathname === "/__reload") {
			const stream = new ReadableStream({
				start(controller) {
					clients.add(controller)
				},
				cancel(controller) {
					clients.delete(controller)
				},
			})
			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				},
			})
		}

		// Serve index.html for page routes
		if (isPageRoute(pathname)) {
			const indexPath = join(SRC, "index.html")
			const indexFile = Bun.file(indexPath)
			if (await indexFile.exists()) {
				let html = await indexFile.text()
				html = inlineSvgPlaceholders(html, PUBLIC)
				html = html.replace("</body>", `${LIVE_RELOAD_SCRIPT}</body>`)
				return new Response(html, {
					headers: { "Content-Type": "text/html" },
				})
			}
		}

		// Try public/ (static assets including Tailwind output)
		const publicPath = resolveStaticPath(PUBLIC, pathname)
		if (publicPath) {
			const publicFile = Bun.file(publicPath)
			if (await publicFile.exists()) {
				return new Response(publicFile, {
					headers: { "Content-Type": getMime(publicPath) },
				})
			}
		}

		// Try src/ (JS files served directly)
		const srcPath = resolveStaticPath(SRC, pathname)
		if (srcPath) {
			const srcFile = Bun.file(srcPath)
			if (await srcFile.exists()) {
				return new Response(srcFile, {
					headers: { "Content-Type": getMime(srcPath) },
				})
			}
		}

		return new Response("Not Found", { status: 404 })
	},
})

console.log(`🚀 Dev server running at http://localhost:${server.port}`)
