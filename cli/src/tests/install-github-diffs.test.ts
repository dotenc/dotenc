import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { generateKeyPairSync, type KeyPairKeyObjectResult } from "node:crypto"
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import {
	_runInstallGithubDiffs,
	installGithubDiffsCommand,
} from "../commands/tools/install-github-diffs"
import { getKeyFingerprint } from "../helpers/getKeyFingerprint"
import {
	GITHUB_DIFF_DEFAULT_KEY_NAME,
	GITHUB_DIFF_SECRET_NAME,
	GITHUB_DIFF_WORKFLOW_PATH,
	type InstallGithubDiffsDependencies,
	installGithubDiffs,
	renderGithubDiffWorkflow,
} from "../helpers/installGithubDiffs"

const ACTION_SHA = "a".repeat(40)
const PLAINTEXT =
	"DATABASE_URL=postgres://example.invalid/db\nFEATURE_FLAG=true\n"

type ProjectDefinition = {
	environments: Array<{ mode?: number; path: string }>
	root: string
}

type RepositoryFixture = {
	originals: Map<string, Buffer>
	root: string
}

type GithubCall = {
	args: string[]
	cwd: string
	input?: Buffer
	sensitiveInput?: boolean
}

type GithubUploadMode = "absent-failure" | "success" | "unknown-failure"

const temporaryDirectories = new Set<string>()

const repositoryPath = (root: string, relativePath: string) =>
	path.join(root, ...relativePath.split("/"))

const runGit = (root: string, args: string[]) =>
	execFileSync("git", args, {
		cwd: root,
		encoding: "utf-8",
		env: {
			...process.env,
			GIT_CONFIG_NOSYSTEM: "1",
		},
	})

const createRepository = (
	projects: ProjectDefinition[] = [
		{
			environments: [
				{ path: ".env.production.enc" },
				{ path: "apps/web/.env.preview.enc" },
			],
			root: "",
		},
	],
): RepositoryFixture => {
	const root = mkdtempSync(path.join(os.tmpdir(), "dotenc-github-diffs-"))
	temporaryDirectories.add(root)
	const originals = new Map<string, Buffer>()

	runGit(root, ["init", "--quiet"])
	runGit(root, ["config", "user.email", "tests@dotenc.invalid"])
	runGit(root, ["config", "user.name", "dotenc tests"])
	runGit(root, ["config", "commit.gpgsign", "false"])

	for (const project of projects) {
		const projectRoot = repositoryPath(root, project.root)
		const dotencDirectory = path.join(projectRoot, ".dotenc")
		mkdirSync(dotencDirectory, { recursive: true })

		const owner = generateKeyPairSync("ed25519")
		writeFileSync(
			path.join(dotencDirectory, "owner.pub"),
			owner.publicKey.export({ format: "pem", type: "spki" }),
		)
		const fingerprint = getKeyFingerprint(owner.publicKey)

		for (const environment of project.environments) {
			const relativePath = path.posix.join(project.root, environment.path)
			const absolutePath = repositoryPath(root, relativePath)
			mkdirSync(path.dirname(absolutePath), { recursive: true })
			const content = Buffer.from(
				`${JSON.stringify(
					{
						version: 2,
						keys: [
							{
								algorithm: "ed25519",
								encryptedDataKey: Buffer.from(
									`wrapped:${relativePath}`,
								).toString("base64"),
								fingerprint,
								name: "owner",
							},
						],
						encryptedContent: Buffer.from(
							`ciphertext:${relativePath}`,
						).toString("base64"),
					},
					null,
					2,
				)}\n`,
				"utf-8",
			)
			writeFileSync(absolutePath, content)
			if (environment.mode !== undefined) {
				chmodSync(absolutePath, environment.mode)
			}
			originals.set(relativePath, content)
		}
	}

	runGit(root, ["add", "--all"])
	runGit(root, ["commit", "--quiet", "--no-verify", "-m", "fixture"])
	return { originals, root }
}

