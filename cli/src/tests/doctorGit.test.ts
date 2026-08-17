import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
	DoctorGitInspector,
	isSafeDoctorRelativePath,
} from "../helpers/doctorGit"

const temporaryRepositories = new Set<string>()
const testPosix = process.platform === "win32" ? test.skip : test

const repositoryPath = (root: string, relativePath: string) =>
	path.join(root, ...relativePath.split("/"))

const runGit = (root: string, args: string[]): string =>
	execFileSync("git", args, {
		cwd: root,
		encoding: "utf-8",
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: os.devNull,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_DEFAULT_HASH: "sha1",
			GIT_TERMINAL_PROMPT: "0",
		},
	}).trim()

const createRepository = (objectFormat: "sha1" | "sha256" = "sha1"): string => {
	const root = mkdtempSync(path.join(os.tmpdir(), "dotenc-doctor-git-"))
	temporaryRepositories.add(root)
	runGit(root, ["init", "--quiet", `--object-format=${objectFormat}`])
	runGit(root, ["config", "--local", "user.email", "tests@dotenc.invalid"])
	runGit(root, ["config", "--local", "user.name", "dotenc tests"])
	runGit(root, ["config", "--local", "commit.gpgsign", "false"])
	return root
}

const writeRepositoryFile = (
	root: string,
	relativePath: string,
	content: string,
) => {
	const absolutePath = repositoryPath(root, relativePath)
	mkdirSync(path.dirname(absolutePath), { recursive: true })
	writeFileSync(absolutePath, content, "utf-8")
}

const commitAll = (root: string, message: string): string => {
	runGit(root, ["add", "--all"])
	runGit(root, ["commit", "--quiet", "--no-verify", "-m", message])
	return runGit(root, ["rev-parse", "HEAD"])
}

afterEach(() => {
	for (const root of temporaryRepositories) {
		rmSync(root, { recursive: true, force: true })
	}
	temporaryRepositories.clear()
})

describe("isSafeDoctorRelativePath", () => {
	test("accepts ordinary project-relative paths", () => {
		for (const filePath of [
			".env.development.enc",
			"apps/web/.env.personal.alice.enc",
			"profiles with spaces/.env.personal.josé.enc",
		]) {
			expect(isSafeDoctorRelativePath(filePath)).toBe(true)
		}
	})

	test("rejects empty, absolute, traversal, ambiguous, and control paths", () => {
		for (const filePath of [
			"",
			"/.env.development.enc",
			"../.env.development.enc",
			"apps/../.env.development.enc",
			"apps//.env.development.enc",
			"apps/",
			"apps\\.env.development.enc",
			"apps/.env.development.enc\n",
			"apps/.env.\u007f.enc",
			"apps/.env.\u009b.enc",
		]) {
			expect(isSafeDoctorRelativePath(filePath)).toBe(false)
		}
	})
})

