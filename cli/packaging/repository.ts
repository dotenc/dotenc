#!/usr/bin/env bun

import { spawn } from "node:child_process"
import {
	createHash,
	createPrivateKey,
	createPublicKey,
	type KeyObject,
} from "node:crypto"
import { createReadStream } from "node:fs"
import {
	chmod,
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises"
import {
	basename,
	dirname,
	join,
	posix,
	relative,
	resolve,
	sep,
} from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

export const NFPM_VERSION = "2.47.0"

const PACKAGING_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_BASE_URL = "https://packages.dotenc.org"
const DEFAULT_SUITE = "stable"
const DEFAULT_COMPONENT = "main"
const APT_VALID_DAYS = 14
const APT_VALID_SECONDS = APT_VALID_DAYS * 24 * 60 * 60
const PACKAGE_BUNDLE_MANIFEST = "package-bundle-manifest.json"

const VERSION_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const REPOSITORY_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const APK_KEY_NAME_PATTERN = /^dotenc-[a-f0-9]{64}$/
const OPENPGP_FINGERPRINT_PATTERN = /^[A-Fa-f0-9]{40}$/

type Architecture = {
	input: "x64" | "arm64"
	nfpm: "amd64" | "arm64"
	deb: "amd64" | "arm64"
	rpm: "x86_64" | "aarch64"
	apk: "x86_64" | "aarch64"
}

export const ARCHITECTURES: readonly Architecture[] = [
	{
		input: "x64",
		nfpm: "amd64",
		deb: "amd64",
		rpm: "x86_64",
		apk: "x86_64",
	},
	{
		input: "arm64",
		nfpm: "arm64",
		deb: "arm64",
		rpm: "aarch64",
		apk: "aarch64",
	},
]

export type BuildOptions = {
	version: string
	inputDir?: string
	packageSourceDir?: string
	packageSourceManifest?: string
	outputDir: string
	baseUrl: string
	suite: string
	component: string
	aptGpgPrimaryFingerprint: string
	aptGpgSigningFingerprint: string
	aptGpgPublicKey: string
	rpmGpgPrimaryFingerprint: string
	rpmGpgSigningFingerprint: string
	rpmGpgPublicKey: string
	apkPublicKey: string
	apkKeyName: string
	sourceDateEpoch: number
	publicationEpoch: number
	dryRun: boolean
}

type ToolName =
	| "nfpm"
	| "aptFtparchive"
	| "gzip"
	| "createrepo"
	| "apk"
	| "abuildSign"
	| "abuildGzsplit"
	| "gpg"
	| "gpgconf"
	| "gpgv"
	| "rpm"
	| "rpmkeys"
	| "dpkgDeb"

const TOOL_COMMANDS: Record<ToolName, { command: string; override: string }> = {
	nfpm: { command: "nfpm", override: "DOTENC_NFPM_COMMAND" },
	aptFtparchive: {
		command: "apt-ftparchive",
		override: "DOTENC_APT_FTPARCHIVE_COMMAND",
	},
	gzip: { command: "gzip", override: "DOTENC_GZIP_COMMAND" },
	createrepo: {
		command: "createrepo_c",
		override: "DOTENC_CREATEREPO_COMMAND",
	},
	apk: { command: "apk", override: "DOTENC_APK_COMMAND" },
	abuildSign: {
		command: "abuild-sign",
		override: "DOTENC_ABUILD_SIGN_COMMAND",
	},
	abuildGzsplit: {
		command: "abuild-gzsplit",
		override: "DOTENC_ABUILD_GZSPLIT_COMMAND",
	},
	gpg: { command: "gpg", override: "DOTENC_GPG_COMMAND" },
	gpgconf: { command: "gpgconf", override: "DOTENC_GPGCONF_COMMAND" },
	gpgv: { command: "gpgv", override: "DOTENC_GPGV_COMMAND" },
	rpm: { command: "rpm", override: "DOTENC_RPM_COMMAND" },
	rpmkeys: { command: "rpmkeys", override: "DOTENC_RPMKEYS_COMMAND" },
	dpkgDeb: { command: "dpkg-deb", override: "DOTENC_DPKG_DEB_COMMAND" },
}

const toolCommand = (
	tool: ToolName,
	environment: NodeJS.ProcessEnv = process.env,
): string => {
	const definition = TOOL_COMMANDS[tool]
	const override = environment[definition.override]
	if (override !== undefined && override.trim() === "") {
		throw new Error(`${definition.override} cannot be empty`)
	}
	return override ?? definition.command
}

export type RunOptions = {
	cwd?: string
	env?: NodeJS.ProcessEnv
	stdinFile?: string
	stdoutFile?: string
	stderr?: "inherit" | "ignore"
	acceptedExitCodes?: readonly number[]
}

export type CommandRunner = {
	run(command: string, args: string[], options?: RunOptions): Promise<void>
	capture(command: string, args: string[], options?: RunOptions): Promise<string>
}

const spawnCommand = async (
	command: string,
	args: string[],
	options: RunOptions,
	capture: boolean,
): Promise<string> =>
	new Promise((resolvePromise, rejectPromise) => {
		const shouldPipe = capture || options.stdoutFile !== undefined
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: [
				options.stdinFile === undefined ? "ignore" : "pipe",
				shouldPipe ? "pipe" : "inherit",
				options.stderr ?? "inherit",
			],
		})
		const chunks: Buffer[] = []
		if (shouldPipe) {
			child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk))
		}
		child.once("error", rejectPromise)
		if (options.stdinFile !== undefined) {
			const input = createReadStream(options.stdinFile)
			input.once("error", rejectPromise)
			input.pipe(child.stdin as NodeJS.WritableStream)
		}
		child.once("close", async (code) => {
			const acceptedExitCodes = options.acceptedExitCodes ?? [0]
			if (code === null || !acceptedExitCodes.includes(code)) {
				rejectPromise(
					new Error(
						`${basename(command)} exited with status ${code ?? "unknown"}`,
					),
				)
				return
			}
			const output = Buffer.concat(chunks)
			try {
				if (options.stdoutFile !== undefined) {
					await writeFile(options.stdoutFile, output)
				}
				resolvePromise(output.toString("utf8"))
			} catch (error) {
				rejectPromise(error)
			}
		})
	})

const defaultCommandRunner: CommandRunner = {
	run: (command, args, options = {}) =>
		spawnCommand(command, args, options, false).then(() => undefined),
	capture: (command, args, options = {}) =>
		spawnCommand(command, args, options, true),
}

const helpText = `Build signed dotenc Linux package repositories.

Usage:
  bun cli/packaging/repository.ts [options]

Required options:
  --version <semver>                 Upstream dotenc version (without v)
  --output-dir <path>                New directory for public/ and publication-manifest.json
  --apt-gpg-primary-fingerprint <fpr>  APT OpenPGP v4 primary fingerprint
  --apt-gpg-signing-fingerprint <fpr>  Exact APT signing-subkey fingerprint
  --apt-gpg-public-key <path>        ASCII-armored APT public certificate
  --rpm-gpg-primary-fingerprint <fpr>  RPM OpenPGP v4 primary fingerprint
  --rpm-gpg-signing-fingerprint <fpr>  Exact RPM signing-subkey fingerprint
  --rpm-gpg-public-key <path>        ASCII-armored RPM public certificate
  --apk-public-key <path>            RSA public key in PEM format
  --apk-key-name <name>              dotenc-<64 lowercase hex DER SHA-256>

Choose exactly one package input mode:
  --input-dir <path>                 Build from the four release Linux binaries
  --package-source-dir <path>        Refresh metadata using an archived public/ tree
  --package-source-manifest <path>   Archived manifest (requires adjacent .asc)

Optional:
  --base-url <url>                   Repository origin (default: ${DEFAULT_BASE_URL})
  --suite <name>                     Repository suite (default: ${DEFAULT_SUITE})
  --component <name>                 Repository component (default: ${DEFAULT_COMPONENT})
  --source-date-epoch <seconds>      Reproducible build timestamp
  --publication-epoch <seconds>      Current repository publication UTC
  --dry-run                          Print a secret-free build plan without writing
  --help                             Show this help

Build-only environment:
  NFPM_RPM_KEY_FILE                  chmod-600 OpenPGP RPM secret-subkey export
  NFPM_APK_KEY_FILE                  chmod-600 unencrypted RSA private PEM
  DOTENC_APT_GNUPGHOME               APT subkey-only signing keyring
  DOTENC_RPM_GNUPGHOME               RPM subkey-only signing keyring
  DOTENC_APT_GPG_PASSPHRASE_FILE    Optional chmod-600 APT GPG passphrase file
  DOTENC_RPM_GPG_PASSPHRASE_FILE    Required for a protected RPM signing subkey
  DOTENC_PACKAGING_SECRET_SCRATCH_DIR  Optional chmod-700 workflow-owned scratch
`

const requiredOption = (
	values: Record<string, string | boolean | undefined>,
	name: string,
): string => {
	const value = values[name]
	if (typeof value !== "string" || value === "") {
		throw new Error(`Missing required option --${name}`)
	}
	return value
}