const createGithub = (
	options: {
		isFork?: boolean
		repository?: string
		secretNames?: string[]
		uploadMode?: GithubUploadMode
		url?: string
	} = {},
) => {
	const calls: GithubCall[] = []
	const secretNames = new Set(options.secretNames ?? [])
	let uploadAttempted = false
	const uploadMode = options.uploadMode ?? "success"
	const repository = options.repository ?? "acme/example"

	const implementation = async (
		args: string[],
		runOptions: {
			cwd: string
			input?: Buffer
			sensitiveInput?: boolean
		},
	): Promise<string> => {
		calls.push({
			args: [...args],
			cwd: runOptions.cwd,
			input: runOptions.input ? Buffer.from(runOptions.input) : undefined,
			sensitiveInput: runOptions.sensitiveInput,
		})

		if (args[0] === "repo" && args[1] === "view") {
			return JSON.stringify({
				isFork: options.isFork ?? false,
				nameWithOwner: repository,
				url: options.url ?? `https://github.com/${repository}`,
			})
		}
		if (args[0] === "secret" && args[1] === "list") {
			if (uploadAttempted && uploadMode === "unknown-failure") {
				throw new Error("simulated secret-list uncertainty")
			}
			return JSON.stringify([...secretNames].map((name) => ({ name })))
		}
		if (args[0] === "secret" && args[1] === "set") {
			uploadAttempted = true
			if (uploadMode === "absent-failure") {
				throw new Error("simulated upload failure")
			}
			if (uploadMode === "unknown-failure") {
				throw new Error("simulated upload uncertainty")
			}
			secretNames.add(GITHUB_DIFF_SECRET_NAME)
			return ""
		}
		if (args[0] === "api" && args[1] === "repos/dotenc/dotenc/commits/v1") {
			return `${ACTION_SHA}\n`
		}
		if (
			args[0] === "api" &&
			args[1]?.startsWith(
				"repos/dotenc/dotenc/contents/actions/diff/action.yml?ref=",
			)
		) {
			return ""
		}

		throw new Error(`Unexpected gh invocation: ${args.join(" ")}`)
	}
	const runGh = mock(implementation)

	return {
		calls,
		runGh: runGh as InstallGithubDiffsDependencies["runGh"],
		secretNames,
	}
}

const createDependencies = (options: {
	github: ReturnType<typeof createGithub>
	interactive?: boolean
	keyPair?: KeyPairKeyObjectResult
	promptConfirm?: () => Promise<boolean>
	promptMultiSelect?: () => Promise<string[]>
}) => {
	const keyPair = options.keyPair ?? generateKeyPairSync("ed25519")
	const logs: string[] = []
	const createKeyPair = mock(() => keyPair)
	const promptConfirm = mock(options.promptConfirm ?? (async () => true))
	const promptMultiSelect = mock(
		options.promptMultiSelect ?? (async () => [".env.production.enc"]),
	)
	const decryptEnvironmentData: InstallGithubDiffsDependencies["decryptEnvironmentData"] =
		async () => PLAINTEXT

	const dependencies: Partial<InstallGithubDiffsDependencies> = {
		createKeyPair,
		decryptEnvironmentData,
		isInteractive: () => options.interactive ?? false,
		log: (message) => logs.push(message),
		promptConfirm:
			promptConfirm as InstallGithubDiffsDependencies["promptConfirm"],
		promptMultiSelect:
			promptMultiSelect as InstallGithubDiffsDependencies["promptMultiSelect"],
		runGh: options.github.runGh,
	}
	return {
		createKeyPair,
		dependencies,
		keyPair,
		logs,
		promptConfirm,
		promptMultiSelect,
	}
}

const readEnvironment = (root: string, relativePath: string) =>
	JSON.parse(readFileSync(repositoryPath(root, relativePath), "utf-8")) as {
		keys: Array<{ fingerprint: string; name: string }>
	}

const secretSetCall = (github: ReturnType<typeof createGithub>) =>
	github.calls.find(
		(call) => call.args[0] === "secret" && call.args[1] === "set",
	)

afterEach(() => {
	for (const directory of temporaryDirectories) {
		rmSync(directory, { force: true, recursive: true })
	}
	temporaryDirectories.clear()
})

