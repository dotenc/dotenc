import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { brotliCompressSync, gzipSync } from "node:zlib"
import { renderArtifactDoctorHuman } from "../commands/doctorArtifacts"
import {
	ArtifactDoctorInvocationError,
	createArtifactDoctorReport,
} from "../helpers/artifactDoctor"

const temporaryRoots = new Set<string>()

const makeArtifactDirectory = async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "dotenc-artifacts-"))
	temporaryRoots.add(root)
	const artifacts = path.join(root, "artifacts")
	await fs.mkdir(artifacts)
	return { root, artifacts }
}

const findingIds = (
	report: Awaited<ReturnType<typeof createArtifactDoctorReport>>,
) => report.findings.map((finding) => finding.id)

afterEach(async () => {
	await Promise.all(
		[...temporaryRoots].map((root) =>
			fs.rm(root, { recursive: true, force: true }),
		),
	)
	temporaryRoots.clear()
})

describe("createArtifactDoctorReport", () => {
	test("scans a clean directory recursively without treating templates or encrypted environments as plaintext", async () => {
		const { root, artifacts } = await makeArtifactDirectory()
		await fs.mkdir(path.join(artifacts, "nested"))
		await fs.mkdir(path.join(artifacts, ".env.assets"))
		await fs.writeFile(path.join(artifacts, "index.html"), "<h1>safe</h1>")
		await fs.writeFile(path.join(artifacts, ".env.example"), "EXAMPLE=value")
		await fs.writeFile(path.join(artifacts, ".env.production.enc"), "encrypted")
		await fs.writeFile(path.join(artifacts, "nested", "empty.txt"), "")
		await fs.writeFile(path.join(artifacts, ".env.assets", "logo.txt"), "safe")

		const report = await createArtifactDoctorReport("artifacts", {
			invocationDir: root,
		})

		expect(report).toMatchObject({
			schemaVersion: 1,
			command: "doctor artifacts",
			complete: true,
			scope: { directory: ".", selectedSecrets: 0 },
			findings: [],
			summary: {
				errors: 0,
				warnings: 0,
				filesScanned: 5,
				directoriesScanned: 3,
			},
			exitCode: 0,
		})
		expect(report.passed[0]?.message).toContain("5 files")
	})

	test("reports plaintext environments, key material, bootstrap data, and explicitly selected secrets without echoing them", async () => {
		const { root, artifacts } = await makeArtifactDirectory()
		const privateKeyHeader = ["-----BEGIN OPENSSH", " PRIVATE KEY-----"].join(
			"",
		)
		const bootstrapName = ["DOTENC_PRIVATE", "_KEY_BASE64"].join("")
		const bootstrapValue = "synthetic-bootstrap-value-for-artifact-test"
		const selectedName = "ARTIFACT_TEST_DATABASE_URL"
		const selectedValue = "postgres://artifact-test.invalid/example"
		await fs.writeFile(path.join(artifacts, ".env.production"), "fixture")
		await fs.writeFile(
			path.join(artifacts, "key.txt"),
			`${privateKeyHeader}\nsynthetic-fixture`,
		)
		await fs.writeFile(
			path.join(artifacts, "bundle.js"),
			`${bootstrapName}=${bootstrapValue}`,
		)
		await fs.writeFile(
			path.join(artifacts, "config.json"),
			JSON.stringify({ name: selectedName, value: selectedValue }),
		)

		const report = await createArtifactDoctorReport(
			"artifacts",
			{
				invocationDir: root,
				secretNames: [selectedName],
			},
			{
				environment: {
					[bootstrapName]: bootstrapValue,
					[selectedName]: selectedValue,
				},
			},
		)

		expect(findingIds(report)).toEqual([
			"artifact.plaintext-env",
			"artifact.private-key",
			"artifact.bootstrap-value",
			"artifact.secret-value",
			"artifact.bootstrap-name",
			"artifact.secret-name",
		])
		expect(report.exitCode).toBe(1)
		expect(report.complete).toBe(true)
		expect(report.scope.selectedSecrets).toBe(1)
		const serialized = JSON.stringify(report)
		for (const sensitiveInput of [
			privateKeyHeader,
			bootstrapName,
			bootstrapValue,
			selectedName,
			selectedValue,
		]) {
			expect(serialized).not.toContain(sensitiveInput)
		}
	})

	test("finds selected values that cross read-chunk boundaries", async () => {
		const { root, artifacts } = await makeArtifactDirectory()
		const selectedName = "ARTIFACT_TEST_BOUNDARY_SECRET"
		const selectedValue = "boundary-secret-value-fixture"
		await fs.writeFile(
			path.join(artifacts, "bundle.js"),
			`${"x".repeat(64 * 1024 - 5)}${selectedValue}`,
		)

		const report = await createArtifactDoctorReport(
			"artifacts",
			{ invocationDir: root, secretNames: [selectedName] },
			{ environment: { [selectedName]: selectedValue } },
		)

		expect(findingIds(report)).toContain("artifact.secret-value")
		expect(report.exitCode).toBe(1)
	})

	test("allows ambiguous names by default and promotes them under strict mode", async () => {
		const { root, artifacts } = await makeArtifactDirectory()
		const selectedName = "ARTIFACT_TEST_RUNTIME_SECRET"
		const selectedValue = "selected-value-not-in-the-artifact"
		await fs.writeFile(
			path.join(artifacts, "bundle.js"),
			`process.env.${selectedName}`,
		)

		const options = {
			invocationDir: root,
			secretNames: [selectedName],
		}
		const dependencies = {
			environment: { [selectedName]: selectedValue },
		}
		const normal = await createArtifactDoctorReport(
			"artifacts",
			options,
			dependencies,
		)
		const strict = await createArtifactDoctorReport(
			"artifacts",
			{ ...options, strict: true },
			dependencies,
		)

		expect(findingIds(normal)).toEqual(["artifact.secret-name"])
		expect(normal.exitCode).toBe(0)
		expect(strict.exitCode).toBe(1)
	})

	test("returns an incomplete bounded report for files beyond the configured limit", async () => {
		const { root, artifacts } = await makeArtifactDirectory()
		await fs.writeFile(path.join(artifacts, "large.txt"), "12345")

		const report = await createArtifactDoctorReport(
			"artifacts",
			{ invocationDir: root },
			{ limits: { maxFileBytes: 4 } },
		)

		expect(report.complete).toBe(false)
		expect(report.exitCode).toBe(2)
		expect(report.passed).toEqual([])
		expect(report.findings).toContainEqual(
			expect.objectContaining({
				id: "scan.incomplete",
				paths: ["large.txt"],
			}),
		)
	})

	test("does not follow symbolic links out of the artifact directory", async () => {
		if (process.platform === "win32") return
		const { root, artifacts } = await makeArtifactDirectory()
		const outside = path.join(root, "outside.txt")
		const privateKeyHeader = ["-----BEGIN OPENSSH", " PRIVATE KEY-----"].join(
			"",
		)
		await fs.writeFile(outside, privateKeyHeader)
		await fs.symlink(outside, path.join(artifacts, "linked.txt"))

		const report = await createArtifactDoctorReport("artifacts", {
			invocationDir: root,
		})

		expect(report.complete).toBe(false)
		expect(report.exitCode).toBe(2)
		expect(findingIds(report)).toEqual(["scan.incomplete"])
		expect(report.findings[0]?.paths).toEqual(["linked.txt"])
	})

	test("bounds reported paths while preserving the total finding count", async () => {
		const { root, artifacts } = await makeArtifactDirectory()
		await fs.writeFile(path.join(artifacts, ".env.a"), "a")
		await fs.writeFile(path.join(artifacts, ".env.b"), "b")

		const report = await createArtifactDoctorReport(
			"artifacts",
			{ invocationDir: root },
			{ limits: { maxReportedPaths: 1 } },
		)
		const finding = report.findings.find(
			(entry) => entry.id === "artifact.plaintext-env",
		)

		expect(finding?.count).toBe(2)
		expect(finding?.paths).toHaveLength(1)
		expect(finding?.message).toContain("1 path omitted")
	})

	test("rejects missing directories and unsafe selected-secret inputs", async () => {
		const { root } = await makeArtifactDirectory()

		await expect(
			createArtifactDoctorReport("missing", { invocationDir: root }),
		).rejects.toBeInstanceOf(ArtifactDoctorInvocationError)
		await expect(
			createArtifactDoctorReport(
				"artifacts",
				{ invocationDir: root, secretNames: ["INVALID-NAME"] },
				{ environment: {} },
			),
		).rejects.toThrow("identifier syntax")
		await expect(
			createArtifactDoctorReport(
				"artifacts",
				{ invocationDir: root, secretNames: ["MISSING_SECRET"] },
				{ environment: {} },
			),
		).rejects.toThrow("non-empty environment value")
		await expect(
			createArtifactDoctorReport(
				"artifacts",
				{ invocationDir: root, secretNames: ["SHORT_SECRET"] },
				{ environment: { SHORT_SECRET: "short" } },
			),
		).rejects.toThrow("outside the supported range")
		await expect(
			createArtifactDoctorReport(
				"artifacts",
				{ invocationDir: root },
				{ environment: { DOTENC_PRIVATE_KEY_PASSPHRASE: "short" } },
			),
		).rejects.toThrow("active dotenc bootstrap value")
	})
})

