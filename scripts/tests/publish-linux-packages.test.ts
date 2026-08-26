import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { createPublicationManifest } from "../../cli/packaging/repository"
import {
	orderPublicationObjects,
	parseManifest,
	selectPurgePaths,
	type PublicationObject,
	validateLocalFiles,
} from "../publish-linux-packages"

const immutableCacheControl =
	"public, max-age=31536000, s-maxage=31536000, immutable, no-transform"
const mutableCacheControl =
	"public, max-age=60, s-maxage=300, must-revalidate, no-transform"

const baseReleaseAssetNames = [
	"SHA256SUMS",
	"dotenc-darwin-arm64.tar.gz",
	"dotenc-darwin-x64.tar.gz",
	"dotenc-linux-arm64-musl.tar.gz",
	"dotenc-linux-arm64.tar.gz",
	"dotenc-linux-x64-musl.tar.gz",
	"dotenc-linux-x64.tar.gz",
	"dotenc-windows-x64.zip",
] as const

const temporaryDirectories: string[] = []

const workflowJob = (workflow: string, jobName: string) => {
	const lines = workflow.split("\n")
	const start = lines.indexOf(`  ${jobName}:`)
	if (start === -1) {
		throw new Error(`Workflow job ${jobName} was not found`)
	}
	const nextJob = lines.findIndex(
		(line, index) => index > start && /^  [A-Za-z0-9_-]+:$/.test(line),
	)
	return lines.slice(start, nextJob === -1 ? undefined : nextJob).join("\n")
}

const workflowStep = (workflow: string, stepName: string) => {
	const lines = workflow.split("\n")
	const start = lines.indexOf(`      - name: ${stepName}`)
	if (start === -1) {
		throw new Error(`Workflow step ${stepName} was not found`)
	}
	const nextStep = lines.findIndex(
		(line, index) => index > start && line.startsWith("      - name: "),
	)
	return lines.slice(start, nextStep === -1 ? undefined : nextStep).join("\n")
}

const workflowStepScript = (workflow: string, stepName: string) => {
	const step = workflowStep(workflow, stepName)
	const lines = step.split("\n")
	const run = lines.indexOf("        run: |")
	if (run === -1) {
		throw new Error(`Workflow step ${stepName} does not contain a run script`)
	}
	return lines
		.slice(run + 1)
		.map((line) => (line.startsWith("          ") ? line.slice(10) : line))
		.join("\n")
}

