import { afterEach, describe, expect, spyOn, test } from "bun:test"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { EnvironmentAccessProbeResult } from "../helpers/decryptEnvironment"
import { createDoctorReport, type DoctorDependencies } from "../helpers/doctor"
import { getKeyFingerprint } from "../helpers/getKeyFingerprint"
import { DOTENC_DIFF_TEXTCONV } from "../helpers/setupGitDiff"
import type { Environment } from "../schemas/environment"

type Fixture = {
	root: string
	home: string
	keyPair: crypto.KeyPairKeyObjectResult
	fingerprint: string
}

const temporaryRoots = new Set<string>()

const makeFixture = async (): Promise<Fixture> => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "dotenc-doctor-edges-"))
	const home = path.join(root, "home")
	temporaryRoots.add(root)
	await fs.mkdir(path.join(root, ".dotenc"), { recursive: true })
	await fs.mkdir(home)

	const keyPair = crypto.generateKeyPairSync("ed25519")
	const fingerprint = getKeyFingerprint(keyPair.publicKey)
	await fs.writeFile(
		path.join(root, ".dotenc", "alice.pub"),
		keyPair.publicKey.export({ type: "spki", format: "pem" }),
	)
	const environment: Environment = {
		version: 2,
		keys: [
			{
				name: "alice",
				fingerprint,
				encryptedDataKey: Buffer.from("wrapped key fixture").toString("base64"),
				algorithm: "ed25519",
			},
		],
		encryptedContent: Buffer.from("encrypted content fixture").toString(
			"base64",
		),
	}
	await fs.writeFile(
		path.join(root, ".env.development.enc"),
		JSON.stringify(environment),
	)
	return { root, home, keyPair, fingerprint }
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
				name: "fixture-key",
				privateKey: fixture.keyPair.privateKey,
				fingerprint: fixture.fingerprint,
				algorithm: "ed25519" as const,
			},
		],
		passphraseProtectedKeys: [],
		unsupportedKeys: [],
	}),
	probeEnvironmentAccess: async () =>
		({ status: "accessible" }) as EnvironmentAccessProbeResult,
	probeOnePasswordLocator: async () => ({ status: "absent" as const }),
	createGitInspector: () => createGit() as never,
	homedir: () => fixture.home,
	platform: process.platform,
	...overrides,
})

const findingIds = (report: Awaited<ReturnType<typeof createDoctorReport>>) =>
	report.findings.map((finding) => finding.id)

afterEach(async () => {
	await Promise.all(
		[...temporaryRoots].map((root) =>
			fs.rm(root, { recursive: true, force: true }),
		),
	)
	temporaryRoots.clear()
})