describe("DoctorGitInspector", () => {
	test("scopes repository paths to a nested project root", () => {
		const root = createRepository()
		const projectRoot = repositoryPath(root, "packages/app")
		writeRepositoryFile(root, ".env.personal.outside.enc", "outside\n")
		writeRepositoryFile(
			root,
			"packages/app/.env.personal.alice.enc",
			"nested\n",
		)
		commitAll(root, "add profiles")

		unlinkSync(repositoryPath(root, ".env.personal.outside.enc"))
		unlinkSync(repositoryPath(root, "packages/app/.env.personal.alice.enc"))

		const inspector = new DoctorGitInspector(projectRoot)
		expect(inspector.isRepository()).toBe(true)
		expect(inspector.deletedPaths()).toEqual([
			{
				path: ".env.personal.alice.enc",
				indexDeleted: false,
				worktreeDeleted: true,
			},
		])
	})

	test("reports shallow, non-shallow, and unparsable repository states", () => {
		const root = createRepository()
		writeRepositoryFile(root, "README.md", "shallow fixture\n")
		commitAll(root, "add shallow fixture")
		expect(new DoctorGitInspector(root).isShallow()).toBe(false)

		const cloneContainer = mkdtempSync(
			path.join(os.tmpdir(), "dotenc-doctor-shallow-"),
		)
		temporaryRepositories.add(cloneContainer)
		const shallowRoot = path.join(cloneContainer, "repository")
		runGit(root, [
			"clone",
			"--quiet",
			"--depth=1",
			pathToFileURL(root).href,
			shallowRoot,
		])
		expect(new DoctorGitInspector(shallowRoot).isShallow()).toBe(true)

		const unparsable = new DoctorGitInspector(root, () => ({
			status: 0,
			stdout: Buffer.from("unknown\n"),
			failed: false,
		}))
		expect(unparsable.isShallow()).toBeUndefined()
	})

	test("distinguishes staged and unstaged tracked deletions", () => {
		const root = createRepository()
		writeRepositoryFile(root, ".env.personal.staged.enc", "staged\n")
		writeRepositoryFile(root, ".env.personal.unstaged.enc", "unstaged\n")
		commitAll(root, "add personal profiles")

		unlinkSync(repositoryPath(root, ".env.personal.staged.enc"))
		unlinkSync(repositoryPath(root, ".env.personal.unstaged.enc"))
		runGit(root, ["add", "--update", "--", ".env.personal.staged.enc"])

		expect(new DoctorGitInspector(root).deletedPaths()).toEqual([
			{
				path: ".env.personal.staged.enc",
				indexDeleted: true,
				worktreeDeleted: false,
			},
			{
				path: ".env.personal.unstaged.enc",
				indexDeleted: false,
				worktreeDeleted: true,
			},
		])
	})

	testPosix("fails closed for staged and unstaged symlink deletions", () => {
		for (const staged of [false, true]) {
			const root = createRepository()
			const filePath = ".env.personal.alice.enc"
			symlinkSync("not-an-envelope", repositoryPath(root, filePath))
			commitAll(root, `add ${staged ? "staged" : "unstaged"} symlink`)
			unlinkSync(repositoryPath(root, filePath))
			if (staged) runGit(root, ["add", "--update", "--", filePath])

			expect(new DoctorGitInspector(root).deletedPaths()).toBeUndefined()
		}
	})

	testPosix(
		"does not execute a repository clean filter while reading deletions",
		() => {
			const root = createRepository()
			const stagedPath = ".env.personal.staged.enc"
			const unstagedPath = ".env.personal.unstaged.enc"
			const probePath = ".env.personal.filter-probe.enc"
			const committedProbe = "probe-original\n"
			const controlProbe = "probe-control!\n"
			const doctorProbe = "probe-doctor!!\n"
			writeRepositoryFile(
				root,
				".gitattributes",
				".env.personal.*.enc filter=doctor-sentinel\n",
			)
			writeRepositoryFile(root, stagedPath, "staged\n")
			writeRepositoryFile(root, unstagedPath, "unstaged\n")
			writeRepositoryFile(root, probePath, committedProbe)
			commitAll(root, "add filtered personal profiles")

			unlinkSync(repositoryPath(root, stagedPath))
			runGit(root, ["add", "--update", "--", stagedPath])

			const markerPath = repositoryPath(root, "clean-filter-invoked")
			const filterPath = repositoryPath(root, "clean-filter.sh")
			writeFileSync(
				filterPath,
				`#!/bin/sh\nprintf invoked > ${JSON.stringify(markerPath)}\ncat\n`,
				"utf-8",
			)
			chmodSync(filterPath, 0o700)
			runGit(root, [
				"config",
				"--local",
				"filter.doctor-sentinel.clean",
				filterPath,
			])
			expect(
				[committedProbe, controlProbe, doctorProbe].map((content) =>
					Buffer.byteLength(content),
				),
			).toEqual([15, 15, 15])
			const probeAbsolutePath = repositoryPath(root, probePath)
			writeRepositoryFile(root, probePath, controlProbe)
			const controlMtime = new Date(Date.now() + 60_000)
			utimesSync(probeAbsolutePath, controlMtime, controlMtime)

			expect(runGit(root, ["status", "--porcelain=v1", "--", probePath])).toBe(
				`M ${probePath}`,
			)
			expect(existsSync(markerPath)).toBe(true)
			unlinkSync(markerPath)

			writeRepositoryFile(root, probePath, doctorProbe)
			const doctorMtime = new Date(Date.now() + 120_000)
			utimesSync(probeAbsolutePath, doctorMtime, doctorMtime)
			unlinkSync(repositoryPath(root, unstagedPath))

			expect(new DoctorGitInspector(root).deletedPaths()).toEqual([
				{
					path: stagedPath,
					indexDeleted: true,
					worktreeDeleted: false,
				},
				{
					path: unstagedPath,
					indexDeleted: false,
					worktreeDeleted: true,
				},
			])
			expect(existsSync(markerPath)).toBe(false)
		},
	)

	test("treats an unsafe deleted path as incomplete evidence", () => {
		const root = createRepository()
		const filePath = ".env.personal.unsafe\u202e.enc"
		writeRepositoryFile(root, filePath, "unsafe path fixture\n")
		commitAll(root, "add unsafe profile path")
		unlinkSync(repositoryPath(root, filePath))

		expect(new DoctorGitInspector(root).deletedPaths()).toBeUndefined()
	})

	test("batches tracked and ignored paths within a nested project root", () => {
		const root = createRepository()
		const projectRoot = repositoryPath(root, "packages/app")
		writeRepositoryFile(root, ".env.outside.enc", "outside\n")
		writeRepositoryFile(root, "packages/app/.gitignore", ".env.ignored.enc\n")
		writeRepositoryFile(root, "packages/app/.env.tracked.enc", "tracked\n")
		commitAll(root, "add nested project")
		writeRepositoryFile(root, "packages/app/.env.ignored.enc", "ignored\n")
		writeRepositoryFile(root, "packages/app/.env.visible.enc", "visible\n")

		const inspector = new DoctorGitInspector(projectRoot)
		expect(
			inspector.trackedPaths([
				".env.tracked.enc",
				".env.visible.enc",
				".env.outside.enc",
				".env.tracked.enc",
			]),
		).toEqual(new Set([".env.tracked.enc"]))
		expect(inspector.isTracked(".env.tracked.enc")).toBe(true)
		expect(inspector.isTracked(".env.visible.enc")).toBe(false)
		expect(
			inspector.ignoredPaths([
				".env.ignored.enc",
				".env.visible.enc",
				".env.ignored.enc",
			]),
		).toEqual(new Set([".env.ignored.enc"]))
		expect(inspector.isIgnored(".env.ignored.enc")).toBe(true)
		expect(inspector.isIgnored(".env.visible.enc")).toBe(false)
	})

	test("does not treat merge-conflict deletion statuses as recoverable deletions", () => {
		const root = createRepository()
		const deletedByThem = ".env.personal.deleted-by-them.enc"
		const deletedByUs = ".env.personal.deleted-by-us.enc"
		writeRepositoryFile(root, deletedByThem, "base\n")
		writeRepositoryFile(root, deletedByUs, "base\n")
		commitAll(root, "add conflict bases")
		const originalBranch = runGit(root, ["branch", "--show-current"])

		runGit(root, ["checkout", "--quiet", "-b", "doctor-incoming"])
		unlinkSync(repositoryPath(root, deletedByThem))
		writeRepositoryFile(root, deletedByUs, "incoming modification\n")
		commitAll(root, "incoming changes")

		runGit(root, ["checkout", "--quiet", originalBranch])
		writeRepositoryFile(root, deletedByThem, "current modification\n")
		unlinkSync(repositoryPath(root, deletedByUs))
		commitAll(root, "current changes")

		expect(() =>
			runGit(root, ["merge", "--no-edit", "--no-verify", "doctor-incoming"]),
		).toThrow()
		const conflictStatuses = runGit(root, ["status", "--porcelain=v1"]).split(
			/\r?\n/,
		)
		expect(conflictStatuses).toEqual(
			expect.arrayContaining([`UD ${deletedByThem}`, `DU ${deletedByUs}`]),
		)
		expect(new DoctorGitInspector(root).deletedPaths()).toBeUndefined()
	})

	test("reads all values from local Git configuration", () => {
		const root = createRepository()
		runGit(root, [
			"config",
			"--local",
			"--add",
			"diff.dotenc.textconv",
			"dotenc textconv",
		])
		runGit(root, [
			"config",
			"--local",
			"--add",
			"diff.dotenc.textconv",
			"dotenc textconv --strict",
		])
		runGit(root, ["config", "--local", "--add", "doctor.boundary", ""])
		runGit(root, [
			"config",
			"--local",
			"--add",
			"doctor.boundary",
			"line one\nline two",
		])

		const inspector = new DoctorGitInspector(root)
		expect(inspector.configValues("diff.dotenc.textconv")).toEqual([
			"dotenc textconv",
			"dotenc textconv --strict",
		])
		expect(inspector.configValues("doctor.boundary")).toEqual([
			"",
			"line one\nline two",
		])
		expect(inspector.configValues("doctor.missing")).toEqual([])
	})

	test("normalizes local Git boolean values", () => {
		const root = createRepository()
		runGit(root, ["config", "--local", "--add", "doctor.enabled", "yes"])
		runGit(root, ["config", "--local", "--add", "doctor.enabled", "off"])

		const inspector = new DoctorGitInspector(root)
		expect(inspector.configBooleanValues("doctor.enabled")).toEqual([
			true,
			false,
		])
		expect(inspector.configBooleanValues("doctor.missing")).toEqual([])
	})

	test("reads a bounded attribute value for a safe path", () => {
		const root = createRepository()
		writeRepositoryFile(root, ".gitattributes", ".env.*.enc diff=dotenc\n")
		const inspector = new DoctorGitInspector(root)

		expect(inspector.attributeValue(".env.personal.alice.enc", "diff")).toBe(
			"dotenc",
		)
		expect(inspector.attributeValue("../outside.enc", "diff")).toBeUndefined()
		expect(
			inspector.attributeValue(".env.personal.alice.enc", "invalid:name"),
		).toBeUndefined()
	})

	testPosix("suppresses a configured core.fsmonitor hook", () => {
		const root = createRepository()
		writeRepositoryFile(root, ".env.development.enc", "tracked\n")
		commitAll(root, "add environment")
		const hookPath = repositoryPath(root, "fsmonitor-hook.sh")
		const markerPath = repositoryPath(root, "fsmonitor-invoked")
		writeFileSync(
			hookPath,
			`#!/bin/sh\nprintf invoked > ${JSON.stringify(markerPath)}\nexit 1\n`,
			"utf-8",
		)
		chmodSync(hookPath, 0o700)
		runGit(root, ["config", "--local", "core.fsmonitor", hookPath])

		runGit(root, ["status", "--porcelain=v1"])
		expect(existsSync(markerPath)).toBe(true)
		unlinkSync(markerPath)

		expect(new DoctorGitInspector(root).deletedPaths()).toEqual([])
		expect(existsSync(markerPath)).toBe(false)
	})

	test("sanitizes inherited Git trace and repository-selection variables", () => {
		const root = createRepository()
		const decoyRoot = createRepository()
		writeRepositoryFile(root, ".env.target.enc", "target\n")
		commitAll(root, "add target")
		writeRepositoryFile(decoyRoot, ".env.decoy.enc", "decoy\n")
		commitAll(decoyRoot, "add decoy")
		const tracePath = repositoryPath(root, "git-trace.log")
		const trace2Path = repositoryPath(root, "git-trace2.json")
		const moduleUrl = new URL("../helpers/doctorGit.ts", import.meta.url).href
		const childProgram = `
			import { DoctorGitInspector } from ${JSON.stringify(moduleUrl)}
			const inspector = new DoctorGitInspector(${JSON.stringify(root)})
			const tracked = inspector.trackedPaths([".env.target.enc", ".env.decoy.enc"])
			process.stdout.write(JSON.stringify({
				repository: inspector.isRepository(),
				tracked: tracked ? [...tracked].sort() : null,
			}))
		`

		const output = execFileSync(process.execPath, ["-e", childProgram], {
			cwd: root,
			encoding: "utf-8",
			env: {
				...process.env,
				GIT_DIR: repositoryPath(decoyRoot, ".git"),
				GIT_INDEX_FILE: repositoryPath(decoyRoot, ".git/index"),
				GIT_TRACE: tracePath,
				GIT_TRACE2_EVENT: trace2Path,
				GIT_WORK_TREE: decoyRoot,
			},
		})

		expect(JSON.parse(output)).toEqual({
			repository: true,
			tracked: [".env.target.enc"],
		})
		expect(existsSync(tracePath)).toBe(false)
		expect(existsSync(trace2Path)).toBe(false)
	})

	test("returns the latest revision whose exact nested path is valid", () => {
		const root = createRepository()
		const projectRoot = repositoryPath(root, "packages/app")
		const filePath = ".env.personal.alice.enc"
		const repositoryFilePath = `packages/app/${filePath}`
		const validEnvelope = '{"version":2,"valid":true}\n'
		const invalidEnvelope = '{"version":2,"valid":false}\n'

		writeRepositoryFile(root, repositoryFilePath, validEnvelope)
		const validRevision = commitAll(root, "add valid profile")
		writeRepositoryFile(root, repositoryFilePath, invalidEnvelope)
		commitAll(root, "corrupt profile")
		unlinkSync(repositoryPath(root, repositoryFilePath))
		commitAll(root, "delete profile")

		const inspectedSources: string[] = []
		const revision = new DoctorGitInspector(projectRoot).latestValidRevision(
			filePath,
			(source) => {
				inspectedSources.push(source)
				return source === validEnvelope
			},
		)

		expect(revision).toEqual({ status: "found", revision: validRevision })
		expect(inspectedSources).toEqual([invalidEnvelope, validEnvelope])
	})

	test("returns a valid personal envelope created by a merge resolution", () => {
		const root = createRepository()
		const filePath = ".env.personal.alice.enc"
		const validEnvelope = '{"version":2,"valid":true}\n'
		writeRepositoryFile(root, filePath, '{"version":2,"state":"base"}\n')
		commitAll(root, "add merge base")
		const originalBranch = runGit(root, ["branch", "--show-current"])

		runGit(root, ["checkout", "--quiet", "-b", "doctor-incoming"])
		writeRepositoryFile(root, filePath, '{"version":2,"state":"incoming"}\n')
		commitAll(root, "change incoming profile")

		runGit(root, ["checkout", "--quiet", originalBranch])
		writeRepositoryFile(root, filePath, '{"version":2,"state":"current"}\n')
		commitAll(root, "change current profile")
		expect(() =>
			runGit(root, ["merge", "--no-edit", "--no-verify", "doctor-incoming"]),
		).toThrow()
		writeRepositoryFile(root, filePath, validEnvelope)
		const mergeRevision = commitAll(root, "resolve profile merge")
		expect(
			runGit(root, ["rev-list", "--parents", "-1", "HEAD"]).split(" "),
		).toHaveLength(3)

		expect(
			new DoctorGitInspector(root).latestValidRevision(
				filePath,
				(source) => source === validEnvelope,
			),
		).toEqual({ status: "found", revision: mergeRevision })
	})

	test("finds a valid personal envelope commit reachable only from reflog", () => {
		const root = createRepository()
		const filePath = ".env.personal.alice.enc"
		const validEnvelope = '{"version":2,"valid":true}\n'
		writeRepositoryFile(root, "README.md", "base\n")
		const baseRevision = commitAll(root, "add base")
		writeRepositoryFile(root, filePath, validEnvelope)
		const validRevision = commitAll(root, "add valid personal envelope")
		const branch = runGit(root, ["branch", "--show-current"])

		runGit(root, [
			"update-ref",
			`refs/heads/${branch}`,
			baseRevision,
			validRevision,
		])

		expect(runGit(root, ["rev-list", "--all", "--", filePath])).toBe("")
		expect(
			runGit(root, [
				"reflog",
				"show",
				"--format=%H",
				`refs/heads/${branch}`,
			]).split(/\r?\n/),
		).toContain(validRevision)
		expect(
			new DoctorGitInspector(root).latestValidRevision(
				filePath,
				(source) => source === validEnvelope,
			),
		).toEqual({ status: "found", revision: validRevision })
	})

	test("returns the latest valid revision from SHA-256 history", () => {
		const root = createRepository("sha256")
		const filePath = ".env.personal.alice.enc"
		const validEnvelope = '{"version":2,"valid":true}\n'
		const invalidEnvelope = '{"version":2,"valid":false}\n'

		writeRepositoryFile(root, filePath, validEnvelope)
		const validRevision = commitAll(root, "add valid profile")
		writeRepositoryFile(root, filePath, invalidEnvelope)
		commitAll(root, "corrupt profile")
		unlinkSync(repositoryPath(root, filePath))
		commitAll(root, "delete profile")

		expect(validRevision).toMatch(/^[0-9a-f]{64}$/)
		expect(
			new DoctorGitInspector(root).latestValidRevision(
				filePath,
				(source) => source === validEnvelope,
			),
		).toEqual({ status: "found", revision: validRevision })
	})

	test("treats wildcard characters as literals in nested history", () => {
		const root = createRepository()
		const projectRoot = repositoryPath(root, "packages/app")
		const literalPath = ".env.personal.[ab].enc"
		const matchingPath = ".env.personal.a.enc"
		const validEnvelope = '{"version":2,"literal":true}\n'

		writeRepositoryFile(root, `packages/app/${literalPath}`, validEnvelope)
		const literalRevision = commitAll(root, "add literal wildcard profile")
		unlinkSync(repositoryPath(root, `packages/app/${literalPath}`))
		commitAll(root, "delete literal wildcard profile")
		writeRepositoryFile(
			root,
			`packages/app/${matchingPath}`,
			'{"version":2,"matching":true}\n',
		)
		commitAll(root, "add pathspec match")

		expect(
			new DoctorGitInspector(projectRoot).latestValidRevision(
				literalPath,
				(source) => source === validEnvelope,
			),
		).toEqual({ status: "found", revision: literalRevision })
	})

	testPosix(
		"rejects a historical symlink even when its blob looks valid",
		() => {
			const root = createRepository()
			const projectRoot = repositoryPath(root, "packages/app")
			const filePath = ".env.personal.symlink.enc"
			const absolutePath = repositoryPath(root, `packages/app/${filePath}`)
			mkdirSync(path.dirname(absolutePath), { recursive: true })
			symlinkSync("VALID_ENVELOPE", absolutePath)
			commitAll(root, "add symlink profile")
			let validationCalls = 0

			expect(
				new DoctorGitInspector(projectRoot).latestValidRevision(
					filePath,
					() => {
						validationCalls += 1
						return true
					},
				),
			).toEqual({ status: "not-found" })
			expect(validationCalls).toBe(0)
		},
	)

	testPosix(
		"never invokes a promisor transport while inspecting local history",
		() => {
			const root = createRepository()
			const filePath = ".env.personal.remote.enc"
			writeRepositoryFile(root, filePath, "VALID_ENVELOPE\n")
			commitAll(root, "add promisor profile")
			const blobHash = runGit(root, ["rev-parse", `HEAD:${filePath}`])
			unlinkSync(
				repositoryPath(
					root,
					`.git/objects/${blobHash.slice(0, 2)}/${blobHash.slice(2)}`,
				),
			)

			const marker = repositoryPath(root, "transport-invoked")
			const transport = repositoryPath(root, "fake-promisor-transport")
			writeFileSync(transport, `#!/bin/sh\n: > "${marker}"\nexit 1\n`, "utf-8")
			chmodSync(transport, 0o755)
			runGit(root, ["config", "--local", "protocol.ext.allow", "always"])
			runGit(root, [
				"config",
				"--local",
				"remote.origin.url",
				`ext::${transport}`,
			])
			runGit(root, ["config", "--local", "remote.origin.promisor", "true"])
			runGit(root, ["config", "--local", "extensions.partialClone", "origin"])

			expect(
				new DoctorGitInspector(root).latestValidRevision(
					filePath,
					(source) => source === "VALID_ENVELOPE\n",
				),
			).toEqual({ status: "incomplete" })
			expect(existsSync(marker)).toBe(false)
		},
	)

	testPosix(
		"honors included repository config before inspecting promisor history",
		() => {
			const root = createRepository()
			const filePath = ".env.personal.included-remote.enc"
			writeRepositoryFile(root, filePath, "VALID_ENVELOPE\n")
			commitAll(root, "add included promisor profile")
			const blobHash = runGit(root, ["rev-parse", `HEAD:${filePath}`])
			unlinkSync(
				repositoryPath(
					root,
					`.git/objects/${blobHash.slice(0, 2)}/${blobHash.slice(2)}`,
				),
			)

			const marker = repositoryPath(root, "included-transport-invoked")
			const transport = repositoryPath(root, "included-promisor-transport")
			const includedConfig = repositoryPath(root, ".git/promisor.config")
			writeFileSync(transport, `#!/bin/sh\n: > "${marker}"\nexit 1\n`, "utf-8")
			chmodSync(transport, 0o755)
			writeFileSync(
				includedConfig,
				`[remote "origin"]\n\turl = ext::${transport}\n\tpromisor = true\n[extensions]\n\tpartialClone = origin\n`,
				"utf-8",
			)
			runGit(root, ["config", "--local", "protocol.ext.allow", "always"])
			runGit(root, ["config", "--local", "include.path", includedConfig])

			expect(
				new DoctorGitInspector(root).latestValidRevision(
					filePath,
					(source) => source === "VALID_ENVELOPE\n",
				),
			).toEqual({ status: "incomplete" })
			expect(existsSync(marker)).toBe(false)
		},
	)

	test("reports incomplete history when a valid revision is beyond the limit", () => {
		const root = createRepository()
		const filePath = ".env.personal.alice.enc"
		for (let index = 0; index < 65; index += 1) {
			writeRepositoryFile(
				root,
				filePath,
				index === 0 ? "VALID_ENVELOPE\n" : `INVALID_ENVELOPE_${index}\n`,
			)
			commitAll(root, `profile revision ${index}`)
		}
		let validationCalls = 0

		expect(
			new DoctorGitInspector(root).latestValidRevision(filePath, (source) => {
				validationCalls += 1
				return source === "VALID_ENVELOPE\n"
			}),
		).toEqual({ status: "incomplete" })
		expect(validationCalls).toBe(64)
	})
})