const createRecoveryWorkflowFixture = () => {
	const root = mkdtempSync(path.join(tmpdir(), "dotenc-recovery-workflow-"))
	temporaryDirectories.push(root)
	const fixtureDirectory = path.join(root, "fixtures")
	const toolDirectory = path.join(root, "bin")
	mkdirSync(fixtureDirectory)
	mkdirSync(toolDirectory)

	const packageMetadata = JSON.parse(
		readFileSync(
			path.resolve(import.meta.dir, "../../cli/package.json"),
			"utf8",
		),
	) as { version?: unknown }
	if (typeof packageMetadata.version !== "string") {
		throw new Error("CLI package fixture requires a string version")
	}
	const version = packageMetadata.version
	const sourceRunId = "32057702020"
	const artifactId = "9296974042"
	const sourceCommit = "95393260d445c8d11f9131027625a25ddbc85907"
	const checkoutCommit = "f".repeat(40)
	const tagObjectSha = "a".repeat(40)
	const repositoryId = 8675309
	const sourceRun = {
		id: Number(sourceRunId),
		event: "push",
		status: "completed",
		conclusion: "failure",
		head_branch: "main",
		head_sha: sourceCommit,
		path: ".github/workflows/release.yml",
		repository: { id: repositoryId, full_name: "dotenc/dotenc" },
		head_repository: { id: repositoryId, full_name: "dotenc/dotenc" },
	}
	const tagRef = {
		ref: `refs/tags/v${version}`,
		object: { type: "tag", sha: tagObjectSha },
	}
	const tagObject = {
		sha: tagObjectSha,
		tag: `v${version}`,
		message: [
			"dotenc-release-reservation:v1",
			`version=${version}`,
			`commit=${sourceCommit}`,
			`run-id=${sourceRunId}`,
		].join("\n"),
		object: { type: "commit", sha: sourceCommit },
	}
	const release = {
		tag_name: `v${version}`,
		draft: false,
		prerelease: false,
		published_at: "2026-08-17T18:59:00Z",
		target_commitish: sourceCommit,
		assets: baseReleaseAssetNames.map((name) => ({
			name,
			state: "uploaded",
			size: 128,
			digest: `sha256:${createHash("sha256").update(name).digest("hex")}`,
		})),
	}
	const artifact = {
		id: Number(artifactId),
		name: `linux-package-inputs-v${version}-attempt-1`,
		expired: false,
		size_in_bytes: 4096,
		workflow_run: {
			id: Number(sourceRunId),
			head_branch: "main",
			head_sha: sourceCommit,
			repository_id: repositoryId,
			head_repository_id: repositoryId,
		},
	}

	writeFileSync(
		path.join(toolDirectory, "gh"),
		[
			"#!/bin/sh",
			"set -eu",
			'request="$*"',
			'if [ "$request" = "release view --repo $GITHUB_REPOSITORY --json isDraft,publishedAt,tagName" ]; then',
			'  exec /bin/cat "$RECOVERY_FIXTURE_DIR/latest-release.json"',
			"fi",
			'if [ "$request" = "release view v$VERSION --repo $GITHUB_REPOSITORY --json isDraft,publishedAt,tagName" ]; then',
			'  exec /bin/cat "$RECOVERY_FIXTURE_DIR/target-release.json"',
			"fi",
			'if [ "$request" = "release view v$VERSION --repo $GITHUB_REPOSITORY --json assets --jq .assets[].name" ]; then',
			'  exec /bin/cat "$RECOVERY_FIXTURE_DIR/asset-names.txt"',
			"fi",
			'if [ "$request" = "api repos/$GITHUB_REPOSITORY/actions/runs/$SOURCE_RUN_ID" ]; then',
			'  exec /bin/cat "$RECOVERY_FIXTURE_DIR/source-run.json"',
			"fi",
			'if [ "$request" = "api repos/$GITHUB_REPOSITORY/git/ref/tags/v$VERSION" ]; then',
			'  exec /bin/cat "$RECOVERY_FIXTURE_DIR/tag-ref.json"',
			"fi",
			'if [ "$request" = "api repos/$GITHUB_REPOSITORY/git/tags/$RECOVERY_TAG_OBJECT_SHA" ]; then',
			'  exec /bin/cat "$RECOVERY_FIXTURE_DIR/tag-object.json"',
			"fi",
			'if [ "$request" = "api repos/$GITHUB_REPOSITORY/releases/tags/v$VERSION" ]; then',
			'  exec /bin/cat "$RECOVERY_FIXTURE_DIR/release.json"',
			"fi",
			'if [ "$request" = "api repos/$GITHUB_REPOSITORY/releases/latest" ]; then',
			'  exec /bin/cat "$RECOVERY_FIXTURE_DIR/release.json"',
			"fi",
			'if [ "$request" = "api repos/$GITHUB_REPOSITORY/actions/artifacts/$PACKAGE_INPUT_ARTIFACT_ID" ]; then',
			'  exec /bin/cat "$RECOVERY_FIXTURE_DIR/artifact.json"',
			"fi",
			'printf "%s\\n" "unexpected gh invocation: $request" >&2',
			"exit 97",
			"",
		].join("\n"),
		{ mode: 0o755 },
	)
	writeFileSync(
		path.join(toolDirectory, "git"),
		[
			"#!/bin/sh",
			"set -eu",
			'request="$*"',
			'if [ "$request" = "fetch --force --no-tags --depth=1 origin refs/tags/v$VERSION:refs/tags/v$VERSION" ]; then',
			"  exit 0",
			"fi",
			'if [ "$request" = "rev-parse HEAD^{commit}" ]; then',
			'  printf "%s\\n" "$RECOVERY_CHECKOUT_COMMIT"',
			"  exit 0",
			"fi",
			'if [ "$request" = "rev-parse v$VERSION^{commit}" ]; then',
			'  printf "%s\\n" "$RECOVERY_SOURCE_COMMIT"',
			"  exit 0",
			"fi",
			'if [ "${request#--no-pager diff --quiet --no-ext-diff --no-textconv }" != "$request" ]; then',
			"  exit 0",
			"fi",
			'if [ "$request" = "show --no-patch --format=%ct v$VERSION^{commit}" ]; then',
			'  printf "%s\\n" "1768737600"',
			"  exit 0",
			"fi",
			'printf "%s\\n" "unexpected git invocation: $request" >&2',
			"exit 98",
			"",
		].join("\n"),
		{ mode: 0o755 },
	)

	const outputPath = path.join(root, "github-output")
	const environmentPath = path.join(root, "github-env")
	const writeFixtures = (bundlePresent = false) => {
		const releaseSummary = {
			isDraft: release.draft,
			publishedAt: release.published_at,
			tagName: release.tag_name,
		}
		for (const [name, value] of [
			["latest-release.json", releaseSummary],
			["target-release.json", releaseSummary],
			["source-run.json", sourceRun],
			["tag-ref.json", tagRef],
			["tag-object.json", tagObject],
			["release.json", release],
			["artifact.json", artifact],
		] as const) {
			writeFileSync(path.join(fixtureDirectory, name), JSON.stringify(value))
		}
		const assetNames: string[] = release.assets.map(({ name }) => name)
		if (bundlePresent) {
			assetNames.push(
				`dotenc-linux-packages-${version}.tar.gz`,
				`dotenc-linux-packages-${version}.tar.gz.sha256`,
			)
		}
		writeFileSync(path.join(fixtureDirectory, "asset-names.txt"), `${assetNames.join("\n")}\n`)
		writeFileSync(outputPath, "")
		writeFileSync(environmentPath, "")
	}

	type RunOptions = {
		artifactId?: string
		bundlePresent?: boolean
		eventName?: string
		extraEnvironment?: Record<string, string>
		sourceRunId?: string
		validateOnly?: string
	}
	const runScript = (script: string, options: RunOptions = {}) => {
		writeFixtures(options.bundlePresent)
		const bashPath = Bun.which("bash")
		if (!bashPath) {
			throw new Error("bash is required for publisher tests")
		}
		return spawnSync(bashPath, ["-c", script], {
			cwd: path.resolve(import.meta.dir, "../.."),
			encoding: "utf8",
			env: {
				...process.env,
				GITHUB_ENV: environmentPath,
				GITHUB_EVENT_NAME: options.eventName ?? "workflow_dispatch",
				GITHUB_OUTPUT: outputPath,
				GITHUB_REPOSITORY: "dotenc/dotenc",
				GITHUB_SHA: checkoutCommit,
				PACKAGE_INPUT_ARTIFACT_ID: options.artifactId ?? artifactId,
				PATH: `${toolDirectory}:${process.env.PATH ?? ""}`,
				RECOVERY_CHECKOUT_COMMIT: checkoutCommit,
				RECOVERY_FIXTURE_DIR: fixtureDirectory,
				RECOVERY_SOURCE_COMMIT: sourceCommit,
				RECOVERY_TAG_OBJECT_SHA: tagObjectSha,
				SOURCE_RUN_ID: options.sourceRunId ?? sourceRunId,
				VALIDATE_ONLY: options.validateOnly ?? "false",
				VERSION: version,
				...options.extraEnvironment,
			},
		})
	}

	return {
		artifact,
		artifactId,
		fixtureDirectory,
		outputPath,
		release,
		runScript,
		sourceCommit,
		sourceRun,
		sourceRunId,
		tagObject,
		version,
	}
}