export const parseCliOptions = (
	args: string[],
	environment: NodeJS.ProcessEnv = process.env,
	now: Date = new Date(),
): BuildOptions | { help: true } => {
	const parsed = parseArgs({
		args,
		strict: true,
		allowPositionals: false,
		options: {
			version: { type: "string" },
			"input-dir": { type: "string" },
			"package-source-dir": { type: "string" },
			"package-source-manifest": { type: "string" },
			"output-dir": { type: "string" },
			"base-url": { type: "string", default: DEFAULT_BASE_URL },
			suite: { type: "string", default: DEFAULT_SUITE },
			component: { type: "string", default: DEFAULT_COMPONENT },
			"apt-gpg-primary-fingerprint": { type: "string" },
			"apt-gpg-signing-fingerprint": { type: "string" },
			"apt-gpg-public-key": { type: "string" },
			"rpm-gpg-primary-fingerprint": { type: "string" },
			"rpm-gpg-signing-fingerprint": { type: "string" },
			"rpm-gpg-public-key": { type: "string" },
			"apk-public-key": { type: "string" },
			"apk-key-name": { type: "string" },
			"source-date-epoch": { type: "string" },
			"publication-epoch": { type: "string" },
			"dry-run": { type: "boolean", default: false },
			help: { type: "boolean", short: "h", default: false },
		},
	})

	if (parsed.values.help) return { help: true }

	const epochValue =
		parsed.values["source-date-epoch"] ?? environment.SOURCE_DATE_EPOCH
	const sourceDateEpoch =
		epochValue === undefined
			? Math.floor(now.getTime() / 1000)
			: Number(epochValue)
	const publicationEpoch =
		parsed.values["publication-epoch"] === undefined
			? Math.floor(now.getTime() / 1000)
			: Number(parsed.values["publication-epoch"])

	const options: BuildOptions = {
		version: requiredOption(parsed.values, "version"),
		inputDir:
			typeof parsed.values["input-dir"] === "string"
				? resolve(parsed.values["input-dir"])
				: undefined,
		packageSourceDir:
			typeof parsed.values["package-source-dir"] === "string"
				? resolve(parsed.values["package-source-dir"])
				: undefined,
		packageSourceManifest:
			typeof parsed.values["package-source-manifest"] === "string"
				? resolve(parsed.values["package-source-manifest"])
				: undefined,
		outputDir: resolve(requiredOption(parsed.values, "output-dir")),
		baseUrl: requiredOption(parsed.values, "base-url").replace(/\/+$/, ""),
		suite: requiredOption(parsed.values, "suite"),
		component: requiredOption(parsed.values, "component"),
		aptGpgPrimaryFingerprint: requiredOption(
			parsed.values,
			"apt-gpg-primary-fingerprint",
		).toUpperCase(),
		aptGpgSigningFingerprint: requiredOption(
			parsed.values,
			"apt-gpg-signing-fingerprint",
		).toUpperCase(),
		aptGpgPublicKey: resolve(
			requiredOption(parsed.values, "apt-gpg-public-key"),
		),
		rpmGpgPrimaryFingerprint: requiredOption(
			parsed.values,
			"rpm-gpg-primary-fingerprint",
		).toUpperCase(),
		rpmGpgSigningFingerprint: requiredOption(
			parsed.values,
			"rpm-gpg-signing-fingerprint",
		).toUpperCase(),
		rpmGpgPublicKey: resolve(
			requiredOption(parsed.values, "rpm-gpg-public-key"),
		),
		apkPublicKey: resolve(requiredOption(parsed.values, "apk-public-key")),
		apkKeyName: requiredOption(parsed.values, "apk-key-name"),
		sourceDateEpoch,
		publicationEpoch,
		dryRun: parsed.values["dry-run"] ?? false,
	}
	validateOptions(options)
	assertCurrentPublicationEpoch(
		options.publicationEpoch,
		Math.floor(now.getTime() / 1000),
	)
	return options
}

export const assertCurrentPublicationEpoch = (
	publicationEpoch: number,
	nowEpoch = Math.floor(Date.now() / 1000),
): void => {
	if (publicationEpoch < nowEpoch - 60 * 60 || publicationEpoch > nowEpoch + 5 * 60) {
		throw new Error("publication-epoch must be within one hour of the runner's current UTC time")
	}
}

export const validateOptions = (options: BuildOptions): void => {
	if (!VERSION_PATTERN.test(options.version)) {
		throw new Error(`Invalid semantic version: ${options.version}`)
	}
	if ((options.inputDir === undefined) === (options.packageSourceDir === undefined)) {
		throw new Error("Choose exactly one of --input-dir or --package-source-dir")
	}
	if (
		(options.packageSourceDir === undefined) !==
		(options.packageSourceManifest === undefined)
	) {
		throw new Error(
			"--package-source-dir and --package-source-manifest must be provided together",
		)
	}
	for (const [label, value] of [
		["suite", options.suite],
		["component", options.component],
	] as const) {
		if (
			!REPOSITORY_NAME_PATTERN.test(value) ||
			value === "." ||
			value === ".."
		) {
			throw new Error(`Invalid repository ${label}: ${value}`)
		}
	}
	if (
		!APK_KEY_NAME_PATTERN.test(options.apkKeyName) ||
		options.apkKeyName === "." ||
		options.apkKeyName === ".."
	) {
		throw new Error(`Invalid APK key name: ${options.apkKeyName}`)
	}
	for (const [label, fingerprint] of [
		["APT primary", options.aptGpgPrimaryFingerprint],
		["APT signing", options.aptGpgSigningFingerprint],
		["RPM primary", options.rpmGpgPrimaryFingerprint],
		["RPM signing", options.rpmGpgSigningFingerprint],
	] as const) {
		if (!OPENPGP_FINGERPRINT_PATTERN.test(fingerprint)) {
			throw new Error(
				`${label} key ID must be a full 40-hex OpenPGP v4 signing-subkey fingerprint`,
			)
		}
	}
	if (!Number.isSafeInteger(options.sourceDateEpoch) || options.sourceDateEpoch < 0) {
		throw new Error("source-date-epoch must be a non-negative integer")
	}
	if (!Number.isSafeInteger(options.publicationEpoch) || options.publicationEpoch < 0) {
		throw new Error("publication-epoch must be a non-negative integer")
	}
	let baseUrl: URL
	try {
		baseUrl = new URL(options.baseUrl)
	} catch {
		throw new Error(`Invalid base URL: ${options.baseUrl}`)
	}
	if (
		baseUrl.protocol !== "https:" ||
		(baseUrl.pathname !== "" && baseUrl.pathname !== "/") ||
		baseUrl.search !== "" ||
		baseUrl.hash !== ""
	) {
		throw new Error("base-url must be an HTTPS origin without a path, query, or hash")
	}
}

export const createBuildPlan = (options: BuildOptions) => ({
	schemaVersion: 1,
	nfpmVersion: NFPM_VERSION,
	mode: options.packageSourceDir === undefined ? "build-packages" : "refresh-metadata",
	inputs:
		options.inputDir === undefined
			? [options.packageSourceDir, options.packageSourceManifest]
			: ARCHITECTURES.flatMap((architecture) => [
					join(options.inputDir as string, `dotenc-linux-${architecture.input}`),
					join(
						options.inputDir as string,
						`dotenc-linux-${architecture.input}-musl`,
					),
				]),
	output: {
		publicRoot: join(options.outputDir, "public"),
		manifest: join(options.outputDir, "publication-manifest.json"),
	},
	publicationEpoch: options.publicationEpoch,
	requiredSecretFiles:
		options.packageSourceDir === undefined
			? ["NFPM_RPM_KEY_FILE", "NFPM_APK_KEY_FILE"]
			: ["NFPM_APK_KEY_FILE"],
	requiredTools: Object.fromEntries(
		Object.entries(TOOL_COMMANDS).map(([name, value]) => [
			name,
			{ defaultCommand: value.command, overrideEnvironment: value.override },
		]),
	),
	packagePaths: ARCHITECTURES.flatMap((architecture) => [
		`apt/pool/${options.component}/d/dotenc/dotenc_${options.version}-1_${architecture.deb}.deb`,
		`rpm/${architecture.rpm}/dotenc-${options.version}-1.${architecture.rpm}.rpm`,
		`apk/${options.suite}/${options.component}/${architecture.apk}/dotenc-${options.version}-r0.apk`,
	]),
	signing: {
		apt: `${options.aptGpgSigningFingerprint}!`,
		rpmMetadata: `${options.rpmGpgSigningFingerprint}!`,
		rpmPackageKeyId: options.rpmGpgSigningFingerprint.slice(-16),
		apkPackage: "abuild RSA256 over the apk-tools v2 control stream",
		apkIndex: "abuild-sign RSA256",
	},
})

const isMissingFileError = (error: unknown): boolean =>
	(error as NodeJS.ErrnoException).code === "ENOENT"

const assertRegularFile = async (
	path: string,
	label: string,
	secret = false,
): Promise<void> => {
	let fileStat
	try {
		fileStat = await lstat(path)
	} catch (error) {
		if (isMissingFileError(error)) throw new Error(`${label} does not exist: ${path}`)
		throw error
	}
	if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
		throw new Error(`${label} must be a regular, non-symlink file: ${path}`)
	}
	if (secret && process.platform !== "win32" && (fileStat.mode & 0o077) !== 0) {
		throw new Error(`${label} must not be accessible by group or other users: ${path}`)
	}
}

const assertPrivateDirectory = async (path: string, label: string): Promise<void> => {
	let directoryStat
	try {
		directoryStat = await lstat(path)
	} catch (error) {
		if (isMissingFileError(error)) throw new Error(`${label} does not exist: ${path}`)
		throw error
	}
	if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
		throw new Error(`${label} must be a non-symlink directory: ${path}`)
	}
	if (process.platform !== "win32" && (directoryStat.mode & 0o077) !== 0) {
		throw new Error(`${label} must not be accessible by group or other users: ${path}`)
	}
}

const requiredEnvironmentPath = (name: string): string => {
	const value = process.env[name]
	if (value === undefined || value === "") {
		throw new Error(`Missing required environment variable ${name}`)
	}
	return resolve(value)
}

const readOptionalSecretFile = async (name: string): Promise<Buffer | undefined> => {
	const path = process.env[name]
	if (path === undefined || path === "") return undefined
	const resolvedPath = resolve(path)
	await assertRegularFile(resolvedPath, name, true)
	const contents = await readFile(resolvedPath)
	let end = contents.length
	while (end > 0 && (contents[end - 1] === 0x0a || contents[end - 1] === 0x0d)) {
		end -= 1
	}
	const value = Buffer.from(contents.subarray(0, end))
	contents.fill(0)
	if (value.length === 0) throw new Error(`${name} cannot be empty`)
	return value
}

const assertArmoredPublicKey = async (path: string, label: string): Promise<void> => {
	await assertRegularFile(path, label)
	const contents = await readFile(path, "utf8")
	if (
		!contents.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----") ||
		contents.includes("PRIVATE KEY")
	) {
		throw new Error(`${label} must contain only an ASCII-armored OpenPGP public key`)
	}
}

type OpenPgpKeyRecord = {
	type: "pub" | "sub"
	validity: string
	bits: number
	algorithm: number
	expires: number
	capabilities: string
	fingerprint: string
}

export const parseOpenPgpKeyListing = (listing: string): OpenPgpKeyRecord[] => {
	const records: OpenPgpKeyRecord[] = []
	let pending: Omit<OpenPgpKeyRecord, "fingerprint"> | undefined
	for (const line of listing.split("\n")) {
		const fields = line.split(":")
		if (fields[0] === "pub" || fields[0] === "sub") {
			pending = {
				type: fields[0],
				validity: fields[1] ?? "",
				bits: Number(fields[2] ?? 0),
				algorithm: Number(fields[3] ?? 0),
				expires: Number(fields[6] ?? 0),
				capabilities: fields[11] ?? "",
			}
		} else if (fields[0] === "fpr" && pending !== undefined) {
			records.push({ ...pending, fingerprint: fields[9] ?? "" })
			pending = undefined
		}
	}
	return records
}

