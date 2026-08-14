import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test"
import crypto from "node:crypto"
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createDataKey, decryptData, encryptData } from "../helpers/crypto"
import { decryptDataKey } from "../helpers/decryptDataKey"
import { decryptEnvironmentData as decryptEnvironmentDataDefault } from "../helpers/decryptEnvironment"
import { encryptDataKey } from "../helpers/encryptDataKey"
import { getEnvironmentByPath } from "../helpers/getEnvironmentByPath"
import { getKeyFingerprint } from "../helpers/getKeyFingerprint"
import { prepareEnvironmentRename } from "../helpers/renameEnvironment"
import type { Environment } from "../schemas/environment"

const confirmPromptMock = mock(async (_message: string) => true)
mock.module("../prompts/confirm", () => ({ confirmPrompt: confirmPromptMock }))
const { envRenameCommand } = await import("../commands/env/rename")

type Fixture = {
	dataKey: Buffer
	environment: Environment
	filePath: string
	plaintext: string
}

describe("env rename", () => {
	let keyPair: crypto.KeyPairKeyObjectResult
	let privateKeyBase64: string
	let fingerprint: string
	let workspace: string
	let nestedDir: string
	let homeDir: string
	let originalPrivateKeyBase64: string | undefined
	let homedirSpy: ReturnType<typeof spyOn>
	let cwdSpy: ReturnType<typeof spyOn>
	let logSpy: ReturnType<typeof spyOn>

	beforeAll(() => {
		keyPair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
		privateKeyBase64 = Buffer.from(
			keyPair.privateKey
				.export({ type: "pkcs8", format: "pem" })
				.toString("utf-8"),
			"utf-8",
		).toString("base64")
		fingerprint = getKeyFingerprint(keyPair.publicKey)
	})

	beforeEach(() => {
		workspace = mkdtempSync(path.join(os.tmpdir(), "dotenc-rename-"))
		nestedDir = path.join(workspace, "packages", "app")
		homeDir = path.join(workspace, "home")
		mkdirSync(path.join(workspace, ".dotenc"), { recursive: true })
		mkdirSync(nestedDir, { recursive: true })
		mkdirSync(homeDir, { recursive: true })
		originalPrivateKeyBase64 = process.env.DOTENC_PRIVATE_KEY_BASE64
		process.env.DOTENC_PRIVATE_KEY_BASE64 = privateKeyBase64
		homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir)
		cwdSpy = spyOn(process, "cwd").mockReturnValue(workspace)
		logSpy = spyOn(console, "log").mockImplementation(() => {})
		confirmPromptMock.mockClear()
		confirmPromptMock.mockImplementation(async () => true)
	})

	afterEach(() => {
		homedirSpy.mockRestore()
		cwdSpy.mockRestore()
		logSpy.mockRestore()
		if (originalPrivateKeyBase64 === undefined) {
			delete process.env.DOTENC_PRIVATE_KEY_BASE64
		} else {
			process.env.DOTENC_PRIVATE_KEY_BASE64 = originalPrivateKeyBase64
		}
		rmSync(workspace, { recursive: true, force: true })
	})

	afterAll(() => {
		privateKeyBase64 = ""
	})

	const writeEnvironment = async (
		directory: string,
		name: string,
		plaintext: string,
		version: 1 | 2 | undefined = 2,
		mode = 0o640,
	): Promise<Fixture> => {
		const dataKey = createDataKey()
		const encryptedDataKey = encryptDataKey(
			{ algorithm: "rsa", publicKey: keyPair.publicKey },
			dataKey,
		)
		const encryptedContent = await encryptData(
			dataKey,
			plaintext,
			version === 2 ? Buffer.from(name, "utf-8") : undefined,
		)
		const environment: Environment = {
			...(version === undefined ? {} : { version }),
			keys: [
				{
					name: "alice-display-name",
					fingerprint,
					encryptedDataKey: encryptedDataKey.toString("base64"),
					algorithm: "rsa",
				},
				{
					name: "offline-recipient",
					fingerprint: "offline-fingerprint",
					encryptedDataKey: Buffer.from("offline-wrapper").toString("base64"),
					algorithm: "rsa",
				},
			],
			encryptedContent: encryptedContent.toString("base64"),
		}
		const filePath = path.join(directory, `.env.${name}.enc`)
		writeFileSync(filePath, JSON.stringify(environment, null, 2), {
			encoding: "utf-8",
			mode,
		})
		chmodSync(filePath, mode)
		return { dataKey, environment, filePath, plaintext }
	}

	const readRenamed = async (directory: string, name: string) =>
		getEnvironmentByPath(path.join(directory, `.env.${name}.enc`))

	test("migrates a v1 envelope to v2 with destination-name AAD", async () => {
		const source = await writeEnvironment(
			workspace,
			"alice",
			"TOKEN=legacy\n",
			1,
			0o600,
		)
		const plan = await prepareEnvironmentRename({
			sourceName: "alice",
			destinationName: "personal.alice",
			invocationDir: workspace,
		})

		try {
			await plan.commit()
		} finally {
			plan.dispose()
		}

		const destination = await readRenamed(workspace, "personal.alice")
		expect(existsSync(source.filePath)).toBe(false)
		expect(destination.version).toBe(2)
		expect(destination.keys).toEqual(source.environment.keys)
		expect(destination.encryptedContent).not.toBe(
			source.environment.encryptedContent,
		)
		expect(
			statSync(path.join(workspace, ".env.personal.alice.enc")).mode & 0o777,
		).toBe(0o600)

		const unwrapped = decryptDataKey(
			{ algorithm: "rsa", privateKey: keyPair.privateKey },
			Buffer.from(destination.keys[0].encryptedDataKey, "base64"),
		)
		try {
			expect(unwrapped.equals(source.dataKey)).toBe(true)
			await expect(
				decryptData(
					unwrapped,
					Buffer.from(destination.encryptedContent, "base64"),
					Buffer.from("personal.alice", "utf-8"),
				),
			).resolves.toBe(source.plaintext)
			await expect(
				decryptData(
					unwrapped,
					Buffer.from(destination.encryptedContent, "base64"),
					Buffer.from("alice", "utf-8"),
				),
			).rejects.toThrow()
		} finally {
			unwrapped.fill(0)
			source.dataKey.fill(0)
		}
	})

	test("renames v2 only by decrypting with source AAD and re-encrypting with destination AAD", async () => {
		const source = await writeEnvironment(workspace, "alice", "VALUE=v2\n", 2)
		await expect(
			decryptData(
				source.dataKey,
				Buffer.from(source.environment.encryptedContent, "base64"),
				Buffer.from("personal.alice", "utf-8"),
			),
		).rejects.toThrow()

		const plan = await prepareEnvironmentRename({
			sourceName: "alice",
			destinationName: "personal.alice",
			invocationDir: workspace,
		})
		try {
			await plan.commit()
		} finally {
			plan.dispose()
		}

		const destination = await readRenamed(workspace, "personal.alice")
		expect(destination.keys).toEqual(source.environment.keys)
		await expect(
			decryptData(
				source.dataKey,
				Buffer.from(destination.encryptedContent, "base64"),
				Buffer.from("personal.alice", "utf-8"),
			),
		).resolves.toBe(source.plaintext)
		source.dataKey.fill(0)
	})

	test("rejects a v2 source whose ciphertext is bound to another name", async () => {
		const wrongName = await writeEnvironment(
			workspace,
			"other",
			"VALUE=wrong-aad\n",
			2,
		)
		const sourcePath = path.join(workspace, ".env.alice.enc")
		writeFileSync(sourcePath, readFileSync(wrongName.filePath))
		rmSync(wrongName.filePath)

		await expect(
			prepareEnvironmentRename({
				sourceName: "alice",
				destinationName: "personal.alice",
				invocationDir: workspace,
			}),
		).rejects.toThrow("could not decrypt source with its current name")
		expect(existsSync(sourcePath)).toBe(true)
		expect(existsSync(path.join(workspace, ".env.personal.alice.enc"))).toBe(
			false,
		)
		wrongName.dataKey.fill(0)
	})

	test("rejects destination collisions without changing either envelope", async () => {
		const source = await writeEnvironment(workspace, "alice", "SOURCE=1\n")
		const destination = await writeEnvironment(
			workspace,
			"personal.alice",
			"DESTINATION=1\n",
		)
		const sourceBefore = readFileSync(source.filePath)
		const destinationBefore = readFileSync(destination.filePath)

		await expect(
			prepareEnvironmentRename({
				sourceName: "alice",
				destinationName: "personal.alice",
				invocationDir: workspace,
			}),
		).rejects.toThrow("Destination environment already exists")
		expect(readFileSync(source.filePath)).toEqual(sourceBefore)
		expect(readFileSync(destination.filePath)).toEqual(destinationBefore)
		source.dataKey.fill(0)
		destination.dataKey.fill(0)
	})

	test("rolls back an unchanged target when source content changes after preflight", async () => {
		const source = await writeEnvironment(workspace, "alice", "VALUE=before\n")
		const plan = await prepareEnvironmentRename({
			sourceName: "alice",
			destinationName: "personal.alice",
			invocationDir: workspace,
		})
		writeFileSync(
			source.filePath,
			`${readFileSync(source.filePath, "utf-8")}\n`,
		)

		try {
			await expect(plan.commit()).rejects.toThrow(
				"failed before source removal",
			)
		} finally {
			plan.dispose()
		}
		expect(existsSync(source.filePath)).toBe(true)
		expect(existsSync(path.join(workspace, ".env.personal.alice.enc"))).toBe(
			false,
		)
		source.dataKey.fill(0)
	})

	test("rejects a source mode change after preflight without removing it", async () => {
		const source = await writeEnvironment(
			workspace,
			"alice",
			"VALUE=mode\n",
			2,
			0o600,
		)
		const plan = await prepareEnvironmentRename({
			sourceName: "alice",
			destinationName: "personal.alice",
			invocationDir: workspace,
		})
		chmodSync(source.filePath, 0o640)

		try {
			await expect(plan.commit()).rejects.toThrow(
				"failed before source removal",
			)
		} finally {
			plan.dispose()
		}
		expect(existsSync(source.filePath)).toBe(true)
		expect(statSync(source.filePath).mode & 0o777).toBe(0o640)
		expect(existsSync(path.join(workspace, ".env.personal.alice.enc"))).toBe(
			false,
		)
		expect(
			readdirSync(workspace).filter((entry) =>
				entry.startsWith(".dotenc-rename-quarantine-"),
			),
		).toEqual([])
		source.dataKey.fill(0)
	})

	test("rejects an identical-content source inode replacement after preflight", async () => {
		const source = await writeEnvironment(
			workspace,
			"alice",
			"VALUE=identity\n",
			2,
			0o640,
		)
		const plan = await prepareEnvironmentRename({
			sourceName: "alice",
			destinationName: "personal.alice",
			invocationDir: workspace,
		})
		const replacementPath = path.join(workspace, ".replacement.enc")
		writeFileSync(replacementPath, readFileSync(source.filePath), {
			mode: 0o640,
		})
		await fs.rename(replacementPath, source.filePath)

		try {
			await expect(plan.commit()).rejects.toThrow(
				"failed before source removal",
			)
		} finally {
			plan.dispose()
		}
		expect(existsSync(source.filePath)).toBe(true)
		expect(existsSync(path.join(workspace, ".env.personal.alice.enc"))).toBe(
			false,
		)
		source.dataKey.fill(0)
	})

	test("does not delete a source replacement introduced during quarantine", async () => {
		const source = await writeEnvironment(
			workspace,
			"alice",
			"VALUE=original\n",
		)
		const replacement = await writeEnvironment(
			nestedDir,
			"replacement",
			"VALUE=replacement\n",
		)
		const replacementBytes = readFileSync(replacement.filePath)
		let sourceMoveObserved = false
		const plan = await prepareEnvironmentRename(
			{
				sourceName: "alice",
				destinationName: "personal.alice",
				invocationDir: workspace,
			},
			{
				rename: async (from, to) => {
					await fs.rename(from, to)
					if (from === source.filePath) {
						sourceMoveObserved = true
						writeFileSync(source.filePath, replacementBytes, { mode: 0o640 })
					}
				},
			},
		)

		let failure: Error | undefined
		try {
			await plan.commit()
		} catch (error) {
			failure = error as Error
		} finally {
			plan.dispose()
		}
		expect(sourceMoveObserved).toBe(true)
		expect(readFileSync(source.filePath)).toEqual(replacementBytes)
		expect(existsSync(path.join(workspace, ".env.personal.alice.enc"))).toBe(
			true,
		)
		expect(failure?.message).toContain(
			"Source quarantine paths requiring recovery",
		)
		const retainedDirectory = readdirSync(workspace).find((entry) =>
			entry.startsWith(".dotenc-rename-quarantine-"),
		)
		expect(retainedDirectory).toBeDefined()
		expect(failure?.message).toContain(
			path.join(workspace, retainedDirectory ?? "", "entry"),
		)
		source.dataKey.fill(0)
		replacement.dataKey.fill(0)
	})

	test("keeps the verified target when a source quarantine disappears", async () => {
		const source = await writeEnvironment(workspace, "alice", "VALUE=source\n")
		const targetPath = path.join(workspace, ".env.personal.alice.enc")
		let removedQuarantinePath: string | undefined
		const plan = await prepareEnvironmentRename(
			{
				sourceName: "alice",
				destinationName: "personal.alice",
				invocationDir: workspace,
			},
			{
				rename: async (from, to) => {
					await fs.rename(from, to)
					if (from === source.filePath) {
						removedQuarantinePath = to.toString()
						await fs.unlink(to)
					}
				},
			},
		)

		let failure: Error | undefined
		try {
			await plan.commit()
		} catch (error) {
			failure = error as Error
		} finally {
			plan.dispose()
		}
		expect(existsSync(source.filePath)).toBe(false)
		expect(existsSync(targetPath)).toBe(true)
		expect(failure?.message).toContain(
			"Source quarantine paths requiring recovery",
		)
		expect(failure?.message).toContain(removedQuarantinePath ?? "missing")
		source.dataKey.fill(0)
	})

	test("keeps the verified target when the source disappears before quarantine", async () => {
		const source = await writeEnvironment(workspace, "alice", "VALUE=source\n")
		const targetPath = path.join(workspace, ".env.personal.alice.enc")
		const plan = await prepareEnvironmentRename(
			{
				sourceName: "alice",
				destinationName: "personal.alice",
				invocationDir: workspace,
			},
			{
				rename: async (from, to) => {
					if (from.toString() === source.filePath) {
						await fs.unlink(source.filePath)
					}
					await fs.rename(from, to)
				},
			},
		)

		let failure: Error | undefined
		try {
			await plan.commit()
		} catch (error) {
			failure = error as Error
		} finally {
			plan.dispose()
		}

		expect(existsSync(source.filePath)).toBe(false)
		expect(existsSync(targetPath)).toBe(true)
		expect(failure?.message).toContain(
			`Source layers without a verified original copy: "${source.filePath}"`,
		)
		expect(failure?.message).toContain(targetPath)
		expect(
			readdirSync(workspace).filter((entry) =>
				entry.startsWith(".dotenc-rename-quarantine-"),
			),
		).toEqual([])
		source.dataKey.fill(0)
	})

	test("re-verifies targets after source quarantine before deleting sources", async () => {
		const source = await writeEnvironment(workspace, "alice", "VALUE=source\n")
		const targetPath = path.join(workspace, ".env.personal.alice.enc")
		let verificationCount = 0
		const plan = await prepareEnvironmentRename(
			{
				sourceName: "alice",
				destinationName: "personal.alice",
				invocationDir: workspace,
			},
			{
				verifyTarget: async () => {
					verificationCount += 1
					if (verificationCount === 2) {
						throw new Error("synthetic second verification failure")
					}
				},
			},
		)

		try {
			await expect(plan.commit()).rejects.toThrow(
				"failed before source removal",
			)
		} finally {
			plan.dispose()
		}
		expect(verificationCount).toBe(2)
		expect(existsSync(source.filePath)).toBe(true)
		expect(existsSync(targetPath)).toBe(false)
		source.dataKey.fill(0)
	})

	test("restores a target unlinked during default second verification", async () => {
		const source = await writeEnvironment(workspace, "alice", "VALUE=source\n")
		const targetPath = path.join(workspace, ".env.personal.alice.enc")
		let verificationDecryptions = 0
		const plan = await prepareEnvironmentRename(
			{
				sourceName: "alice",
				destinationName: "personal.alice",
				invocationDir: workspace,
			},
			{
				decryptEnvironmentData: async (name, environment, context) => {
					const plaintext = await decryptEnvironmentDataDefault(
						name,
						environment,
						context,
					)
					verificationDecryptions += 1
					if (verificationDecryptions === 2) await fs.unlink(targetPath)
					return plaintext
				},
			},
		)

		try {
			await plan.commit()
		} finally {
			plan.dispose()
		}

		expect(verificationDecryptions).toBe(2)
		expect(existsSync(source.filePath)).toBe(false)
		expect(existsSync(targetPath)).toBe(true)
		expect(
			readdirSync(workspace).filter((entry) =>
				entry.startsWith(".dotenc-rename-quarantine-"),
			),
		).toEqual([])
		const destination = await readRenamed(workspace, "personal.alice")
		await expect(
			decryptData(
				source.dataKey,
				Buffer.from(destination.encryptedContent, "base64"),
				Buffer.from("personal.alice", "utf-8"),
			),
		).resolves.toBe(source.plaintext)
		source.dataKey.fill(0)
	})

	test("rolls back created targets when strict target verification fails", async () => {
		const source = await writeEnvironment(workspace, "alice", "VALUE=verify\n")
		const plan = await prepareEnvironmentRename(
			{
				sourceName: "alice",
				destinationName: "personal.alice",
				invocationDir: workspace,
			},
			{
				verifyTarget: async () => {
					throw new Error("synthetic verification failure")
				},
			},
		)

		try {
			await expect(plan.commit()).rejects.toThrow(
				"failed before source removal",
			)
		} finally {
			plan.dispose()
		}
		expect(existsSync(source.filePath)).toBe(true)
		expect(existsSync(path.join(workspace, ".env.personal.alice.enc"))).toBe(
			false,
		)
		source.dataKey.fill(0)
	})

	test("rollback preserves a destination replacement introduced during quarantine", async () => {
		const source = await writeEnvironment(workspace, "alice", "VALUE=source\n")
		const replacement = await writeEnvironment(
			nestedDir,
			"replacement",
			"VALUE=replacement\n",
		)
		const targetPath = path.join(workspace, ".env.personal.alice.enc")
		const replacementBytes = readFileSync(replacement.filePath)
		let targetMoveObserved = false
		const plan = await prepareEnvironmentRename(
			{
				sourceName: "alice",
				destinationName: "personal.alice",
				invocationDir: workspace,
			},
			{
				rename: async (from, to) => {
					await fs.rename(from, to)
					if (from === targetPath) {
						targetMoveObserved = true
						writeFileSync(to, `${readFileSync(to, "utf-8")}\n`)
						writeFileSync(targetPath, replacementBytes, { mode: 0o640 })
					}
				},
				verifyTarget: async () => {
					throw new Error("synthetic verification failure")
				},
			},
		)

		let failure: Error | undefined
		try {
			await plan.commit()
		} catch (error) {
			failure = error as Error
		} finally {
			plan.dispose()
		}
		expect(targetMoveObserved).toBe(true)
		expect(readFileSync(targetPath)).toEqual(replacementBytes)
		expect(failure?.message).toContain("destination files were retained")
		expect(failure?.message).toContain(targetPath)
		const retainedDirectory = readdirSync(workspace).find((entry) =>
			entry.startsWith(".dotenc-rename-quarantine-"),
		)
		expect(retainedDirectory).toBeDefined()
		expect(failure?.message).toContain(
			path.join(workspace, retainedDirectory ?? "", "entry"),
		)
		expect(existsSync(source.filePath)).toBe(true)
		source.dataKey.fill(0)
		replacement.dataKey.fill(0)
	})

	test("retains a published target if it changes before verification", async () => {
		const source = await writeEnvironment(workspace, "alice", "VALUE=tamper\n")
		const targetPath = path.join(workspace, ".env.personal.alice.enc")
		let mutated = false
		const plan = await prepareEnvironmentRename(
			{
				sourceName: "alice",
				destinationName: "personal.alice",
				invocationDir: workspace,
			},
			{
				syncDirectory: async () => {
					if (!mutated && existsSync(targetPath)) {
						writeFileSync(targetPath, `${readFileSync(targetPath, "utf-8")}\n`)
						mutated = true
					}
				},
			},
		)

		try {
			await expect(plan.commit()).rejects.toThrow(
				"changed or unremovable destination files were retained",
			)
		} finally {
			plan.dispose()
		}
		expect(existsSync(source.filePath)).toBe(true)
		expect(existsSync(targetPath)).toBe(true)
		source.dataKey.fill(0)
	})

	test("renames every exact source layer in the root-to-cwd chain", async () => {
		const root = await writeEnvironment(
			workspace,
			"alice",
			"ROOT=1\n",
			2,
			0o600,
		)
		const local = await writeEnvironment(
			nestedDir,
			"alice",
			"LOCAL=1\n",
			2,
			0o640,
		)
		const plan = await prepareEnvironmentRename({
			sourceName: "alice",
			destinationName: "personal.alice",
			allLayers: true,
			invocationDir: nestedDir,
		})

		expect(plan.layers.map((layer) => layer.sourcePath)).toEqual([
			root.filePath,
			local.filePath,
		])
		try {
			await plan.commit()
		} finally {
			plan.dispose()
		}

		for (const fixture of [root, local]) {
			expect(existsSync(fixture.filePath)).toBe(false)
			const destination = await readRenamed(
				path.dirname(fixture.filePath),
				"personal.alice",
			)
			expect(destination.keys).toEqual(fixture.environment.keys)
			await expect(
				decryptData(
					fixture.dataKey,
					Buffer.from(destination.encryptedContent, "base64"),
					Buffer.from("personal.alice", "utf-8"),
				),
			).resolves.toBe(fixture.plaintext)
			fixture.dataKey.fill(0)
		}
	})

	test("defaults to the current directory and leaves ancestor layers untouched", async () => {
		const root = await writeEnvironment(workspace, "alice", "ROOT=1\n")
		const local = await writeEnvironment(nestedDir, "alice", "LOCAL=1\n")
		const plan = await prepareEnvironmentRename({
			sourceName: "alice",
			destinationName: "personal.alice",
			invocationDir: nestedDir,
		})

		try {
			await plan.commit()
		} finally {
			plan.dispose()
		}
		expect(existsSync(root.filePath)).toBe(true)
		expect(existsSync(path.join(workspace, ".env.personal.alice.enc"))).toBe(
			false,
		)
		expect(existsSync(local.filePath)).toBe(false)
		expect(existsSync(path.join(nestedDir, ".env.personal.alice.enc"))).toBe(
			true,
		)
		root.dataKey.fill(0)
		local.dataKey.fill(0)
	})

	test("does not write any targets when a later layer fails full preflight", async () => {
		const root = await writeEnvironment(workspace, "alice", "ROOT=1\n")
		const invalidPath = path.join(nestedDir, ".env.alice.enc")
		writeFileSync(invalidPath, "not-json", "utf-8")

		await expect(
			prepareEnvironmentRename({
				sourceName: "alice",
				destinationName: "personal.alice",
				allLayers: true,
				invocationDir: nestedDir,
			}),
		).rejects.toThrow("preflight rejected source")
		expect(existsSync(root.filePath)).toBe(true)
		expect(existsSync(invalidPath)).toBe(true)
		expect(existsSync(path.join(workspace, ".env.personal.alice.enc"))).toBe(
			false,
		)
		expect(existsSync(path.join(nestedDir, ".env.personal.alice.enc"))).toBe(
			false,
		)
		root.dataKey.fill(0)
	})

	test("rejects a mixed all-layer chain when any destination layer exists", async () => {
		const destination = await writeEnvironment(
			workspace,
			"personal.alice",
			"ROOT_DESTINATION=1\n",
		)
		const source = await writeEnvironment(
			nestedDir,
			"alice",
			"LOCAL_SOURCE=1\n",
		)

		await expect(
			prepareEnvironmentRename({
				sourceName: "alice",
				destinationName: "personal.alice",
				allLayers: true,
				invocationDir: nestedDir,
			}),
		).rejects.toThrow("Destination environment already exists")
		expect(existsSync(source.filePath)).toBe(true)
		expect(existsSync(destination.filePath)).toBe(true)
		source.dataKey.fill(0)
		destination.dataKey.fill(0)
	})

	test("rejects symlink sources during preflight", async () => {
		const real = await writeEnvironment(workspace, "real", "VALUE=1\n")
		const sourcePath = path.join(workspace, ".env.alice.enc")
		symlinkSync(real.filePath, sourcePath)

		await expect(
			prepareEnvironmentRename({
				sourceName: "alice",
				destinationName: "personal.alice",
				invocationDir: workspace,
			}),
		).rejects.toThrow("preflight rejected source")
		expect(existsSync(sourcePath)).toBe(true)
		expect(existsSync(path.join(workspace, ".env.personal.alice.enc"))).toBe(
			false,
		)
		real.dataKey.fill(0)
	})

	test("keeps verified targets when source cleanup fails", async () => {
		const source = await writeEnvironment(workspace, "alice", "VALUE=cleanup\n")
		const plan = await prepareEnvironmentRename(
			{
				sourceName: "alice",
				destinationName: "personal.alice",
				invocationDir: workspace,
			},
			{
				unlink: async (filePath) => {
					const resolvedPath = filePath.toString()
					if (
						path.basename(resolvedPath) === "entry" &&
						path.dirname(path.dirname(resolvedPath)) === workspace
					) {
						throw Object.assign(new Error("synthetic cleanup failure"), {
							code: "EPERM",
						})
					}
					await fs.unlink(filePath)
				},
			},
		)

		let failure: Error | undefined
		try {
			await plan.commit()
		} catch (error) {
			failure = error as Error
		} finally {
			plan.dispose()
		}
		expect(failure?.message).toContain("cleanup is incomplete")
		expect(failure?.message).toContain(
			`Remaining source layers: "${source.filePath}"`,
		)
		expect(failure?.message).toContain("Removed source layers: (none)")
		expect(failure?.message).toContain(
			`Verified destination layers: "${path.join(workspace, ".env.personal.alice.enc")}"`,
		)
		expect(existsSync(source.filePath)).toBe(true)
		expect(existsSync(path.join(workspace, ".env.personal.alice.enc"))).toBe(
			true,
		)
		source.dataKey.fill(0)
	})

	test("reports exact source and destination paths after partial cleanup", async () => {
		const root = await writeEnvironment(workspace, "alice", "ROOT=1\n")
		const local = await writeEnvironment(nestedDir, "alice", "LOCAL=1\n")
		const rootTarget = path.join(workspace, ".env.personal.alice.enc")
		const localTarget = path.join(nestedDir, ".env.personal.alice.enc")
		const plan = await prepareEnvironmentRename(
			{
				sourceName: "alice",
				destinationName: "personal.alice",
				allLayers: true,
				invocationDir: nestedDir,
			},
			{
				unlink: async (filePath) => {
					const resolvedPath = filePath.toString()
					if (
						path.basename(resolvedPath) === "entry" &&
						path.dirname(path.dirname(resolvedPath)) === nestedDir
					) {
						throw Object.assign(new Error("synthetic cleanup failure"), {
							code: "EPERM",
						})
					}
					await fs.unlink(filePath)
				},
			},
		)

		let failure: Error | undefined
		try {
			await plan.commit()
		} catch (error) {
			failure = error as Error
		} finally {
			plan.dispose()
		}
		expect(failure?.message).toContain(
			`Removed source layers: "${root.filePath}"`,
		)
		expect(failure?.message).toContain(
			`Remaining source layers: "${local.filePath}"`,
		)
		expect(failure?.message).toContain(
			`Verified destination layers: "${rootTarget}", "${localTarget}"`,
		)
		expect(existsSync(root.filePath)).toBe(false)
		expect(existsSync(local.filePath)).toBe(true)
		expect(existsSync(rootTarget)).toBe(true)
		expect(existsSync(localTarget)).toBe(true)
		root.dataKey.fill(0)
		local.dataKey.fill(0)
	})

	test("restores every source when a later quarantined source changes", async () => {
		const root = await writeEnvironment(workspace, "alice", "ROOT=1\n")
		const local = await writeEnvironment(nestedDir, "alice", "LOCAL=1\n")
		const rootTarget = path.join(workspace, ".env.personal.alice.enc")
		const localTarget = path.join(nestedDir, ".env.personal.alice.enc")
		const plan = await prepareEnvironmentRename(
			{
				sourceName: "alice",
				destinationName: "personal.alice",
				allLayers: true,
				invocationDir: nestedDir,
			},
			{
				rename: async (from, to) => {
					await fs.rename(from, to)
					if (from === local.filePath) {
						writeFileSync(to, `${readFileSync(to, "utf-8")}\n`)
					}
				},
			},
		)

		let failure: Error | undefined
		try {
			await plan.commit()
		} catch (error) {
			failure = error as Error
		} finally {
			plan.dispose()
		}
		expect(failure?.message).toContain("failed before source removal")
		expect(existsSync(root.filePath)).toBe(true)
		expect(existsSync(local.filePath)).toBe(true)
		expect(existsSync(rootTarget)).toBe(false)
		expect(existsSync(localTarget)).toBe(false)
		root.dataKey.fill(0)
		local.dataKey.fill(0)
	})

	test("requires confirmation and performs no writes when it is declined", async () => {
		const source = await writeEnvironment(workspace, "alice", "VALUE=confirm\n")
		confirmPromptMock.mockImplementation(async () => false)

		await envRenameCommand("alice", "personal.alice")

		expect(confirmPromptMock).toHaveBeenCalledTimes(1)
		expect(existsSync(source.filePath)).toBe(true)
		expect(existsSync(path.join(workspace, ".env.personal.alice.enc"))).toBe(
			false,
		)
		source.dataKey.fill(0)
	})

	test("fails a non-interactive confirmation before writes", async () => {
		const source = await writeEnvironment(workspace, "alice", "VALUE=confirm\n")
		confirmPromptMock.mockImplementation(async () => {
			throw new Error(
				"Confirmation is required in non-interactive mode. Re-run with --yes to continue.",
			)
		})

		await expect(envRenameCommand("alice", "personal.alice")).rejects.toThrow(
			"--yes",
		)
		expect(existsSync(source.filePath)).toBe(true)
		expect(existsSync(path.join(workspace, ".env.personal.alice.enc"))).toBe(
			false,
		)
		source.dataKey.fill(0)
	})

	test("--yes skips confirmation and commits the prepared rename", async () => {
		const source = await writeEnvironment(workspace, "alice", "VALUE=yes\n")

		await envRenameCommand("alice", "personal.alice", { yes: true })

		expect(confirmPromptMock).not.toHaveBeenCalled()
		expect(existsSync(source.filePath)).toBe(false)
		expect(existsSync(path.join(workspace, ".env.personal.alice.enc"))).toBe(
			true,
		)
		source.dataKey.fill(0)
	})

	test("rejects invalid or identical names before touching the filesystem", async () => {
		await expect(
			prepareEnvironmentRename({
				sourceName: "../alice",
				destinationName: "personal.alice",
				invocationDir: workspace,
			}),
		).rejects.toThrow("Invalid source environment")
		await expect(
			prepareEnvironmentRename({
				sourceName: "alice",
				destinationName: "alice",
				invocationDir: workspace,
			}),
		).rejects.toThrow("must be different")
	})
})
