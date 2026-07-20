import { describe, expect, test } from "bun:test"
import { createHash, generateKeyPairSync } from "node:crypto"
import {
	access,
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import {
	assertCurrentPublicationEpoch,
	assertGpgPassphraseChangeStatus,
	assertGpgvStatus,
	assertNfpmVersion,
	assertRpmSignatureStatus,
	assertSecretSubkeyExportPackets,
	type BuildOptions,
	buildRepositories,
	CACHE_POLICIES,
	type CommandRunner,
	classifyPublishPath,
	contentTypeForPath,
	createBuildPlan,
	createPackageBundleManifest,
	createPublicationManifest,
	immutableOpenPgpKeyFilename,
	inspectSecretSubkeyExportPackets,
	LINUX_KEY_ALIAS_PATHS,
	NFPM_VERSION,
	packageRelativePaths,
	parseCliOptions,
	parseOpenPgpKeyListing,
	parseSecretKeyListing,
	type RunOptions,
	renderRepositoryConfigs,
	validateOptions,
} from "../../../packaging/repository"

const APT_PRIMARY = "A".repeat(40)
const APT_SIGNING = "B".repeat(40)
const RPM_PRIMARY = "C".repeat(40)
const RPM_SIGNING = "D".repeat(40)

const makeOptions = (root: string): BuildOptions => ({
	version: "1.2.3",
	inputDir: join(root, "input"),
	outputDir: join(root, "output"),
	baseUrl: "https://packages.dotenc.org",
	suite: "stable",
	component: "main",
	aptGpgPrimaryFingerprint: APT_PRIMARY,
	aptGpgSigningFingerprint: APT_SIGNING,
	aptGpgPublicKey: join(root, "apt.asc"),
	rpmGpgPrimaryFingerprint: RPM_PRIMARY,
	rpmGpgSigningFingerprint: RPM_SIGNING,
	rpmGpgPublicKey: join(root, "rpm.asc"),
	apkPublicKey: join(root, "apk.rsa.pub"),
	apkKeyName: `dotenc-${"e".repeat(64)}`,
	sourceDateEpoch: 1_700_000_000,
	publicationEpoch: Math.floor(Date.now() / 1000),
	dryRun: false,
})

const keyRecord = (
	type: "pub" | "sub",
	fingerprint: string,
	capabilities: string,
	expires: number,
): string =>
	[
		`${type}:u:4096:1:0123456789ABCDEF:1700000000:${expires}:::::${capabilities}`,
		`fpr:::::::::${fingerprint}:`,
	].join("\n")

const secretRecord = (
	type: "sec" | "ssb",
	fingerprint: string,
	capabilities: string,
	secretStorage: string,
): string => {
	const fields = Array.from({ length: 16 }, () => "")
	fields[0] = type
	fields[11] = capabilities
	fields[14] = secretStorage
	return `${fields.join(":")}\nfpr:::::::::${fingerprint}:`
}

describe("repository option and policy primitives", () => {
	test("parses the build interface and keeps build/publication clocks separate", () => {
		const now = new Date("2026-07-18T12:00:00.000Z")
		const parsed = parseCliOptions(
			[
				"--version",
				"1.2.3",
				"--input-dir",
				"dist",
				"--output-dir",
				"repo",
				"--apt-gpg-primary-fingerprint",
				APT_PRIMARY,
				"--apt-gpg-signing-fingerprint",
				APT_SIGNING,
				"--apt-gpg-public-key",
				"apt.asc",
				"--rpm-gpg-primary-fingerprint",
				RPM_PRIMARY,
				"--rpm-gpg-signing-fingerprint",
				RPM_SIGNING,
				"--rpm-gpg-public-key",
				"rpm.asc",
				"--apk-public-key",
				"apk.pub",
				"--apk-key-name",
				`dotenc-${"a".repeat(64)}`,
				"--source-date-epoch",
				"1700000000",
			],
			{},
			now,
		)
		expect("help" in parsed).toBe(false)
		if ("help" in parsed) throw new Error("unexpected help result")
		expect(parsed.sourceDateEpoch).toBe(1_700_000_000)
		expect(parsed.publicationEpoch).toBe(Math.floor(now.getTime() / 1000))
		expect(parsed.inputDir).toEndWith("dist")
	})

	test("requires one package input mode and hardened key identifiers", () => {
		const root = "/tmp/dotenc-test"
		const options = makeOptions(root)
		expect(() => validateOptions(options)).not.toThrow()
		expect(() =>
			validateOptions({ ...options, packageSourceDir: "/bundle/public" }),
		).toThrow("exactly one")
		expect(() =>
			validateOptions({ ...options, rpmGpgSigningFingerprint: "DEADBEEF" }),
		).toThrow("40-hex")
		expect(() => validateOptions({ ...options, apkKeyName: "dotenc" })).toThrow(
			"Invalid APK key name",
		)
		expect(() =>
			validateOptions({ ...options, version: "1.2.3-rc.1" }),
		).toThrow("Invalid semantic version")
	})

	test("creates a secret-free build plan with exact six package paths", () => {
		const options = makeOptions("/workspace")
		const plan = createBuildPlan(options)
		expect(plan.nfpmVersion).toBe(NFPM_VERSION)
		expect(plan.mode).toBe("build-packages")
		expect(plan.packagePaths).toHaveLength(6)
		expect(plan.signing.rpmPackageKeyId).toBe(RPM_SIGNING.slice(-16))
		expect(JSON.stringify(plan)).not.toContain("PASSPHRASE=")
	})

	test("rejects passphrases passed directly to nFPM", async () => {
		const oldEnvironment = { ...process.env }
		try {
			process.env.NFPM_RPM_KEY_FILE = "/tmp/dotenc-test-rpm-key"
			for (const environmentName of [
				"NFPM_RPM_PASSPHRASE",
				"NFPM_RPM_PASSPHRASE_FILE",
			]) {
				delete process.env.NFPM_RPM_PASSPHRASE
				delete process.env.NFPM_RPM_PASSPHRASE_FILE
				process.env[environmentName] = "must-not-reach-nfpm"
				await expect(
					buildRepositories(makeOptions("/tmp/dotenc-test")),
				).rejects.toThrow(`${environmentName} is not accepted`)
			}
		} finally {
			for (const key of Object.keys(process.env)) delete process.env[key]
			Object.assign(process.env, oldEnvironment)
		}
	})

	test("classifies atomic publication phases and cache policies", () => {
		expect(
			classifyPublishPath("apt/pool/main/d/dotenc/dotenc_1.2.3-1_amd64.deb"),
		).toEqual({ policy: "immutable", phase: 1 })
		expect(
			classifyPublishPath(
				`keys/dotenc-apt-${APT_PRIMARY}-${"f".repeat(64)}.asc`,
			),
		).toEqual({ policy: "immutable", phase: 1 })
		expect(
			classifyPublishPath(`keys/dotenc-apk-${"a".repeat(64)}.rsa.pub`),
		).toEqual({ policy: "key", phase: 2 })
		expect(
			classifyPublishPath(`keys/dotenc-${"a".repeat(64)}.rsa.pub`),
		).toEqual({ policy: "immutable", phase: 1 })
		for (const path of Object.values(LINUX_KEY_ALIAS_PATHS)) {
			expect(classifyPublishPath(path)).toEqual({ policy: "key", phase: 2 })
		}
		expect(classifyPublishPath("rpm/x86_64/repodata/repomd.xml.asc")).toEqual({
			policy: "metadata",
			phase: 2,
		})
		expect(classifyPublishPath("rpm/x86_64/repodata/repomd.xml")).toEqual({
			policy: "metadata",
			phase: 3,
		})
		expect(classifyPublishPath("apt/dists/stable/InRelease")).toEqual({
			policy: "metadata",
			phase: 3,
		})
		expect(CACHE_POLICIES.immutable.cacheControl).toContain("no-transform")
	})

	test("uses explicit content types", () => {
		expect(contentTypeForPath("apt/pool/dotenc.deb")).toBe(
			"application/octet-stream",
		)
		expect(contentTypeForPath("keys/dotenc-apt.asc")).toBe(
			"application/pgp-keys",
		)
		expect(contentTypeForPath(LINUX_KEY_ALIAS_PATHS.apt)).toBe(
			"application/pgp-keys",
		)
		expect(contentTypeForPath(LINUX_KEY_ALIAS_PATHS.rpm)).toBe(
			"application/pgp-keys",
		)
		expect(contentTypeForPath(LINUX_KEY_ALIAS_PATHS.apk)).toBe(
			"application/x-pem-file",
		)
		expect(contentTypeForPath("rpm/x/repodata/repomd.xml.asc")).toBe(
			"application/pgp-signature",
		)
	})

	test("checks tool version and publication clock", () => {
		expect(() =>
			assertNfpmVersion(`nfpm version ${NFPM_VERSION}`),
		).not.toThrow()
		expect(() =>
			assertNfpmVersion(
				`Version:        development\nGitVersion:    ${NFPM_VERSION}`,
			),
		).not.toThrow()
		expect(() => assertNfpmVersion("nfpm version 2.46.0")).toThrow(
			`Expected nFPM ${NFPM_VERSION}`,
		)
		expect(() => assertCurrentPublicationEpoch(1_000, 1_100)).not.toThrow()
		expect(() => assertCurrentPublicationEpoch(1_000, 10_000)).toThrow(
			"within one hour",
		)
	})
})

describe("key listing and signature status validation", () => {
	test("parses public and secret key machine listings", () => {
		const publicRecords = parseOpenPgpKeyListing(
			`${keyRecord("pub", APT_PRIMARY, "c", 0)}\n${keyRecord("sub", APT_SIGNING, "s", 0)}`,
		)
		expect(publicRecords.map((record) => record.fingerprint)).toEqual([
			APT_PRIMARY,
			APT_SIGNING,
		])
		const secretRecords = parseSecretKeyListing(
			`${secretRecord("sec", APT_PRIMARY, "c", "#")}\n${secretRecord("ssb", APT_SIGNING, "s", "")}`,
		)
		expect(secretRecords[0]?.secretStorage).toBe("#")
		expect(secretRecords[1]?.fingerprint).toBe(APT_SIGNING)
	})

	test("pins GPG verification to exact primary and signing fingerprints", () => {
		const status = `[GNUPG:] VALIDSIG ${APT_SIGNING} 2026-07-18 1 0 4 0 1 10 01 ${APT_PRIMARY}`
		expect(() =>
			assertGpgvStatus(status, APT_SIGNING, APT_PRIMARY, "APT"),
		).not.toThrow()
		expect(() =>
			assertGpgvStatus(status, RPM_SIGNING, APT_PRIMARY, "APT"),
		).toThrow("declared signing identity")
	})

	test("distinguishes protected source and unprotected transient RPM subkeys", () => {
		const encryptedPackets = `:secret key packet:
\tgnu-dummy, algo: 0
:secret sub key packet:
\titer+salt S2K, algo: 7, SHA1 protection`
		expect(inspectSecretSubkeyExportPackets(encryptedPackets)).toBe("encrypted")
		const unencryptedPackets = `:secret key packet:
\tgnu-dummy, algo: 0
:secret sub key packet:
\tskey[2]: [4096 bits]
\tskey[3]: [2048 bits]
\tskey[4]: [2048 bits]
\tskey[5]: [2048 bits]
\tchecksum: 1234`
		expect(inspectSecretSubkeyExportPackets(unencryptedPackets)).toBe(
			"unencrypted",
		)
		expect(() =>
			assertSecretSubkeyExportPackets(unencryptedPackets),
		).not.toThrow()
		expect(() =>
			assertSecretSubkeyExportPackets(
				`${encryptedPackets}\n:secret sub key packet:\n\titer+salt S2K`,
			),
		).toThrow("exactly one usable secret subkey")
		expect(() =>
			inspectSecretSubkeyExportPackets(
				`:secret key packet:\n\tgnu-dummy, algo: 0\n:secret sub key packet:\n\tkeyid: 1234`,
			),
		).toThrow("protection could not be determined")
	})

	test("accepts only the exact GPG passphrase-removal status protocol", () => {
		const successfulStatus = `[GNUPG:] KEY_CONSIDERED ${RPM_PRIMARY} 0
[GNUPG:] GET_HIDDEN passphrase.enter
[GNUPG:] GOT_IT
[GNUPG:] GET_HIDDEN passphrase.enter
[GNUPG:] GOT_IT
[GNUPG:] SUCCESS keyedit.passwd
[GNUPG:] FAILURE gpg-exit 33554433`
		expect(() =>
			assertGpgPassphraseChangeStatus(successfulStatus),
		).not.toThrow()
		expect(() =>
			assertGpgPassphraseChangeStatus(
				successfulStatus.replace(
					"[GNUPG:] SUCCESS keyedit.passwd",
					"[GNUPG:] BAD_PASSPHRASE DEADBEEF",
				),
			),
		).toThrow("did not unlock")
		expect(() =>
			assertGpgPassphraseChangeStatus(
				successfulStatus.replace("[GNUPG:] GOT_IT\n", ""),
			),
		).toThrow("did not unlock")
	})

	test("requires RPM signature output from the declared signing subkey", () => {
		const keyId = RPM_SIGNING.slice(-16).toLowerCase()
		const status = `Header V4 RSA/SHA256 Signature, key ID ${keyId}: OK`
		expect(() =>
			assertRpmSignatureStatus(status, RPM_SIGNING, "RPM package"),
		).not.toThrow()
		expect(() =>
			assertRpmSignatureStatus(
				`Header OpenPGP V4 RSA/SHA256, key fingerprint ${RPM_SIGNING.toLowerCase()} signature: OK`,
				RPM_SIGNING,
				"RPM package",
			),
		).not.toThrow()
		expect(() =>
			assertRpmSignatureStatus(status, APT_SIGNING, "RPM package"),
		).toThrow("declared RPM subkey")
	})
})

describe("repository artifacts", () => {
	test("emits a sorted, three-phase publication manifest and purges every path", async () => {
		const root = await mkdtemp(join(tmpdir(), "dotenc-manifest-"))
		const publicRoot = join(root, "public")
		const files = [
			"apt/dists/stable/InRelease",
			"apt/pool/main/d/dotenc/dotenc_1.2.3-1_amd64.deb",
			"rpm/x86_64/repodata/repomd.xml.asc",
			"rpm/x86_64/repodata/repomd.xml",
			`keys/dotenc-${"a".repeat(64)}.rsa.pub`,
		]
		for (const path of files) {
			await mkdir(dirname(join(publicRoot, path)), { recursive: true })
			await writeFile(join(publicRoot, path), path)
		}
		const manifest = await createPublicationManifest(
			publicRoot,
			"https://packages.dotenc.org",
			1_700_000_000,
		)
		expect(manifest.edge.negativeTtlSeconds).toBe(30)
		expect(manifest.edge.negativeCacheStatuses).toEqual([404, 410])
		expect(manifest.purgePaths).toEqual([...files].sort())
		expect(manifest.objects.map((object) => object.phase)).toEqual([
			1, 1, 2, 3, 3,
		])
		expect(
			manifest.objects.every((object) => object.sha256.length === 64),
		).toBe(true)
		expect(manifest.objects[0]?.source).toStartWith("public/")
	})

	test("renders secure package-manager configuration", () => {
		const options = makeOptions("/workspace")
		const certificateDigests = { apt: "a".repeat(64), rpm: "b".repeat(64) }
		const configs = renderRepositoryConfigs(options, certificateDigests)
		expect(configs.apt).toContain("Signed-By: /etc/apt/keyrings/dotenc.asc")
		expect(configs.apt).not.toContain("Architectures:")
		expect(configs.apt).toContain(
			immutableOpenPgpKeyFilename("apt", APT_PRIMARY, certificateDigests.apt),
		)
		expect(configs.rpm).toContain("gpgcheck=1")
		expect(configs.rpm).toContain("repo_gpgcheck=1")
		expect(configs.rpm).toContain(
			immutableOpenPgpKeyFilename("rpm", RPM_PRIMARY, certificateDigests.rpm),
		)
		expect(configs.apk).toContain(`${options.apkKeyName}.rsa.pub`)
	})
})

type FakeRunnerBehavior = {
	failGpgconfCleanup?: boolean
	failRpmProbe?: boolean
	failRpmBuild?: boolean
	invalidInspectedRpmIdentity?: boolean
	rpmSourceProtection?: "encrypted" | "unencrypted"
	transientRpmKeyPaths?: string[]
	aptReleaseArguments?: string[]
}

const createFakeRunner = (
	options: BuildOptions,
	behavior: FakeRunnerBehavior = {},
): CommandRunner => {
	const publicListing = (primary: string, signing: string) =>
		`${keyRecord("pub", primary, "c", options.publicationEpoch + 90 * 86400)}\n${keyRecord("sub", signing, "s", options.publicationEpoch + 90 * 86400)}`
	const secretListing = (primary: string, signing: string) =>
		`${secretRecord("sec", primary, "c", "#")}\n${secretRecord("ssb", signing, "s", "")}`
	const assertSanitized = (
		command: string,
		args: string[],
		runOptions: RunOptions | undefined,
	) => {
		expect(runOptions?.env?.UNRELATED_CI_SECRET).toBeUndefined()
		const name = basename(command)
		const originalSecretGpgOperation =
			name === "gpg" &&
			(args.includes("--local-user") ||
				(args.includes("--list-secret-keys") && !args.includes("--homedir")))
		const explicitGpgHome = args.includes("--homedir")
			? args[args.indexOf("--homedir") + 1]
			: undefined
		const stagedSecretGpgOperation =
			name === "gpg" &&
			explicitGpgHome?.includes("/nfpm-rpm-secret/") === true &&
			[
				"--import",
				"--change-passphrase",
				"--export-secret-subkeys",
				"--list-secret-keys",
			].some((argument) => args.includes(argument))
		if (name === "gpg") {
			expect(args).toContain("--no-options")
			if (!originalSecretGpgOperation && !stagedSecretGpgOperation) {
				expect(args).toContain("--no-autostart")
			}
		}
		if (
			name === "gpgv" ||
			(name === "gpg" &&
				!originalSecretGpgOperation &&
				!stagedSecretGpgOperation)
		) {
			const home = args[args.indexOf("--homedir") + 1]
			expect(home).toStartWith("/tmp/dotenc-gpg-")
		}
		if (originalSecretGpgOperation) {
			const aptOperation = args.some(
				(arg) => arg === APT_PRIMARY || arg === `${APT_SIGNING}!`,
			)
			expect(runOptions?.env?.GNUPGHOME).toBe(
				process.env[
					aptOperation ? "DOTENC_APT_GNUPGHOME" : "DOTENC_RPM_GNUPGHOME"
				],
			)
		} else if (stagedSecretGpgOperation) {
			expect(explicitGpgHome).toContain("/nfpm-rpm-secret/")
			expect(runOptions?.env?.GNUPGHOME).toBeUndefined()
		} else {
			expect(runOptions?.env?.GNUPGHOME).toBeUndefined()
		}
	}
	return {
		async run(command, args, runOptions = {}) {
			assertSanitized(command, args, runOptions)
			const name = basename(command)
			if (name === "gpgconf" && behavior.failGpgconfCleanup) {
				throw new Error("fake transient GPG agent cleanup failure")
			}
			if (
				name === "gpg" &&
				behavior.failRpmProbe &&
				args.includes(`${RPM_SIGNING}!`) &&
				args.includes("--detach-sign")
			) {
				throw new Error("fake RPM passphrase probe failure")
			}
			if (name === "nfpm") {
				if (args.includes("rpm")) {
					const transientKey = runOptions.env?.NFPM_RPM_KEY_FILE
					if (behavior.rpmSourceProtection === "unencrypted") {
						expect(transientKey).toBe(process.env.NFPM_RPM_KEY_FILE)
					} else {
						expect(transientKey).toContain("/nfpm-rpm-secret/")
					}
					expect(runOptions.env?.NFPM_RPM_PASSPHRASE).toBeUndefined()
					if (
						transientKey !== undefined &&
						behavior.rpmSourceProtection !== "unencrypted"
					) {
						behavior.transientRpmKeyPaths?.push(transientKey)
					}
					if (behavior.failRpmBuild) throw new Error("fake nFPM RPM failure")
				}
				const target = args[args.indexOf("--target") + 1]
				if (target === undefined) throw new Error("missing fake nFPM target")
				await mkdir(dirname(target), { recursive: true })
				await writeFile(
					target,
					`fake ${args[args.indexOf("--packager") + 1]} package`,
				)
				return
			}
			if (name === "abuild-gzsplit") {
				if (runOptions.cwd === undefined) throw new Error("missing split cwd")
				await writeFile(join(runOptions.cwd, "control.tar.gz"), "control")
				await writeFile(join(runOptions.cwd, "data.tar.gz"), "data")
				return
			}
			if (name === "abuild-sign") {
				const target = args.at(-1)
				if (target === undefined) throw new Error("missing abuild target")
				await writeFile(
					target,
					Buffer.concat([Buffer.from("signed:"), await readFile(target)]),
				)
				return
			}
			if (name === "apt-ftparchive" || name === "gzip") {
				if (runOptions.stdoutFile === undefined)
					throw new Error("missing stdout file")
				if (name === "apt-ftparchive" && args.includes("release")) {
					behavior.aptReleaseArguments?.push(...args)
				}
				await mkdir(dirname(runOptions.stdoutFile), { recursive: true })
				await writeFile(runOptions.stdoutFile, `${name} output`)
				return
			}
			if (name === "createrepo_c") {
				if (runOptions.cwd === undefined)
					throw new Error("missing createrepo cwd")
				const repodata = join(runOptions.cwd, "repodata")
				await mkdir(repodata, { recursive: true })
				await writeFile(join(repodata, "abc-primary.xml.gz"), "primary")
				await writeFile(join(repodata, "repomd.xml"), "repomd")
				return
			}
			if (name === "apk" && args.includes("index")) {
				expect(args.slice(0, 2)).toEqual(["--allow-untrusted", "index"])
				const target = args[args.indexOf("--output") + 1]
				if (target === undefined) throw new Error("missing apk index target")
				await writeFile(target, "apk index")
				return
			}
			if (name === "gpg") {
				const outputIndex = args.indexOf("--output")
				const target = outputIndex === -1 ? undefined : args[outputIndex + 1]
				if (target !== undefined) {
					await mkdir(dirname(target), { recursive: true })
					await writeFile(target, "gpg output")
				}
			}
		},
		async capture(command, args, runOptions = {}) {
			assertSanitized(command, args, runOptions)
			const name = basename(command)
			if (name === "nfpm") return `nfpm version ${NFPM_VERSION}`
			if (name === "gpg" && args.includes("--change-passphrase")) {
				expect(runOptions.stderr).toBe("ignore")
				expect(runOptions.acceptedExitCodes).toEqual([0, 2])
				return `[GNUPG:] KEY_CONSIDERED ${RPM_PRIMARY} 0
[GNUPG:] GET_HIDDEN passphrase.enter
[GNUPG:] GOT_IT
[GNUPG:] GET_HIDDEN passphrase.enter
[GNUPG:] GOT_IT
[GNUPG:] SUCCESS keyedit.passwd
[GNUPG:] FAILURE gpg-exit 33554433`
			}
			if (
				name === "gpg" &&
				args.includes("--import-options") &&
				args.includes("show-only")
			) {
				const path = args.at(-1)
				return path === options.aptGpgPublicKey
					? publicListing(APT_PRIMARY, APT_SIGNING)
					: publicListing(RPM_PRIMARY, RPM_SIGNING)
			}
			if (name === "gpg" && args.includes("--list-secret-keys")) {
				const explicitHome = args.includes("--homedir")
					? args[args.indexOf("--homedir") + 1]
					: undefined
				if (
					behavior.invalidInspectedRpmIdentity &&
					explicitHome?.includes("/nfpm-rpm-secret/inspect-gnupg") === true
				) {
					return secretListing(RPM_PRIMARY, APT_SIGNING)
				}
				return args.at(-1) === APT_PRIMARY
					? secretListing(APT_PRIMARY, APT_SIGNING)
					: secretListing(RPM_PRIMARY, RPM_SIGNING)
			}
			if (name === "gpg" && args.includes("--list-packets")) {
				const path = args.at(-1) ?? ""
				return path.includes("rpm.secret-subkeys.unprotected.asc") ||
					behavior.rpmSourceProtection === "unencrypted"
					? ":secret key packet:\ngnu-dummy, algo: 0\n:secret sub key packet:\nskey[2]: [4096 bits]\nskey[3]: [2048 bits]\nskey[4]: [2048 bits]\nskey[5]: [2048 bits]\nchecksum: 1234\n"
					: ":secret key packet:\ngnu-dummy, algo: 0\n:secret sub key packet:\niter+salt S2K\n"
			}
			if (name === "gpgv") {
				const isApt = args.some(
					(arg) =>
						arg.endsWith("InRelease") ||
						arg.endsWith("package-bundle-manifest.json") ||
						arg.endsWith("package-bundle-manifest.json.asc"),
				)
				const signing = isApt ? APT_SIGNING : RPM_SIGNING
				const primary = isApt ? APT_PRIMARY : RPM_PRIMARY
				return `[GNUPG:] VALIDSIG ${signing} 2026-07-18 1 0 4 0 1 10 01 ${primary}`
			}
			if (name === "dpkg-deb") {
				const field = args.at(-1)
				const path = args[1] ?? ""
				if (field === "Package") return "dotenc\n"
				if (field === "Version") return `${options.version}-1\n`
				return path.includes("arm64") ? "arm64\n" : "amd64\n"
			}
			if (name === "rpm" && args.includes("--query")) {
				const path = args.at(-1) ?? ""
				const arch = path.includes("aarch64") ? "aarch64" : "x86_64"
				return `dotenc\t${options.version}\t1\t${arch}\n`
			}
			if (name === "rpmkeys") {
				return `Header V4 RSA/SHA256 Signature, key ID ${RPM_SIGNING.slice(-16)}: OK\n`
			}
			return ""
		},
	}
}

describe("full build and metadata refresh orchestration", () => {
	test("builds, verifies, manifests, and byte-preserves the six-package bundle", async () => {
		const root = await mkdtemp(join(tmpdir(), "dotenc-repository-"))
		const options = makeOptions(root)
		const inputDir = options.inputDir as string
		await mkdir(inputDir, { recursive: true })
		for (const architecture of ["x64", "arm64"]) {
			await writeFile(join(inputDir, `dotenc-linux-${architecture}`), "glibc")
			await writeFile(
				join(inputDir, `dotenc-linux-${architecture}-musl`),
				"musl",
			)
		}
		const publicArmor =
			"-----BEGIN PGP PUBLIC KEY BLOCK-----\nZmFrZQ==\n-----END PGP PUBLIC KEY BLOCK-----\n"
		await writeFile(options.aptGpgPublicKey, publicArmor)
		await writeFile(options.rpmGpgPublicKey, publicArmor)
		const { privateKey, publicKey } = generateKeyPairSync("rsa", {
			modulusLength: 4096,
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
			publicKeyEncoding: { type: "spki", format: "pem" },
		})
		await writeFile(options.apkPublicKey, publicKey)
		const publicDer = Buffer.from(
			publicKey.replace(
				/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g,
				"",
			),
			"base64",
		)
		options.apkKeyName = `dotenc-${createHash("sha256").update(publicDer).digest("hex")}`
		const apkPrivatePath = join(root, "apk-private.pem")
		const rpmPrivatePath = join(root, "rpm-private.asc")
		const rpmPassphrasePath = join(root, "rpm-passphrase")
		await writeFile(apkPrivatePath, privateKey, { mode: 0o600 })
		await writeFile(rpmPrivatePath, "fake secret export", { mode: 0o600 })
		await writeFile(rpmPassphrasePath, "fake-rpm-passphrase", { mode: 0o600 })
		await chmod(apkPrivatePath, 0o600)
		await chmod(rpmPrivatePath, 0o600)
		await chmod(rpmPassphrasePath, 0o600)
		const oldEnvironment = { ...process.env }
		process.env.NFPM_APK_KEY_FILE = apkPrivatePath
		process.env.NFPM_RPM_KEY_FILE = rpmPrivatePath
		process.env.DOTENC_APT_GNUPGHOME = join(root, "apt-gnupg")
		process.env.DOTENC_RPM_GNUPGHOME = join(root, "rpm-gnupg")
		process.env.DOTENC_RPM_GPG_PASSPHRASE_FILE = rpmPassphrasePath
		process.env.UNRELATED_CI_SECRET = "must-not-leak"
		try {
			const transientRpmKeyPaths: string[] = []
			const aptReleaseArguments: string[] = []
			const manifest = await buildRepositories(
				options,
				createFakeRunner(options, {
					transientRpmKeyPaths,
					aptReleaseArguments,
				}),
			)
			expect(manifest.objects.some((object) => object.phase === 3)).toBe(true)
			for (const [aliasPath, sourcePath, contentType] of [
				[
					LINUX_KEY_ALIAS_PATHS.apt,
					options.aptGpgPublicKey,
					"application/pgp-keys",
				],
				[
					LINUX_KEY_ALIAS_PATHS.rpm,
					options.rpmGpgPublicKey,
					"application/pgp-keys",
				],
				[
					LINUX_KEY_ALIAS_PATHS.apk,
					options.apkPublicKey,
					"application/x-pem-file",
				],
			] as const) {
				expect(
					await readFile(join(options.outputDir, "public", aliasPath)),
				).toEqual(await readFile(sourcePath))
				expect(
					manifest.objects.find((object) => object.path === aliasPath),
				).toMatchObject({
					contentType,
					policy: "key",
					phase: 2,
					cacheControl: CACHE_POLICIES.key.cacheControl,
					writeMode: "overwrite",
					immutable: false,
				})
			}
			expect(aptReleaseArguments).toContain(
				"APT::FTPArchive::Release::ValidTime=1209600",
			)
			expect(aptReleaseArguments).toContain(
				`APT::FTPArchive::Release::Valid-Until=${new Date(
					(options.publicationEpoch + 14 * 24 * 60 * 60) * 1000,
				).toUTCString()}`,
			)
			expect(new Set(transientRpmKeyPaths).size).toBe(1)
			await expect(access(transientRpmKeyPaths[0] as string)).rejects.toThrow()
			const bundle = await createPackageBundleManifest(
				join(options.outputDir, "public"),
				options,
			)
			expect(bundle.packages).toHaveLength(6)
			expect(bundle.sourceDateEpoch).toBe(options.sourceDateEpoch)
			expect(packageRelativePaths(options)).toHaveLength(6)
			const sourceSignature = await readFile(
				join(options.outputDir, "package-bundle-manifest.json.asc"),
			)

			const failedOptions = {
				...options,
				outputDir: join(root, "failed"),
			}
			const failedTransientRpmKeyPaths: string[] = []
			await expect(
				buildRepositories(
					failedOptions,
					createFakeRunner(failedOptions, {
						failRpmBuild: true,
						transientRpmKeyPaths: failedTransientRpmKeyPaths,
					}),
				),
			).rejects.toThrow("fake nFPM RPM failure")
			expect(new Set(failedTransientRpmKeyPaths).size).toBe(1)
			await expect(
				access(failedTransientRpmKeyPaths[0] as string),
			).rejects.toThrow()

			delete process.env.DOTENC_RPM_GPG_PASSPHRASE_FILE
			const missingPassphraseOptions = {
				...options,
				outputDir: join(root, "missing-rpm-passphrase"),
			}
			await expect(
				buildRepositories(
					missingPassphraseOptions,
					createFakeRunner(missingPassphraseOptions),
				),
			).rejects.toThrow(
				"DOTENC_RPM_GPG_PASSPHRASE_FILE is required for the encrypted RPM signing subkey",
			)

			process.env.DOTENC_RPM_GPG_PASSPHRASE_FILE = rpmPassphrasePath
			const unexpectedPassphraseOptions = {
				...options,
				outputDir: join(root, "unexpected-rpm-passphrase"),
			}
			await expect(
				buildRepositories(
					unexpectedPassphraseOptions,
					createFakeRunner(unexpectedPassphraseOptions, {
						rpmSourceProtection: "unencrypted",
					}),
				),
			).rejects.toThrow(
				"DOTENC_RPM_GPG_PASSPHRASE_FILE was provided for an unencrypted RPM signing subkey",
			)

			const multilinePassphrasePath = join(root, "rpm-multiline-passphrase")
			await writeFile(multilinePassphrasePath, "fake\npassphrase", {
				mode: 0o600,
			})
			await chmod(multilinePassphrasePath, 0o600)
			process.env.DOTENC_RPM_GPG_PASSPHRASE_FILE = multilinePassphrasePath
			const multilinePassphraseOptions = {
				...options,
				outputDir: join(root, "multiline-rpm-passphrase"),
			}
			await expect(
				buildRepositories(
					multilinePassphraseOptions,
					createFakeRunner(multilinePassphraseOptions),
				),
			).rejects.toThrow("RPM GPG passphrase must contain exactly one line")

			process.env.DOTENC_RPM_GPG_PASSPHRASE_FILE = rpmPassphrasePath
			const probeCleanupFailureOptions = {
				...options,
				outputDir: join(root, "probe-cleanup-failure"),
			}
			await expect(
				buildRepositories(
					probeCleanupFailureOptions,
					createFakeRunner(probeCleanupFailureOptions, {
						failGpgconfCleanup: true,
						failRpmProbe: true,
					}),
				),
			).rejects.toThrow(
				"Unable to prepare and fully clean the transient RPM signing material",
			)

			delete process.env.DOTENC_RPM_GPG_PASSPHRASE_FILE
			const mismatchedUnprotectedOptions = {
				...options,
				outputDir: join(root, "mismatched-unprotected-test-key"),
			}
			await expect(
				buildRepositories(
					mismatchedUnprotectedOptions,
					createFakeRunner(mismatchedUnprotectedOptions, {
						invalidInspectedRpmIdentity: true,
						rpmSourceProtection: "unencrypted",
					}),
				),
			).rejects.toThrow(
				"nFPM RPM keyring must contain only the declared secret signing subkey",
			)

			const unprotectedOptions = {
				...options,
				outputDir: join(root, "unprotected-test-key"),
			}
			await buildRepositories(
				unprotectedOptions,
				createFakeRunner(unprotectedOptions, {
					rpmSourceProtection: "unencrypted",
				}),
			)

			const refreshOptions: BuildOptions = {
				...options,
				inputDir: undefined,
				packageSourceDir: join(options.outputDir, "public"),
				packageSourceManifest: join(
					options.outputDir,
					"package-bundle-manifest.json",
				),
				outputDir: join(root, "refresh"),
				publicationEpoch: Math.floor(Date.now() / 1000),
			}
			delete process.env.NFPM_RPM_KEY_FILE
			await buildRepositories(refreshOptions, createFakeRunner(refreshOptions))
			const refreshedBundle = JSON.parse(
				await readFile(
					join(refreshOptions.outputDir, "package-bundle-manifest.json"),
					"utf8",
				),
			)
			expect(refreshedBundle).toEqual(bundle)
			expect(
				await readFile(
					join(refreshOptions.outputDir, "package-bundle-manifest.json.asc"),
				),
			).toEqual(sourceSignature)
			await expect(
				access(join(options.outputDir, ".staging")),
			).rejects.toThrow()
			await expect(
				access(join(refreshOptions.outputDir, ".staging")),
			).rejects.toThrow()
		} finally {
			for (const key of Object.keys(process.env)) delete process.env[key]
			Object.assign(process.env, oldEnvironment)
		}
	}, 30_000)
})