const validateOpenPgpCertificate = async (
	runner: CommandRunner,
	path: string,
	label: string,
	primaryFingerprint: string,
	signingFingerprint: string,
	publicationEpoch: number,
	homeDirectory: string,
	environment: NodeJS.ProcessEnv,
): Promise<void> => {
	await mkdir(homeDirectory, { recursive: true, mode: 0o700 })
	const listing = await runner.capture(
		toolCommand("gpg"),
		[
			"--homedir",
			homeDirectory,
			"--no-options",
			"--no-autostart",
			"--batch",
			"--with-colons",
			"--import-options",
			"show-only",
			"--import",
			path,
		],
		{ env: environment },
	)
	const records = parseOpenPgpKeyListing(listing)
	const primaryKeys = records.filter((record) => record.type === "pub")
	if (primaryKeys.length !== 1) {
		throw new Error(`${label} public certificate must contain exactly one primary key`)
	}
	const primary = primaryKeys[0]
	if (primary?.fingerprint !== primaryFingerprint) {
		throw new Error(`${label} public certificate does not match its primary fingerprint`)
	}
	const unusableValidity = new Set(["d", "e", "i", "r"])
	const minimumExpiry = publicationEpoch + 30 * 24 * 60 * 60
	const assertUsableRsa4096 = (record: OpenPgpKeyRecord, recordLabel: string) => {
		if (
			unusableValidity.has(record.validity) ||
			(record.expires !== 0 && record.expires < minimumExpiry)
		) {
			throw new Error(
				`${recordLabel} is revoked, disabled, invalid, or has less than 30 days remaining`,
			)
		}
		if (![1, 3].includes(record.algorithm) || record.bits < 4096) {
			throw new Error(`${recordLabel} must be an OpenPGP v4 RSA-4096 key`)
		}
	}
	assertUsableRsa4096(primary, `${label} primary key`)
	const signingSubkeys = records.filter(
		(record) =>
			record.type === "sub" &&
			record.capabilities.includes("s") &&
			!unusableValidity.has(record.validity) &&
			(record.expires === 0 || record.expires > publicationEpoch),
	)
	if (signingSubkeys.length !== 1) {
		throw new Error(`${label} certificate must have exactly one usable signing subkey`)
	}
	const signingSubkey = signingSubkeys[0]
	if (signingSubkey?.fingerprint !== signingFingerprint) {
		throw new Error(`${label} signing fingerprint does not match its usable subkey`)
	}
	assertUsableRsa4096(signingSubkey, `${label} signing subkey`)
}

type SecretKeyRecord = {
	type: "sec" | "ssb"
	capabilities: string
	secretStorage: string
	fingerprint: string
}

export const parseSecretKeyListing = (listing: string): SecretKeyRecord[] => {
	const records: SecretKeyRecord[] = []
	let pending: Omit<SecretKeyRecord, "fingerprint"> | undefined
	for (const line of listing.split("\n")) {
		const fields = line.split(":")
		if (fields[0] === "sec" || fields[0] === "ssb") {
			pending = {
				type: fields[0],
				capabilities: fields[11] ?? "",
				secretStorage: fields[14] ?? "",
			}
		} else if (fields[0] === "fpr" && pending !== undefined) {
			records.push({ ...pending, fingerprint: fields[9] ?? "" })
			pending = undefined
		}
	}
	return records
}

const assertSecretSubkeyRecords = (
	records: SecretKeyRecord[],
	label: string,
	primaryFingerprint: string,
	signingFingerprint: string,
): void => {
	const primary = records.find(
		(record) => record.type === "sec" && record.fingerprint === primaryFingerprint,
	)
	if (primary?.secretStorage !== "#") {
		throw new Error(`${label} primary secret material must be offline (dummy stub only)`)
	}
	const usableSecrets = records.filter(
		(record) => record.type === "ssb" && record.secretStorage !== "#",
	)
	if (
		usableSecrets.length !== 1 ||
		usableSecrets[0]?.fingerprint !== signingFingerprint ||
		!usableSecrets[0].capabilities.includes("s")
	) {
		throw new Error(
			`${label} keyring must contain only the declared secret signing subkey`,
		)
	}
}

const validateSecretSubkeyLayout = async (
	runner: CommandRunner,
	label: "APT" | "RPM",
	primaryFingerprint: string,
	signingFingerprint: string,
	environment: NodeJS.ProcessEnv,
): Promise<void> => {
	const listing = await runner.capture(
		toolCommand("gpg"),
		[
			"--no-options",
			"--batch",
			"--with-colons",
			"--with-subkey-fingerprint",
			"--list-secret-keys",
			primaryFingerprint,
		],
		{ env: gpgSecretEnvironment(environment, label) },
	)
	assertSecretSubkeyRecords(
		parseSecretKeyListing(listing),
		label,
		primaryFingerprint,
		signingFingerprint,
	)
}

export type SecretSubkeyProtection = "encrypted" | "unencrypted"

export const inspectSecretSubkeyExportPackets = (
	packets: string,
): SecretSubkeyProtection => {
	const primaryPackets = packets.match(/^:secret key packet:/gm) ?? []
	const subkeyPackets = packets.match(/^:secret sub key packet:/gm) ?? []
	const primaryOffset = packets.indexOf(":secret key packet:")
	const subkeyOffset = packets.indexOf(":secret sub key packet:")
	if (
		primaryPackets.length !== 1 ||
		subkeyPackets.length !== 1 ||
		primaryOffset < 0 ||
		subkeyOffset <= primaryOffset
	) {
		throw new Error(
			"RPM secret export must contain a dummy offline primary and exactly one usable secret subkey",
		)
	}
	const primaryPacket = packets.slice(primaryOffset, subkeyOffset)
	const subkeyPacket = packets.slice(subkeyOffset)
	if (
		!primaryPacket.includes("gnu-dummy") ||
		subkeyPacket.includes("gnu-dummy")
	) {
		throw new Error(
			"RPM secret export must contain a dummy offline primary and exactly one usable secret subkey",
		)
	}
	const encrypted =
		/\bS2K\b|\bprotect (?:count|IV):|\[v4 protected\]/.test(subkeyPacket)
	const unencrypted =
		/^\s*checksum:/m.test(subkeyPacket) &&
		[2, 3, 4, 5].every((index) =>
			new RegExp(`^\\s*skey\\[${index}\\]:`, "m").test(subkeyPacket),
		)
	if (encrypted === unencrypted) {
		throw new Error(
			"RPM secret signing subkey protection could not be determined from its OpenPGP packets",
		)
	}
	return encrypted ? "encrypted" : "unencrypted"
}

export const assertSecretSubkeyExportPackets = (packets: string): void => {
	inspectSecretSubkeyExportPackets(packets)
}

const validateSecretSubkeyExport = async (
	runner: CommandRunner,
	path: string,
	homeDirectory: string,
	environment: NodeJS.ProcessEnv,
): Promise<SecretSubkeyProtection> => {
	await mkdir(homeDirectory, { recursive: true, mode: 0o700 })
	const packets = await runner.capture(
		toolCommand("gpg"),
		[
			"--homedir",
			homeDirectory,
			"--no-options",
			"--no-autostart",
			"--batch",
			"--list-packets",
			path,
		],
		{ env: environment },
	)
	return inspectSecretSubkeyExportPackets(packets)
}

const assertRsa4096 = (key: KeyObject, label: string): void => {
	if (key.asymmetricKeyType !== "rsa") throw new Error(`${label} must be RSA`)
	if (key.asymmetricKeyDetails?.modulusLength !== 4096) {
		throw new Error(`${label} must be exactly RSA-4096`)
	}
}

const assertApkPublicKey = async (path: string): Promise<KeyObject> => {
	await assertRegularFile(path, "APK public key")
	const contents = await readFile(path, "utf8")
	if (
		!contents.includes("PUBLIC KEY-----") ||
		contents.includes("PRIVATE KEY")
	) {
		throw new Error("APK public key must be an RSA public key in PEM format")
	}
	try {
		const key = createPublicKey(contents)
		assertRsa4096(key, "APK public key")
		return key
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("APK public key")) {
			throw error
		}
		throw new Error("APK public key is not a valid RSA public key")
	}
}

const assertUnencryptedApkPrivateKey = async (path: string): Promise<KeyObject> => {
	await assertRegularFile(path, "APK private key", true)
	const contents = await readFile(path, "utf8")
	if (
		!contents.includes("PRIVATE KEY-----") ||
		contents.includes("ENCRYPTED PRIVATE KEY") ||
		contents.includes("Proc-Type: 4,ENCRYPTED")
	) {
		throw new Error("APK private key must be an unencrypted RSA private key in PEM format")
	}
	try {
		const key = createPrivateKey(contents)
		assertRsa4096(key, "APK private key")
		return key
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("APK private key")) {
			throw error
		}
		throw new Error("APK private key must be an unencrypted RSA private key in PEM format")
	}
}

const assertApkKeyPair = async (
	publicKeyPath: string,
	privateKeyPath: string,
	keyName: string,
): Promise<void> => {
	const [publicKey, privateKey] = await Promise.all([
		assertApkPublicKey(publicKeyPath),
		assertUnencryptedApkPrivateKey(privateKeyPath),
	])
	const publicDer = publicKey.export({ type: "spki", format: "der" })
	const derivedPublicDer = createPublicKey(privateKey).export({
		type: "spki",
		format: "der",
	})
	if (!publicDer.equals(derivedPublicDer)) {
		throw new Error("APK public and private keys do not match")
	}
	const expectedKeyName = `dotenc-${createHash("sha256").update(publicDer).digest("hex")}`
	if (keyName !== expectedKeyName) {
		throw new Error(
			`APK key name must be the SHA-256 fingerprint of the public SPKI DER: ${expectedKeyName}`,
		)
	}
}

const ensureFreshOutputDirectory = async (path: string): Promise<void> => {
	try {
		await lstat(path)
		throw new Error(`Output directory already exists; refusing to overwrite it: ${path}`)
	} catch (error) {
		if (!isMissingFileError(error)) throw error
	}
	await mkdir(path, { recursive: true, mode: 0o755 })
}

export const assertNfpmVersion = (output: string): void => {
	const match =
		output.match(/\bnfpm(?: version)?[\s:]+v?(\d+\.\d+\.\d+)\b/i) ??
		output.match(/^\s*GitVersion:\s*v?(\d+\.\d+\.\d+)\s*$/im)
	if (match?.[1] !== NFPM_VERSION) {
		throw new Error(
			`Expected nFPM ${NFPM_VERSION}, received: ${output.trim() || "unknown version"}`,
		)
	}
}

const CHILD_ENVIRONMENT_ALLOWLIST = [
	"PATH",
	"HOME",
	"TMPDIR",
	"RUNNER_TEMP",
	"GITHUB_WORKSPACE",
	"DOCKER_HOST",
	"DOCKER_CONFIG",
	"DOTENC_APK_TOOLS_CONTAINER",
] as const

const commonEnvironment = (sourceDateEpoch: number): NodeJS.ProcessEnv => {
	const environment: NodeJS.ProcessEnv = {
		LC_ALL: "C",
		TZ: "UTC",
		SOURCE_DATE_EPOCH: String(sourceDateEpoch),
	}
	for (const name of CHILD_ENVIRONMENT_ALLOWLIST) {
		if (process.env[name] !== undefined) environment[name] = process.env[name]
	}
	return environment
}

