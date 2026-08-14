import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { EnvironmentAccessProbeResult } from "../helpers/decryptEnvironment"
import {
	createDoctorReport,
	type DoctorDependencies,
	DoctorInvocationError,
} from "../helpers/doctor"
import { DoctorGitInspector } from "../helpers/doctorGit"
import { getKeyFingerprint } from "../helpers/getKeyFingerprint"
import { DOTENC_DIFF_TEXTCONV } from "../helpers/setupGitDiff"
import type { Environment } from "../schemas/environment"

type Fixture = {
	root: string
	nested: string
	home: string
	keyPair: crypto.KeyPairKeyObjectResult
	fingerprint: string
}

type NestedGitFixture = Fixture & {
	gitRoot: string
}

type EnvironmentOptions = {
	marker?: EnvironmentAccessProbeResult["status"]
	recipientName?: string
	fingerprint?: string
	algorithm?: "rsa" | "ed25519"
}

const temporaryRoots = new Set<string>()
const testPosix = process.platform === "win32" ? test.skip : test
const testPosixUnprivileged =
	process.platform === "win32" || process.getuid?.() === 0 ? test.skip : test

const runGit = (cwd: string, args: string[]): string =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf-8",
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: os.devNull,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_DEFAULT_HASH: "sha1",
			GIT_TERMINAL_PROMPT: "0",
		},
	}).trim()

const gitRelativePath = (root: string, filePath: string) =>
	path.relative(root, filePath).split(path.sep).join("/")

const commitAll = (gitRoot: string, message: string): string => {
	runGit(gitRoot, ["add", "--all"])
	runGit(gitRoot, ["commit", "--quiet", "--no-verify", "-m", message])
	return runGit(gitRoot, ["rev-parse", "HEAD"])
}

const executeEmittedCommand = (cwd: string, command: string[]) => {
	const [executable, ...args] = command
	if (!executable) throw new Error("Expected an emitted command")
	execFileSync(executable, args, {
		cwd,
		encoding: "utf-8",
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: os.devNull,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_TERMINAL_PROMPT: "0",
		},
	})
}

const makeFixture = async (): Promise<Fixture> => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "dotenc-doctor-"))
	temporaryRoots.add(root)
	const nested = path.join(root, "packages", "api")
	const home = path.join(root, "home")
	await fs.mkdir(path.join(root, ".dotenc"), { recursive: true })
	await fs.mkdir(nested, { recursive: true })
	await fs.mkdir(home, { recursive: true })

	const keyPair = crypto.generateKeyPairSync("ed25519")
	const fingerprint = getKeyFingerprint(keyPair.publicKey)
	await fs.writeFile(
		path.join(root, ".dotenc", "alice.pub"),
		keyPair.publicKey.export({ type: "spki", format: "pem" }),
	)
	return { root, nested, home, keyPair, fingerprint }
}

const makeNestedGitFixture = async (): Promise<NestedGitFixture> => {
	const temporaryRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "dotenc-doctor-nested-git-"),
	)
	temporaryRoots.add(temporaryRoot)
	const gitRoot = path.join(temporaryRoot, "repository")
	const root = path.join(gitRoot, "apps", "service")
	const nested = path.join(root, "packages", "api")
	const home = path.join(temporaryRoot, "home")
	await fs.mkdir(path.join(root, ".dotenc"), { recursive: true })
	await fs.mkdir(nested, { recursive: true })
	await fs.mkdir(home, { recursive: true })

	const keyPair = crypto.generateKeyPairSync("ed25519")
	const fingerprint = getKeyFingerprint(keyPair.publicKey)
	await fs.writeFile(
		path.join(root, ".dotenc", "alice.pub"),
		keyPair.publicKey.export({ type: "spki", format: "pem" }),
	)
	await fs.writeFile(
		path.join(root, ".gitattributes"),
		".env.*.enc diff=dotenc\n",
	)

	runGit(gitRoot, ["init", "--quiet"])
	runGit(gitRoot, ["config", "--local", "user.email", "tests@dotenc.invalid"])
	runGit(gitRoot, ["config", "--local", "user.name", "dotenc tests"])
	runGit(gitRoot, ["config", "--local", "commit.gpgsign", "false"])
	runGit(gitRoot, [
		"config",
		"--local",
		"diff.dotenc.textconv",
		DOTENC_DIFF_TEXTCONV,
	])
	runGit(gitRoot, ["config", "--local", "diff.dotenc.cachetextconv", "false"])

	return { root, nested, home, keyPair, fingerprint, gitRoot }
}