describe("installGithubDiffs", () => {
	test("performs a minimal non-interactive install through the command wrapper without exposing the private identity", async () => {
		const fixture = createRepository()
		const github = createGithub()
		const testDependencies = createDependencies({ github })
		const consoleMessages: string[] = []
		const consoleSpy = spyOn(console, "log").mockImplementation((message) => {
			consoleMessages.push(String(message))
		})

		try {
			const result = await _runInstallGithubDiffs(
				{
					actionRef: ACTION_SHA.toUpperCase(),
					cwd: fixture.root,
					environment: [".env.production.enc"],
					repo: "acme/example",
					yes: true,
				},
				testDependencies.dependencies,
			)

			expect(result).toEqual({
				actionRef: ACTION_SHA,
				environments: [".env.production.enc"],
				keyPaths: [".dotenc/github-diff.pub"],
				repository: "acme/example",
				secretName: GITHUB_DIFF_SECRET_NAME,
				status: "installed",
				workflowPath: GITHUB_DIFF_WORKFLOW_PATH,
			})

			const upload = secretSetCall(github)
			expect(upload?.args).toEqual([
				"secret",
				"set",
				GITHUB_DIFF_SECRET_NAME,
				"--repo",
				"acme/example",
				"--app",
				"actions",
			])
			expect(upload?.sensitiveInput).toBe(true)
			expect(upload?.input).toBeInstanceOf(Buffer)

			const encodedPrivateKey = upload?.input?.toString("ascii") ?? ""
			const privatePem = Buffer.from(encodedPrivateKey, "base64").toString(
				"utf-8",
			)
			expect(privatePem).toBe(
				testDependencies.keyPair.privateKey
					.export({ format: "pem", type: "pkcs8" })
					.toString(),
			)
			expect(privatePem).toStartWith("-----BEGIN PRIVATE KEY-----")

			const workflow = readFileSync(
				repositoryPath(fixture.root, GITHUB_DIFF_WORKFLOW_PATH),
				"utf-8",
			)
			expect(workflow).toBe(renderGithubDiffWorkflow(ACTION_SHA))
			expect(workflow).toContain("pull_request_target:")
			expect(workflow).toContain("contents: read")
			expect(workflow).toContain("pull-requests: write")
			expect(workflow).toContain("timeout-minutes: 10")
			expect(workflow).toContain(
				`uses: dotenc/dotenc/actions/diff@${ACTION_SHA}`,
			)
			expect(workflow).not.toContain("actions/checkout")
			expect(workflow).not.toContain("pull_request.head")

			const selected = readEnvironment(fixture.root, ".env.production.enc")
			expect(selected.keys.map((key) => key.name).sort()).toEqual([
				"github-diff",
				"owner",
			])
			expect(selected.keys).toHaveLength(2)
			expect(
				Buffer.compare(
					readFileSync(
						repositoryPath(fixture.root, "apps/web/.env.preview.enc"),
					),
					fixture.originals.get("apps/web/.env.preview.enc") as Buffer,
				),
			).toBe(0)

			const publicKey = readFileSync(
				path.join(fixture.root, ".dotenc", "github-diff.pub"),
				"utf-8",
			)
			const localOutput = [
				workflow,
				publicKey,
				readFileSync(
					repositoryPath(fixture.root, ".env.production.enc"),
					"utf-8",
				),
			].join("\n")
			const diagnosticOutput = [
				...testDependencies.logs,
				...consoleMessages,
				...github.calls.flatMap((call) => call.args),
			].join("\n")
			expect(localOutput).not.toContain(encodedPrivateKey)
			expect(localOutput).not.toContain(privatePem)
			expect(diagnosticOutput).not.toContain(encodedPrivateKey)
			expect(diagnosticOutput).not.toContain(privatePem)
			expect(consoleMessages.join("\n")).toContain(
				"GitHub redacted diffs are configured",
			)
		} finally {
			consoleSpy.mockRestore()
		}
	})

	test("uses interactive environment selection and makes cancellation side-effect free", async () => {
		const fixture = createRepository()
		const github = createGithub()
		const testDependencies = createDependencies({
			github,
			interactive: true,
			promptConfirm: async () => false,
			promptMultiSelect: async () => ["apps/web/.env.preview.enc"],
		})
		const consoleMessages: string[] = []
		const consoleSpy = spyOn(console, "log").mockImplementation((message) => {
			consoleMessages.push(String(message))
		})

		let result!: Awaited<ReturnType<typeof _runInstallGithubDiffs>>
		try {
			result = await _runInstallGithubDiffs(
				{ cwd: fixture.root },
				testDependencies.dependencies,
			)
		} finally {
			consoleSpy.mockRestore()
		}

		expect(result).toEqual({ status: "cancelled" })
		expect(consoleMessages).toContain("Installation cancelled.")
		expect(testDependencies.promptMultiSelect).toHaveBeenCalledTimes(1)
		const selectionCalls = testDependencies.promptMultiSelect.mock
			.calls as unknown as Array<
			[
				string,
				{
					options: Array<{ label: string; value: string }>
				},
			]
		>
		expect(selectionCalls[0]?.[1].options).toEqual([
			{ label: ".env.production.enc", value: ".env.production.enc" },
			{
				label: "apps/web/.env.preview.enc",
				value: "apps/web/.env.preview.enc",
			},
		])
		expect(testDependencies.promptConfirm).toHaveBeenCalledTimes(1)
		expect(testDependencies.createKeyPair).not.toHaveBeenCalled()
		expect(secretSetCall(github)).toBeUndefined()
		expect(
			existsSync(path.join(fixture.root, ".dotenc", "github-diff.pub")),
		).toBe(false)
		expect(
			existsSync(repositoryPath(fixture.root, GITHUB_DIFF_WORKFLOW_PATH)),
		).toBe(false)
		for (const [relativePath, original] of fixture.originals) {
			expect(
				Buffer.compare(
					readFileSync(repositoryPath(fixture.root, relativePath)),
					original,
				),
			).toBe(0)
		}
		expect(
			github.calls.some(
				(call) =>
					call.args[0] === "api" &&
					call.args[1] === "repos/dotenc/dotenc/commits/v1",
			),
		).toBe(true)
	})

	test("rejects unsafe or incomplete non-interactive option combinations before writing", async () => {
		const fixture = createRepository()
		const github = createGithub()
		const testDependencies = createDependencies({ github })

		await expect(
			installGithubDiffs(
				{
					actionRef: ACTION_SHA,
					cwd: fixture.root,
					environment: [".env.production.enc"],
				},
				testDependencies.dependencies,
			),
		).rejects.toThrow("Non-interactive installation requires --yes")

		await expect(
			installGithubDiffs(
				{
					actionRef: ACTION_SHA,
					all: true,
					cwd: fixture.root,
					environment: [".env.production.enc"],
					yes: true,
				},
				testDependencies.dependencies,
			),
		).rejects.toThrow("Options --all and --environment are mutually exclusive")

		await expect(
			installGithubDiffs(
				{ actionRef: ACTION_SHA, cwd: fixture.root, yes: true },
				testDependencies.dependencies,
			),
		).rejects.toThrow(
			"Non-interactive installation requires --environment <path> or --all",
		)

		await expect(
			installGithubDiffs(
				{ actionRef: "v1", all: true, cwd: fixture.root, yes: true },
				testDependencies.dependencies,
			),
		).rejects.toThrow("full 40-character hexadecimal commit SHA")

		await expect(
			installGithubDiffs(
				{
					actionRef: ACTION_SHA,
					all: true,
					cwd: fixture.root,
					repo: "different/repository",
					yes: true,
				},
				testDependencies.dependencies,
			),
		).rejects.toThrow("--repo does not match")

		expect(testDependencies.createKeyPair).not.toHaveBeenCalled()
		expect(secretSetCall(github)).toBeUndefined()
		expect(
			existsSync(path.join(fixture.root, ".dotenc", "github-diff.pub")),
		).toBe(false)
		expect(
			existsSync(repositoryPath(fixture.root, GITHUB_DIFF_WORKFLOW_PATH)),
		).toBe(false)
	})

	test("exercises the public command wrapper while retaining early validation errors", async () => {
		await expect(
			installGithubDiffsCommand({ keyName: "invalid/name", yes: true }),
		).rejects.toThrow("Invalid key name")
	})

	test("refuses to overwrite an existing public key, workflow, or repository secret", async () => {
		const keyFixture = createRepository()
		writeFileSync(
			path.join(keyFixture.root, ".dotenc", "github-diff.pub"),
			"existing public key",
		)
		const keyGithub = createGithub()
		await expect(
			installGithubDiffs(
				{
					actionRef: ACTION_SHA,
					all: true,
					cwd: keyFixture.root,
					yes: true,
				},
				createDependencies({ github: keyGithub }).dependencies,
			),
		).rejects.toThrow("Public key already exists; refusing to overwrite")
		expect(secretSetCall(keyGithub)).toBeUndefined()

		const workflowFixture = createRepository()
		const workflowPath = repositoryPath(
			workflowFixture.root,
			GITHUB_DIFF_WORKFLOW_PATH,
		)
		mkdirSync(path.dirname(workflowPath), { recursive: true })
		writeFileSync(workflowPath, "existing workflow\n")
		const workflowGithub = createGithub()
		await expect(
			installGithubDiffs(
				{
					actionRef: ACTION_SHA,
					all: true,
					cwd: workflowFixture.root,
					yes: true,
				},
				createDependencies({ github: workflowGithub }).dependencies,
			),
		).rejects.toThrow("Workflow already exists; refusing to overwrite")
		expect(secretSetCall(workflowGithub)).toBeUndefined()

		const deletedWorkflowFixture = createRepository()
		const deletedWorkflowPath = repositoryPath(
			deletedWorkflowFixture.root,
			GITHUB_DIFF_WORKFLOW_PATH,
		)
		mkdirSync(path.dirname(deletedWorkflowPath), { recursive: true })
		writeFileSync(deletedWorkflowPath, "tracked workflow\n")
		runGit(deletedWorkflowFixture.root, ["add", GITHUB_DIFF_WORKFLOW_PATH])
		runGit(deletedWorkflowFixture.root, [
			"commit",
			"--quiet",
			"--no-verify",
			"-m",
			"track workflow",
		])
		rmSync(deletedWorkflowPath)
		const deletedWorkflowGithub = createGithub()
		await expect(
			installGithubDiffs(
				{
					actionRef: ACTION_SHA,
					all: true,
					cwd: deletedWorkflowFixture.root,
					yes: true,
				},
				createDependencies({
					github: deletedWorkflowGithub,
				}).dependencies,
			),
		).rejects.toThrow("Installer target already exists in Git")
		expect(existsSync(deletedWorkflowPath)).toBe(false)
		expect(secretSetCall(deletedWorkflowGithub)).toBeUndefined()

		const secretFixture = createRepository()
		const secretGithub = createGithub({
			secretNames: [GITHUB_DIFF_SECRET_NAME],
		})
		await expect(
			installGithubDiffs(
				{
					actionRef: ACTION_SHA,
					all: true,
					cwd: secretFixture.root,
					yes: true,
				},
				createDependencies({ github: secretGithub }).dependencies,
			),
		).rejects.toThrow("secret DOTENC_DIFF_PRIVATE_KEY_BASE64 already exists")
		expect(secretSetCall(secretGithub)).toBeUndefined()
	})

	test("rejects GitHub Enterprise targets that cannot consume the public action safely", async () => {
		const fixture = createRepository()
		const github = createGithub({
			url: "https://github.example.test/acme/example",
		})

		await expect(
			installGithubDiffs(
				{
					actionRef: ACTION_SHA,
					all: true,
					cwd: fixture.root,
					yes: true,
				},
				createDependencies({ github }).dependencies,
			),
		).rejects.toThrow(
			"GitHub diff installer currently supports GitHub.com repositories only",
		)
		expect(secretSetCall(github)).toBeUndefined()
	})

	test("requires explicit acknowledgement for fork repositories", async () => {
		const fixture = createRepository()
		const github = createGithub({ isFork: true })
		const testDependencies = createDependencies({ github })

		await expect(
			installGithubDiffs(
				{
					actionRef: ACTION_SHA,
					all: true,
					cwd: fixture.root,
					yes: true,
				},
				testDependencies.dependencies,
			),
		).rejects.toThrow("repository is a fork")
		expect(secretSetCall(github)).toBeUndefined()

		const result = await installGithubDiffs(
			{
				actionRef: ACTION_SHA,
				all: true,
				allowFork: true,
				cwd: fixture.root,
				yes: true,
			},
			testDependencies.dependencies,
		)
		expect(result.status).toBe("installed")
		expect(secretSetCall(github)).toBeDefined()
	})

	test("restores exact environment bytes and modes when a failed upload is confirmed absent", async () => {
		const fixture = createRepository([
			{
				environments: [{ mode: 0o600, path: ".env.production.enc" }],
				root: "",
			},
		])
		const environmentPath = repositoryPath(fixture.root, ".env.production.enc")
		const original = Buffer.from(
			fixture.originals.get(".env.production.enc") as Buffer,
		)
		const github = createGithub({ uploadMode: "absent-failure" })
		const testDependencies = createDependencies({ github })

		await expect(
			installGithubDiffs(
				{
					actionRef: ACTION_SHA,
					all: true,
					cwd: fixture.root,
					yes: true,
				},
				testDependencies.dependencies,
			),
		).rejects.toThrow("simulated upload failure")

		expect(readFileSync(environmentPath)).toEqual(original)
		expect(statSync(environmentPath).mode & 0o777).toBe(0o600)
		expect(
			existsSync(path.join(fixture.root, ".dotenc", "github-diff.pub")),
		).toBe(false)
		expect(existsSync(path.join(fixture.root, ".github"))).toBe(false)
		expect(secretSetCall(github)?.sensitiveInput).toBe(true)
	})

	test("preserves local changes when a failed upload leaves the remote state ambiguous", async () => {
		const fixture = createRepository([
			{
				environments: [{ path: ".env.production.enc" }],
				root: "",
			},
		])
		const github = createGithub({ uploadMode: "unknown-failure" })
		const testDependencies = createDependencies({ github })

		await expect(
			installGithubDiffs(
				{
					actionRef: ACTION_SHA,
					all: true,
					cwd: fixture.root,
					yes: true,
				},
				testDependencies.dependencies,
			),
		).rejects.toThrow("remote state is unknown. Local changes were preserved")

		expect(
			readFileSync(repositoryPath(fixture.root, ".env.production.enc")),
		).not.toEqual(fixture.originals.get(".env.production.enc") as Buffer)
		expect(
			readEnvironment(fixture.root, ".env.production.enc").keys.map(
				(key) => key.name,
			),
		).toContain("github-diff")
		expect(
			existsSync(path.join(fixture.root, ".dotenc", "github-diff.pub")),
		).toBe(true)
		expect(
			existsSync(repositoryPath(fixture.root, GITHUB_DIFF_WORKFLOW_PATH)),
		).toBe(true)
		expect(secretSetCall(github)?.sensitiveInput).toBe(true)
	})

	test("grants one generated identity across nested dotenc roots without broadening recipients", async () => {
		const fixture = createRepository([
			{
				environments: [{ path: ".env.production.enc" }],
				root: "",
			},
			{
				environments: [{ path: ".env.service.enc" }],
				root: "services/api",
			},
		])
		const github = createGithub()
		const testDependencies = createDependencies({ github })

		const result = await installGithubDiffs(
			{
				actionRef: ACTION_SHA,
				all: true,
				cwd: fixture.root,
				yes: true,
			},
			testDependencies.dependencies,
		)
		expect(result).toMatchObject({
			environments: [".env.production.enc", "services/api/.env.service.enc"],
			keyPaths: [
				`.dotenc/${GITHUB_DIFF_DEFAULT_KEY_NAME}.pub`,
				`services/api/.dotenc/${GITHUB_DIFF_DEFAULT_KEY_NAME}.pub`,
			],
			status: "installed",
		})

		const rootKey = readFileSync(
			path.join(fixture.root, ".dotenc", "github-diff.pub"),
		)
		const nestedKey = readFileSync(
			path.join(fixture.root, "services", "api", ".dotenc", "github-diff.pub"),
		)
		expect(rootKey).toEqual(nestedKey)
		for (const relativePath of [
			".env.production.enc",
			"services/api/.env.service.enc",
		]) {
			const keys = readEnvironment(fixture.root, relativePath).keys
			expect(keys.map((key) => key.name).sort()).toEqual([
				"github-diff",
				"owner",
			])
			expect(keys).toHaveLength(2)
		}
		expect(
			github.calls.filter(
				(call) => call.args[0] === "secret" && call.args[1] === "set",
			),
		).toHaveLength(1)
	})
})