const gpgSecretEnvironment = (
	base: NodeJS.ProcessEnv,
	purpose: "APT" | "RPM",
): NodeJS.ProcessEnv => {
	const home =
		process.env[`DOTENC_${purpose}_GNUPGHOME`] ?? process.env.GNUPGHOME
	if (home === undefined || home === "") {
		throw new Error(
			`Set DOTENC_${purpose}_GNUPGHOME (or GNUPGHOME) to the subkey-only signing keyring`,
		)
	}
	return {
		...base,
		GNUPGHOME: home,
		...(process.env.GPG_TTY === undefined ? {} : { GPG_TTY: process.env.GPG_TTY }),
	}
}

const gpgSigningArgs = (
	fingerprint: string,
	passphraseFileEnvironment: string,
): string[] => {
	const args = ["--no-options", "--batch", "--yes", "--no-tty"]
	const passphraseFile = process.env[passphraseFileEnvironment]
	if (passphraseFile !== undefined && passphraseFile !== "") {
		args.push("--pinentry-mode", "loopback", "--passphrase-file", resolve(passphraseFile))
	}
	args.push(
		"--local-user",
		`${fingerprint}!`,
		"--digest-algo",
		"SHA256",
	)
	return args
}

const signGpg = async (
	runner: CommandRunner,
	input: string,
	output: string,
	purpose: "APT" | "RPM",
	fingerprint: string,
	passphraseFileEnvironment: string,
	clearSign: boolean,
	environment: NodeJS.ProcessEnv,
): Promise<void> => {
	const args = gpgSigningArgs(fingerprint, passphraseFileEnvironment)
	if (clearSign) {
		args.push("--clearsign")
	} else {
		args.push("--armor", "--detach-sign")
	}
	args.push("--output", output, input)
	await runner.run(toolCommand("gpg"), args, {
		env: gpgSecretEnvironment(environment, purpose),
	})
}

export const assertGpgPassphraseChangeStatus = (status: string): void => {
	const lines = status.split("\n")
	const successes = lines.filter(
		(line) => line === "[GNUPG:] SUCCESS keyedit.passwd",
	)
	const prompts = lines.filter((line) =>
		line.startsWith("[GNUPG:] GET_HIDDEN passphrase.enter"),
	)
	const acceptedPrompts = lines.filter((line) => line === "[GNUPG:] GOT_IT")
	if (
		successes.length !== 1 ||
		prompts.length !== 2 ||
		acceptedPrompts.length !== 2 ||
		lines.some((line) =>
			/^\[GNUPG:\] (?:BAD_PASSPHRASE|MISSING_PASSPHRASE|ERROR)\b/.test(line),
		)
	) {
		throw new Error(
			"RPM GPG passphrase did not unlock the exact signing subkey for transient nFPM staging",
		)
	}
}

const scrubDirectory = async (directory: string): Promise<void> => {
	let entries
	try {
		entries = await readdir(directory, { withFileTypes: true })
	} catch (error) {
		if (isMissingFileError(error)) return
		throw error
	}
	for (const entry of entries) {
		const path = join(directory, entry.name)
		if (entry.isDirectory()) {
			await scrubDirectory(path)
		} else if (entry.isFile()) {
			const fileStat = await lstat(path)
			if (fileStat.size > 0) {
				await writeFile(path, Buffer.alloc(Number(fileStat.size)), { flag: "r+" })
			}
		}
	}
	await rm(directory, { recursive: true, force: true })
}

type PreparedNfpmRpmKey = {
	path: string
	cleanup: () => Promise<void>
}

const prepareNfpmRpmKey = async (
	runner: CommandRunner,
	sourceKey: string,
	primaryFingerprint: string,
	signingFingerprint: string,
	protection: SecretSubkeyProtection,
	passphrase: Buffer | undefined,
	gpgHomeRoot: string,
	secretScratchRoot: string,
	environment: NodeJS.ProcessEnv,
): Promise<PreparedNfpmRpmKey> => {
	if (protection === "unencrypted" && passphrase !== undefined) {
		throw new Error(
			"DOTENC_RPM_GPG_PASSPHRASE_FILE was provided for an unencrypted RPM signing subkey",
		)
	}
	if (protection === "encrypted" && passphrase === undefined) {
		throw new Error(
			"DOTENC_RPM_GPG_PASSPHRASE_FILE is required for the encrypted RPM signing subkey",
		)
	}
	if (
		passphrase !== undefined &&
		(passphrase.includes(0x0a) || passphrase.includes(0x0d))
	) {
		throw new Error("RPM GPG passphrase must contain exactly one line")
	}

	const stagingRoot = join(secretScratchRoot, "nfpm-rpm-secret")
	const stagingHome = join(stagingRoot, "gnupg")
	const inspectionHome = join(stagingRoot, "inspect-gnupg")
	const probeInput = join(stagingRoot, "passphrase-probe")
	const probeSignature = join(stagingRoot, "passphrase-probe.asc")
	const commandInput = join(stagingRoot, "change-passphrase.input")
	const stagedKey = join(stagingRoot, "rpm.secret-subkeys.unprotected.asc")
	let cleaned = false
	let stagingCreated = false
	const cleanup = async (): Promise<void> => {
		if (cleaned) return
		if (!stagingCreated) {
			cleaned = true
			return
		}
		const cleanupErrors: unknown[] = []
		for (const home of [stagingHome, inspectionHome]) {
			try {
				await runner.run(
					toolCommand("gpgconf"),
					["--homedir", home, "--kill", "gpg-agent"],
					{ env: environment },
				)
			} catch (error) {
				cleanupErrors.push(error)
			}
		}
		try {
			await scrubDirectory(stagingRoot)
		} catch (error) {
			cleanupErrors.push(error)
		}
		if (cleanupErrors.length > 0) {
			throw new AggregateError(
				cleanupErrors,
				"Unable to fully clean the transient RPM signing material",
			)
		}
		cleaned = true
	}

	try {
		await mkdir(stagingRoot, { mode: 0o700 })
		stagingCreated = true
		await mkdir(stagingHome, { mode: 0o700 })
		await mkdir(inspectionHome, { mode: 0o700 })
		const validateNfpmKeyIdentity = async (keyPath: string): Promise<void> => {
			await runner.run(
				toolCommand("gpg"),
				[
					"--homedir",
					inspectionHome,
					"--no-options",
					"--batch",
					"--no-tty",
					"--quiet",
					"--import",
					keyPath,
				],
				{ env: environment },
			)
			const listing = await runner.capture(
				toolCommand("gpg"),
				[
					"--homedir",
					inspectionHome,
					"--no-options",
					"--batch",
					"--with-colons",
					"--with-subkey-fingerprint",
					"--list-secret-keys",
					primaryFingerprint,
				],
				{ env: environment },
			)
			assertSecretSubkeyRecords(
				parseSecretKeyListing(listing),
				"nFPM RPM",
				primaryFingerprint,
				signingFingerprint,
			)
		}
		if (protection === "unencrypted") {
			await validateNfpmKeyIdentity(sourceKey)
			return { path: sourceKey, cleanup }
		}
		if (passphrase === undefined) {
			throw new Error("Encrypted RPM signing subkey passphrase was not loaded")
		}
		await writeFile(probeInput, "dotenc nFPM RPM signing-subkey probe\n", {
			mode: 0o600,
		})
		try {
			await signGpg(
				runner,
				probeInput,
				probeSignature,
				"RPM",
				signingFingerprint,
				"DOTENC_RPM_GPG_PASSPHRASE_FILE",
				false,
				environment,
			)
		} catch (error) {
			throw new Error(
				"RPM GPG passphrase did not unlock the exact signing subkey",
				{ cause: error },
			)
		}

		await runner.run(
			toolCommand("gpg"),
			[
				"--homedir",
				stagingHome,
				"--no-options",
				"--batch",
				"--no-tty",
				"--quiet",
				"--import",
				sourceKey,
			],
			{ env: environment },
		)
		const commandSequence = Buffer.alloc(passphrase.length + 2, 0x0a)
		passphrase.copy(commandSequence)
		try {
			await writeFile(commandInput, commandSequence, { mode: 0o600 })
		} finally {
			commandSequence.fill(0)
		}
		let status: string
		try {
			status = await runner.capture(
				toolCommand("gpg"),
				[
					"--homedir",
					stagingHome,
					"--no-options",
					"--batch",
					"--yes",
					"--no-tty",
					"--pinentry-mode",
					"loopback",
					"--passphrase-repeat",
					"0",
					"--status-fd",
					"1",
					"--command-fd",
					"0",
					"--change-passphrase",
					primaryFingerprint,
				],
				{
					env: environment,
					stdinFile: commandInput,
					stderr: "ignore",
					acceptedExitCodes: [0, 2],
				},
			)
		} finally {
			const commandInputStat = await lstat(commandInput)
			if (commandInputStat.size > 0) {
				await writeFile(
					commandInput,
					Buffer.alloc(Number(commandInputStat.size)),
					{ flag: "r+" },
				)
			}
			await rm(commandInput)
		}
		assertGpgPassphraseChangeStatus(status)

		await runner.run(
			toolCommand("gpg"),
			[
				"--homedir",
				stagingHome,
				"--no-options",
				"--batch",
				"--yes",
				"--no-tty",
				"--pinentry-mode",
				"loopback",
				"--passphrase",
				"",
				"--armor",
				"--output",
				stagedKey,
				"--export-secret-subkeys",
				`${signingFingerprint}!`,
			],
			{ env: environment },
		)
		await chmod(stagedKey, 0o600)
		const stagedProtection = await validateSecretSubkeyExport(
			runner,
			stagedKey,
			join(gpgHomeRoot, "inspect-nfpm-rpm-export"),
			environment,
		)
		if (stagedProtection !== "unencrypted") {
			throw new Error(
				"Transient nFPM RPM export must contain one unencrypted signing subkey",
			)
		}

		await validateNfpmKeyIdentity(stagedKey)
		return { path: stagedKey, cleanup }
	} catch (error) {
		try {
			await cleanup()
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Unable to prepare and fully clean the transient RPM signing material",
			)
		}
		throw error
	}
}

export type OpenPgpCertificateDigests = {
	apt: string
	rpm: string
}

export const immutableOpenPgpKeyFilename = (
	purpose: "apt" | "rpm",
	primaryFingerprint: string,
	certificateSha256: string,
): string =>
	`dotenc-${purpose}-${primaryFingerprint}-${certificateSha256}.asc`