const writeEnvironment = async (
	fixture: Fixture,
	directory: string,
	name: string,
	options: EnvironmentOptions = {},
) => {
	const marker = options.marker ?? "accessible"
	const environment: Environment = {
		version: 2,
		keys: [
			{
				name: options.recipientName ?? "alice",
				fingerprint: options.fingerprint ?? fixture.fingerprint,
				encryptedDataKey: Buffer.from(marker).toString("base64"),
				algorithm: options.algorithm ?? "ed25519",
			},
		],
		encryptedContent: Buffer.from("encrypted payload sentinel").toString(
			"base64",
		),
	}
	const filePath = path.join(directory, `.env.${name}.enc`)
	await fs.writeFile(filePath, JSON.stringify(environment))
	return filePath
}

const createGit = (overrides: Record<string, unknown> = {}) => ({
	isRepository: () => true,
	isShallow: () => false,
	deletedPaths: () => [],
	configValues: () => [DOTENC_DIFF_TEXTCONV],
	configBooleanValues: () => [false],
	attributeValues: (filePaths: string[]) =>
		new Map(filePaths.map((filePath) => [filePath, "dotenc"])),
	trackedPaths: () => new Set<string>(),
	ignoredPaths: (filePaths: string[]) => new Set(filePaths),
	latestValidRevision: () => ({ status: "not-found" as const }),
	...overrides,
})

const dependencies = (
	fixture: Fixture,
	overrides: Partial<DoctorDependencies> = {},
): Partial<DoctorDependencies> => ({
	getPrivateKeys: async () => ({
		keys: [
			{
				name: "private-path-must-not-leak",
				privateKey: fixture.keyPair.privateKey,
				fingerprint: fixture.fingerprint,
				algorithm: "ed25519" as const,
			},
		],
		passphraseProtectedKeys: [],
		unsupportedKeys: [],
	}),
	probeEnvironmentAccess: async (environment) => {
		const marker = Buffer.from(
			environment.keys[0].encryptedDataKey,
			"base64",
		).toString("utf8") as EnvironmentAccessProbeResult["status"]
		if (marker === "provider-inconclusive") {
			return {
				status: marker,
				provider: "1password" as const,
				reason: "cached-key-unavailable" as const,
			}
		}
		return { status: marker } as EnvironmentAccessProbeResult
	},
	probeOnePasswordLocator: async () => ({ status: "absent" as const }),
	createGitInspector: () => createGit() as never,
	homedir: () => fixture.home,
	platform: process.platform,
	...overrides,
})

const findingIds = (report: Awaited<ReturnType<typeof createDoctorReport>>) =>
	report.findings.map((finding) => finding.id)

const passedIds = (report: Awaited<ReturnType<typeof createDoctorReport>>) =>
	report.passed.map((entry) => entry.id)

afterEach(async () => {
	await Promise.all(
		[...temporaryRoots].map((root) =>
			fs.rm(root, { recursive: true, force: true }),
		),
	)
	temporaryRoots.clear()
})

