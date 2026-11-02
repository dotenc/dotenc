const http = require("node:http")
const vm = require("node:vm")
const { test, expect } = require("bun:test")
const redirects = require("follow-redirects")

const listen = (server) =>
	new Promise((resolve, reject) => {
		server.once("error", reject)
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject)
			resolve()
		})
	})
const close = (server) =>
	new Promise((resolve, reject) => {
		server.closeAllConnections()
		server.close((error) => (error ? reject(error) : resolve()))
	})

test("cross-realm sensitive headers stay private across redirects", async () => {
	const header = "x^credential"
	let forwarded = false
	let destinationHits = 0
	const destination = http.createServer((request, response) => {
		destinationHits += 1
		forwarded = request.headers[header] !== undefined
		response.end("ok")
	})
	const source = http.createServer((_request, response) => {
		response.writeHead(302, {
			Location: `http://localhost:${destination.address().port}/`,
		})
		response.end()
	})
	let request

	try {
		await listen(destination)
		await listen(source)
		const sensitiveHeaders = vm.runInNewContext('["x^credential"]')
		await new Promise((resolve, reject) => {
			request = redirects.http.request(
				{
					hostname: "127.0.0.1",
					port: source.address().port,
					path: "/",
					headers: { [header]: "SYNTHETIC_TEST_ONLY" },
					sensitiveHeaders,
					lookup: (_hostname, options, callback) => {
						if (options?.all) callback(null, [{ address: "127.0.0.1", family: 4 }])
						else callback(null, "127.0.0.1", 4)
					},
				},
					(response) => {
					if (response.statusCode !== 200) {
						response.resume()
						reject(new Error(`Unexpected status ${response.statusCode}`))
						return
					}
						response.resume()
						response.on("end", resolve)
					},
			)
			request.on("error", reject)
			request.setTimeout(5_000, () => request.destroy(new Error("timeout")))
			request.end()
		})
		expect(destinationHits).toBe(1)
		expect(forwarded).toBe(false)
	} finally {
		request?.destroy()
		await Promise.all([source, destination].filter((server) => server.listening).map(close))
	}
})