export const renderRepositoryConfigs = (
	options: BuildOptions,
	certificateDigests: OpenPgpCertificateDigests,
) => ({
	apt: `# Install ${options.baseUrl}/keys/${immutableOpenPgpKeyFilename("apt", options.aptGpgPrimaryFingerprint, certificateDigests.apt)} as /etc/apt/keyrings/dotenc.asc first.
Types: deb
URIs: ${options.baseUrl}/apt
Suites: ${options.suite}
Components: ${options.component}
Signed-By: /etc/apt/keyrings/dotenc.asc
`,
	rpm: `[dotenc]
name=dotenc
baseurl=${options.baseUrl}/rpm/$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=${options.baseUrl}/keys/${immutableOpenPgpKeyFilename("rpm", options.rpmGpgPrimaryFingerprint, certificateDigests.rpm)}
sslverify=1
`,
	apk: `# Install ${options.baseUrl}/keys/${options.apkKeyName}.rsa.pub as /etc/apk/keys/${options.apkKeyName}.rsa.pub first.
${options.baseUrl}/apk/${options.suite}/${options.component}
`,
})

const createAptByHash = async (indexFile: string): Promise<void> => {
	const digest = await sha256File(indexFile)
	const targetDirectory = join(dirname(indexFile), "by-hash", "SHA256")
	await mkdir(targetDirectory, { recursive: true, mode: 0o755 })
	await copyFile(indexFile, join(targetDirectory, digest))
}

const buildAptRepository = async (
	options: BuildOptions,
	publicRoot: string,
	stagingRoot: string,
	runner: CommandRunner,
	environment: NodeJS.ProcessEnv,
): Promise<void> => {
	const aptRoot = join(publicRoot, "apt")
	const releaseDirectory = join(aptRoot, "dists", options.suite)
	for (const architecture of ARCHITECTURES) {
		const indexDirectory = join(
			releaseDirectory,
			options.component,
			`binary-${architecture.deb}`,
		)
		await mkdir(indexDirectory, { recursive: true, mode: 0o755 })
		const packagesFile = join(indexDirectory, "Packages")
		const packagesGzipFile = `${packagesFile}.gz`
		await runner.run(
			toolCommand("aptFtparchive"),
			[
				"-o",
				"APT::FTPArchive::Packages::MD5=false",
				"-o",
				"APT::FTPArchive::Packages::SHA1=false",
				`--arch=${architecture.deb}`,
				"packages",
				`pool/${options.component}`,
			],
			{ cwd: aptRoot, env: environment, stdoutFile: packagesFile },
		)
		await runner.run(toolCommand("gzip"), ["-n", "-9", "-c", packagesFile], {
			cwd: aptRoot,
			env: environment,
			stdoutFile: packagesGzipFile,
		})
	}

	const releaseStagingDirectory = join(stagingRoot, "apt")
	await mkdir(releaseStagingDirectory, { recursive: true, mode: 0o700 })
	const releaseFile = join(releaseStagingDirectory, "Release")
	const releaseDate = new Date(options.publicationEpoch * 1000).toUTCString()
	const validUntil = new Date(
		(options.publicationEpoch + APT_VALID_SECONDS) * 1000,
	).toUTCString()
	// apt-ftparchive only creates the field when ValidTime is nonzero. The
	// explicit value then anchors it to the validated publication clock.
	await runner.run(
		toolCommand("aptFtparchive"),
		[
			"-o",
			"APT::FTPArchive::Release::Origin=dotenc",
			"-o",
			"APT::FTPArchive::Release::Label=dotenc",
			"-o",
			`APT::FTPArchive::Release::Suite=${options.suite}`,
			"-o",
			`APT::FTPArchive::Release::Codename=${options.suite}`,
			"-o",
			"APT::FTPArchive::Release::Architectures=amd64 arm64",
			"-o",
			`APT::FTPArchive::Release::Components=${options.component}`,
			"-o",
			"APT::FTPArchive::Release::Acquire-By-Hash=yes",
			"-o",
			"APT::FTPArchive::Release::MD5=false",
			"-o",
			"APT::FTPArchive::Release::SHA1=false",
			"-o",
			`APT::FTPArchive::Release::Signed-By=${options.aptGpgPrimaryFingerprint}`,
			"-o",
			`APT::FTPArchive::Release::Date=${releaseDate}`,
			"-o",
			`APT::FTPArchive::Release::ValidTime=${APT_VALID_SECONDS}`,
			"-o",
			`APT::FTPArchive::Release::Valid-Until=${validUntil}`,
			"-o",
			"APT::FTPArchive::Release::Description=dotenc stable packages",
			"release",
			`dists/${options.suite}`,
		],
		{ cwd: aptRoot, env: environment, stdoutFile: releaseFile },
	)

	for (const architecture of ARCHITECTURES) {
		const indexDirectory = join(
			releaseDirectory,
			options.component,
			`binary-${architecture.deb}`,
		)
		await createAptByHash(join(indexDirectory, "Packages"))
		await createAptByHash(join(indexDirectory, "Packages.gz"))
	}

	await signGpg(
		runner,
		releaseFile,
		join(releaseDirectory, "InRelease"),
		"APT",
		options.aptGpgSigningFingerprint,
		"DOTENC_APT_GPG_PASSPHRASE_FILE",
		true,
		environment,
	)
}

const buildRpmRepositories = async (
	options: BuildOptions,
	publicRoot: string,
	runner: CommandRunner,
	environment: NodeJS.ProcessEnv,
): Promise<void> => {
	for (const architecture of ARCHITECTURES) {
		const rpmRoot = join(publicRoot, "rpm", architecture.rpm)
		await runner.run(
			toolCommand("createrepo"),
			[
				"--checksum",
				"sha256",
				"--revision",
				String(options.publicationEpoch),
				"--unique-md-filenames",
				".",
			],
			{ cwd: rpmRoot, env: environment },
		)
		const repomd = join(rpmRoot, "repodata", "repomd.xml")
		await signGpg(
			runner,
			repomd,
			`${repomd}.asc`,
			"RPM",
			options.rpmGpgSigningFingerprint,
			"DOTENC_RPM_GPG_PASSPHRASE_FILE",
			false,
			environment,
		)
	}
}

const buildApkRepositories = async (
	options: BuildOptions,
	publicRoot: string,
	runner: CommandRunner,
	environment: NodeJS.ProcessEnv,
	apkPrivateKey: string,
): Promise<void> => {
	for (const architecture of ARCHITECTURES) {
		const apkRoot = join(
			publicRoot,
			"apk",
			options.suite,
			options.component,
			architecture.apk,
		)
		const apkPackage = join(apkRoot, `dotenc-${options.version}-r0.apk`)
		const apkIndex = join(apkRoot, "APKINDEX.tar.gz")
		await runner.run(
			toolCommand("apk"),
			[
				"--allow-untrusted",
				"index",
				"--output",
				apkIndex,
				"--description",
				"dotenc stable repository",
				apkPackage,
			],
			{ cwd: apkRoot, env: environment },
		)
		await runner.run(
			toolCommand("abuildSign"),
			[
				"-q",
				"-t",
				"RSA256",
				"-k",
				apkPrivateKey,
				"-p",
				`${options.apkKeyName}.rsa.pub`,
				apkIndex,
			],
			{ cwd: apkRoot, env: environment },
		)
	}
}

export const assertGpgvStatus = (
	status: string,
	signingFingerprint: string,
	primaryFingerprint: string,
	label: string,
): void => {
	const validSignature = status
		.split("\n")
		.find((line) => line.startsWith("[GNUPG:] VALIDSIG "))
	if (validSignature === undefined) {
		throw new Error(`${label} did not produce a GPG VALIDSIG status`)
	}
	const fields = validSignature.split(/\s+/)
	const actualSigningFingerprint = fields[2]
	const actualPrimaryFingerprint = fields.at(-1)
	if (
		actualSigningFingerprint !== signingFingerprint ||
		actualPrimaryFingerprint !== primaryFingerprint
	) {
		throw new Error(`${label} was not signed by the declared signing identity`)
	}
}

export const assertRpmSignatureStatus = (
	status: string,
	signingFingerprint: string,
	label: string,
): void => {
	const keyIds = [
		...status.matchAll(
			/\bRSA\/SHA(?:256|512)\b[^\r\n]*\bkey (?:ID|fingerprint) ([a-f0-9]{8,40})[^\r\n]*:\s*OK\b/gi,
		),
	]
		.map((match) => match[1]?.toUpperCase())
		.filter((keyId): keyId is string => keyId !== undefined)
	if (
		keyIds.length < 1 ||
		!keyIds.some((keyId) => signingFingerprint.endsWith(keyId))
	) {
		throw new Error(
			`${label} does not have a valid signature from the declared RPM subkey`,
		)
	}
}

const verifyGpgSignature = async (
	runner: CommandRunner,
	publicKey: string,
	signedFile: string,
	signature: string | undefined,
	signingFingerprint: string,
	primaryFingerprint: string,
	label: string,
	homeDirectory: string,
	environment: NodeJS.ProcessEnv,
): Promise<void> => {
	await mkdir(homeDirectory, { recursive: true, mode: 0o700 })
	const keyring = join(homeDirectory, "trustedkeys.gpg")
	await runner.run(
		toolCommand("gpg"),
		[
			"--homedir",
			homeDirectory,
			"--no-options",
			"--no-autostart",
			"--batch",
			"--yes",
			"--dearmor",
			"--output",
			keyring,
			publicKey,
		],
		{ env: environment },
	)
	const args = [
		"--homedir",
		homeDirectory,
		"--status-fd",
		"1",
		"--keyring",
		keyring,
	]
	if (signature === undefined) args.push(signedFile)
	else args.push(signature, signedFile)
	const status = await runner.capture(toolCommand("gpgv"), args, {
		env: environment,
	})
	assertGpgvStatus(status, signingFingerprint, primaryFingerprint, label)
}

const verifyDebPackages = async (
	options: BuildOptions,
	publicRoot: string,
	runner: CommandRunner,
	environment: NodeJS.ProcessEnv,
): Promise<void> => {
	for (const architecture of ARCHITECTURES) {
		const path = join(
			publicRoot,
			"apt",
			"pool",
			options.component,
			"d",
			"dotenc",
			`dotenc_${options.version}-1_${architecture.deb}.deb`,
		)
		for (const [field, expected] of [
			["Package", "dotenc"],
			["Version", `${options.version}-1`],
			["Architecture", architecture.deb],
		] as const) {
			const actual = await runner.capture(
				toolCommand("dpkgDeb"),
				["--field", path, field],
				{ env: environment },
			)
			if (actual.trim() !== expected) {
				throw new Error(`DEB ${field} mismatch for ${basename(path)}`)
			}
		}
	}
}

