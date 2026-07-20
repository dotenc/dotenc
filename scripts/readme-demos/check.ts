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
const maxWidth = 2200
const maxHeight = 1200
const expectedBackgroundColor = 0xff0d1117
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
	"git-diff": [
		"git status --short",
		"M .env.development.enc",
		"git diff -- .env.development.enc",
		"diff --git a/.env.development.enc b/.env.development.enc",
		"index 1234567..89abcde 100644",
		"-FEATURE_CHECKOUT=false",
		"+FEATURE_CHECKOUT=true",
	],
}

if (import.meta.main) {
	for (const scene of parseSceneSelection("all")) {
		await checkScene(scene)
	}

	console.log(
		`Verified ${scenes.length} sanitized README demo scene${scenes.length === 1 ? "" : "s"}.`,
	)
}

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
	if (scene === "quickstart") assertNanoTyping(parsedRecording.records)

	const webp = await fs.readFile(assetPath(scene))
	const { width, height, backgroundColor, loopCount, frameDurations } =
		readAnimatedWebP(webp, scene)
	if (width === 0 || height === 0 || width > maxWidth || height > maxHeight) {
		throw new Error(
			`${scene}.webp dimensions ${width}x${height} exceed ${maxWidth}x${maxHeight}.`,
		)
	}
	if (webp.byteLength > maxBytes) {
		throw new Error(
			`${scene}.webp is ${(webp.byteLength / 1024 / 1024).toFixed(2)} MiB; limit is 3 MiB.`,
		)
	}
	if (backgroundColor !== expectedBackgroundColor) {
		throw new Error(
			`${scene}.webp must use #0d1117 as its animation background (received ${formatBackgroundColor(backgroundColor)}).`,
		)
	}
	if (loopCount !== 0) {
		throw new Error(`${scene}.webp must loop indefinitely.`)
	}
	if (frameDurations.length < 2) {
		throw new Error(`${scene}.webp does not appear to contain multiple frames.`)
	}
	if ((frameDurations.at(-1) ?? 0) < 2000) {
		throw new Error(
			`${scene}.webp must hold its final frame for at least 2 seconds.`,
		)
	}
	const totalDuration = frameDurations.reduce(
		(total, duration) => total + duration,
		0,
	)
	if (totalDuration < 10_000) {
		throw new Error(`${scene}.webp must run for at least 10 seconds.`)
	}
	if (frameDurations.filter((duration) => duration <= 140).length < 10) {
		throw new Error(`${scene}.webp does not appear to type commands naturally.`)
	}

	const url = `https://raw.githubusercontent.com/dotenc/dotenc/main/assets/demos/${scene}.webp`
	if (!readme.includes(url)) {
		throw new Error(`cli/README.md does not reference ${scene}.webp.`)
	}

	console.log(
		`${scene}: ${width}x${height}, ${(webp.byteLength / 1024).toFixed(0)} KiB, ${frameDurations.length} frames, ${(totalDuration / 1000).toFixed(1)}s`,
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

type RiffChunk = {
	type: string
	dataOffset: number
	size: number
}

export function readAnimatedWebP(buffer: Buffer, label = "asset") {
	if (
		buffer.byteLength < 30 ||
		buffer.toString("ascii", 0, 4) !== "RIFF" ||
		buffer.toString("ascii", 8, 12) !== "WEBP"
	) {
		throw new Error(`${label}.webp has an invalid WebP signature.`)
	}

	const declaredFileSize = buffer.readUInt32LE(4) + 8
	if (declaredFileSize !== buffer.byteLength) {
		throw new Error(
			`${label}.webp RIFF size is ${declaredFileSize} bytes, but the file is ${buffer.byteLength} bytes.`,
		)
	}

	const chunks: RiffChunk[] = []
	let offset = 12
	while (offset < declaredFileSize) {
		if (offset + 8 > declaredFileSize) {
			throw new Error(`${label}.webp has a truncated RIFF chunk header.`)
		}

		const type = buffer.toString("ascii", offset, offset + 4)
		const size = buffer.readUInt32LE(offset + 4)
		const dataOffset = offset + 8
		const dataEnd = dataOffset + size
		const nextOffset = dataEnd + (size % 2)
		if (dataEnd > declaredFileSize || nextOffset > declaredFileSize) {
			throw new Error(`${label}.webp has a truncated ${type} chunk.`)
		}

		chunks.push({ type, dataOffset, size })
		offset = nextOffset
	}

	const extendedHeaders = chunks.filter((chunk) => chunk.type === "VP8X")
	if (extendedHeaders.length !== 1 || extendedHeaders[0].size !== 10) {
		throw new Error(`${label}.webp must contain exactly one valid VP8X chunk.`)
	}
	const extendedHeader = extendedHeaders[0]
	const flags = buffer[extendedHeader.dataOffset]
	if ((flags & 0x02) === 0) {
		throw new Error(`${label}.webp is not marked as animated.`)
	}
	const width = buffer.readUIntLE(extendedHeader.dataOffset + 4, 3) + 1
	const height = buffer.readUIntLE(extendedHeader.dataOffset + 7, 3) + 1

	const animationHeaders = chunks.filter((chunk) => chunk.type === "ANIM")
	if (animationHeaders.length !== 1 || animationHeaders[0].size !== 6) {
		throw new Error(`${label}.webp must contain exactly one valid ANIM chunk.`)
	}
	const animationHeader = animationHeaders[0]
	const backgroundColor = buffer.readUInt32LE(animationHeader.dataOffset)
	const loopCount = buffer.readUInt16LE(animationHeader.dataOffset + 4)

	const frameDurations = chunks
		.filter((chunk) => chunk.type === "ANMF")
		.map((chunk, index) => {
			if (chunk.size < 24) {
				throw new Error(`${label}.webp frame ${index + 1} is truncated.`)
			}

			const frameOffset = chunk.dataOffset
			const x = buffer.readUIntLE(frameOffset, 3) * 2
			const y = buffer.readUIntLE(frameOffset + 3, 3) * 2
			const frameWidth = buffer.readUIntLE(frameOffset + 6, 3) + 1
			const frameHeight = buffer.readUIntLE(frameOffset + 9, 3) + 1
			const duration = buffer.readUIntLE(frameOffset + 12, 3)
			if (x + frameWidth > width || y + frameHeight > height) {
				throw new Error(
					`${label}.webp frame ${index + 1} exceeds the ${width}x${height} canvas.`,
				)
			}
			if (duration === 0) {
				throw new Error(`${label}.webp frame ${index + 1} has no duration.`)
			}

			assertFrameImageChunk(buffer, chunk, index, label)
			return duration
		})

	return { width, height, backgroundColor, loopCount, frameDurations }
}

function assertFrameImageChunk(
	buffer: Buffer,
	frame: RiffChunk,
	frameIndex: number,
	label: string,
) {
	const frameEnd = frame.dataOffset + frame.size
	let offset = frame.dataOffset + 16
	let imageChunkCount = 0

	while (offset < frameEnd) {
		if (offset + 8 > frameEnd) {
			throw new Error(`${label}.webp frame ${frameIndex + 1} is truncated.`)
		}
		const type = buffer.toString("ascii", offset, offset + 4)
		const size = buffer.readUInt32LE(offset + 4)
		const dataEnd = offset + 8 + size
		const nextOffset = dataEnd + (size % 2)
		if (dataEnd > frameEnd || nextOffset > frameEnd) {
			throw new Error(
				`${label}.webp frame ${frameIndex + 1} has a truncated ${type} chunk.`,
			)
		}
		if (type === "VP8 " || type === "VP8L") imageChunkCount++
		offset = nextOffset
	}

	if (imageChunkCount !== 1) {
		throw new Error(
			`${label}.webp frame ${frameIndex + 1} must contain exactly one image chunk.`,
		)
	}
}

function formatBackgroundColor(backgroundColor: number) {
	const alpha = ((backgroundColor >>> 24) & 0xff).toString(16).padStart(2, "0")
	const rgb = (backgroundColor & 0xffffff).toString(16).padStart(6, "0")
	return `#${rgb}${alpha}`
}
