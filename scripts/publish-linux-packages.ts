import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

export type PublicationObject = {
	path: string
	source: string
	sha256: string
	size: number
	contentType: string
	policy: "immutable" | "key" | "metadata" | "config"
	phase: 1 | 2 | 3
	cacheControl: string
	writeMode: "create-only" | "overwrite"
	immutable: boolean
}

export type PublicationOutcome = "created" | "overwritten" | "unchanged"

export type PublicationManifest = {
	schemaVersion: 1
	baseUrl: string
	generatedAt: string
	edge: {
		cacheableStatusCodes: [200, 206]
		negativeCacheStatuses: [404, 410]
		negativeTtlSeconds: 30
		noStoreStatusRange: [500, 599]
		r2DevEndpointEnabled: false
		honorRangeRequests: true
	}
	policies: Record<
		"immutable" | "key" | "metadata" | "config",
		{
			cacheControl: string
			writeMode: "create-only" | "overwrite"
			immutable: boolean
		}
	>
	objects: PublicationObject[]
	purgePaths: string[]
}

type HeadObject = {
	ContentLength?: number
	ContentType?: string
	CacheControl?: string
	Metadata?: Record<string, string>
}

type Options = {
	manifestPath: string
	rootDir: string
	validateOnly: boolean
}

const allowedPrefixes = ["apt/", "rpm/", "apk/", "keys/"] as const
const sha256Pattern = /^[0-9a-f]{64}$/
const safeObjectPathPattern = /^[A-Za-z0-9._+@=/-]+$/
const maxCacheableObjectSize = 512 * 1024 * 1024
const immutableCacheControl =
	"public, max-age=31536000, s-maxage=31536000, immutable, no-transform"
const mutableCacheControl =
	"public, max-age=60, s-maxage=300, must-revalidate, no-transform"

const expectedClassificationForPath = (
	objectPath: string,
): Pick<PublicationObject, "policy" | "phase"> => {
	if (
		/(?:^|\/)InRelease$/.test(objectPath) ||
		/(?:^|\/)repodata\/repomd\.xml$/.test(objectPath) ||
		/(?:^|\/)APKINDEX\.tar\.gz$/.test(objectPath)
	) {
		return { policy: "metadata", phase: 3 }
	}
	if (objectPath.startsWith("keys/")) {
		const fingerprinted =
			/^keys\/dotenc-(?:apt|rpm)-[A-Fa-f0-9]{40}-[a-f0-9]{64}\.asc$/.test(
				objectPath,
			) || /^keys\/dotenc-[a-f0-9]{64}\.rsa\.pub$/.test(objectPath)
		return fingerprinted
			? { policy: "immutable", phase: 1 }
			: { policy: "key", phase: 2 }
	}
	if (
		objectPath === "apt/dotenc.sources" ||
		objectPath === "rpm/dotenc.repo" ||
		objectPath === "apk/dotenc.repositories"
	) {
		return { policy: "config", phase: 2 }
	}
	if (
		/\.(?:deb|rpm|apk)$/.test(objectPath) ||
		objectPath.includes("/by-hash/SHA256/") ||
		(/\/repodata\/[^/]+$/.test(objectPath) &&
			!objectPath.endsWith("/repomd.xml") &&
			!objectPath.endsWith("/repomd.xml.asc"))
	) {
		return { policy: "immutable", phase: 1 }
	}
	return { policy: "metadata", phase: 2 }
}

const fail: (message: string) => never = (message) => {
	throw new Error(message)
}