const verifyRpmPackages = async (
	options: BuildOptions,
	publicRoot: string,
	stagingRoot: string,
	runner: CommandRunner,
	environment: NodeJS.ProcessEnv,
): Promise<void> => {
	const rpmDatabase = join(stagingRoot, "rpmdb")
	await mkdir(rpmDatabase, { recursive: true, mode: 0o700 })
	await runner.run(
		toolCommand("rpm"),
		["--dbpath", rpmDatabase, "--import", options.rpmGpgPublicKey],
		{ env: environment },
	)
	for (const architecture of ARCHITECTURES) {
		const path = join(
			publicRoot,
			"rpm",
			architecture.rpm,
			`dotenc-${options.version}-1.${architecture.rpm}.rpm`,
		)
		const signatureStatus = await runner.capture(
			toolCommand("rpmkeys"),
			["--dbpath", rpmDatabase, "--checksig", "--verbose", path],
			{ env: environment },
		)
		assertRpmSignatureStatus(
			signatureStatus,
			options.rpmGpgSigningFingerprint,
			`RPM ${basename(path)}`,
		)
		const identity = await runner.capture(
			toolCommand("rpm"),
			[
				"--dbpath",
				rpmDatabase,
				"--query",
				"--package",
				"--queryformat",
				"%{NAME}\t%{VERSION}\t%{RELEASE}\t%{ARCH}\n",
				path,
			],
			{ env: environment },
		)
		const expected = `dotenc\t${options.version}\t1\t${architecture.rpm}`
		if (identity.trim() !== expected) {
			throw new Error(`RPM identity mismatch for ${basename(path)}`)
		}
	}
}

const verifyApkArtifacts = async (
	options: BuildOptions,
	publicRoot: string,
	stagingRoot: string,
	runner: CommandRunner,
	environment: NodeJS.ProcessEnv,
): Promise<void> => {
	const keysDirectory = join(stagingRoot, "apk-keys")
	await mkdir(keysDirectory, { recursive: true, mode: 0o700 })
	await copyFile(
		options.apkPublicKey,
		join(keysDirectory, `${options.apkKeyName}.rsa.pub`),
	)
	for (const architecture of ARCHITECTURES) {
		const apkRoot = join(
			publicRoot,
			"apk",
			options.suite,
			options.component,
			architecture.apk,
		)
		await runner.run(
			toolCommand("apk"),
			[
				"--keys-dir",
				keysDirectory,
				"verify",
				join(apkRoot, `dotenc-${options.version}-r0.apk`),
				join(apkRoot, "APKINDEX.tar.gz"),
			],
			{ cwd: apkRoot, env: environment },
		)
	}
}

const verifyPublishedArtifacts = async (
	options: BuildOptions,
	publicRoot: string,
	stagingRoot: string,
	gpgHomeRoot: string,
	runner: CommandRunner,
	environment: NodeJS.ProcessEnv,
): Promise<void> => {
	await verifyGpgSignature(
		runner,
		options.aptGpgPublicKey,
		join(publicRoot, "apt", "dists", options.suite, "InRelease"),
		undefined,
		options.aptGpgSigningFingerprint,
		options.aptGpgPrimaryFingerprint,
		"APT InRelease",
		join(gpgHomeRoot, "verify-apt"),
		environment,
	)
	for (const architecture of ARCHITECTURES) {
		const repomd = join(
			publicRoot,
			"rpm",
			architecture.rpm,
			"repodata",
			"repomd.xml",
		)
		await verifyGpgSignature(
			runner,
			options.rpmGpgPublicKey,
			repomd,
			`${repomd}.asc`,
			options.rpmGpgSigningFingerprint,
			options.rpmGpgPrimaryFingerprint,
			`RPM ${architecture.rpm} repomd.xml`,
			join(gpgHomeRoot, `verify-rpm-${architecture.rpm}`),
			environment,
		)
	}
	await verifyDebPackages(options, publicRoot, runner, environment)
	await verifyRpmPackages(options, publicRoot, stagingRoot, runner, environment)
	await verifyApkArtifacts(options, publicRoot, stagingRoot, runner, environment)
}

const buildNativePackages = async (
	options: BuildOptions,
	publicRoot: string,
	stagingRoot: string,
	runner: CommandRunner,
	environment: NodeJS.ProcessEnv,
	rpmPrivateKey: string,
	apkPrivateKey: string,
): Promise<void> => {
	const inputDir = options.inputDir
	if (inputDir === undefined) {
		throw new Error("inputDir is required when building native packages")
	}
	const aptPool = join(
		publicRoot,
		"apt",
		"pool",
		options.component,
		"d",
		"dotenc",
	)
	await mkdir(aptPool, { recursive: true, mode: 0o755 })

	for (const architecture of ARCHITECTURES) {
		const rpmRoot = join(publicRoot, "rpm", architecture.rpm)
		const apkRoot = join(
			publicRoot,
			"apk",
			options.suite,
			options.component,
			architecture.apk,
		)
		await mkdir(rpmRoot, { recursive: true, mode: 0o755 })
		await mkdir(apkRoot, { recursive: true, mode: 0o755 })

		const sharedEnvironment = {
			...environment,
			NFPM_ARCH: architecture.nfpm,
			NFPM_VERSION: options.version,
		}
		const glibcBinary = join(
			inputDir,
			`dotenc-linux-${architecture.input}`,
		)
		const muslBinary = join(
			inputDir,
			`dotenc-linux-${architecture.input}-musl`,
		)
		const debTarget = join(
			aptPool,
			`dotenc_${options.version}-1_${architecture.deb}.deb`,
		)
		const rpmTarget = join(
			rpmRoot,
			`dotenc-${options.version}-1.${architecture.rpm}.rpm`,
		)
		const apkTarget = join(apkRoot, `dotenc-${options.version}-r0.apk`)

		await runner.run(
			toolCommand("nfpm"),
			[
				"package",
				"--config",
				join(PACKAGING_DIR, "nfpm.deb.yaml"),
				"--packager",
				"deb",
				"--target",
				debTarget,
			],
			{
				env: {
					...sharedEnvironment,
					NFPM_BINARY: glibcBinary,
					NFPM_INSTALL_MARKER: join(
						PACKAGING_DIR,
						"assets",
						"install-method-apt",
					),
				},
			},
		)
		await runner.run(
			toolCommand("nfpm"),
			[
				"package",
				"--config",
				join(PACKAGING_DIR, "nfpm.rpm.yaml"),
				"--packager",
				"rpm",
				"--target",
				rpmTarget,
			],
			{
				env: {
					...sharedEnvironment,
					NFPM_BINARY: glibcBinary,
					NFPM_INSTALL_MARKER: join(
						PACKAGING_DIR,
						"assets",
						"install-method-rpm",
					),
					NFPM_RPM_KEY_FILE: rpmPrivateKey,
					NFPM_RPM_KEY_ID: options.rpmGpgSigningFingerprint.slice(-16),
				},
			},
		)
		await runner.run(
			toolCommand("nfpm"),
			[
				"package",
				"--config",
				join(PACKAGING_DIR, "nfpm.apk.yaml"),
				"--packager",
				"apk",
				"--target",
				apkTarget,
			],
			{
				env: {
					...sharedEnvironment,
					NFPM_BINARY: muslBinary,
					NFPM_INSTALL_MARKER: join(
						PACKAGING_DIR,
						"assets",
						"install-method-apk",
					),
				},
			},
		)

		const apkSigningDirectory = join(stagingRoot, "apk", architecture.apk)
		await mkdir(apkSigningDirectory, { recursive: true, mode: 0o700 })
		await runner.run(toolCommand("abuildGzsplit"), [], {
			cwd: apkSigningDirectory,
			env: sharedEnvironment,
			stdinFile: apkTarget,
		})
		try {
			await lstat(join(apkSigningDirectory, "signatures.tar.gz"))
			throw new Error("nFPM APK must be unsigned before RSA256 signing")
		} catch (error) {
			if (!isMissingFileError(error)) throw error
		}
		const controlArchive = join(apkSigningDirectory, "control.tar.gz")
		const dataArchive = join(apkSigningDirectory, "data.tar.gz")
		await assertRegularFile(controlArchive, "APK control archive")
		await assertRegularFile(dataArchive, "APK data archive")
		await runner.run(
			toolCommand("abuildSign"),
			[
				"-q",
				"-t",
				"RSA256",
				"-k",
				apkPrivateKey,
				"-p",
				`${options.apkKeyName}.rsa.pub`,
				controlArchive,
			],
			{ cwd: apkSigningDirectory, env: sharedEnvironment },
		)
		const [signedControl, packageData] = await Promise.all([
			readFile(controlArchive),
			readFile(dataArchive),
		])
		await writeFile(apkTarget, Buffer.concat([signedControl, packageData]), {
			mode: 0o644,
		})
	}
}

export const packageRelativePaths = (options: BuildOptions): string[] =>
	ARCHITECTURES.flatMap((architecture) => [
		posix.join(
			"apt",
			"pool",
			options.component,
			"d",
			"dotenc",
			`dotenc_${options.version}-1_${architecture.deb}.deb`,
		),
		posix.join(
			"rpm",
			architecture.rpm,
			`dotenc-${options.version}-1.${architecture.rpm}.rpm`,
		),
		posix.join(
			"apk",
			options.suite,
			options.component,
			architecture.apk,
			`dotenc-${options.version}-r0.apk`,
		),
	])

export type PackageBundleManifest = {
	schemaVersion: 1
	version: string
	suite: string
	component: string
	sourceDateEpoch: number
	packages: Array<{ path: string; sha256: string; size: number }>
}

export const createPackageBundleManifest = async (
	publicRoot: string,
	options: BuildOptions,
): Promise<PackageBundleManifest> => {
	const packages = []
	for (const path of packageRelativePaths(options).sort()) {
		const absolutePath = join(publicRoot, path)
		await assertRegularFile(absolutePath, `package bundle object ${path}`)
		const fileStat = await stat(absolutePath)
		packages.push({
			path,
			sha256: await sha256File(absolutePath),
			size: fileStat.size,
		})
	}
	return {
		schemaVersion: 1,
		version: options.version,
		suite: options.suite,
		component: options.component,
		sourceDateEpoch: options.sourceDateEpoch,
		packages,
	}
}