const fixture = () => {
	const root = mkdtempSync(path.join(tmpdir(), "dotenc-package-publisher-"))
	temporaryDirectories.push(root)
	const objectPath = "apt/pool/main/d/dotenc/dotenc_1.2.3_amd64.deb"
	const source = path.join(root, "public", objectPath)
	mkdirSync(path.dirname(source), { recursive: true })
	const contents = Buffer.from("signed-package-fixture")
	writeFileSync(source, contents)

	const object = {
		path: objectPath,
		source: `public/${objectPath}`,
		sha256: createHash("sha256").update(contents).digest("hex"),
		size: contents.length,
		contentType: "application/vnd.debian.binary-package",
		policy: "immutable",
		phase: 1,
		cacheControl: immutableCacheControl,
		writeMode: "create-only",
		immutable: true,
	}
	const manifest = {
		schemaVersion: 1,
		baseUrl: "https://packages.dotenc.org",
		generatedAt: "2026-07-18T12:00:00Z",
		edge: {
			cacheableStatusCodes: [200, 206],
			negativeCacheStatuses: [404, 410],
			negativeTtlSeconds: 30,
			noStoreStatusRange: [500, 599],
			r2DevEndpointEnabled: false,
			honorRangeRequests: true,
		},
		policies: {
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
		},
		objects: [object],
		purgePaths: [objectPath],
	}

	const writeManifest = (value: unknown) => {
		const manifestPath = path.join(root, "publication-manifest.json")
		writeFileSync(manifestPath, `${JSON.stringify(value)}\n`)
		return manifestPath
	}

	return { root, object, manifest, writeManifest }
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true })
	}
})