describe("createDoctorReport", () => {
	test("reports a deterministic healthy nested effective scope without leaking key or payload data", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		await writeEnvironment(fixture, fixture.nested, "development")

		const first = await createDoctorReport(
			{ invocationDir: fixture.nested },
			dependencies(fixture),
		)
		const second = await createDoctorReport(
			{ invocationDir: fixture.nested },
			dependencies(fixture),
		)

		expect(first).toEqual(second)
		expect(first).toMatchObject({
			schemaVersion: 1,
			command: "doctor",
			complete: true,
			scope: { mode: "effective" },
			project: { root: ".", invocation: "packages/api" },
			exitCode: 0,
		})
		expect(first.passed).toContainEqual({
			id: "development.decryptable",
			subject: "development",
			message: "2 layers, data key decryptable.",
			paths: [".env.development.enc", "packages/api/.env.development.enc"],
		})
		expect(findingIds(first)).toContain("personal.none")
		const serialized = JSON.stringify(first)
		expect(serialized).not.toContain(fixture.root)
		expect(serialized).not.toContain(fixture.home)
		expect(serialized).not.toContain("private-path-must-not-leak")
		expect(serialized).not.toContain("encrypted payload sentinel")
	})

	test("scopes personal-profile absence to the effective chain during a recursive audit", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		await writeEnvironment(fixture, fixture.nested, "personal.alice")

		const report = await createDoctorReport(
			{ invocationDir: fixture.root, all: true },
			dependencies(fixture),
		)
		const noEffectiveProfiles = report.findings.find(
			(finding) => finding.id === "personal.none",
		)

		expect(noEffectiveProfiles?.message).toBe(
			"No personal profiles are present in the effective root-to-invocation chain; recursive envelopes are audited separately.",
		)
		expect(
			report.passed.some(
				(entry) =>
					entry.id === "repository.envelope-valid" &&
					entry.paths?.includes("packages/api/.env.personal.alice.enc"),
			),
		).toBe(true)
	})

	test("rejects conflicting scopes and invalid profile suffixes", async () => {
		const fixture = await makeFixture()
		const deps = dependencies(fixture)

		await expect(
			createDoctorReport(
				{ invocationDir: fixture.root, all: true, localOnly: true },
				deps,
			),
		).rejects.toBeInstanceOf(DoctorInvocationError)
		await expect(
			createDoctorReport(
				{ invocationDir: fixture.root, all: true, profile: "alice" },
				deps,
			),
		).rejects.toBeInstanceOf(DoctorInvocationError)
		await expect(
			createDoctorReport(
				{ invocationDir: fixture.root, profile: "../alice" },
				deps,
			),
		).rejects.toBeInstanceOf(DoctorInvocationError)
	})

	test("keeps local-only scope isolated and treats missing development as an error", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")

		const report = await createDoctorReport(
			{ invocationDir: fixture.nested, localOnly: true },
			dependencies(fixture),
		)

		expect(report.scope).toEqual({ mode: "local" })
		expect(findingIds(report)).toContain("development.missing")
		expect(report.exitCode).toBe(1)
	})

	test("distinguishes development access outcomes and preserves exit precedence", async () => {
		for (const [marker, expectedId, expectedExit] of [
			["inaccessible", "development.inaccessible", 1],
			["corrupt-data-key", "development.corrupt", 1],
			["provider-inconclusive", "development.provider-inconclusive", 0],
		] as const) {
			const fixture = await makeFixture()
			await writeEnvironment(fixture, fixture.root, "development", { marker })
			const report = await createDoctorReport(
				{ invocationDir: fixture.root },
				dependencies(fixture),
			)
			expect(findingIds(report)).toContain(expectedId)
			expect(report.exitCode).toBe(expectedExit)
		}
	})

	test("keeps corrupt local access inconclusive when another recipient has cached provider evidence", async () => {
		const fixture = await makeFixture()
		const environmentPath = await writeEnvironment(
			fixture,
			fixture.root,
			"development",
			{ marker: "corrupt-data-key" },
		)
		const environment = JSON.parse(
			await fs.readFile(environmentPath, "utf-8"),
		) as Environment
		environment.keys.push({
			name: "provider",
			fingerprint: "provider-fingerprint",
			encryptedDataKey: Buffer.from("provider-wrap").toString("base64"),
			algorithm: "ed25519",
		})
		await fs.writeFile(environmentPath, JSON.stringify(environment))

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture, {
				probeOnePasswordLocator: async (fingerprint) =>
					fingerprint === "provider-fingerprint"
						? {
								status: "present" as const,
								locator: {
									accountId: "a".repeat(26),
									vaultId: "v".repeat(26),
									itemId: "i".repeat(26),
								},
							}
						: { status: "absent" as const },
			}),
		)

		expect(findingIds(report)).toContain("development.provider-inconclusive")
		expect(findingIds(report)).not.toContain("development.corrupt")
		expect(report.exitCode).toBe(0)
	})

	test("treats access negatives as inconclusive when private-key evidence is incomplete", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development", {
			marker: "inaccessible",
		})
		await writeEnvironment(fixture, fixture.root, "personal.alice", {
			marker: "inaccessible",
		})

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture, {
				getPrivateKeys: async () => ({
					keys: [],
					passphraseProtectedKeys: [],
					unsupportedKeys: [],
					incompleteKeys: 1,
				}),
			}),
		)
		const ids = findingIds(report)

		expect(ids).toContain("development.local-key-inconclusive")
		expect(ids).toContain("personal.local-key-inconclusive")
		expect(ids).not.toContain("key.no-active-match")
		expect(ids).not.toContain("development.inaccessible")
		expect(ids).not.toContain("personal.inaccessible")
		expect(report.complete).toBe(false)
		expect(report.exitCode).toBe(2)
	})

	test("deduplicates local private keys by fingerprint before access probing", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		let probedFingerprints: string[] | undefined

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture, {
				getPrivateKeys: async () => ({
					keys: [
						{
							name: "first-copy",
							privateKey: fixture.keyPair.privateKey,
							fingerprint: fixture.fingerprint,
							algorithm: "ed25519" as const,
						},
						{
							name: "second-copy",
							privateKey: fixture.keyPair.privateKey,
							fingerprint: fixture.fingerprint,
							algorithm: "ed25519" as const,
						},
					],
					passphraseProtectedKeys: [],
					unsupportedKeys: [],
				}),
				probeEnvironmentAccess: async (_environment, probeDependencies) => {
					const privateKeys = await probeDependencies.getPrivateKeys()
					probedFingerprints = privateKeys.keys.map((key) => key.fingerprint)
					return { status: "accessible" as const }
				},
			}),
		)

		expect(probedFingerprints).toEqual([fixture.fingerprint])
		expect(report.passed).toContainEqual({
			id: "keys.active-match",
			subject: "active keys",
			message: "1 local private-key fingerprint match.",
		})
	})

	test("treats an oversized encrypted envelope as incomplete without probing recovery history", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		await fs.writeFile(
			path.join(fixture.root, ".env.personal.alice.enc"),
			Buffer.alloc(1024 * 1024 + 1, 0x41),
		)
		let historyCalls = 0
		const git = createGit({
			latestValidRevision: () => {
				historyCalls += 1
				return { status: "found" as const, revision: "a".repeat(40) }
			},
		})

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture, {
				createGitInspector: () => git as never,
			}),
		)

		expect(report.complete).toBe(false)
		expect(report.exitCode).toBe(2)
		expect(historyCalls).toBe(0)
		expect(report.findings.every((finding) => !finding.commands)).toBe(true)
	})

	test("treats explicit missing personal profiles as recoverable warnings and strict failures", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		const git = createGit({
			latestValidRevision: (filePath: string) =>
				filePath === ".env.personal.alice.enc"
					? { status: "found" as const, revision: "a".repeat(40) }
					: { status: "not-found" as const },
		})

		const report = await createDoctorReport(
			{ invocationDir: fixture.root, profile: "alice", strict: true },
			dependencies(fixture, {
				createGitInspector: () => git as never,
			}),
		)

		const missing = report.findings.find(
			(finding) => finding.id === "personal.missing",
		)
		expect(report.scope.profile).toBe("personal.alice")
		expect(missing?.severity).toBe("warning")
		expect(missing?.commands).toEqual([
			[
				"git",
				"-C",
				".",
				"--literal-pathspecs",
				"restore",
				`--source=${"a".repeat(40)}`,
				"--",
				".env.personal.alice.enc",
			],
		])
		expect(report.exitCode).toBe(1)
	})

	test("suppresses historical and fresh-start recovery when Git status is conflicted", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		let historyCalls = 0
		const git = createGit({
			deletedPaths: () => undefined,
			latestValidRevision: () => {
				historyCalls += 1
				return { status: "found" as const, revision: "a".repeat(40) }
			},
		})

		const report = await createDoctorReport(
			{ invocationDir: fixture.root, profile: "alice" },
			dependencies(fixture, {
				createGitInspector: () => git as never,
			}),
		)
		const missing = report.findings.find(
			(finding) => finding.id === "personal.missing",
		)

		expect(historyCalls).toBe(0)
		expect(missing?.commands).toBeUndefined()
		expect(report.complete).toBe(false)
		expect(report.exitCode).toBe(2)
	})

	test("states that a fresh profile starts empty when no local recovery exists", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")

		const report = await createDoctorReport(
			{ invocationDir: fixture.root, profile: "personal.alice" },
			dependencies(fixture),
		)
		const missing = report.findings.find(
			(finding) => finding.id === "personal.missing",
		)

		expect(report.scope.profile).toBe("personal.personal.alice")
		expect(missing?.message).toContain("starts empty")
		expect(missing?.message).toContain("cannot recover old values")
		expect(missing?.commands).toEqual([
			["dotenc", "env", "create", "personal.personal.alice"],
		])
		expect(report.exitCode).toBe(0)
	})

	test("does not emit explicit-profile recovery commands when an effective path cannot be normalized", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		const unsafeEffectiveDir = path.join(fixture.root, "unsafe\u202e-scope")
		await fs.mkdir(unsafeEffectiveDir)

		const report = await createDoctorReport(
			{ invocationDir: fixture.root, profile: "alice" },
			dependencies(fixture, {
				buildAncestorChain: () => [fixture.root, unsafeEffectiveDir],
			}),
		)

		expect(report.scope.profile).toBe("personal.alice")
		expect(report.complete).toBe(false)
		expect(report.exitCode).toBe(2)
		expect(report.findings.every((finding) => !finding.commands)).toBe(true)
	})

	test("reports multiple accessible profiles as healthy information", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		await writeEnvironment(fixture, fixture.root, "personal.alice")
		await writeEnvironment(fixture, fixture.root, "personal.bob")

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture),
		)

		expect(findingIds(report)).toContain("personal.multiple-accessible")
		expect(report.summary.errors).toBe(0)
		expect(report.exitCode).toBe(0)
	})

	test("emits tested recovery argv for staged tracked personal deletion evidence", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		const git = createGit({
			deletedPaths: () => [
				{
					path: ".env.personal.alice.enc",
					indexDeleted: true,
					worktreeDeleted: false,
				},
			],
		})

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture, {
				createGitInspector: () => git as never,
			}),
		)
		const deleted = report.findings.find(
			(finding) => finding.id === "personal.deleted",
		)

		expect(deleted?.commands).toEqual([
			[
				"git",
				"-C",
				".",
				"--literal-pathspecs",
				"restore",
				"--staged",
				"--",
				".env.personal.alice.enc",
			],
			[
				"git",
				"-C",
				".",
				"--literal-pathspecs",
				"restore",
				"--",
				".env.personal.alice.enc",
			],
		])
		expect(findingIds(report)).not.toContain("personal.none")
		expect(report.exitCode).toBe(0)
	})

	testPosix(
		"emits no recovery advice for staged or unstaged tracked symlink deletions",
		async () => {
			for (const staged of [false, true]) {
				const fixture = await makeNestedGitFixture()
				await writeEnvironment(fixture, fixture.root, "development")
				const personalPath = path.join(fixture.root, ".env.personal.alice.enc")
				await fs.symlink("not-an-envelope", personalPath)
				commitAll(
					fixture.gitRoot,
					`add ${staged ? "staged" : "unstaged"} personal symlink`,
				)
				await fs.unlink(personalPath)
				if (staged) {
					runGit(fixture.gitRoot, [
						"add",
						"--update",
						"--",
						gitRelativePath(fixture.gitRoot, personalPath),
					])
				}

				const report = await createDoctorReport(
					{ invocationDir: fixture.root },
					dependencies(fixture, {
						createGitInspector: (projectRoot) =>
							new DoctorGitInspector(projectRoot),
					}),
				)

				expect(report.complete).toBe(false)
				expect(findingIds(report)).toContain("scan.incomplete")
				expect(findingIds(report)).not.toContain("personal.deleted")
				expect(report.findings.every((finding) => !finding.commands)).toBe(true)
			}
		},
	)

	test("ignores a tracked deletion whose personal profile name is invalid", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		const git = createGit({
			deletedPaths: () => [
				{
					path: ".env.personal.bad name.enc",
					indexDeleted: false,
					worktreeDeleted: true,
				},
			],
		})

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture, {
				createGitInspector: () => git as never,
			}),
		)

		expect(findingIds(report)).not.toContain("personal.deleted")
		expect(findingIds(report)).toContain("personal.none")
		expect(report.findings.every((finding) => !finding.commands)).toBe(true)
	})

	test("reports a safe invalid encrypted filename in effective scope", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		await writeEnvironment(fixture, fixture.root, "bad name")

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture),
		)
		const invalidEnvelope = report.findings.find(
			(finding) => finding.id === "repository.envelope-invalid",
		)

		expect(invalidEnvelope?.paths).toEqual([".env.bad name.enc"])
		expect(report.exitCode).toBe(1)
	})

	test("executes nested staged, unstaged, and plaintext-index recovery commands in the intended project", async () => {
		const fixture = await makeNestedGitFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		const personalPath = await writeEnvironment(
			fixture,
			fixture.root,
			"personal.alice",
		)
		const personalSource = await fs.readFile(personalPath, "utf-8")
		const plaintextPath = path.join(fixture.nested, ".env.local")
		await fs.writeFile(plaintextPath, "SECRET_SENTINEL=must-not-be-read\n")
		commitAll(fixture.gitRoot, "add nested dotenc project")

		await fs.unlink(personalPath)
		runGit(fixture.gitRoot, [
			"add",
			"--update",
			"--",
			gitRelativePath(fixture.gitRoot, personalPath),
		])
		const realGitDependencies = dependencies(fixture, {
			createGitInspector: (projectRoot) => new DoctorGitInspector(projectRoot),
		})

		const stagedReport = await createDoctorReport(
			{ invocationDir: fixture.nested },
			realGitDependencies,
		)
		const stagedCommand = stagedReport.findings.find(
			(finding) => finding.id === "personal.deleted",
		)?.commands?.[0]
		expect(stagedCommand).toEqual([
			"git",
			"-C",
			"../..",
			"--literal-pathspecs",
			"restore",
			"--staged",
			"--",
			".env.personal.alice.enc",
		])
		executeEmittedCommand(fixture.nested, stagedCommand ?? [])

		const unstagedReport = await createDoctorReport(
			{ invocationDir: fixture.nested },
			realGitDependencies,
		)
		const unstagedCommand = unstagedReport.findings.find(
			(finding) => finding.id === "personal.deleted",
		)?.commands?.[0]
		expect(unstagedCommand).toEqual([
			"git",
			"-C",
			"../..",
			"--literal-pathspecs",
			"restore",
			"--",
			".env.personal.alice.enc",
		])
		executeEmittedCommand(fixture.nested, unstagedCommand ?? [])
		expect(await fs.readFile(personalPath, "utf-8")).toBe(personalSource)

		const plaintextCommand = unstagedReport.findings.find(
			(finding) => finding.id === "plaintext.tracked",
		)?.commands?.[0]
		expect(plaintextCommand).toEqual([
			"git",
			"-C",
			"../..",
			"--literal-pathspecs",
			"rm",
			"--cached",
			"--",
			"packages/api/.env.local",
		])
		executeEmittedCommand(fixture.nested, plaintextCommand ?? [])
		expect(await fs.readFile(plaintextPath, "utf-8")).toBe(
			"SECRET_SENTINEL=must-not-be-read\n",
		)
		expect(
			runGit(fixture.gitRoot, [
				"ls-files",
				"--",
				gitRelativePath(fixture.gitRoot, plaintextPath),
			]),
		).toBe("")
	})

	test("executes a nested historical restore against the outer Git repository", async () => {
		const fixture = await makeNestedGitFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		const personalPath = await writeEnvironment(
			fixture,
			fixture.root,
			"personal.alice",
		)
		const personalSource = await fs.readFile(personalPath, "utf-8")
		const profileRevision = commitAll(fixture.gitRoot, "add personal profile")
		await fs.unlink(personalPath)
		commitAll(fixture.gitRoot, "delete personal profile")

		const report = await createDoctorReport(
			{ invocationDir: fixture.nested, profile: "alice" },
			dependencies(fixture, {
				createGitInspector: (projectRoot) =>
					new DoctorGitInspector(projectRoot),
			}),
		)
		const historicalCommand = report.findings.find(
			(finding) => finding.id === "personal.missing",
		)?.commands?.[0]

		expect(historicalCommand).toEqual([
			"git",
			"-C",
			"../..",
			"--literal-pathspecs",
			"restore",
			`--source=${profileRevision}`,
			"--",
			".env.personal.alice.enc",
		])
		executeEmittedCommand(fixture.nested, historicalCommand ?? [])
		expect(await fs.readFile(personalPath, "utf-8")).toBe(personalSource)
	})

	test("warns without misleading repair commands when an included local config overrides canonical diff settings", async () => {
		const fixture = await makeNestedGitFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		commitAll(fixture.gitRoot, "add dotenc project")
		const includedConfigPath = path.join(
			fixture.gitRoot,
			".git",
			"doctor-override.config",
		)
		await fs.writeFile(
			includedConfigPath,
			'[diff "dotenc"]\n\ttextconv = dotenc textconv --included-override\n\tcachetextconv = true\n',
		)
		runGit(fixture.gitRoot, [
			"config",
			"--local",
			"--add",
			"include.path",
			"doctor-override.config",
		])

		expect(
			runGit(fixture.gitRoot, [
				"config",
				"--no-includes",
				"--local",
				"--get-all",
				"diff.dotenc.textconv",
			]),
		).toBe(DOTENC_DIFF_TEXTCONV)
		expect(
			runGit(fixture.gitRoot, [
				"config",
				"--includes",
				"--local",
				"--get-all",
				"diff.dotenc.textconv",
			]).split(/\r?\n/),
		).toEqual([DOTENC_DIFF_TEXTCONV, "dotenc textconv --included-override"])
		expect(
			runGit(fixture.gitRoot, [
				"config",
				"--includes",
				"--local",
				"--bool",
				"--get-all",
				"diff.dotenc.cachetextconv",
			]).split(/\r?\n/),
		).toEqual(["false", "true"])

		const report = await createDoctorReport(
			{ invocationDir: fixture.nested },
			dependencies(fixture, {
				createGitInspector: (projectRoot) =>
					new DoctorGitInspector(projectRoot),
			}),
		)
		const diffDriver = report.findings.find(
			(finding) => finding.id === "git.diff-driver",
		)
		const textconvCache = report.findings.find(
			(finding) => finding.id === "git.textconv-cache",
		)

		expect(diffDriver?.severity).toBe("warning")
		expect(diffDriver?.commands).toBeUndefined()
		expect(textconvCache?.severity).toBe("warning")
		expect(textconvCache?.commands).toBeUndefined()
		expect(passedIds(report)).not.toContain("git.diff-driver")
		expect(passedIds(report)).not.toContain("git.textconv-cache")
	})

	test("suggests a fingerprint-correlated ancestor legacy rename with all layers", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		await writeEnvironment(fixture, fixture.root, "alice")

		const report = await createDoctorReport(
			{ invocationDir: fixture.nested },
			dependencies(fixture),
		)
		const legacy = report.findings.find(
			(finding) => finding.id === "legacy.candidate",
		)

		expect(legacy?.paths).toEqual([".env.alice.enc"])
		expect(legacy?.commands).toEqual([
			[
				"dotenc",
				"env",
				"rename",
				"--all-layers",
				"--",
				"alice",
				"personal.alice",
			],
		])
		expect(report.exitCode).toBe(0)
	})

	test("audits every recursive envelope and plaintext path while honoring ignored directories", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		await writeEnvironment(fixture, fixture.root, "metadata", {
			recipientName: "stale-alias",
			algorithm: "rsa",
		})
		await writeEnvironment(fixture, fixture.root, "orphan", {
			fingerprint: "orphan-fingerprint",
		})
		await fs.writeFile(path.join(fixture.root, ".env.broken.enc"), "not-json")
		await fs.writeFile(
			path.join(fixture.root, ".env.production"),
			"SECRET_NAME=must-not-be-read\n",
		)
		await fs.symlink(
			path.join(fixture.root, ".env.production"),
			path.join(fixture.root, ".env.symlink"),
		)
		await fs.mkdir(path.join(fixture.root, "node_modules"), { recursive: true })
		await fs.writeFile(
			path.join(fixture.root, "node_modules", ".env.ignored.enc"),
			"not-json",
		)
		const git = createGit({
			trackedPaths: (filePaths: string[]) =>
				new Set(filePaths.filter((filePath) => filePath === ".env.production")),
		})

		const report = await createDoctorReport(
			{ invocationDir: fixture.root, all: true },
			dependencies(fixture, {
				createGitInspector: () => git as never,
			}),
		)
		const ids = findingIds(report)
		const serialized = JSON.stringify(report)

		expect(ids).toContain("repository.envelope-invalid")
		expect(ids).toContain("repository.recipient-orphaned")
		expect(ids).toContain("repository.recipient-stale-alias")
		expect(ids).toContain("repository.recipient-algorithm")
		expect(ids).toContain("plaintext.tracked")
		expect(ids).toContain("plaintext.unsafe")
		expect(serialized).not.toContain("node_modules/.env.ignored.enc")
		expect(serialized).not.toContain("SECRET_NAME")
		expect(report.exitCode).toBe(1)
	})

	test("marks a non-Git recursive scan incomplete without rendering an unsafe encrypted filename", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		const bidiControl = "\u202e"
		const unsafeName = `personal.${bidiControl}alice`
		const unsafePath = await writeEnvironment(fixture, fixture.root, unsafeName)
		const unsafeFileName = path.basename(unsafePath)
		const nonGit = createGit({ isRepository: () => false })

		const report = await createDoctorReport(
			{ invocationDir: fixture.root, all: true },
			dependencies(fixture, {
				createGitInspector: () => nonGit as never,
			}),
		)

		expect(report.complete).toBe(false)
		expect(report.exitCode).toBe(2)
		expect(findingIds(report)).toContain("scan.incomplete")
		expect(
			report.findings.flatMap((finding) => finding.paths ?? []),
		).not.toContain(unsafeFileName)
		expect(JSON.stringify(report)).not.toContain(unsafeFileName)
	})

	test("marks an unsafe public-key filename incomplete without rendering it", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		const unsafeFileName = `unsafe\u202e-alias.pub`
		await fs.writeFile(
			path.join(fixture.root, ".dotenc", unsafeFileName),
			fixture.keyPair.publicKey.export({ type: "spki", format: "pem" }),
		)

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture),
		)

		expect(report.complete).toBe(false)
		expect(report.exitCode).toBe(2)
		expect(findingIds(report)).toContain("scan.incomplete")
		expect(findingIds(report)).toContain("key.invalid")
		expect(
			report.findings.flatMap((finding) => finding.paths ?? []),
		).not.toContain(`.dotenc/${unsafeFileName}`)
		expect(JSON.stringify(report)).not.toContain(unsafeFileName)
	})

	test("treats an oversized public key as incomplete without negative inventory conclusions", async () => {
		const fixture = await makeFixture()
		await fs.writeFile(
			path.join(fixture.root, ".dotenc", "oversized.pub"),
			Buffer.alloc(64 * 1024 + 1, 0x41),
		)
		await writeEnvironment(fixture, fixture.root, "development")
		await writeEnvironment(fixture, fixture.root, "metadata", {
			recipientName: "stale-alias",
			algorithm: "rsa",
		})
		await writeEnvironment(fixture, fixture.root, "orphan", {
			fingerprint: "orphan-fingerprint",
		})

		const report = await createDoctorReport(
			{ invocationDir: fixture.root, all: true },
			dependencies(fixture, {
				getPrivateKeys: async () => ({
					keys: [],
					passphraseProtectedKeys: [],
					unsupportedKeys: [],
				}),
			}),
		)
		const ids = findingIds(report)

		expect(report.complete).toBe(false)
		expect(report.exitCode).toBe(2)
		expect(ids).toContain("scan.incomplete")
		expect(ids).not.toContain("key.none")
		expect(ids).not.toContain("key.no-active-match")
		expect(ids).not.toContain("repository.recipient-orphaned")
		expect(ids).not.toContain("repository.recipient-stale-alias")
		expect(ids).not.toContain("repository.recipient-algorithm")
		expect(passedIds(report)).not.toContain("keys.valid")
	})

	test("marks aggregate public-key evidence incomplete without negative key conclusions", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		for (let index = 0; index < 512; index += 1) {
			await fs.writeFile(
				path.join(fixture.root, ".dotenc", `aggregate-${index}.pub`),
				"diagnostic fixture",
			)
		}

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture),
		)

		expect(report.complete).toBe(false)
		expect(report.exitCode).toBe(2)
		expect(findingIds(report)).toContain("scan.incomplete")
		expect(findingIds(report)).not.toContain("key.none")
		expect(findingIds(report)).not.toContain("key.no-active-match")
		expect(passedIds(report)).not.toContain("keys.valid")
	})

	test("suppresses effective-scope absence and whole-scope passes when scanning cannot complete", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		await writeEnvironment(fixture, fixture.root, "personal.alice")
		const unreadable = path.join(fixture.root, "missing-directory")

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture, {
				buildAncestorChain: () => [fixture.root, unreadable],
			}),
		)

		expect(report.complete).toBe(false)
		expect(findingIds(report)).toContain("scan.incomplete")
		expect(findingIds(report)).not.toContain("development.missing")
		expect(findingIds(report)).not.toContain("personal.none")
		expect(passedIds(report)).not.toContain("development.decryptable")
		expect(passedIds(report)).not.toContain("personal.decryptable")
		expect(passedIds(report)).not.toContain("git.attributes")
		expect(passedIds(report)).not.toContain("plaintext.clean")
		expect(report.exitCode).toBe(2)
	})

	testPosixUnprivileged(
		"suppresses plaintext.clean when a recursive repository directory is unreadable",
		async () => {
			const fixture = await makeFixture()
			await writeEnvironment(fixture, fixture.root, "development")
			const unreadable = path.join(fixture.root, "unreadable")
			await fs.mkdir(unreadable)
			await fs.chmod(unreadable, 0)

			const report = await (async () => {
				try {
					return await createDoctorReport(
						{ invocationDir: fixture.root, all: true },
						dependencies(fixture),
					)
				} finally {
					await fs.chmod(unreadable, 0o700)
				}
			})()

			expect(report.complete).toBe(false)
			expect(report.exitCode).toBe(2)
			expect(findingIds(report)).toContain("scan.incomplete")
			expect(passedIds(report)).not.toContain("git.attributes")
			expect(passedIds(report)).not.toContain("plaintext.clean")
		},
	)

	test("validates Windows configuration content after permissions are unverified", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		const configDir = path.join(fixture.home, ".dotenc")
		await fs.mkdir(configDir)
		await fs.writeFile(path.join(configDir, "config.json"), "[]")

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture, { platform: "win32" }),
		)

		expect(findingIds(report)).toContain("config.permissions-unverified")
		expect(findingIds(report)).toContain("config.invalid")
	})

	test("treats an oversized home configuration as incomplete", async () => {
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		const configDir = path.join(fixture.home, ".dotenc")
		const configPath = path.join(configDir, "config.json")
		await fs.mkdir(configDir, { mode: 0o700 })
		await fs.writeFile(configPath, Buffer.alloc(64 * 1024 + 1, 0x41), {
			mode: 0o600,
		})
		if (process.platform !== "win32") {
			await fs.chmod(configDir, 0o700)
			await fs.chmod(configPath, 0o600)
		}

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture),
		)

		expect(findingIds(report)).toContain("scan.incomplete")
		expect(report.complete).toBe(false)
		expect(report.exitCode).toBe(2)
	})

	test("reports unsafe home configuration without changing its permissions", async () => {
		if (process.platform === "win32") return
		const fixture = await makeFixture()
		await writeEnvironment(fixture, fixture.root, "development")
		const configDir = path.join(fixture.home, ".dotenc")
		const configPath = path.join(configDir, "config.json")
		await fs.mkdir(configDir, { mode: 0o755 })
		await fs.writeFile(configPath, "[]", { mode: 0o644 })
		await fs.chmod(configDir, 0o755)
		await fs.chmod(configPath, 0o644)

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture),
		)
		const directoryMode = (await fs.stat(configDir)).mode & 0o777
		const fileMode = (await fs.stat(configPath)).mode & 0o777

		expect(findingIds(report)).toContain("config.permissions")
		expect(findingIds(report)).toContain("config.invalid")
		expect(directoryMode).toBe(0o755)
		expect(fileMode).toBe(0o644)
		expect(JSON.stringify(report)).not.toContain(fixture.home)
	})

	test("returns a known project-not-found error without exposing the invocation path", async () => {
		const fixture = await makeFixture()
		const outside = path.join(fixture.root, "outside")
		await fs.mkdir(outside)

		const report = await createDoctorReport(
			{ invocationDir: outside },
			dependencies(fixture, {
				resolveProjectRoot: async () => ({ status: "not-found" as const }),
			}),
		)

		expect(findingIds(report)).toEqual(["project.not-found"])
		expect(report.exitCode).toBe(1)
		expect(JSON.stringify(report)).not.toContain(outside)
	})
})