const parseOptions = (args: string[]): Options => {
	let manifestPath = ""
	let rootDir = ""
	let validateOnly = false

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		switch (arg) {
			case "--manifest":
				manifestPath = args[index + 1] ?? ""
				index += 1
				break
			case "--root":
				rootDir = args[index + 1] ?? ""
				index += 1
				break
			case "--validate-only":
				validateOnly = true
				break
			default:
				fail(`Unknown argument: ${arg}`)
		}
	}

	if (!manifestPath || !rootDir) {
		fail(
			"Usage: bun scripts/publish-linux-packages.ts --manifest FILE --root DIR [--validate-only]",
		)
	}

	return {
		manifestPath: path.resolve(manifestPath),
		rootDir: path.resolve(rootDir),
		validateOnly,
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const requireString = (
	record: Record<string, unknown>,
	field: string,
	objectPath: string,
): string => {
	const value = record[field]
	if (typeof value !== "string" || value.length === 0) {
		fail(`${objectPath}: ${field} must be a non-empty string`)
	}
	if (value.includes("\n") || value.includes("\r")) {
		fail(`${objectPath}: ${field} must not contain newlines`)
	}
	return value
}

const validateObjectPath = (objectPath: string): void => {
	if (objectPath.startsWith("/") || objectPath.includes("\\")) {
		fail(`${objectPath}: object paths must be relative POSIX paths`)
	}
	if (objectPath.includes("?") || objectPath.includes("#")) {
		fail(`${objectPath}: query strings and fragments are not valid object paths`)
	}
	if (!safeObjectPathPattern.test(objectPath) || objectPath.includes("%")) {
		fail(`${objectPath}: object path contains a disallowed character or encoding`)
	}
	const segments = objectPath.split("/")
	if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
		fail(`${objectPath}: object path contains an unsafe segment`)
	}
	if (!allowedPrefixes.some((prefix) => objectPath.startsWith(prefix))) {
		fail(
			`${objectPath}: object path must begin with ${allowedPrefixes.join(", ")}`,
		)
	}
}