describe("Linux package publication manifest", () => {
	test("gates binary releases on the triggering main version change", () => {
		const releaseWorkflow = readFileSync(
			path.resolve(import.meta.dir, "../../.github/workflows/release.yml"),
			"utf8",
		)
		const versionJob = workflowJob(releaseWorkflow, "check-version")
		const releaseJob = workflowJob(releaseWorkflow, "build-and-release")

		expect(releaseWorkflow).toContain(
			"concurrency:\n  group: release-binaries-production\n  cancel-in-progress: false\n  queue: max",
		)
		expect(versionJob).toContain("          fetch-depth: 0")
		expect(versionJob).toContain("    permissions:\n      contents: write")
		expect(versionJob).toContain(
			"          DOTENC_RELEASE_BEFORE_SHA: ${{ github.event.before }}",
		)
		expect(versionJob).toContain("          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}")
		expect(versionJob).toContain("run: bun run ./scripts/check-cli-release.ts")
		expect(versionJob).not.toContain("npm view")
		expect(releaseJob).toContain(
			"if: github.event_name == 'push' && needs.check-version.outputs.bumped == 'true'",
		)
		const targetCheck = releaseJob.indexOf(
			"bun run ./scripts/check-cli-release.ts --target-only",
		)
		const releaseAction = releaseJob.indexOf(
			"uses: softprops/action-gh-release@",
		)
		const releaseVerification = releaseJob.indexOf(
			"bun run ./scripts/check-cli-release.ts --verify-release",
		)
		expect(targetCheck).toBeGreaterThan(-1)
		expect(releaseAction).toBeGreaterThan(targetCheck)
		expect(releaseVerification).toBeGreaterThan(releaseAction)
		expect(releaseJob).toContain("          target_commitish: ${{ github.sha }}")
		expect(releaseJob).toContain("          overwrite_files: false")
	})

	test("passes protected secrets to both release publisher workflows", () => {
		const releaseWorkflow = readFileSync(
			path.resolve(import.meta.dir, "../../.github/workflows/release.yml"),
			"utf8",
		)

		for (const [jobName, reusableWorkflow] of [
			["publish-linux-packages", "publish-linux-packages.yml"],
			["publish-aur-package", "publish-aur-package.yml"],
		] as const) {
			const job = workflowJob(releaseWorkflow, jobName)
			expect(job).toContain(`uses: ./.github/workflows/${reusableWorkflow}`)
			expect(job).toContain("    secrets: inherit")
		}
	})

	test("keeps manual reusable secret validation non-publishing", () => {
		const releaseWorkflow = readFileSync(
			path.resolve(import.meta.dir, "../../.github/workflows/release.yml"),
			"utf8",
		)
		const linuxJob = workflowJob(
			releaseWorkflow,
			"validate-linux-package-secrets",
		)
		const aurJob = workflowJob(
			releaseWorkflow,
			"validate-aur-package-secrets",
		)
		const imageJob = workflowJob(releaseWorkflow, "publish-cli-image")

		for (const job of [linuxJob, aurJob]) {
			expect(job).toContain(
				"github.event_name == 'workflow_dispatch' &&\n      inputs.validate_package_secrets == true",
			)
			expect(job).toContain("    secrets: inherit")
		}
		expect(releaseWorkflow).toMatch(
			/workflow_dispatch:\n\s+inputs:\n\s+validate_package_secrets:[\s\S]*?default: false/,
		)
		expect(imageJob).toContain("inputs.validate_package_secrets != true")
		expect(linuxJob).toContain("      contents: write")
		expect(linuxJob).toContain("      validate_only: true")
		expect(aurJob).toContain("      publish: false")
	})

	test("uses AlmaLinux rpmkeys' 8-hex signing key ID", () => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)
		expect(workflow).toContain(
			"rpm_key_id=${RPM_SIGNING_FINGERPRINT: -8}",
		)
		expect(workflow).not.toContain(
			"rpm_key_id=${RPM_SIGNING_FINGERPRINT: -16}",
		)
	})

	test("uses full AlmaLinux DNF for repository signature verification", () => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)
		expect(workflow).toContain("dnf install --assumeyes dotenc")
		expect(workflow).not.toContain("microdnf")
		expect(workflow).not.toContain("almalinux:9-minimal")
	})

	test("compares the AlmaLinux-installed RPM key by SHA-256 without cmp", () => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)
		const directInstallerBlocks = [
			...workflow.matchAll(
				/if \[ "\$TEST_DIRECT_INSTALLERS" = "true" \]; then\n([\s\S]*?)\n\s+fi/g,
			),
		].map((match) => match[1] ?? "")
		const rpmDirectInstallerBlock = directInstallerBlocks[1]
		if (!rpmDirectInstallerBlock) {
			throw new Error("RPM direct-installer block was not found")
		}
		const keyComparison = [
			"canonical_key_sha256=$(sha256sum /repo/keys/dotenc-rpm.asc)",
			"                  canonical_key_sha256=${canonical_key_sha256%% *}",
			"                  installed_key_sha256=$(sha256sum /etc/pki/rpm-gpg/dotenc.asc)",
			"                  installed_key_sha256=${installed_key_sha256%% *}",
			'                  test "$installed_key_sha256" = "$canonical_key_sha256"',
		].join("\n")

		expect(rpmDirectInstallerBlock).toContain(keyComparison)
		expect(rpmDirectInstallerBlock).not.toMatch(/(^|\s)cmp(?:\s|$)/m)

		const root = mkdtempSync(path.join(tmpdir(), "dotenc-rpm-key-check-"))
		temporaryDirectories.push(root)
		const canonicalKeyPath = path.join(root, "canonical.asc")
		const installedKeyPath = path.join(root, "installed.asc")
		const toolDirectory = path.join(root, "bin")
		mkdirSync(toolDirectory)
		writeFileSync(canonicalKeyPath, "same public RPM key\n")
		writeFileSync(installedKeyPath, "same public RPM key\n")
		const sha256sumPath = Bun.which("sha256sum")
		if (!sha256sumPath) {
			throw new Error("sha256sum is required for publisher tests")
		}
		symlinkSync(sha256sumPath, path.join(toolDirectory, "sha256sum"))
		const runnableComparison = keyComparison
			.replace(
				"/repo/keys/dotenc-rpm.asc",
				'"$CANONICAL_RPM_KEY_PATH"',
			)
			.replace(
				"/etc/pki/rpm-gpg/dotenc.asc",
				'"$INSTALLED_RPM_KEY_PATH"',
			)
		const runComparison = () =>
			spawnSync("/bin/sh", ["-euc", runnableComparison], {
				env: {
					...process.env,
					CANONICAL_RPM_KEY_PATH: canonicalKeyPath,
					INSTALLED_RPM_KEY_PATH: installedKeyPath,
					PATH: toolDirectory,
				},
			})

		expect(runComparison().status).toBe(0)
		writeFileSync(installedKeyPath, "different public RPM key\n")
		expect(runComparison().status).not.toBe(0)
	})

	test("keeps direct installer verification on local repositories", () => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)
		const directInstallerBlocks = [
			...workflow.matchAll(
				/if \[ "\$TEST_DIRECT_INSTALLERS" = "true" \]; then\n([\s\S]*?)\n\s+fi/g,
			),
		].map((match) => match[1] ?? "")
		const aptIsolation = [
			'sed -i "s|^URIs: https://packages.dotenc.org/apt$|URIs: file:/repo/apt|" \\',
			"                    /etc/apt/sources.list.d/dotenc.sources",
			'                  grep -Fx "URIs: file:/repo/apt" \\',
			"                    /etc/apt/sources.list.d/dotenc.sources >/dev/null",
			'                  ! grep -F "packages.dotenc.org" \\',
			"                    /etc/apt/sources.list.d/dotenc.sources >/dev/null",
			"                  apt-get update >/dev/null",
		].join("\n")
		const rpmIsolation = [
			'sed -i "s|^baseurl=https://packages.dotenc.org/rpm/.*$|baseurl=file:///repo/rpm/$RPM_ARCH|" \\',
			"                    /etc/yum.repos.d/dotenc.repo",
			'                  grep -Fx "baseurl=file:///repo/rpm/$RPM_ARCH" \\',
			"                    /etc/yum.repos.d/dotenc.repo >/dev/null",
			'                  ! grep -F "packages.dotenc.org" \\',
			"                    /etc/yum.repos.d/dotenc.repo >/dev/null",
			"                  dnf --assumeyes \\",
			'                    --disablerepo="*" \\',
			"                    --enablerepo=dotenc \\",
			"                    makecache >/dev/null",
		].join("\n")

		expect(directInstallerBlocks).toHaveLength(2)
		expect(directInstallerBlocks[0]).toContain(aptIsolation)
		expect(directInstallerBlocks[1]).toContain(rpmIsolation)
		expect(directInstallerBlocks[1]).toContain(
			"test ! -e /etc/yum.repos.d/dotenc.repo.rpmnew",
		)
		expect(directInstallerBlocks[1]).toContain(
			"test ! -e /etc/yum.repos.d/dotenc.repo.rpmsave",
		)
	})

	test("verifies short Linux key aliases at the public edge", () => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)

		for (const [aliasPath, contentType] of [
			["keys/linux/apt", "application/pgp-keys"],
			["keys/linux/rpm", "application/pgp-keys"],
			["keys/linux/apk", "application/x-pem-file"],
		] as const) {
			expect(workflow).toContain(`assert_content_type ${aliasPath} ${contentType}`)
		}
		expect(workflow).toContain('"$edge_dir/keys/linux/apt"')
		expect(workflow).toContain('"$edge_dir/keys/linux/rpm"')
		expect(workflow).toContain('"$edge_dir/keys/linux/apk"')
	})

	test("pins distinct install images for each validated architecture", () => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)
		for (const image of [
			"debian:bookworm-slim@sha256:63a496b5d3b99214b39f5ed70eb71a61e590a77979c79cbee4faf991f8c0783e",
			"debian:bookworm-slim@sha256:9b67294679b30e5d6ab257b40594feeb4a4b81f7fcf4131f4decf0d6a212a9b0",
			"almalinux:9@sha256:28db580abb508f7ccbc0ac6d53e1d8da9d42a26c77fa3dcc26ac2726673fbe3e",
			"almalinux:9@sha256:2c999b3bd705fad8b115741d9036ae2499148ba162752f09f2f4ab62b0c07320",
			"alpine:3.22.3@sha256:e0baf8c394150ac5a14925e179100519f5e37c53547f647acbd9f8eb3e5c4528",
			"alpine:3.22.3@sha256:42148bde0efbaf68c898a31697c37422abec27c85ffb9cbb1d07278dc3639050",
		]) {
			expect(workflow).toContain(image)
		}
		for (const imageName of ["debian", "almalinux", "alpine"]) {
			expect(workflow).toContain(
				`${imageName}_image=\${${imageName}_images[$index]}`,
			)
		}
	})

	test("keeps manual signing-key validation non-publishing by default", () => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)

		expect(workflow).toMatch(
			/workflow_dispatch:[\s\S]*?validate_only:[\s\S]*?default: true/,
		)
		expect(workflow).toContain(
			"if: inputs.validate_only == true || vars.LINUX_PACKAGES_ENABLED == 'true'",
		)
		for (const stepName of [
			"Upload canonical signed package bundle to the GitHub release",
			"Archive the exact repository publication",
			"Publish repository objects to R2",
			"Verify the public edge and signed repository roots",
			"Reconcile native installers on the GitHub release",
		]) {
			const escapedStepName = stepName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			expect(workflow).toMatch(
				new RegExp(
					`- name: ${escapedStepName}\\n\\s+if: [^\\n]*validate_only != 'true'`,
				),
			)
		}
	})

	test("allows manual dispatch to publish with validate_only explicitly false", () => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)
		const dispatchBlock = workflow.match(
			/  workflow_dispatch:\n[\s\S]*?\n  schedule:/,
		)?.[0]
		if (!dispatchBlock) {
			throw new Error("workflow_dispatch inputs were not found")
		}
		expect(dispatchBlock).toMatch(
			/validate_only:\n\s+description:[^\n]+\n\s+required: true\n\s+type: boolean\n\s+default: true/,
		)
		expect(workflow).toContain(
			"if: inputs.validate_only == true || vars.LINUX_PACKAGES_ENABLED == 'true'",
		)
		expect(workflow).toContain("      VALIDATE_ONLY: ${{ inputs.validate_only }}")
		expect(workflow).toMatch(
			/elif \[\[ "\$bundle_present" == "true" \]\]; then[\s\S]*?\n\s+refresh=true/,
		)

		const validationGuard = [
			"validate_only=${VALIDATE_ONLY:-false}",
			'if [[ "$validate_only" != "true" && "$validate_only" != "false" ]]; then',
			'  echo "validate_only must be a boolean" >&2',
			"  exit 1",
			"fi",
			'if [[ "$validate_only" == "true" && "$GITHUB_EVENT_NAME" != "workflow_dispatch" ]]; then',
			'  echo "Non-publishing signing-key validation is restricted to manual workflow dispatch" >&2',
			"  exit 1",
			"fi",
		].join("\n")
		expect(workflow).toContain(
			validationGuard
				.split("\n")
				.map((line) => `          ${line}`)
				.join("\n"),
		)
		const guardResult = spawnSync("/bin/bash", ["-euc", validationGuard], {
			env: {
				...process.env,
				GITHUB_EVENT_NAME: "workflow_dispatch",
				VALIDATE_ONLY: "false",
			},
		})
		expect(guardResult.status).toBe(0)

		for (const stepName of [
			"Upload canonical signed package bundle to the GitHub release",
			"Publish repository objects to R2",
			"Verify the public edge and signed repository roots",
		]) {
			const escapedStepName = stepName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			expect(workflow).toMatch(
				new RegExp(
					`- name: ${escapedStepName}\\n\\s+if: [^\\n]*validate_only != 'true'`,
				),
			)
		}
	})

	test("authorizes an exact reviewed cross-run initial-publication recovery", () => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)
		const resolveScript = workflowStepScript(
			workflow,
			"Resolve publication target",
		)
		const fixture = createRecoveryWorkflowFixture()
		const result = fixture.runScript(resolveScript)
		if (result.status !== 0) {
			throw new Error(`Valid recovery fixture failed: ${result.stderr}`)
		}
		const outputs = readFileSync(fixture.outputPath, "utf8")

		expect(outputs).toContain("validate_only=false\n")
		expect(outputs).toContain("refresh=false\n")
		expect(outputs).toContain("recovery=true\n")
		expect(outputs).toContain(`source_run_id=${fixture.sourceRunId}\n`)
		expect(outputs).toContain(`release_commit=${fixture.sourceCommit}\n`)
		for (const packageGenerationInput of [
			"bun.lockb",
			"cli/package.json",
			"cli/packaging",
			"package.json",
			"scripts/alpine-package-tool.sh",
			"scripts/publish-linux-packages.ts",
			"scripts/verify-packages-edge.sh",
		]) {
			expect(resolveScript).toContain(packageGenerationInput)
		}
	})

	test.each([
		[
			"signing-key validation inputs",
			{ validateOnly: "true" },
			"Signing-key validation does not accept recovery artifact inputs",
		],
		[
			"recovery inputs after the canonical bundle exists",
			{ bundlePresent: true },
			"Recovery artifact inputs are invalid after the canonical Linux bundle exists",
		],
		[
			"an incomplete recovery input pair",
			{ sourceRunId: "" },
			"Manual initial recovery requires canonical source run and artifact IDs",
		],
		[
			"a push-triggered source-run override",
			{ eventName: "push" },
			"Push-triggered initial signing does not accept a source release run override",
		],
	] as const)("rejects %s", (_name, options, expectedError) => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)
		const fixture = createRecoveryWorkflowFixture()
		const result = fixture.runScript(
			workflowStepScript(workflow, "Resolve publication target"),
			options,
		)

		expect(result.status).not.toBe(0)
		expect(result.stderr).toContain(expectedError)
	})

	test.each(
		[
			[
				"source run",
				(fixture: ReturnType<typeof createRecoveryWorkflowFixture>) => {
					fixture.sourceRun.id += 1
				},
				"The recovery source is not an exact failed main release workflow run",
			],
			[
				"annotated reservation",
				(fixture: ReturnType<typeof createRecoveryWorkflowFixture>) => {
					fixture.tagObject.message = "reservation for a different run"
				},
				"The release reservation does not authorize this recovery source run",
			],
			[
				"published release",
				(fixture: ReturnType<typeof createRecoveryWorkflowFixture>) => {
					fixture.release.target_commitish = "b".repeat(40)
				},
				"The published release is not valid for manual initial recovery",
			],
			[
				"artifact workflow run",
				(fixture: ReturnType<typeof createRecoveryWorkflowFixture>) => {
					fixture.artifact.workflow_run.id += 1
				},
				"The recovery artifact does not belong to the authorized release run",
			],
			[
				"artifact name",
				(fixture: ReturnType<typeof createRecoveryWorkflowFixture>) => {
					fixture.artifact.name = "linux-package-inputs-unbound"
				},
				"The recovery artifact name is invalid",
			],
		] as const,
	)("rejects a mismatched %s binding", (_name, mutate, expectedError) => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)
		const fixture = createRecoveryWorkflowFixture()
		mutate(fixture)
		const result = fixture.runScript(
			workflowStepScript(workflow, "Resolve publication target"),
		)

		expect(result.status).not.toBe(0)
		expect(result.stderr).toContain(expectedError)
	})

	test("pins and binds the cross-run artifact download", () => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)
		const sameRunDownload = workflowStep(
			workflow,
			"Download immutable same-run Linux package inputs",
		)
		const recoveryDownload = workflowStep(
			workflow,
			"Download reviewed recovery Linux package inputs",
		)

		expect(workflow).toContain(
			"concurrency:\n  group: linux-packages-production\n  cancel-in-progress: false\n  queue: max",
		)
		expect(sameRunDownload).toContain(
			"steps.target.outputs.recovery != 'true'",
		)
		expect(recoveryDownload).toContain("id: recovery_release")
		expect(recoveryDownload).toContain(
			"uses: actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131 # v7",
		)
		expect(recoveryDownload).toContain(
			"          artifact-ids: ${{ inputs.package_input_artifact_id }}",
		)
		expect(recoveryDownload).toContain(
			"          github-token: ${{ github.token }}",
		)
		expect(recoveryDownload).toContain(
			"          repository: ${{ github.repository }}",
		)
		expect(recoveryDownload).toContain(
			"          run-id: ${{ steps.target.outputs.source_run_id }}",
		)
		expect(recoveryDownload).toContain("          merge-multiple: true")
	})

	test("revalidates recovery identity and asset digests before signing", () => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)
		const verifyScript = workflowStepScript(
			workflow,
			"Verify checksums and extract Linux binaries",
		)
		const checksumStart = verifyScript.indexOf(
			'checksum_file="$RUNNER_TEMP/linux-SHA256SUMS"',
		)
		if (checksumStart === -1) {
			throw new Error("Linux checksum verification boundary was not found")
		}
		const recoveryVerification = verifyScript.slice(0, checksumStart)
		expect(recoveryVerification).toContain(
			'"repos/$GITHUB_REPOSITORY/git/ref/tags/v$VERSION"',
		)
		expect(recoveryVerification).toContain(
			'"repos/$GITHUB_REPOSITORY/git/tags/$tag_object_sha"',
		)
		expect(recoveryVerification).toContain(
			'"repos/$GITHUB_REPOSITORY/releases/latest"',
		)
		expect(recoveryVerification).toContain(
			"The base GitHub release asset set changed after recovery authorization",
		)
		expect(recoveryVerification).toContain(
			'artifact_sha256=$(sha256sum "$DOWNLOAD_DIR/$asset")',
		)
		expect(
			workflow.indexOf("      - name: Verify checksums and extract Linux binaries"),
		).toBeLessThan(
			workflow.indexOf("      - name: Build and sign repository payload"),
		)

		const fixture = createRecoveryWorkflowFixture()
		const downloadDirectory = path.join(
			path.dirname(fixture.fixtureDirectory),
			"download",
		)
		mkdirSync(downloadDirectory)
		const recoveryAssets = [
			"SHA256SUMS",
			"dotenc-linux-x64.tar.gz",
			"dotenc-linux-arm64.tar.gz",
			"dotenc-linux-x64-musl.tar.gz",
			"dotenc-linux-arm64-musl.tar.gz",
		]
		for (const assetName of recoveryAssets) {
			const contents = Buffer.from(`immutable recovery bytes for ${assetName}`)
			writeFileSync(path.join(downloadDirectory, assetName), contents)
			const releaseAsset = fixture.release.assets.find(
				({ name }) => name === assetName,
			)
			if (!releaseAsset) {
				throw new Error(`Release fixture is missing ${assetName}`)
			}
			releaseAsset.size = contents.length
			releaseAsset.digest = `sha256:${createHash("sha256")
				.update(contents)
				.digest("hex")}`
		}
		const recoveryEnvironment = {
			DOWNLOAD_DIR: downloadDirectory,
			RECOVERY: "true",
			RELEASE_COMMIT: fixture.sourceCommit,
			RUNNER_TEMP: path.dirname(fixture.fixtureDirectory),
		}
		const validResult = fixture.runScript(recoveryVerification, {
			extraEnvironment: recoveryEnvironment,
		})
		if (validResult.status !== 0) {
			throw new Error(
				`Valid pre-sign recovery verification failed: ${validResult.stderr}`,
			)
		}

		fixture.release.tag_name = "v0.15.0"
		const staleReleaseResult = fixture.runScript(recoveryVerification, {
			extraEnvironment: recoveryEnvironment,
		})
		expect(staleReleaseResult.status).not.toBe(0)
		expect(staleReleaseResult.stderr).toContain(
			"The GitHub release changed after recovery authorization",
		)
		fixture.release.tag_name = `v${fixture.version}`

		writeFileSync(
			path.join(downloadDirectory, "dotenc-linux-x64.tar.gz"),
			"mutated cross-run artifact",
		)
		const mismatchedResult = fixture.runScript(recoveryVerification, {
			extraEnvironment: recoveryEnvironment,
		})
		expect(mismatchedResult.status).not.toBe(0)
		expect(mismatchedResult.stderr).toContain(
			"Recovery artifact dotenc-linux-x64.tar.gz does not match the published release",
		)
	})

	test("publishes stable native installer assets after edge verification", () => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)

		for (const asset of [
			"dotenc-amd64.deb",
			"dotenc-arm64.deb",
			"dotenc-x86_64.rpm",
			"dotenc-aarch64.rpm",
			"dotenc-linux-installers.sha256",
		]) {
			expect(workflow).toContain(asset)
		}
		expect(
			workflow.indexOf("Verify the public edge and signed repository roots"),
		).toBeLessThan(
				workflow.indexOf("Reconcile native installers on the GitHub release"),
			)
		expect(workflow).toContain("release_has_asset")
		expect(workflow).toContain("refusing to overwrite it")
		expect(workflow).toContain("sha256sum --check --strict")
		expect(workflow).toContain("--enablerepo=dotenc")
		expect(workflow).toContain("makecache >/dev/null")
		expect(workflow).toContain(
			"test ! -e /etc/apt/sources.list.d/dotenc.sources",
		)
		expect(workflow).toContain("test ! -e /etc/yum.repos.d/dotenc.repo")
	})

	test("contains transient nFPM RPM key material inside the scrubbed signing directory", () => {
		const workflow = readFileSync(
			path.resolve(
				import.meta.dir,
				"../../.github/workflows/publish-linux-packages.yml",
			),
			"utf8",
		)

		expect(workflow).toContain(
			'export DOTENC_PACKAGING_SECRET_SCRATCH_DIR="$signing_dir"',
		)
		expect(workflow).toContain(
			'export NFPM_RPM_KEY_FILE="$rpm_gpg_private_key"',
		)
		expect(workflow).toContain(
			'export DOTENC_RPM_GPG_PASSPHRASE_FILE="$rpm_gpg_passphrase_file"',
		)
		expect(workflow).not.toContain("export NFPM_RPM_PASSPHRASE_FILE=")
		expect(workflow).toContain(
			'"$signing_dir/nfpm-rpm-secret/gnupg"',
		)
		expect(workflow).toContain(
			'"$signing_dir/nfpm-rpm-secret/inspect-gnupg"',
		)
		expect(workflow).not.toContain('if [[ -d "$isolated_home" ]]')
		expect(workflow).toContain(
			'find "$signing_dir" -type f -exec shred --force --remove {} +',
		)
	})

	test("does not purge an existing identical immutable object", () => {
		const objectPath = "apt/pool/main/d/dotenc/dotenc_1.2.3_amd64.deb"
		expect(
			selectPurgePaths([objectPath], new Map([[objectPath, "unchanged"]])),
		).toEqual([])
	})

	test("purges a newly created immutable object", () => {
		const objectPath = "apt/pool/main/d/dotenc/dotenc_1.2.3_amd64.deb"
		expect(
			selectPurgePaths([objectPath], new Map([[objectPath, "created"]])),
		).toEqual([objectPath])
	})

	test("accepts the repository builder's publication contract", async () => {
		const { root, writeManifest } = fixture()
		const builderManifest = await createPublicationManifest(
			path.join(root, "public"),
			"https://packages.dotenc.org",
			1_768_737_600,
		)
		const parsed = parseManifest(writeManifest(builderManifest))
		expect(validateLocalFiles(root, parsed.objects).size).toBe(1)
	})

	test("accepts nested mutable signing-key aliases", async () => {
		const { root, writeManifest } = fixture()
		const aliasPaths = ["keys/linux/apt", "keys/linux/rpm", "keys/linux/apk"]
		for (const aliasPath of aliasPaths) {
			const source = path.join(root, "public", aliasPath)
			mkdirSync(path.dirname(source), { recursive: true })
			writeFileSync(source, `public key for ${aliasPath}`)
		}
		const builderManifest = await createPublicationManifest(
			path.join(root, "public"),
			"https://packages.dotenc.org",
			1_768_737_600,
		)
		const parsed = parseManifest(writeManifest(builderManifest))
		for (const aliasPath of aliasPaths) {
			expect(
				parsed.objects.find((object) => object.path === aliasPath),
			).toMatchObject({
				policy: "key",
				phase: 2,
				cacheControl: mutableCacheControl,
				writeMode: "overwrite",
				immutable: false,
			})
		}
		expect(validateLocalFiles(root, parsed.objects).size).toBe(4)
	})

	test("accepts a valid manifest and matching local object", () => {
		const { root, manifest, writeManifest } = fixture()
		const parsed = parseManifest(writeManifest(manifest))
		expect(validateLocalFiles(root, parsed.objects).size).toBe(1)
	})

	test.each(["other/file", "apt/../keys/file", "apt/%2e%2e/file"])(
		"rejects unsafe object path %s",
		(objectPath) => {
			const { manifest, object, writeManifest } = fixture()
			expect(() =>
				parseManifest(
					writeManifest({
						...manifest,
						objects: [
							{
								...object,
								path: objectPath,
								source: `public/${objectPath}`,
							},
						],
					}),
				),
			).toThrow()
		},
	)

	test("rejects duplicate object paths", () => {
		const { manifest, object, writeManifest } = fixture()
		expect(() =>
			parseManifest(
				writeManifest({ ...manifest, objects: [object, { ...object }] }),
			),
		).toThrow("duplicate object path")
	})

	test("rejects a local digest mismatch", () => {
		const { root, manifest, object, writeManifest } = fixture()
		const parsed = parseManifest(
			writeManifest({
				...manifest,
				objects: [{ ...object, sha256: "0".repeat(64) }],
			}),
		)
		expect(() => validateLocalFiles(root, parsed.objects)).toThrow(
			"local SHA-256 does not match",
		)
	})

	test("rejects a local size mismatch", () => {
		const { root, manifest, object, writeManifest } = fixture()
		const parsed = parseManifest(
			writeManifest({
				...manifest,
				objects: [{ ...object, size: object.size + 1 }],
			}),
		)
		expect(() => validateLocalFiles(root, parsed.objects)).toThrow(
			"local size",
		)
	})

	test("rejects a phase and write-mode mismatch", () => {
		const { manifest, object, writeManifest } = fixture()
		expect(() =>
			parseManifest(
				writeManifest({
					...manifest,
					objects: [{ ...object, phase: 2 }],
				}),
			),
		).toThrow("create-only objects must be published in phase 1")
	})

	test("rejects an overwrite policy for an immutable package path", () => {
		const { manifest, object, writeManifest } = fixture()
		expect(() =>
			parseManifest(
				writeManifest({
					...manifest,
					objects: [
						{
							...object,
							policy: "metadata",
							phase: 2,
							cacheControl: mutableCacheControl,
							writeMode: "overwrite",
							immutable: false,
						},
					],
				}),
			),
		).toThrow("path must use immutable policy in phase 1")
	})

	test("rejects a signed metadata root before phase 3", () => {
		const { manifest, object, writeManifest } = fixture()
		const objectPath = "apt/dists/stable/InRelease"
		expect(() =>
			parseManifest(
				writeManifest({
					...manifest,
					objects: [
						{
							...object,
							path: objectPath,
							source: `public/${objectPath}`,
							policy: "metadata",
							phase: 2,
							cacheControl: mutableCacheControl,
							writeMode: "overwrite",
							immutable: false,
						},
					],
					purgePaths: [objectPath],
				}),
			),
		).toThrow("path must use metadata policy in phase 3")
	})

	test("publishes each RPM detached signature immediately before its root", () => {
		const { object } = fixture()
		const config: PublicationObject = {
			...object,
			path: "rpm/dotenc.repo",
			source: "public/rpm/dotenc.repo",
			policy: "config",
			phase: 2,
			cacheControl: mutableCacheControl,
			writeMode: "overwrite",
			immutable: false,
		}
		const signature: PublicationObject = {
			...config,
			path: "rpm/x86_64/repodata/repomd.xml.asc",
			source: "public/rpm/x86_64/repodata/repomd.xml.asc",
			policy: "metadata",
		}
		const root: PublicationObject = {
			...signature,
			path: "rpm/x86_64/repodata/repomd.xml",
			source: "public/rpm/x86_64/repodata/repomd.xml",
			phase: 3,
		}
		expect(
			orderPublicationObjects([config, signature, root]).map(
				(entry) => entry.path,
			),
		).toEqual([config.path, signature.path, root.path])
	})

	test("rejects a cache-policy mismatch", () => {
		const { manifest, object, writeManifest } = fixture()
		expect(() =>
			parseManifest(
				writeManifest({
					...manifest,
					objects: [{ ...object, cacheControl: mutableCacheControl }],
				}),
			),
		).toThrow("cacheControl is not allowed")
	})

	test("rejects a top-level policy contract mismatch", () => {
		const { manifest, writeManifest } = fixture()
		expect(() =>
			parseManifest(
				writeManifest({
					...manifest,
					policies: {
						...manifest.policies,
						metadata: {
							...manifest.policies.metadata,
							cacheControl: immutableCacheControl,
						},
					},
				}),
			),
		).toThrow("policies do not match")
	})

	test("rejects objects larger than Cloudflare's cache limit", () => {
		const { manifest, object, writeManifest } = fixture()
		expect(() =>
			parseManifest(
				writeManifest({
					...manifest,
					objects: [{ ...object, size: 512 * 1024 * 1024 + 1 }],
				}),
			),
		).toThrow("512 MiB cache limit")
	})
})