const readAndVerifyPackageSourceManifest = async (
	options: BuildOptions,
	runner: CommandRunner,
	verificationHome: string,
	environment: NodeJS.ProcessEnv,
): Promise<PackageBundleManifest> => {
	const sourceRoot = options.packageSourceDir
	const manifestPath = options.packageSourceManifest
	if (sourceRoot === undefined || manifestPath === undefined) {
		throw new Error("Package source directory and manifest are required for refresh")
	}
	await assertRegularFile(manifestPath, "package source manifest")
	const signaturePath = `${manifestPath}.asc`
	await assertRegularFile(signaturePath, "package source manifest signature")
	await verifyGpgSignature(
		runner,
		options.aptGpgPublicKey,
		manifestPath,
		signaturePath,
		options.aptGpgSigningFingerprint,
		options.aptGpgPrimaryFingerprint,
		"package bundle manifest",
		verificationHome,
		environment,
	)
	let parsed: unknown
	try {
		parsed = JSON.parse(await readFile(manifestPath, "utf8"))
	} catch {
		throw new Error("Package source manifest is not valid JSON")
	}
	const manifest = parsed as Partial<PackageBundleManifest>
	if (
		manifest.schemaVersion !== 1 ||
		manifest.version !== options.version ||
		manifest.suite !== options.suite ||
		manifest.component !== options.component ||
		manifest.sourceDateEpoch !== options.sourceDateEpoch ||
		!Array.isArray(manifest.packages)
	) {
		throw new Error("Package source manifest identity does not match this refresh")
	}
	const expectedPaths = packageRelativePaths(options).sort()
	const actualPaths = manifest.packages.map((entry) => entry.path).sort()
	if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
		throw new Error("Package source manifest must contain exactly the six expected packages")
	}
	for (const entry of manifest.packages) {
		if (
			typeof entry.path !== "string" ||
			!/^[a-f0-9]{64}$/.test(entry.sha256) ||
			!Number.isSafeInteger(entry.size) ||
			entry.size < 1
		) {
			throw new Error("Package source manifest contains an invalid package entry")
		}
		const source = join(sourceRoot, entry.path)
		await assertRegularFile(source, `package source ${entry.path}`)
		const fileStat = await stat(source)
		if (fileStat.size !== entry.size || (await sha256File(source)) !== entry.sha256) {
			throw new Error(`Package source digest mismatch: ${entry.path}`)
		}
	}
	return manifest as PackageBundleManifest
}

const copyExistingNativePackages = async (
	options: BuildOptions,
	publicRoot: string,
	gpgHomeRoot: string,
	runner: CommandRunner,
	environment: NodeJS.ProcessEnv,
): Promise<void> => {
	const sourceRoot = options.packageSourceDir
	const sourceManifest = options.packageSourceManifest
	if (sourceRoot === undefined || sourceManifest === undefined) {
		throw new Error("Package source directory and manifest are required for refresh")
	}
	const sourceBundle = await readAndVerifyPackageSourceManifest(
		options,
		runner,
		join(gpgHomeRoot, "verify-bundle-source"),
		environment,
	)
	for (const relativePath of packageRelativePaths(options)) {
		const source = join(sourceRoot, relativePath)
		const target = join(publicRoot, relativePath)
		await mkdir(dirname(target), { recursive: true, mode: 0o755 })
		await copyFile(source, target)
	}
	for (const entry of sourceBundle.packages) {
		const copiedPackage = join(publicRoot, entry.path)
		const copiedStat = await stat(copiedPackage)
		if (
			copiedStat.size !== entry.size ||
			(await sha256File(copiedPackage)) !== entry.sha256
		) {
			throw new Error(`Copied package digest mismatch: ${entry.path}`)
		}
	}
	const targetManifest = join(options.outputDir, PACKAGE_BUNDLE_MANIFEST)
	const targetSignature = `${targetManifest}.asc`
	await copyFile(sourceManifest, targetManifest)
	await copyFile(`${sourceManifest}.asc`, targetSignature)
	const [sourceManifestBytes, targetManifestBytes, sourceSignatureBytes, targetSignatureBytes] =
		await Promise.all([
			readFile(sourceManifest),
			readFile(targetManifest),
			readFile(`${sourceManifest}.asc`),
			readFile(targetSignature),
		])
	if (
		!sourceManifestBytes.equals(targetManifestBytes) ||
		!sourceSignatureBytes.equals(targetSignatureBytes)
	) {
		throw new Error("Refreshed package bundle manifest was not preserved byte-for-byte")
	}
	await verifyGpgSignature(
		runner,
		options.aptGpgPublicKey,
		targetManifest,
		targetSignature,
		options.aptGpgSigningFingerprint,
		options.aptGpgPrimaryFingerprint,
		"copied package bundle manifest",
		join(gpgHomeRoot, "verify-bundle-copy"),
		environment,
	)
}

const writeAndSignPackageBundleManifest = async (
	options: BuildOptions,
	publicRoot: string,
	gpgHomeRoot: string,
	runner: CommandRunner,
	environment: NodeJS.ProcessEnv,
): Promise<void> => {
	const manifest = await createPackageBundleManifest(publicRoot, options)
	const manifestPath = join(options.outputDir, PACKAGE_BUNDLE_MANIFEST)
	const signaturePath = `${manifestPath}.asc`
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
		mode: 0o644,
	})
	await signGpg(
		runner,
		manifestPath,
		signaturePath,
		"APT",
		options.aptGpgSigningFingerprint,
		"DOTENC_APT_GPG_PASSPHRASE_FILE",
		false,
		environment,
	)
	await verifyGpgSignature(
		runner,
		options.aptGpgPublicKey,
		manifestPath,
		signaturePath,
		options.aptGpgSigningFingerprint,
		options.aptGpgPrimaryFingerprint,
		"package bundle manifest",
		join(gpgHomeRoot, "verify-bundle-created"),
		environment,
	)
}

const sha256File = async (path: string): Promise<string> =>
	new Promise((resolvePromise, rejectPromise) => {
		const hash = createHash("sha256")
		const stream = createReadStream(path)
		stream.on("data", (chunk) => hash.update(chunk))
		stream.once("error", rejectPromise)
		stream.once("end", () => resolvePromise(hash.digest("hex")))
	})

export type PublishPolicy = "immutable" | "key" | "metadata" | "config"

export const CACHE_POLICIES = {
	immutable: {
		cacheControl:
			"public, max-age=31536000, s-maxage=31536000, immutable, no-transform",
		writeMode: "create-only",
		immutable: true,
	},
	key: {
		cacheControl:
			"public, max-age=60, s-maxage=300, must-revalidate, no-transform",
		writeMode: "overwrite",
		immutable: false,
	},
	metadata: {
		cacheControl:
			"public, max-age=60, s-maxage=300, must-revalidate, no-transform",
		writeMode: "overwrite",
		immutable: false,
	},
	config: {
		cacheControl:
			"public, max-age=60, s-maxage=300, must-revalidate, no-transform",
		writeMode: "overwrite",
		immutable: false,
	},
} as const

const isSignedRoot = (path: string): boolean =>
	/(?:^|\/)InRelease$/.test(path) ||
	/(?:^|\/)repodata\/repomd\.xml$/.test(path) ||
	/(?:^|\/)APKINDEX\.tar\.gz$/.test(path)

export const classifyPublishPath = (
	path: string,
): { policy: PublishPolicy; phase: 1 | 2 | 3 } => {
	if (isSignedRoot(path)) return { policy: "metadata", phase: 3 }
	if (path.startsWith("keys/")) {
		const fingerprinted =
			/^keys\/dotenc-(?:apt|rpm)-[A-Fa-f0-9]{40}-[a-f0-9]{64}\.asc$/.test(path) ||
			/^keys\/dotenc-[a-f0-9]{64}\.rsa\.pub$/.test(path)
		return fingerprinted
			? { policy: "immutable", phase: 1 }
			: { policy: "key", phase: 2 }
	}
	if (
		path === "apt/dotenc.sources" ||
		path === "rpm/dotenc.repo" ||
		path === "apk/dotenc.repositories"
	) {
		return { policy: "config", phase: 2 }
	}
	if (
		/\.deb$/.test(path) ||
		/\.rpm$/.test(path) ||
		/\.apk$/.test(path) ||
		path.includes("/by-hash/SHA256/") ||
		(/\/repodata\/[^/]+$/.test(path) &&
			!path.endsWith("/repomd.xml") &&
			!path.endsWith("/repomd.xml.asc"))
	) {
		return { policy: "immutable", phase: 1 }
	}
	return { policy: "metadata", phase: 2 }
}

export const contentTypeForPath = (path: string): string => {
	if (/\.(?:deb|rpm|apk)$/.test(path)) return "application/octet-stream"
	if (path.endsWith(".asc")) {
		return path.startsWith("keys/")
			? "application/pgp-keys"
			: "application/pgp-signature"
	}
	if (path.endsWith(".rsa.pub")) return "application/x-pem-file"
	if (path.endsWith(".xml")) return "application/xml"
	if (path.endsWith(".gz")) return "application/gzip"
	if (
		path.endsWith(".sources") ||
		path.endsWith(".repo") ||
		path.endsWith(".repositories") ||
		path.endsWith("/Packages") ||
		path.endsWith("/InRelease")
	) {
		return "text/plain; charset=utf-8"
	}
	return "application/octet-stream"
}

const walkFiles = async (directory: string): Promise<string[]> => {
	const results: string[] = []
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name)
		if (entry.isSymbolicLink()) {
			throw new Error(`Publication tree cannot contain symlinks: ${path}`)
		}
		if (entry.isDirectory()) {
			results.push(...(await walkFiles(path)))
		} else if (entry.isFile()) {
			results.push(path)
		} else {
			throw new Error(`Publication tree contains an unsupported entry: ${path}`)
		}
	}
	return results
}

export type PublicationObject = {
	path: string
	source: string
	sha256: string
	size: number
	contentType: string
	policy: PublishPolicy
	phase: 1 | 2 | 3
	cacheControl: string
	writeMode: "create-only" | "overwrite"
	immutable: boolean
}

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
	policies: typeof CACHE_POLICIES
	objects: PublicationObject[]
	purgePaths: string[]
}

export const createPublicationManifest = async (
	publicRoot: string,
	baseUrl: string,
	publicationEpoch: number,
): Promise<PublicationManifest> => {
	const objects: PublicationObject[] = []
	for (const absolutePath of await walkFiles(publicRoot)) {
		const path = relative(publicRoot, absolutePath).split(sep).join(posix.sep)
		if (!/^(?:apt|rpm|apk|keys)\//.test(path)) {
			throw new Error(`Publication path is outside the allowed prefixes: ${path}`)
		}
		const classification = classifyPublishPath(path)
		const policy = CACHE_POLICIES[classification.policy]
		const fileStat = await stat(absolutePath)
		objects.push({
			path,
			source: `public/${path}`,
			sha256: await sha256File(absolutePath),
			size: fileStat.size,
			contentType: contentTypeForPath(path),
			policy: classification.policy,
			phase: classification.phase,
			cacheControl: policy.cacheControl,
			writeMode: policy.writeMode,
			immutable: policy.immutable,
		})
	}
	objects.sort((left, right) => left.phase - right.phase || left.path.localeCompare(right.path))
	return {
		schemaVersion: 1,
		baseUrl,
		generatedAt: new Date(publicationEpoch * 1000).toISOString(),
		edge: {
			cacheableStatusCodes: [200, 206],
			negativeCacheStatuses: [404, 410],
			negativeTtlSeconds: 30,
			noStoreStatusRange: [500, 599],
			r2DevEndpointEnabled: false,
			honorRangeRequests: true,
		},
		policies: CACHE_POLICIES,
		objects,
		purgePaths: objects.map((object) => object.path).sort(),
	}
}