export const parseManifest = (manifestPath: string): PublicationManifest => {
	let raw: unknown
	try {
		raw = JSON.parse(readFileSync(manifestPath, "utf8"))
	} catch (error) {
		fail(`Unable to parse ${manifestPath}: ${String(error)}`)
	}

	if (!isRecord(raw) || !Array.isArray(raw.objects)) {
		fail("Publication manifest must be an object containing an objects array")
	}
	if (raw.schemaVersion !== 1) {
		fail("Publication manifest schemaVersion must be 1")
	}
	const baseUrl = requireString(raw, "baseUrl", "manifest")
	let parsedBaseUrl: URL
	try {
		parsedBaseUrl = new URL(baseUrl)
	} catch {
		fail("Publication manifest baseUrl must be a valid URL")
	}
	if (
		parsedBaseUrl.protocol !== "https:" ||
		parsedBaseUrl.username ||
		parsedBaseUrl.password ||
		parsedBaseUrl.pathname !== "/" ||
		parsedBaseUrl.search ||
		parsedBaseUrl.hash
	) {
		fail("Publication manifest baseUrl must be an HTTPS origin")
	}
	const generatedAt = requireString(raw, "generatedAt", "manifest")
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(generatedAt)) {
		fail("Publication manifest generatedAt must be an ISO-8601 UTC timestamp")
	}
	if (!isRecord(raw.edge)) {
		fail("Publication manifest edge contract is missing")
	}
	const statusCodes = raw.edge.cacheableStatusCodes
	const negativeStatuses = raw.edge.negativeCacheStatuses
	const noStoreStatusRange = raw.edge.noStoreStatusRange
	if (
		Object.keys(raw.edge).sort().join(",") !==
			[
				"cacheableStatusCodes",
				"honorRangeRequests",
				"negativeCacheStatuses",
				"negativeTtlSeconds",
				"noStoreStatusRange",
				"r2DevEndpointEnabled",
			].join(",") ||
		!Array.isArray(statusCodes) ||
		statusCodes.length !== 2 ||
		statusCodes[0] !== 200 ||
		statusCodes[1] !== 206 ||
		!Array.isArray(negativeStatuses) ||
		negativeStatuses.length !== 2 ||
		negativeStatuses[0] !== 404 ||
		negativeStatuses[1] !== 410 ||
		raw.edge.negativeTtlSeconds !== 30 ||
		!Array.isArray(noStoreStatusRange) ||
		noStoreStatusRange.length !== 2 ||
		noStoreStatusRange[0] !== 500 ||
		noStoreStatusRange[1] !== 599 ||
		raw.edge.r2DevEndpointEnabled !== false ||
		raw.edge.honorRangeRequests !== true
	) {
		fail("Publication manifest edge contract does not match production")
	}
	if (!isRecord(raw.policies)) {
		fail("Publication manifest policies contract is missing")
	}
	const expectedPolicies = {
		immutable: {
			cacheControl: immutableCacheControl,
			writeMode: "create-only",
			immutable: true,
		},
		key: {
			cacheControl: mutableCacheControl,
			writeMode: "overwrite",
			immutable: false,
		},
		metadata: {
			cacheControl: mutableCacheControl,
			writeMode: "overwrite",
			immutable: false,
		},
		config: {
			cacheControl: mutableCacheControl,
			writeMode: "overwrite",
			immutable: false,
		},
	} as const
	if (
		Object.keys(raw.policies).sort().join(",") !==
			Object.keys(expectedPolicies).sort().join(",")
	) {
		fail("Publication manifest policies do not match the production allowlist")
	}
	for (const [name, expected] of Object.entries(expectedPolicies)) {
		const actual = raw.policies[name]
		if (
			!isRecord(actual) ||
			Object.keys(actual).sort().join(",") !==
				["cacheControl", "immutable", "writeMode"].join(",") ||
			actual.cacheControl !== expected.cacheControl ||
			actual.writeMode !== expected.writeMode ||
			actual.immutable !== expected.immutable
		) {
			fail("Publication manifest policies do not match the production allowlist")
		}
	}
	if (!Array.isArray(raw.purgePaths)) {
		fail("Publication manifest purgePaths must be an array")
	}

	const objects = raw.objects.map((value, index): PublicationObject => {
		if (!isRecord(value)) {
			fail(`objects[${index}] must be an object`)
		}

		const objectPath = requireString(value, "path", `objects[${index}]`)
		validateObjectPath(objectPath)
		const source = requireString(value, "source", objectPath)
		const sha256 = requireString(value, "sha256", objectPath)
		const contentType = requireString(value, "contentType", objectPath)
		const policy = requireString(value, "policy", objectPath)
		const cacheControl = requireString(value, "cacheControl", objectPath)
		const { size, phase, writeMode, immutable } = value

		if (source !== `public/${objectPath}`) {
			fail(`${objectPath}: source must be exactly public/${objectPath}`)
		}
		if (!sha256Pattern.test(sha256)) {
			fail(`${objectPath}: sha256 must be 64 lowercase hexadecimal characters`)
		}
		if (!Number.isSafeInteger(size) || (size as number) < 0) {
			fail(`${objectPath}: size must be a non-negative safe integer`)
		}
		if ((size as number) > maxCacheableObjectSize) {
			fail(`${objectPath}: size exceeds Cloudflare's 512 MiB cache limit`)
		}
		if (phase !== 1 && phase !== 2 && phase !== 3) {
			fail(`${objectPath}: phase must be 1, 2, or 3`)
		}
		if (writeMode !== "create-only" && writeMode !== "overwrite") {
			fail(`${objectPath}: writeMode must be create-only or overwrite`)
		}
		if (typeof immutable !== "boolean") {
			fail(`${objectPath}: immutable must be a boolean`)
		}
		if (immutable !== (writeMode === "create-only")) {
			fail(`${objectPath}: immutable and writeMode disagree`)
		}
		if (writeMode === "create-only" && phase !== 1) {
			fail(`${objectPath}: create-only objects must be published in phase 1`)
		}
		if (writeMode === "overwrite" && phase === 1) {
			fail(`${objectPath}: overwrite objects must be published in phase 2 or 3`)
		}
		if (
			policy !== "immutable" &&
			policy !== "key" &&
			policy !== "metadata" &&
			policy !== "config"
		) {
			fail(`${objectPath}: policy is not recognized`)
		}
		const expectedCacheControl = immutable
			? immutableCacheControl
			: mutableCacheControl
		if (cacheControl !== expectedCacheControl) {
			fail(`${objectPath}: cacheControl is not allowed for ${policy} policy`)
		}
		if (policy === "immutable" && !immutable) {
			fail(`${objectPath}: immutable policy must use create-only publication`)
		}
		if (policy === "key" && (immutable || phase !== 2)) {
			fail(`${objectPath}: key policy objects must be overwritten in phase 2`)
		}
		if ((policy === "metadata" || policy === "config") && immutable) {
			fail(`${objectPath}: ${policy} policy must use overwrite publication`)
		}
		if (policy === "config" && phase !== 2) {
			fail(`${objectPath}: config policy objects must be published in phase 2`)
		}
		if (phase === 3 && policy !== "metadata") {
			fail(`${objectPath}: phase 3 is reserved for signed metadata roots`)
		}
		if (
			phase === 3 &&
			!/^apt\/dists\/[A-Za-z0-9._+@=-]+\/InRelease$/.test(objectPath) &&
			!/^rpm\/(?:x86_64|aarch64)\/repodata\/repomd\.xml$/.test(
				objectPath,
			) &&
			!/^apk\/[A-Za-z0-9._+@=-]+\/[A-Za-z0-9._+@=-]+\/(?:x86_64|aarch64)\/APKINDEX\.tar\.gz$/.test(
				objectPath,
			)
		) {
			fail(`${objectPath}: phase 3 path is not a recognized signed metadata root`)
		}
		const expectedClassification = expectedClassificationForPath(objectPath)
		if (
			policy !== expectedClassification.policy ||
			phase !== expectedClassification.phase
		) {
			fail(
				`${objectPath}: path must use ${expectedClassification.policy} policy in phase ${expectedClassification.phase}`,
			)
		}

		return {
			path: objectPath,
			source,
			sha256,
			size: size as number,
			contentType,
			policy,
			phase,
			cacheControl,
			writeMode,
			immutable,
		}
	})

	if (objects.length === 0) {
		fail("Publication manifest contains no objects")
	}

	const seen = new Set<string>()
	for (const object of objects) {
		if (seen.has(object.path)) {
			fail(`${object.path}: duplicate object path`)
		}
		seen.add(object.path)
	}

	const expectedOrder = [...objects].sort(
		(left, right) => left.phase - right.phase || left.path.localeCompare(right.path),
	)
	for (const [index, object] of objects.entries()) {
		if (object.path !== expectedOrder[index]?.path) {
			fail("Publication manifest objects must be sorted by phase and path")
		}
	}

	const purgePaths = raw.purgePaths.map((value, index) => {
		if (typeof value !== "string") {
			fail(`purgePaths[${index}] must be a string`)
		}
		validateObjectPath(value)
		return value
	})
	const expectedPurgePaths = objects.map((object) => object.path).sort()
	if (
		purgePaths.length !== expectedPurgePaths.length ||
		purgePaths.some((value, index) => value !== expectedPurgePaths[index])
	) {
		fail("Publication manifest purgePaths must contain every sorted object path")
	}

	return {
		schemaVersion: 1,
		baseUrl,
		generatedAt,
		edge: {
			cacheableStatusCodes: [200, 206],
			negativeCacheStatuses: [404, 410],
			negativeTtlSeconds: 30,
			noStoreStatusRange: [500, 599],
			r2DevEndpointEnabled: false,
			honorRangeRequests: true,
		},
		policies: expectedPolicies,
		objects,
		purgePaths,
	}
}

