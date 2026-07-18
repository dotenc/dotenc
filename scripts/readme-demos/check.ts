import fs from "node:fs/promises"
import path from "node:path"
import {
	assertSanitizedRecording,
	assetPath,
	parseSceneSelection,
	recordingPath,
	repoRoot,
	type Scene,
	scenes,
} from "./lib"

const maxBytes = 3 * 1024 * 1024
const maxWidth = 1440
const maxHeight = 810
const escapeCharacter = String.fromCharCode(27)
const ansiControlSequence = new RegExp(
	`${escapeCharacter}\\[[0-?]*[ -/]*[@-~]`,
	"g",
)
const readme = await fs.readFile(
	path.join(repoRoot, "cli", "README.md"),
	"utf8",
)
const expectedRecordingText: Record<Scene, string[]> = {
	quickstart: [
		"cat app.js",
		"process.env.GREETING",
		"node app.js",
		"No greeting",
		"dotenc env edit development",
		"File: .env.development",
		"GREETING=Hello",
		"Encrypted development environment and saved it to .env.development.enc.",
		"dotenc dev node app.js",
		"Hello from dotenc!",
	],
}

for (const scene of parseSceneSelection("all")) {
	await checkScene(scene)
}

console.log(
	`Verified ${scenes.length} sanitized README demo scene${scenes.length === 1 ? "" : "s"}.`,
)

async function checkScene(scene: Scene) {
	const recording = await fs.readFile(recordingPath(scene), "utf8")
	assertSanitizedRecording(recording)
	const parsedRecording = Bun.YAML.parse(recording) as {
		records?: Array<{ content?: unknown; delay?: unknown }>
	}
	if (!Array.isArray(parsedRecording.records)) {
		throw new Error(`${scene}.yml does not contain a records array.`)
	}
	const transcript = parsedRecording.records
		.map((record) => (typeof record.content === "string" ? record.content : ""))
		.join("")
	const plainTranscript = transcript.replace(ansiControlSequence, "")

	for (const expected of expectedRecordingText[scene]) {
		if (!plainTranscript.includes(expected)) {
			throw new Error(
				`${scene}.yml does not contain expected text: ${expected}`,
			)
		}
	}
	assertNanoTyping(parsedRecording.records)

	const gif = await fs.readFile(assetPath(scene))
	const signature = gif.subarray(0, 6).toString("ascii")
	if (signature !== "GIF87a" && signature !== "GIF89a") {
		throw new Error(`${scene}.gif has an invalid GIF signature.`)
	}
	const width = gif.readUInt16LE(6)
	const height = gif.readUInt16LE(8)
	if (width === 0 || height === 0 || width > maxWidth || height > maxHeight) {
		throw new Error(
			`${scene}.gif dimensions ${width}x${height} exceed ${maxWidth}x${maxHeight}.`,
		)
	}
	if (gif.byteLength > maxBytes) {
		throw new Error(
			`${scene}.gif is ${(gif.byteLength / 1024 / 1024).toFixed(2)} MiB; limit is 3 MiB.`,
		)
	}
	const frameDelays = readFrameDelays(gif)
	if (frameDelays.length < 2) {
		throw new Error(`${scene}.gif does not appear to contain multiple frames.`)
	}
	if ((frameDelays.at(-1) ?? 0) < 200) {
		throw new Error(
			`${scene}.gif must hold its final frame for at least 2 seconds.`,
		)
	}
	const totalDuration = frameDelays.reduce((total, delay) => total + delay, 0)
	if (totalDuration < 1000) {
		throw new Error(`${scene}.gif must run for at least 10 seconds.`)
	}
	if (frameDelays.filter((delay) => delay <= 14).length < 10) {
		throw new Error(`${scene}.gif does not appear to type commands naturally.`)
	}

	const url = `https://raw.githubusercontent.com/dotenc/dotenc/main/assets/demos/${scene}.gif`
	if (!readme.includes(url)) {
		throw new Error(`cli/README.md does not reference ${scene}.gif.`)
	}

	console.log(
		`${scene}: ${width}x${height}, ${(gif.byteLength / 1024).toFixed(0)} KiB, ${frameDelays.length} frames, ${(totalDuration / 100).toFixed(1)}s`,
	)
}

function assertNanoTyping(
	records: Array<{ content?: unknown; delay?: unknown }>,
) {
	const editorReady = records.findIndex(
		(record) =>
			typeof record.content === "string" && record.content.includes("Modified"),
	)
	const savePrompt = records.findIndex(
		(record, index) =>
			index > editorReady &&
			typeof record.content === "string" &&
			record.content.includes("File Name to write"),
	)
	const typedFrames = records
		.slice(editorReady + 1, savePrompt)
		.filter(
			(record) =>
				typeof record.delay === "number" &&
				record.delay <= 165 &&
				typeof record.content === "string" &&
				record.content.length > 0,
		).length

	if (editorReady === -1 || savePrompt === -1 || typedFrames < 20) {
		throw new Error(
			"quickstart.yml must show the greeting being typed naturally in nano.",
		)
	}
}

function readFrameDelays(buffer: Buffer) {
	const sequence = Buffer.from([0x21, 0xf9, 0x04])
	const delays: number[] = []
	let offset = buffer.indexOf(sequence)
	while (offset !== -1) {
		delays.push(buffer.readUInt16LE(offset + 4))
		offset = buffer.indexOf(sequence, offset + sequence.length)
	}
	return delays
}