const writePublicKeys = async (
	options: BuildOptions,
	publicRoot: string,
	certificateDigests: OpenPgpCertificateDigests,
): Promise<void> => {
	const keysDirectory = join(publicRoot, "keys")
	await mkdir(keysDirectory, { recursive: true, mode: 0o755 })
	for (const [source, alias, immutable] of [
		[
			options.aptGpgPublicKey,
			"dotenc-apt.asc",
			immutableOpenPgpKeyFilename(
				"apt",
				options.aptGpgPrimaryFingerprint,
				certificateDigests.apt,
			),
		],
		[
			options.rpmGpgPublicKey,
			"dotenc-rpm.asc",
			immutableOpenPgpKeyFilename(
				"rpm",
				options.rpmGpgPrimaryFingerprint,
				certificateDigests.rpm,
			),
		],
	] as const) {
		await copyFile(source, join(keysDirectory, alias))
		await copyFile(source, join(keysDirectory, immutable))
		await chmod(join(keysDirectory, alias), 0o644)
		await chmod(join(keysDirectory, immutable), 0o644)
	}
	for (const filename of [
		`${options.apkKeyName}.rsa.pub`,
		"dotenc-apk.rsa.pub",
	]) {
		await copyFile(options.apkPublicKey, join(keysDirectory, filename))
		await chmod(join(keysDirectory, filename), 0o644)
	}
}

const writeRepositoryConfigs = async (
	options: BuildOptions,
	publicRoot: string,
	certificateDigests: OpenPgpCertificateDigests,
): Promise<void> => {
	const configs = renderRepositoryConfigs(options, certificateDigests)
	await writeFile(join(publicRoot, "apt", "dotenc.sources"), configs.apt, {
		mode: 0o644,
	})
	await writeFile(join(publicRoot, "rpm", "dotenc.repo"), configs.rpm, {
		mode: 0o644,
	})
	await writeFile(join(publicRoot, "apk", "dotenc.repositories"), configs.apk, {
		mode: 0o644,
	})
}

type ValidatedBuildInputs = {
	rpmSecretSubkeyProtection?: SecretSubkeyProtection
}

const validateBuildInputs = async (
	options: BuildOptions,
	rpmPrivateKey: string | undefined,
	apkPrivateKey: string,
	runner: CommandRunner,
	gpgHomeRoot: string,
	environment: NodeJS.ProcessEnv,
): Promise<ValidatedBuildInputs> => {
	let rpmSecretSubkeyProtection: SecretSubkeyProtection | undefined
	if (options.inputDir !== undefined) {
		for (const architecture of ARCHITECTURES) {
			await assertRegularFile(
				join(options.inputDir, `dotenc-linux-${architecture.input}`),
				`${architecture.input} glibc binary`,
			)
			await assertRegularFile(
				join(options.inputDir, `dotenc-linux-${architecture.input}-musl`),
				`${architecture.input} musl binary`,
			)
		}
		if (rpmPrivateKey === undefined) {
			throw new Error("RPM private key is required when building packages")
		}
		await assertRegularFile(rpmPrivateKey, "RPM private key", true)
		rpmSecretSubkeyProtection = await validateSecretSubkeyExport(
			runner,
			rpmPrivateKey,
			join(gpgHomeRoot, "inspect-rpm-export"),
			environment,
		)
	}
	await assertArmoredPublicKey(options.aptGpgPublicKey, "APT public key")
	await assertArmoredPublicKey(options.rpmGpgPublicKey, "RPM public key")
	await validateOpenPgpCertificate(
		runner,
		options.aptGpgPublicKey,
		"APT",
		options.aptGpgPrimaryFingerprint,
		options.aptGpgSigningFingerprint,
		options.publicationEpoch,
		join(gpgHomeRoot, "inspect-apt-certificate"),
		environment,
	)
	await validateSecretSubkeyLayout(
		runner,
		"APT",
		options.aptGpgPrimaryFingerprint,
		options.aptGpgSigningFingerprint,
		environment,
	)
	await validateOpenPgpCertificate(
		runner,
		options.rpmGpgPublicKey,
		"RPM",
		options.rpmGpgPrimaryFingerprint,
		options.rpmGpgSigningFingerprint,
		options.publicationEpoch,
		join(gpgHomeRoot, "inspect-rpm-certificate"),
		environment,
	)
	await validateSecretSubkeyLayout(
		runner,
		"RPM",
		options.rpmGpgPrimaryFingerprint,
		options.rpmGpgSigningFingerprint,
		environment,
	)
	await assertApkKeyPair(options.apkPublicKey, apkPrivateKey, options.apkKeyName)
	for (const environmentName of [
		"DOTENC_APT_GPG_PASSPHRASE_FILE",
		"DOTENC_RPM_GPG_PASSPHRASE_FILE",
	]) {
		const path = process.env[environmentName]
		if (path !== undefined && path !== "") {
			await assertRegularFile(resolve(path), environmentName, true)
		}
	}
	return { rpmSecretSubkeyProtection }
}

export const buildRepositories = async (
	options: BuildOptions,
	runner: CommandRunner = defaultCommandRunner,
): Promise<PublicationManifest> => {
	validateOptions(options)
	assertCurrentPublicationEpoch(options.publicationEpoch)
	const rpmPrivateKey =
		options.inputDir === undefined
			? undefined
			: requiredEnvironmentPath("NFPM_RPM_KEY_FILE")
	for (const environmentName of [
		"NFPM_RPM_PASSPHRASE",
		"NFPM_RPM_PASSPHRASE_FILE",
	]) {
		if (process.env[environmentName] !== undefined) {
			throw new Error(
				`${environmentName} is not accepted; use DOTENC_RPM_GPG_PASSPHRASE_FILE so nFPM receives only a transient unencrypted subkey export`,
			)
		}
	}
	let rpmPassphrase: Buffer | undefined
	const apkPrivateKey = requiredEnvironmentPath("NFPM_APK_KEY_FILE")
	const packageEnvironment = commonEnvironment(options.sourceDateEpoch)
	const metadataEnvironment = commonEnvironment(options.publicationEpoch)
	await ensureFreshOutputDirectory(options.outputDir)
	const publicRoot = join(options.outputDir, "public")
	const stagingRoot = join(options.outputDir, ".staging")
	await mkdir(publicRoot, { recursive: true, mode: 0o755 })
	await mkdir(stagingRoot, { recursive: true, mode: 0o700 })
	const gpgHomeRoot = await mkdtemp("/tmp/dotenc-gpg-")
	try {
		await chmod(gpgHomeRoot, 0o700)
		if (options.inputDir !== undefined) {
			rpmPassphrase = await readOptionalSecretFile(
				"DOTENC_RPM_GPG_PASSPHRASE_FILE",
			)
		}
		const configuredSecretScratch =
			process.env.DOTENC_PACKAGING_SECRET_SCRATCH_DIR
		if (configuredSecretScratch === "") {
			throw new Error("DOTENC_PACKAGING_SECRET_SCRATCH_DIR cannot be empty")
		}
		const secretScratchRoot =
			configuredSecretScratch === undefined
				? gpgHomeRoot
				: resolve(configuredSecretScratch)
		await assertPrivateDirectory(
			secretScratchRoot,
			"DOTENC_PACKAGING_SECRET_SCRATCH_DIR",
		)
		const validatedInputs = await validateBuildInputs(
			options,
			rpmPrivateKey,
			apkPrivateKey,
			runner,
			gpgHomeRoot,
			metadataEnvironment,
		)

		if (options.inputDir !== undefined) {
			const nfpmOutput = await runner.capture(toolCommand("nfpm"), ["--version"], {
				env: packageEnvironment,
			})
			assertNfpmVersion(nfpmOutput)
		}

		if (options.inputDir === undefined) {
			await copyExistingNativePackages(
				options,
				publicRoot,
				gpgHomeRoot,
				runner,
				metadataEnvironment,
			)
		} else {
			if (rpmPrivateKey === undefined) throw new Error("RPM private key is required")
			if (validatedInputs.rpmSecretSubkeyProtection === undefined) {
				throw new Error("RPM secret-subkey protection was not validated")
			}
			const preparedRpmKey = await prepareNfpmRpmKey(
				runner,
				rpmPrivateKey,
				options.rpmGpgPrimaryFingerprint,
				options.rpmGpgSigningFingerprint,
				validatedInputs.rpmSecretSubkeyProtection,
				rpmPassphrase,
				gpgHomeRoot,
				secretScratchRoot,
				metadataEnvironment,
			).finally(() => {
				rpmPassphrase?.fill(0)
				rpmPassphrase = undefined
			})
			try {
				await buildNativePackages(
					options,
					publicRoot,
					stagingRoot,
					runner,
					packageEnvironment,
					preparedRpmKey.path,
					apkPrivateKey,
				)
			} finally {
				await preparedRpmKey.cleanup()
			}
			await writeAndSignPackageBundleManifest(
				options,
				publicRoot,
				gpgHomeRoot,
				runner,
				metadataEnvironment,
			)
		}
		const certificateDigests: OpenPgpCertificateDigests = {
			apt: await sha256File(options.aptGpgPublicKey),
			rpm: await sha256File(options.rpmGpgPublicKey),
		}

		await buildAptRepository(
			options,
			publicRoot,
			stagingRoot,
			runner,
			metadataEnvironment,
		)
		await buildRpmRepositories(options, publicRoot, runner, metadataEnvironment)
		await buildApkRepositories(
			options,
			publicRoot,
			runner,
			metadataEnvironment,
			apkPrivateKey,
		)
		await writePublicKeys(options, publicRoot, certificateDigests)
		await writeRepositoryConfigs(options, publicRoot, certificateDigests)
		await verifyPublishedArtifacts(
			options,
			publicRoot,
			stagingRoot,
			gpgHomeRoot,
			runner,
			metadataEnvironment,
		)
		await rm(stagingRoot, { recursive: true, force: true })

		const manifest = await createPublicationManifest(
			publicRoot,
			options.baseUrl,
			options.publicationEpoch,
		)
		await writeFile(
			join(options.outputDir, "publication-manifest.json"),
			`${JSON.stringify(manifest, null, 2)}\n`,
			{ mode: 0o644 },
		)
		return manifest
	} finally {
		rpmPassphrase?.fill(0)
		await rm(gpgHomeRoot, { recursive: true, force: true })
	}
}

const main = async (): Promise<void> => {
	const options = parseCliOptions(process.argv.slice(2))
	if ("help" in options) {
		process.stdout.write(helpText)
		return
	}
	if (options.dryRun) {
		process.stdout.write(`${JSON.stringify(createBuildPlan(options), null, 2)}\n`)
		return
	}
	const manifest = await buildRepositories(options)
	process.stdout.write(
		`Built ${manifest.objects.length} publishable objects in ${options.outputDir}\n`,
	)
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error)
		process.stderr.write(`repository build failed: ${message}\n`)
		process.exitCode = 1
	})
}