const resolveSource = (rootDir: string, object: PublicationObject): string => {
	const root = realpathSync(rootDir)
	const sourcePath = realpathSync(path.resolve(root, object.source))
	if (!sourcePath.startsWith(`${root}${path.sep}`)) {
		fail(`${object.path}: source resolves outside the publication root`)
	}
	return sourcePath
}

const calculateDigest = (algorithm: "md5" | "sha256", filePath: string): string =>
	createHash(algorithm).update(readFileSync(filePath)).digest("hex")

export const validateLocalFiles = (
	rootDir: string,
	objects: PublicationObject[],
): Map<string, string> => {
	const sources = new Map<string, string>()
	for (const object of objects) {
		let sourcePath: string
		try {
			sourcePath = resolveSource(rootDir, object)
		} catch (error) {
			fail(`${object.path}: unable to resolve source: ${String(error)}`)
		}

		const stat = statSync(sourcePath)
		if (!stat.isFile()) {
			fail(`${object.path}: source is not a regular file`)
		}
		if (stat.size !== object.size) {
			fail(`${object.path}: local size ${stat.size} does not match ${object.size}`)
		}
		const digest = calculateDigest("sha256", sourcePath)
		if (digest !== object.sha256) {
			fail(`${object.path}: local SHA-256 does not match the manifest`)
		}
		sources.set(object.path, sourcePath)
	}
	return sources
}

