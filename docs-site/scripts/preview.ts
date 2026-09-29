import { existsSync, statSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../website/dist",
)
if (!existsSync(join(root, "index.html")))
	throw new Error("Run bun run site:build first.")
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: Number(process.env.PORT || 4322),
	async fetch(request) {
		const url = new URL(request.url)
		let path: string
		try {
			path = resolve(root, `.${decodeURIComponent(url.pathname)}`)
		} catch {
			return new Response("Bad request", { status: 400 })
		}
		if (path !== root && !path.startsWith(root + sep))
			return new Response("Forbidden", { status: 403 })
		if (existsSync(path) && statSync(path).isDirectory()) {
			if (!url.pathname.endsWith("/"))
				return Response.redirect(
					new URL(`${url.pathname}/${url.search}`, url),
					301,
				)
			path = join(path, "index.html")
		}
		if (!existsSync(path) || !statSync(path).isFile())
			return new Response(Bun.file(join(root, "404.html")), { status: 404 })
		return new Response(Bun.file(path))
	},
})
console.log(`Complete site with search: http://127.0.0.1:${server.port}/docs/`)