describe("createDoctorReport edge diagnostics", () => {
	test("reports unavailable Git and plaintext presence without reading its contents", async () => {
		const fixture = await makeFixture()
		const plaintextSentinel = "SECRET_DOCTOR_MUST_NOT_READ=coverage-sentinel"
		await fs.writeFile(path.join(fixture.root, ".env.local"), plaintextSentinel)

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture, {
				createGitInspector: () =>
					createGit({ isRepository: () => false }) as never,
			}),
		)

		expect(findingIds(report)).toContain("git.unavailable")
		expect(findingIds(report)).toContain("plaintext.present")
		expect(JSON.stringify(report)).not.toContain(plaintextSentinel)
	})

	test("reports unsafe clone integration and both ignored and unignored plaintext", async () => {
		const fixture = await makeFixture()
		await fs.writeFile(path.join(fixture.root, ".env.ignored"), "ignored")
		await fs.writeFile(path.join(fixture.root, ".env.unignored"), "unignored")

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture, {
				createGitInspector: () =>
					createGit({
						configValues: () => [],
						configBooleanValues: () => [true],
						attributeValues: (filePaths: string[]) =>
							new Map(filePaths.map((filePath) => [filePath, "unspecified"])),
						trackedPaths: () => new Set<string>(),
						ignoredPaths: () => new Set([".env.ignored"]),
					}) as never,
			}),
		)
		const ids = findingIds(report)

		expect(ids).toContain("git.diff-driver")
		expect(ids).toContain("git.textconv-cache")
		expect(ids).toContain("git.attributes")
		expect(ids).toContain("plaintext.unignored")
		expect(report.findings).toContainEqual(
			expect.objectContaining({
				id: "plaintext.present",
				paths: [".env.ignored"],
			}),
		)
	})

	test("omits plaintext index commands when Git status evidence is incomplete", async () => {
		const fixture = await makeFixture()
		await fs.writeFile(path.join(fixture.root, ".env.conflicted"), "plaintext")

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture, {
				createGitInspector: () =>
					createGit({
						deletedPaths: () => undefined,
						trackedPaths: () => new Set([".env.conflicted"]),
					}) as never,
			}),
		)
		const tracked = report.findings.find(
			(finding) => finding.id === "plaintext.tracked",
		)

		expect(report.complete).toBe(false)
		expect(tracked?.paths).toEqual([".env.conflicted"])
		expect(tracked?.commands).toBeUndefined()
	})

	test("rejects a non-directory project metadata path before loading keys", async () => {
		const root = await fs.mkdtemp(
			path.join(os.tmpdir(), "dotenc-doctor-invalid-project-"),
		)
		temporaryRoots.add(root)
		const home = path.join(root, "home")
		await fs.mkdir(home)
		await fs.writeFile(path.join(root, ".dotenc"), "not a directory")

		const report = await createDoctorReport(
			{ invocationDir: root },
			{ homedir: () => home },
		)

		expect(findingIds(report)).toEqual(["project.invalid-dotenc-directory"])
		expect(report.complete).toBe(true)
		expect(report.exitCode).toBe(1)
	})

	test("treats passphrase-protected local keys as unusable and fingerprint-inconclusive", async () => {
		const fixture = await makeFixture()
		const privatePathSentinel = "/private/path/must-not-leak"

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture, {
				getPrivateKeys: async () => ({
					keys: [],
					passphraseProtectedKeys: [privatePathSentinel],
					unsupportedKeys: [
						{ name: privatePathSentinel, reason: "passphrase-protected" },
					],
				}),
				probeOnePasswordLocator: async () => ({
					status: "present" as const,
					locator: {
						accountId: "a".repeat(26),
						vaultId: "v".repeat(26),
						itemId: "i".repeat(26),
					},
				}),
			}),
		)
		const ids = findingIds(report)

		expect(ids).not.toContain("key.no-active-match")
		expect(ids).toContain("key.private-unusable")
		expect(ids).toContain("key.provider-cached")
		expect(ids).toContain("development.local-key-inconclusive")
		expect(ids).not.toContain("development.provider-inconclusive")
		expect(JSON.stringify(report)).not.toContain(privatePathSentinel)
	})

	test("sanitizes incomplete private-key and provider inventories", async () => {
		const fixture = await makeFixture()
		const privateErrorSentinel = "raw private-key path"
		const providerErrorSentinel = "raw provider account"

		const report = await createDoctorReport(
			{ invocationDir: fixture.root },
			dependencies(fixture, {
				getPrivateKeys: async () => {
					throw new Error(privateErrorSentinel)
				},
				probeOnePasswordLocator: async () => {
					throw new Error(providerErrorSentinel)
				},
			}),
		)
		const serialized = JSON.stringify(report)

		expect(report.complete).toBe(false)
		expect(report.exitCode).toBe(2)
		expect(findingIds(report)).toContain("scan.incomplete")
		expect(findingIds(report)).toContain("development.local-key-inconclusive")
		expect(serialized).not.toContain(privateErrorSentinel)
		expect(serialized).not.toContain(providerErrorSentinel)
	})

	test("bounds aggregate recursive entries across individually bounded directories", async () => {
		const fixture = await makeFixture()
		const originalOpendir = fs.opendir.bind(fs)
		let rootOpenCount = 0
		const syntheticDirectoryPrefix = path.join(fixture.root, "synthetic-")
		const fakeDirectory = (
			entryCount: number,
			namePrefix: string,
			directories: boolean,
		): Awaited<ReturnType<typeof fs.opendir>> => {
			let index = 0
			return {
				read: async () => {
					if (index >= entryCount) return null
					const name = `${namePrefix}${index}`
					index += 1
					return {
						name,
						isDirectory: () => directories,
						isFile: () => !directories,
					} as never
				},
				close: async () => {},
			} as never
		}
		const opendirSpy = spyOn(fs, "opendir").mockImplementation((async (
			directory: Parameters<typeof fs.opendir>[0],
		) => {
			const normalized = path.resolve(String(directory))
			if (normalized === fixture.root) {
				rootOpenCount += 1
				if (rootOpenCount === 2) {
					return fakeDirectory(6, "synthetic-", true)
				}
			}
			if (normalized.startsWith(syntheticDirectoryPrefix)) {
				return fakeDirectory(8_333, "entry-", false)
			}
			return originalOpendir(directory)
		}) as never)

		const report = await (async () => {
			try {
				return await createDoctorReport(
					{ invocationDir: fixture.root, all: true },
					dependencies(fixture),
				)
			} finally {
				opendirSpy.mockRestore()
			}
		})()

		expect(rootOpenCount).toBe(2)
		expect(report.complete).toBe(false)
		expect(report.exitCode).toBe(2)
		expect(findingIds(report)).toContain("scan.incomplete")
		expect(report.passed.map((entry) => entry.id)).not.toContain(
			"plaintext.clean",
		)
	})

	test("resolves a recursive DT_UNKNOWN directory or marks the scan incomplete", async () => {
		const fixture = await makeFixture()
		const unknownDirectoryName = "unknown-entry"
		const unknownDirectory = path.join(fixture.root, unknownDirectoryName)
		const nestedEnvelopeName = ".env.audit.enc"
		const nestedEnvelopePath = path.join(unknownDirectory, nestedEnvelopeName)
		await fs.mkdir(unknownDirectory)
		await fs.copyFile(
			path.join(fixture.root, ".env.development.enc"),
			nestedEnvelopePath,
		)
		const originalOpendir = fs.opendir.bind(fs)
		let rootOpenCount = 0
		let returnedUnknownEntry = false
		const opendirSpy = spyOn(fs, "opendir").mockImplementation((async (
			directory: Parameters<typeof fs.opendir>[0],
		) => {
			const normalized = path.resolve(String(directory))
			if (normalized !== fixture.root) return originalOpendir(directory)
			rootOpenCount += 1
			if (rootOpenCount !== 2) return originalOpendir(directory)
			let read = false
			return {
				read: async () => {
					if (read) return null
					read = true
					returnedUnknownEntry = true
					return {
						name: unknownDirectoryName,
						isBlockDevice: () => false,
						isCharacterDevice: () => false,
						isDirectory: () => false,
						isFIFO: () => false,
						isFile: () => false,
						isSocket: () => false,
						isSymbolicLink: () => false,
					} as never
				},
				close: async () => {},
			} as never
		}) as never)

		const report = await (async () => {
			try {
				return await createDoctorReport(
					{ invocationDir: fixture.root, all: true },
					dependencies(fixture),
				)
			} finally {
				opendirSpy.mockRestore()
			}
		})()
		const relativeEnvelopePath = `${unknownDirectoryName}/${nestedEnvelopeName}`
		const envelopeInspected = report.passed.some(
			(entry) =>
				entry.id === "repository.envelope-valid" &&
				entry.paths?.includes(relativeEnvelopePath),
		)

		expect(returnedUnknownEntry).toBe(true)
		if (envelopeInspected) {
			expect(report.complete).toBe(true)
		} else {
			expect(report.complete).toBe(false)
			expect(report.exitCode).toBe(2)
			expect(findingIds(report)).toContain("scan.incomplete")
			expect(report.passed.map((entry) => entry.id)).not.toContain(
				"git.attributes",
			)
			expect(report.passed.map((entry) => entry.id)).not.toContain(
				"plaintext.clean",
			)
		}
	})
})