const requiredEnvironment = (name: string): string => {
	const value = process.env[name]
	if (!value) fail(`${name} is required`)
	return value
}

const validatedR2Endpoint = (): string => {
	const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID")
	if (!/^[0-9a-f]{32}$/.test(accountId)) {
		fail("CLOUDFLARE_ACCOUNT_ID must be a 32-character lowercase hex ID")
	}
	const endpoint = requiredEnvironment("R2_ENDPOINT")
	const expected = `https://${accountId}.r2.cloudflarestorage.com`
	if (endpoint !== expected) {
		fail("R2_ENDPOINT does not match CLOUDFLARE_ACCOUNT_ID")
	}
	let parsed: URL
	try {
		parsed = new URL(endpoint)
	} catch {
		fail("R2_ENDPOINT is not a valid URL")
	}
	if (
		parsed.protocol !== "https:" ||
		parsed.hostname !== `${accountId}.r2.cloudflarestorage.com` ||
		parsed.port ||
		parsed.username ||
		parsed.password ||
		parsed.pathname !== "/" ||
		parsed.search ||
		parsed.hash
	) {
		fail("R2_ENDPOINT must be the account-scoped HTTPS R2 origin")
	}
	return endpoint
}

const runAws = (args: string[], allowFailure = false) => {
	const endpoint = validatedR2Endpoint()
	const awsEnvironment: NodeJS.ProcessEnv = {
		...process.env,
		AWS_EC2_METADATA_DISABLED: "true",
		AWS_MAX_ATTEMPTS: "5",
		AWS_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED",
		AWS_RESPONSE_CHECKSUM_VALIDATION: "WHEN_REQUIRED",
		AWS_RETRY_MODE: "standard",
	}
	delete awsEnvironment.CLOUDFLARE_CACHE_PURGE_TOKEN
	const result = spawnSync(
		"aws",
		[
			"--endpoint-url",
			endpoint,
			"--region",
			"auto",
			"--no-cli-pager",
			"s3api",
			...args,
		],
		{
			encoding: "utf8",
			env: awsEnvironment,
		},
	)

	if (result.error) {
		fail(`Unable to run aws: ${result.error.message}`)
	}
	if (result.status !== 0 && !allowFailure) {
		fail(`aws command failed: ${result.stderr.trim() || `exit ${result.status}`}`)
	}
	return result
}

const headObject = (objectPath: string): HeadObject | null => {
	const bucket = requiredEnvironment("R2_BUCKET")
	const result = runAws(
		[
			"head-object",
			"--bucket",
			bucket,
			"--key",
			objectPath,
			"--output",
			"json",
		],
		true,
	)

	if (result.status !== 0) {
		const error = result.stderr
		if (/\b(404|Not Found|NoSuchKey)\b/i.test(error)) return null
		fail(`Unable to inspect ${objectPath}: ${error.trim() || `exit ${result.status}`}`)
	}

	try {
		return JSON.parse(result.stdout) as HeadObject
	} catch (error) {
		fail(`${objectPath}: invalid head-object response: ${String(error)}`)
	}
}

const metadataSha256 = (metadata: Record<string, string> | undefined): string => {
	for (const [key, value] of Object.entries(metadata ?? {})) {
		if (key.toLowerCase() === "sha256") return value
	}
	return ""
}

const verifyRemote = (object: PublicationObject, head: HeadObject | null): void => {
	if (!head) fail(`${object.path}: object is missing after publication`)
	if (head.ContentLength !== object.size) {
		fail(
			`${object.path}: remote size ${head.ContentLength ?? "missing"} does not match ${object.size}`,
		)
	}
	if (metadataSha256(head.Metadata) !== object.sha256) {
		fail(`${object.path}: remote SHA-256 metadata does not match`)
	}
	if (head.CacheControl !== object.cacheControl) {
		fail(`${object.path}: remote Cache-Control metadata does not match`)
	}
	if (head.ContentType !== object.contentType) {
		fail(`${object.path}: remote Content-Type metadata does not match`)
	}
}