describe("artifact representations and compressed output", () => {
	const secret = 'synthetic-credential:/+"\\\n\t<é>😀'
	const selected = { secretNames: ["TEST_ARTIFACT_SECRET"] }
	const environment = { TEST_ARTIFACT_SECRET: secret }

	test.each([
		["JSON bundle", JSON.stringify({ credential: secret })],
		["URL configuration", `credential=${encodeURIComponent(secret)}`],
		[
			"lowercase URL escapes",
			encodeURIComponent(secret).replace(/%[0-9A-F]{2}/g, (part) =>
				part.toLowerCase(),
			),
		],
		["base64", Buffer.from(secret).toString("base64")],
		[
			"unpadded base64",
			Buffer.from(secret).toString("base64").replace(/=+$/, ""),
		],
		["base64url", Buffer.from(secret).toString("base64url")],
		["hex", Buffer.from(secret).toString("hex")],
		["uppercase hex", Buffer.from(secret).toString("hex").toUpperCase()],
		[
			"Unicode escapes",
			secret
				.split("")
				.map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)
				.join(""),
		],
	])("detects a selected value in %s without reporting its representation", async (_, contents) => {
		const { artifacts } = await makeArtifactDirectory()
		await fs.writeFile(
			path.join(artifacts, "bundle.js"),
			`${"x".repeat(64 * 1024 - 5)}${contents}`,
		)
		const report = await createArtifactDoctorReport(artifacts, selected, {
			environment,
		})
		expect(report.exitCode).toBe(1)
		expect(findingIds(report)).toContain("artifact.secret-value")
		expect(JSON.stringify(report)).not.toContain(contents)
		expect(renderArtifactDoctorHuman(report)).not.toContain(secret)
	})

	test("detects encoded active bootstrap values without an application allowlist", async () => {
		const { artifacts } = await makeArtifactDirectory()
		await fs.writeFile(
			path.join(artifacts, "bundle.js"),
			JSON.stringify(secret),
		)
		const report = await createArtifactDoctorReport(
			artifacts,
			{},
			{ environment: { DOTENC_PRIVATE_KEY: secret } },
		)
		expect(findingIds(report)).toContain("artifact.bootstrap-value")
		expect(report.exitCode).toBe(1)
	})

	test.each([
		"gzip",
		"brotli",
		"gzip-magic",
	])("scans %s data and includes expanded bytes in the budget", async (format) => {
		const { artifacts } = await makeArtifactDirectory()
		const payload = Buffer.from(JSON.stringify({ credential: secret }))
		const encoded =
			format === "brotli" ? brotliCompressSync(payload) : gzipSync(payload)
		const name =
			format === "brotli"
				? "app.js.br"
				: format === "gzip"
					? "app.js.gz"
					: "unknown.bin"
		await fs.writeFile(path.join(artifacts, name), encoded)
		const report = await createArtifactDoctorReport(artifacts, selected, {
			environment,
		})
		expect(report.complete).toBe(true)
		expect(report.exitCode).toBe(1)
		expect(report.summary.bytesScanned).toBe(encoded.length + payload.length)
		expect(
			report.findings.find((finding) => finding.id === "artifact.secret-value")
				?.paths,
		).toEqual([name])
	})

	test.each([
		"gzip",
		"brotli",
	])("accepts clean %s assets and rejects expansion beyond the bound", async (format) => {
		const { artifacts } = await makeArtifactDirectory()
		const payload = Buffer.from("safe content".repeat(1000))
		const compressed =
			format === "gzip" ? gzipSync(payload) : brotliCompressSync(payload)
		await fs.writeFile(
			path.join(artifacts, format === "gzip" ? "app.gz" : "app.br"),
			compressed,
		)
		const clean = await createArtifactDoctorReport(
			artifacts,
			{},
			{ environment: {} },
		)
		expect(clean.exitCode).toBe(0)
		for (const limits of [
			{ maxDecompressedFileBytes: 128 },
			{ maxCompressedFileBytes: 1 },
			{ maxTotalBytes: compressed.length + 128 },
		]) {
			const report = await createArtifactDoctorReport(
				artifacts,
				{},
				{ environment: {}, limits },
			)
			expect(report.exitCode).toBe(2)
			expect(report.complete).toBe(false)
			expect(report.passed).toEqual([])
		}
	})

	test.each([
		["broken.gz", Buffer.from("not gzip")],
		["broken.br", Buffer.from([255, 255, 255])],
		["empty.gz", Buffer.alloc(0)],
		["truncated.gz", gzipSync("safe").subarray(0, 12)],
		["archive.zip", Buffer.from("not a supported archive")],
		["renamed.bin", Buffer.from("504b03040000", "hex")],
		["archive.tar.gz", gzipSync("tar contents")],
		["nested.gz", gzipSync(gzipSync("safe"))],
	])("does not report %s as a complete scan", async (name, contents) => {
		const { artifacts } = await makeArtifactDirectory()
		await fs.writeFile(path.join(artifacts, name), contents)
		const report = await createArtifactDoctorReport(
			artifacts,
			{},
			{ environment: {} },
		)
		expect(report.exitCode).toBe(2)
		expect(report.complete).toBe(false)
		expect(findingIds(report)).toContain("scan.incomplete")
	})

	test("flags compressed plaintext environments and still scans templates for values", async () => {
		const { artifacts } = await makeArtifactDirectory()
		await fs.writeFile(path.join(artifacts, ".env.gz"), gzipSync("EMPTY=value"))
		await fs.writeFile(
			path.join(artifacts, ".env.example.br"),
			brotliCompressSync(secret),
		)
		const report = await createArtifactDoctorReport(artifacts, selected, {
			environment,
		})
		expect(report.exitCode).toBe(1)
		expect(
			report.findings.find((finding) => finding.id === "artifact.plaintext-env")
				?.paths,
		).toEqual([".env.gz"])
		expect(findingIds(report)).toContain("artifact.secret-value")
	})

	test("retains leak evidence even when the container is unsupported", async () => {
		const { artifacts } = await makeArtifactDirectory()
		await fs.writeFile(path.join(artifacts, "archive.zip"), secret)
		const report = await createArtifactDoctorReport(artifacts, selected, {
			environment,
		})
		expect(report.exitCode).toBe(2)
		expect(findingIds(report)).toContain("artifact.secret-value")
	})

	test("omits sensitive names and encoded values from report paths, including incomplete scans", async () => {
		const { artifacts } = await makeArtifactDirectory()
		const value = "synthetic-path-secret"
		const encoded = Buffer.from(value).toString("hex")
		await fs.writeFile(path.join(artifacts, ".env.TEST_ARTIFACT_SECRET"), value)
		await fs.writeFile(path.join(artifacts, `.env.${encoded}`), value)
		await fs.symlink("missing", path.join(artifacts, value))
		const report = await createArtifactDoctorReport(artifacts, selected, {
			environment: { TEST_ARTIFACT_SECRET: value },
		})
		expect(report.exitCode).toBe(2)
		expect(findingIds(report)).toContain("artifact.secret-value")
		for (const output of [
			JSON.stringify(report),
			renderArtifactDoctorHuman(report),
		]) {
			for (const sensitive of [value, encoded, "TEST_ARTIFACT_SECRET"])
				expect(output).not.toContain(sensitive)
		}
	})

	test("enforces the aggregate pattern budget", async () => {
		const { artifacts } = await makeArtifactDirectory()
		await expect(
			createArtifactDoctorReport(
				artifacts,
				{ secretNames: ["FIRST", "SECOND"] },
				{
					environment: {
						FIRST: "a".repeat(1024 * 1024),
						SECOND: "b".repeat(1024 * 1024),
					},
				},
			),
		).rejects.toThrow("pattern budget")
	})

	test.each([
		{ maxDirectories: 1 },
		{ maxDirectoryEntries: 1 },
		{ maxEntries: 1 },
		{ maxFiles: 1 },
	])("fails incomplete when traversal exceeds %j", async (limits) => {
		const { artifacts } = await makeArtifactDirectory()
		await fs.mkdir(path.join(artifacts, "nested"))
		await fs.writeFile(path.join(artifacts, "one.txt"), "safe")
		await fs.writeFile(path.join(artifacts, "two.txt"), "safe")
		const report = await createArtifactDoctorReport(
			artifacts,
			{},
			{ environment: {}, limits },
		)
		expect(report.exitCode).toBe(2)
		expect(report.complete).toBe(false)
	})
})

test("artifact doctor charges failed decompression against the shared budget", async () => {
	const { artifacts } = await makeArtifactDirectory()
	await fs.writeFile(path.join(artifacts, "a.gz"), gzipSync("x".repeat(10_000)))
	await fs.writeFile(path.join(artifacts, "z.txt"), "safe")
	const report = await createArtifactDoctorReport(
		artifacts,
		{},
		{
			environment: {},
			limits: { maxTotalBytes: 256 },
		},
	)
	expect(report.exitCode).toBe(2)
	expect(report.summary.filesScanned).toBe(0)
	expect(
		report.findings.find((finding) => finding.id === "scan.incomplete")?.paths,
	).toEqual(["a.gz", "z.txt"])
})