const verifyRemoteBytes = (object: PublicationObject): void => {
	const bucket = requiredEnvironment("R2_BUCKET")
	const temporaryDirectory = mkdtempSync(
		path.join(tmpdir(), "dotenc-r2-object-verification-"),
	)
	const destination = path.join(temporaryDirectory, "object")
	try {
		runAws([
			"get-object",
			"--bucket",
			bucket,
			"--key",
			object.path,
			destination,
		])
		const stat = statSync(destination)
		if (!stat.isFile() || stat.size !== object.size) {
			fail(`${object.path}: authenticated remote bytes have the wrong size`)
		}
		if (calculateDigest("sha256", destination) !== object.sha256) {
			fail(`${object.path}: authenticated remote bytes have the wrong SHA-256`)
		}
	} finally {
		if (temporaryDirectory.startsWith(path.join(tmpdir(), "dotenc-r2-object-verification-"))) {
			rmSync(temporaryDirectory, { recursive: true, force: true })
		}
	}
}

const putObject = (
	object: PublicationObject,
	sourcePath: string,
	createOnly: boolean,
) => {
	const bucket = requiredEnvironment("R2_BUCKET")
	const md5 = Buffer.from(calculateDigest("md5", sourcePath), "hex").toString(
		"base64",
	)
	const args = [
		"put-object",
		"--bucket",
		bucket,
		"--key",
		object.path,
		"--body",
		sourcePath,
		"--content-length",
		String(object.size),
		"--content-md5",
		md5,
		"--content-type",
		object.contentType,
		"--cache-control",
		object.cacheControl,
		"--metadata",
		JSON.stringify({ sha256: object.sha256 }),
	]
	if (createOnly) args.push("--if-none-match", "*")
	return runAws(args, createOnly)
}

const publishObject = (
	object: PublicationObject,
	sourcePath: string,
): PublicationOutcome => {
	if (object.writeMode === "create-only") {
		const existing = headObject(object.path)
		if (existing) {
			verifyRemote(object, existing)
			verifyRemoteBytes(object)
			console.log(`unchanged phase ${object.phase}: ${object.path}`)
			return "unchanged"
		}

		const result = putObject(object, sourcePath, true)
		if (result.status !== 0) {
			const raced = headObject(object.path)
			if (!raced) {
				fail(
					`${object.path}: create-only upload failed: ${result.stderr.trim() || `exit ${result.status}`}`,
				)
			}
			verifyRemote(object, raced)
			verifyRemoteBytes(object)
			console.log(`unchanged phase ${object.phase}: ${object.path}`)
			return "unchanged"
		}
	} else {
		putObject(object, sourcePath, false)
	}

	verifyRemote(object, headObject(object.path))
	console.log(`published phase ${object.phase}: ${object.path}`)
	return object.writeMode === "create-only" ? "created" : "overwritten"
}

export const selectPurgePaths = (
	candidates: string[],
	outcomes: ReadonlyMap<string, PublicationOutcome>,
): string[] =>
	candidates.filter((objectPath) => {
		const outcome = outcomes.get(objectPath)
		if (outcome === undefined) {
			fail(`${objectPath}: publication outcome is missing from the purge plan`)
		}
		return outcome !== "unchanged"
	})

const rpmMetadataSignaturePattern =
	/^rpm\/(?:x86_64|aarch64)\/repodata\/repomd\.xml\.asc$/
const rpmMetadataRootPattern =
	/^rpm\/(?:x86_64|aarch64)\/repodata\/repomd\.xml$/

export const orderPublicationObjects = (
	objects: readonly PublicationObject[],
): PublicationObject[] => {
	const signaturesByRoot = new Map<string, PublicationObject>()
	const rootsByPath = new Map<string, PublicationObject>()
	for (const object of objects) {
		if (rpmMetadataSignaturePattern.test(object.path)) {
			signaturesByRoot.set(object.path.slice(0, -".asc".length), object)
		}
		if (rpmMetadataRootPattern.test(object.path)) {
			rootsByPath.set(object.path, object)
		}
	}
	for (const rootPath of new Set([
		...signaturesByRoot.keys(),
		...rootsByPath.keys(),
	])) {
		if (!signaturesByRoot.has(rootPath) || !rootsByPath.has(rootPath)) {
			fail(`${rootPath}: RPM metadata root and detached signature must be published together`)
		}
	}

	const phaseOne = objects.filter((object) => object.phase === 1)
	const phaseTwo = objects.filter(
		(object) => object.phase === 2 && !rpmMetadataSignaturePattern.test(object.path),
	)
	const rpmPairs = [...rootsByPath.keys()]
		.sort()
		.flatMap((rootPath) => [
			signaturesByRoot.get(rootPath) as PublicationObject,
			rootsByPath.get(rootPath) as PublicationObject,
		])
	const remainingRoots = objects.filter(
		(object) => object.phase === 3 && !rpmMetadataRootPattern.test(object.path),
	)
	return [...phaseOne, ...phaseTwo, ...rpmPairs, ...remainingRoots]
}

const sleep = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds))

const purgeUrls = async (objectPaths: string[]): Promise<void> => {
	const baseUrl = new URL(requiredEnvironment("PACKAGES_BASE_URL"))
	if (
		baseUrl.protocol !== "https:" ||
		baseUrl.username ||
		baseUrl.password ||
		baseUrl.search ||
		baseUrl.hash ||
		baseUrl.pathname !== "/"
	) {
		fail("PACKAGES_BASE_URL must be an HTTPS origin without a path or query")
	}

	const zoneId = requiredEnvironment("CLOUDFLARE_ZONE_ID")
	if (!/^[0-9a-f]{32}$/.test(zoneId)) {
		fail("CLOUDFLARE_ZONE_ID must be a 32-character lowercase hex ID")
	}
	const token = requiredEnvironment("CLOUDFLARE_CACHE_PURGE_TOKEN")
	const urls = [...new Set(objectPaths)].sort().map(
		(objectPath) => new URL(objectPath, baseUrl).href,
	)

	for (let offset = 0; offset < urls.length; offset += 100) {
		const files = urls.slice(offset, offset + 100)
		let lastError = ""

		for (let attempt = 0; attempt < 5; attempt += 1) {
			let response: Response
			try {
				response = await fetch(
					`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/purge_cache`,
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${token}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ files }),
						signal: AbortSignal.timeout(30_000),
					},
				)
			} catch (error) {
				lastError = `network error: ${String(error)}`
				if (attempt < 4) await sleep(1_000 * 2 ** attempt)
				continue
			}
			const body = (await response.json().catch(() => null)) as {
				success?: boolean
				errors?: Array<{ code?: number; message?: string }>
			} | null

			if (response.ok && body?.success === true) {
				console.log(`purged ${files.length} exact package URL(s)`)
				lastError = ""
				break
			}

			lastError = `HTTP ${response.status}: ${JSON.stringify(body?.errors ?? [])}`
			if (response.status !== 429 && response.status < 500) break
			const retryAfter = Number(response.headers.get("retry-after"))
			const delay = Number.isFinite(retryAfter)
				? Math.min(retryAfter * 1_000, 30_000)
				: 1_000 * 2 ** attempt
			await sleep(delay)
		}

		if (lastError) fail(`Cloudflare exact-URL purge failed: ${lastError}`)
	}
}

const main = async () => {
	const options = parseOptions(process.argv.slice(2))
	const manifest = parseManifest(options.manifestPath)
	const sources = validateLocalFiles(options.rootDir, manifest.objects)
	const publicationObjects = orderPublicationObjects(manifest.objects)

	if (options.validateOnly) {
		console.log(`Validated ${manifest.objects.length} package repository object(s)`)
		return
	}

	requiredEnvironment("AWS_ACCESS_KEY_ID")
	requiredEnvironment("AWS_SECRET_ACCESS_KEY")
	const configuredBaseUrl = requiredEnvironment("PACKAGES_BASE_URL")
	if (manifest.baseUrl !== configuredBaseUrl) {
		fail("Publication manifest baseUrl does not match PACKAGES_BASE_URL")
	}
	const outcomes = new Map<string, PublicationOutcome>()
	for (const object of publicationObjects) {
		const sourcePath = sources.get(object.path)
		if (!sourcePath) fail(`${object.path}: source path was not validated`)
		outcomes.set(object.path, publishObject(object, sourcePath))
	}

	await purgeUrls(selectPurgePaths(manifest.purgePaths, outcomes))
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	})
}
