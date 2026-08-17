import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, createReadStream, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const MAX_GIT_OUTPUT_BYTES = 1024 * 1024
const MAX_GITHUB_RESPONSE_BYTES = 1024 * 1024
const MAX_PACKAGE_BYTES = 64 * 1024
const MAX_PACKAGE_BASE64_BYTES = 4 * Math.ceil(MAX_PACKAGE_BYTES / 3)
const MAX_VERSION_REVISIONS = 256
const MAX_TRANSITION_REVISIONS = 256
const MAX_RELEASE_PAGES = 10
const RELEASES_PER_PAGE = 100
const STABLE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const SEMANTIC_VERSION =
	/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

export const CLI_RELEASE_ASSETS = [
	"dotenc-darwin-arm64.tar.gz",
	"dotenc-darwin-x64.tar.gz",
	"dotenc-linux-x64.tar.gz",
	"dotenc-linux-arm64.tar.gz",
	"dotenc-linux-x64-musl.tar.gz",
	"dotenc-linux-arm64-musl.tar.gz",
	"dotenc-windows-x64.zip",
	"SHA256SUMS",
] as const

type GitHubResult =
	| { status: "missing" }
	| { status: "present"; value: unknown }

type CreateReferenceResult =
	| { status: "conflict" }
	| { status: "created"; value: unknown }

export type CliReleaseDependencies = {
	git(args: readonly string[]): string
	github(pathname: string): Promise<GitHubResult>
	createTag(tag: string, message: string, object: string): Promise<unknown>
	createReference(ref: string, sha: string): Promise<CreateReferenceResult>
	fileDigest(filePath: string): Promise<string>
	fileSize(filePath: string): number
}

export type CliReleaseGateInput = {
	eventName: string
	beforeSha?: string
	currentSha: string
	runId: string
}

export type CliReleaseGateResult = {
	version: string
	bumped: boolean
}

function releaseError(message: string): never {
	throw new Error(message)
}

const requireCommitSha = (value: string, label: string) => {
	if (!COMMIT_SHA.test(value) || /^0+$/.test(value)) {
		releaseError(`The ${label} revision is invalid.`)
	}
	return value
}

const parseStableVersion = (value: unknown, label: string) => {
	if (typeof value !== "string" || value.length > 128) {
		releaseError(`The ${label} CLI version is invalid.`)
	}
	const match = STABLE_VERSION.exec(value)
	if (!match) releaseError(`The ${label} CLI version is not stable SemVer.`)
	return {
		value,
		parts: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])] as const,
	}
}

const compareVersions = (
	left: readonly [bigint, bigint, bigint],
	right: readonly [bigint, bigint, bigint],
) => {
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] < right[index]) return -1
		if (left[index] > right[index]) return 1
	}
	return 0
}

const requireRunId = (value: string) => {
	if (!/^[1-9][0-9]{0,19}$/.test(value)) {
		releaseError("The workflow run identifier is invalid.")
	}
	return value
}

export const createReleaseReservationMessage = (
	version: string,
	commit: string,
	runId: string,
) =>
	[
		"dotenc-release-reservation:v1",
		`version=${parseStableVersion(version, "reservation").value}`,
		`commit=${requireCommitSha(commit, "reservation")}`,
		`run-id=${requireRunId(runId)}`,
	].join("\n")

const git = (
	deps: CliReleaseDependencies,
	args: readonly string[],
	errorMessage: string,
) => {
	try {
		return deps.git(args)
	} catch {
		return releaseError(errorMessage)
	}
}

const packageVersionAt = (
	deps: CliReleaseDependencies,
	sha: string,
	label: string,
	stableRequired = true,
) => {
	const source = git(
		deps,
		["show", `${sha}:cli/package.json`],
		`The ${label} CLI package could not be read.`,
	)
	let version: unknown
	try {
		const parsed = JSON.parse(source) as unknown
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			releaseError(`The ${label} CLI package is invalid.`)
		}
		version = (parsed as { version?: unknown }).version
	} catch {
		return releaseError(`The ${label} CLI package is invalid.`)
	}
	if (!stableRequired) {
		if (
			typeof version !== "string" ||
			version.length > 128 ||
			!SEMANTIC_VERSION.test(version)
		) {
			releaseError(`The ${label} CLI version is not valid SemVer.`)
		}
		if (!STABLE_VERSION.test(version)) return undefined
	}
	return parseStableVersion(version, label)
}

const currentVersion = (
	currentSha: string,
	deps: CliReleaseDependencies,
) => {
	const current = requireCommitSha(currentSha, "current")
	git(
		deps,
		["cat-file", "-e", `${current}^{commit}`],
		"The current revision is unavailable.",
	)
	const head = git(
		deps,
		["rev-parse", "HEAD^{commit}"],
		"The checked-out revision could not be verified.",
	).trim()
	if (head !== current) {
		releaseError("The checked-out revision does not match the triggering revision.")
	}
	return packageVersionAt(deps, current, "current")
}

const remotePackageVersion = async (
	sha: string,
	deps: CliReleaseDependencies,
) => {
	const result = await deps.github(
		`contents/cli/package.json?ref=${encodeURIComponent(sha)}`,
	)
	if (result.status !== "present") {
		releaseError("The current main CLI package could not be inspected.")
	}
	const file = objectValue(result.value, "current main CLI package")
	if (
		file.type !== "file" ||
		file.encoding !== "base64" ||
		typeof file.content !== "string"
	) {
		releaseError("The current main CLI package response is invalid.")
	}
	const compact = file.content.replace(/[\r\n]/g, "")
	if (
		compact.length === 0 ||
		compact.length > MAX_PACKAGE_BASE64_BYTES ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
			compact,
		)
	) {
		releaseError("The current main CLI package response is invalid.")
	}
	const bytes = Buffer.from(compact, "base64")
	try {
		if (bytes.byteLength > MAX_PACKAGE_BYTES) {
			releaseError("The current main CLI package exceeded its bound.")
		}
		const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
		const parsed = JSON.parse(source) as unknown
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			releaseError("The current main CLI package is invalid.")
		}
		return parseStableVersion(
			(parsed as { version?: unknown }).version,
			"current main",
		)
	} catch {
		return releaseError("The current main CLI package is invalid.")
	} finally {
		bytes.fill(0)
	}
}

const assertCurrentMainOrdering = async (
	currentSha: string,
	version: ReturnType<typeof parseStableVersion>,
	deps: CliReleaseDependencies,
) => {
	const refResult = await deps.github("git/ref/heads/main")
	if (refResult.status !== "present") {
		releaseError("The current main revision could not be inspected.")
	}
	const reference = objectValue(refResult.value, "current main reference")
	const target = objectValue(reference.object, "current main target")
	if (target.type !== "commit" || typeof target.sha !== "string") {
		releaseError("The current main reference is invalid.")
	}
	const remoteSha = requireCommitSha(target.sha, "current main")
	if (remoteSha === currentSha) return

	const comparisonResult = await deps.github(
		`compare/${encodeURIComponent(currentSha)}...${encodeURIComponent(remoteSha)}`,
	)
	if (comparisonResult.status !== "present") {
		releaseError("The current main ancestry could not be inspected.")
	}
	const comparison = objectValue(comparisonResult.value, "current main comparison")
	const mergeBase = objectValue(
		comparison.merge_base_commit,
		"current main merge base",
	)
	if (comparison.status !== "ahead" || mergeBase.sha !== currentSha) {
		releaseError("The triggering revision is no longer an ancestor of main.")
	}
	const remoteVersion = await remotePackageVersion(remoteSha, deps)
	if (compareVersions(remoteVersion.parts, version.parts) !== 0) {
		releaseError(
			`The triggering CLI version ${version.value} is stale relative to main ${remoteVersion.value}.`,
		)
	}
}

type ReleaseInventory = {
	exact: "missing" | "draft" | "published"
	maximum?: ReturnType<typeof parseStableVersion>
	partialStable?: ReturnType<typeof parseStableVersion>
	publishedStable: ReadonlySet<string>
}

const inspectReleaseInventory = async (
	version: ReturnType<typeof parseStableVersion>,
	deps: CliReleaseDependencies,
): Promise<ReleaseInventory> => {
	const tag = `v${version.value}`
	let exact: ReleaseInventory["exact"] = "missing"
	let maximum: ReleaseInventory["maximum"]
	let partialStable: ReleaseInventory["partialStable"]
	const publishedStable = new Set<string>()
	let releaseInventoryComplete = false
	for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
		const result = await deps.github(
			`releases?per_page=${RELEASES_PER_PAGE}&page=${page}`,
		)
		if (result.status !== "present" || !Array.isArray(result.value)) {
			releaseError("The GitHub release inventory could not be verified.")
		}
		for (const rawRelease of result.value) {
			const release = objectValue(rawRelease, "release listing")
			if (typeof release.tag_name !== "string") {
				releaseError("The GitHub release inventory is invalid.")
			}
			if (release.tag_name === tag) {
				if (
					typeof release.draft !== "boolean" ||
					typeof release.prerelease !== "boolean" ||
					exact !== "missing"
				) {
					releaseError("The GitHub release inventory is ambiguous.")
				}
				exact =
					release.draft === false && release.prerelease === false
						? "published"
						: "draft"
			}
			if (
				release.tag_name.startsWith("v") &&
				STABLE_VERSION.test(release.tag_name.slice(1))
			) {
				if (
					typeof release.draft !== "boolean" ||
					typeof release.prerelease !== "boolean"
				) {
					releaseError("The GitHub release inventory is invalid.")
				}
				const releaseVersion = parseStableVersion(
					release.tag_name.slice(1),
					"existing release",
				)
				if (release.draft === false && release.prerelease === false) {
					publishedStable.add(releaseVersion.value)
					if (
						!maximum ||
						compareVersions(releaseVersion.parts, maximum.parts) > 0
					) {
						maximum = releaseVersion
					}
				} else if (
					!partialStable ||
					compareVersions(releaseVersion.parts, partialStable.parts) > 0
				) {
					partialStable = releaseVersion
				}
			}
		}
		if (result.value.length < RELEASES_PER_PAGE) {
			releaseInventoryComplete = true
			break
		}
	}
	if (!releaseInventoryComplete) {
		releaseError("The GitHub release inventory exceeded its bound.")
	}
	return { exact, maximum, partialStable, publishedStable }
}

const inspectReleaseTarget = async (
	version: ReturnType<typeof parseStableVersion>,
	deps: CliReleaseDependencies,
) => {
	const [inventory, reference] = await Promise.all([
		inspectReleaseInventory(version, deps),
		deps.github(`git/ref/tags/${encodeURIComponent(`v${version.value}`)}`),
	])
	return { inventory, reference }
}

type ReleaseReservation = {
	tagObjectSha: string
	targetSha: string
	runId: string
}

const parseReleaseReservationMessage = (message: unknown) => {
	if (typeof message !== "string" || message.length > 512) {
		releaseError("The release reservation marker is invalid.")
	}
	const match =
		/^dotenc-release-reservation:v1\nversion=([^\n]+)\ncommit=([^\n]+)\nrun-id=([^\n]+)$/.exec(
			message,
		)
	if (!match) releaseError("The release reservation marker is invalid.")
	const version = parseStableVersion(match[1], "reservation").value
	const commit = requireCommitSha(match[2], "reservation")
	const runId = requireRunId(match[3])
	if (message !== createReleaseReservationMessage(version, commit, runId)) {
		releaseError("The release reservation marker is not canonical.")
	}
	return { version, commit, runId }
}

const inspectReleaseReservation = async (
	reference: GitHubResult,
	version: ReturnType<typeof parseStableVersion>,
	deps: CliReleaseDependencies,
): Promise<ReleaseReservation> => {
	if (reference.status !== "present") {
		releaseError("The reserved release tag is missing.")
	}
	const ref = objectValue(reference.value, "reserved release tag")
	const refTarget = objectValue(ref.object, "reserved release tag target")
	if (ref.ref !== `refs/tags/v${version.value}` || refTarget.type !== "tag") {
		releaseError("The reserved release tag is invalid.")
	}
	const tagObjectSha = requireCommitSha(
		typeof refTarget.sha === "string" ? refTarget.sha : "",
		"release tag object",
	)
	const tagResult = await deps.github(`git/tags/${tagObjectSha}`)
	if (tagResult.status !== "present") {
		releaseError("The release reservation object is missing.")
	}
	const tagObject = objectValue(tagResult.value, "release reservation object")
	const object = objectValue(tagObject.object, "release reservation target")
	if (
		tagObject.sha !== tagObjectSha ||
		tagObject.tag !== `v${version.value}` ||
		object.type !== "commit" ||
		typeof object.sha !== "string"
	) {
		releaseError("The release reservation object is invalid.")
	}
	const targetSha = requireCommitSha(object.sha, "release reservation target")
	const marker = parseReleaseReservationMessage(tagObject.message)
	if (marker.version !== version.value || marker.commit !== targetSha) {
		releaseError("The release reservation marker does not match its target.")
	}
	return { tagObjectSha, targetSha, runId: marker.runId }
}

const assertReservationOwner = (
	reservation: ReleaseReservation,
	currentSha: string,
	runId: string,
) => {
	if (
		reservation.targetSha !== currentSha ||
		reservation.runId !== requireRunId(runId)
	) {
		releaseError(
			"The release reservation belongs to a different workflow run or revision.",
		)
	}
}

const assertReservationInTriggerHistory = (
	reservation: ReleaseReservation,
	currentSha: string,
	version: ReturnType<typeof parseStableVersion>,
	deps: CliReleaseDependencies,
) => {
	git(
		deps,
		["cat-file", "-e", `${reservation.targetSha}^{commit}`],
		"The reserved CLI release revision is unavailable.",
	)
	git(
		deps,
		["merge-base", "--is-ancestor", reservation.targetSha, currentSha],
		"The reserved CLI release is not in the triggering revision history.",
	)
	const reservedVersion = packageVersionAt(
		deps,
		reservation.targetSha,
		"reserved",
	)
	if (reservedVersion.value !== version.value) {
		releaseError("The reserved CLI release version does not match its tag.")
	}
}

const assertInventoryCanAdvance = (
	version: ReturnType<typeof parseStableVersion>,
	inventory: ReleaseInventory,
) => {
	assertNoPartialStableRelease(inventory)
	if (
		inventory.maximum &&
		compareVersions(version.parts, inventory.maximum.parts) <= 0
	) {
		releaseError(
			`The CLI release version must exceed existing release v${inventory.maximum.value}.`,
		)
	}
}

const assertNoPartialStableRelease = (inventory: ReleaseInventory) => {
	if (inventory.partialStable) {
		releaseError(
			`Partial release v${inventory.partialStable.value} must be reconciled before publishing.`,
		)
	}
}

const assertPreviousReleasePublished = (
	previous: ReturnType<typeof parseStableVersion> | undefined,
	inventory: ReleaseInventory,
) => {
	if (
		previous &&
		!inventory.publishedStable.has(previous.value)
	) {
		releaseError(
			`Previous CLI version v${previous.value} is not a published stable release; reconcile its reservation before advancing.`,
		)
	}
}

export const assertReleaseTargetMissing = async (
	currentSha: string,
	version: string,
	deps: CliReleaseDependencies,
) => {
	const parsedVersion = parseStableVersion(version, "current")
	await assertCurrentMainOrdering(currentSha, parsedVersion, deps)
	const { inventory, reference } = await inspectReleaseTarget(
		parsedVersion,
		deps,
	)
	if (inventory.exact !== "missing" || reference.status === "present") {
		releaseError(
			`Release target v${version} already exists; reconcile it manually before retrying.`,
		)
	}
	assertInventoryCanAdvance(parsedVersion, inventory)
}

export const assertReservedReleaseTarget = async (
	currentSha: string,
	version: string,
	runId: string,
	deps: CliReleaseDependencies,
) => {
	const parsedVersion = parseStableVersion(version, "current")
	const { inventory, reference } = await inspectReleaseTarget(
		parsedVersion,
		deps,
	)
	if (inventory.exact !== "missing" || reference.status !== "present") {
		releaseError("The reserved release target is missing or ambiguous.")
	}
	assertInventoryCanAdvance(parsedVersion, inventory)
	const reservation = await inspectReleaseReservation(
		reference,
		parsedVersion,
		deps,
	)
	assertReservationOwner(reservation, currentSha, runId)
}

export const reserveCliReleaseTag = async (
	currentSha: string,
	version: string,
	runId: string,
	deps: CliReleaseDependencies,
) => {
	const current = currentVersion(currentSha, deps)
	if (current.value !== version) {
		releaseError("The release reservation version does not match the checkout.")
	}
	const parsedRunId = requireRunId(runId)
	const { inventory, reference } = await inspectReleaseTarget(current, deps)
	if (inventory.exact !== "missing") {
		releaseError(
			`Release target v${version} already exists; reconcile it manually before retrying.`,
		)
	}
	assertInventoryCanAdvance(current, inventory)
	if (reference.status === "present") {
		const reservation = await inspectReleaseReservation(reference, current, deps)
		assertReservationOwner(reservation, currentSha, parsedRunId)
		return
	}
	const mainRef = await deps.github("git/ref/heads/main")
	if (mainRef.status !== "present") {
		releaseError("The current main revision could not be reserved.")
	}
	const main = objectValue(mainRef.value, "current main reference")
	const mainTarget = objectValue(main.object, "current main target")
	if (mainTarget.type !== "commit" || mainTarget.sha !== currentSha) {
		releaseError("The triggering revision is no longer the current main head.")
	}

	const message = createReleaseReservationMessage(
		version,
		currentSha,
		parsedRunId,
	)
	const createdTag = objectValue(
		await deps.createTag(`v${version}`, message, currentSha),
		"created release reservation",
	)
	const createdObject = objectValue(
		createdTag.object,
		"created release reservation target",
	)
	if (
		createdTag.tag !== `v${version}` ||
		createdTag.message !== message ||
		createdObject.type !== "commit" ||
		createdObject.sha !== currentSha ||
		typeof createdTag.sha !== "string"
	) {
		releaseError("The created release reservation could not be verified.")
	}
	const tagObjectSha = requireCommitSha(
		createdTag.sha,
		"created release tag object",
	)
	const createdReference = await deps.createReference(
		`refs/tags/v${version}`,
		tagObjectSha,
	)
	if (createdReference.status === "conflict") {
		const racedReference = await deps.github(
			`git/ref/tags/${encodeURIComponent(`v${version}`)}`,
		)
		const reservation = await inspectReleaseReservation(
			racedReference,
			current,
			deps,
		)
		assertReservationOwner(reservation, currentSha, parsedRunId)
		return
	}
	const created = objectValue(createdReference.value, "created release tag")
	const createdTarget = objectValue(created.object, "created release tag target")
	if (
		created.ref !== `refs/tags/v${version}` ||
		createdTarget.type !== "tag" ||
		createdTarget.sha !== tagObjectSha
	) {
		releaseError("The created release tag could not be verified.")
	}
}

export const evaluateCliReleaseGate = async (
	input: CliReleaseGateInput,
	deps: CliReleaseDependencies,
): Promise<CliReleaseGateResult> => {
	const current = currentVersion(input.currentSha, deps)
	const runId = requireRunId(input.runId)
	if (input.eventName === "workflow_dispatch") {
		return { version: current.value, bumped: false }
	}
	if (input.eventName !== "push") {
		releaseError("The release gate received an unsupported event.")
	}

	const before = requireCommitSha(input.beforeSha ?? "", "previous")
	git(
		deps,
		["cat-file", "-e", `${before}^{commit}`],
		"The previous revision is unavailable.",
	)
	git(
		deps,
		["merge-base", "--is-ancestor", before, input.currentSha],
		"The main update is not a forward history transition.",
	)
	const previous = packageVersionAt(deps, before, "previous")
	const versionChanged = compareVersions(current.parts, previous.parts) !== 0
	const transitionOutput = git(
		deps,
		[
			"rev-list",
			"--first-parent",
			"--reverse",
			`--max-count=${MAX_TRANSITION_REVISIONS + 1}`,
			`${before}..${input.currentSha}`,
		],
		"The main version transition could not be inspected.",
	)
	const transitionRevisions = transitionOutput
		.split(/\r?\n/)
		.filter((revision) => revision.length > 0)
	if (
		transitionRevisions.length === 0 ||
		transitionRevisions.length > MAX_TRANSITION_REVISIONS ||
		transitionRevisions.some((revision) => !COMMIT_SHA.test(revision))
	) {
		releaseError("The main version transition is incomplete.")
	}
	const firstParent = git(
		deps,
		["rev-parse", `${transitionRevisions[0]}^1`],
		"The main first-parent transition could not be verified.",
	).trim()
	if (firstParent !== before) {
		releaseError("The main update is not a first-parent history transition.")
	}
	for (const revision of transitionRevisions) {
		if (revision === input.currentSha) continue
		const intermediate = packageVersionAt(
			deps,
			revision,
			"intermediate",
			false,
		)
		if (intermediate && compareVersions(intermediate.parts, current.parts) > 0) {
			releaseError(
				`The current CLI version must not follow higher intermediate version ${intermediate.value}.`,
			)
		}
	}

	const revisionOutput = git(
		deps,
		[
			"rev-list",
			"--first-parent",
			`--max-count=${MAX_VERSION_REVISIONS + 1}`,
			before,
			"--",
			"cli/package.json",
		],
		"The previous CLI version history could not be inspected.",
	)
	const revisions = revisionOutput
		.split(/\r?\n/)
		.filter((revision) => revision.length > 0)
	if (
		revisions.length === 0 ||
		revisions.length > MAX_VERSION_REVISIONS ||
		revisions.some((revision) => !COMMIT_SHA.test(revision))
	) {
		releaseError("The previous CLI version history is incomplete.")
	}

	let maximum = previous
	let maximumPrior =
		previous.value === current.value ? undefined : previous
	for (const revision of revisions) {
		const historical = packageVersionAt(
			deps,
			revision,
			"historical",
			false,
		)
		if (historical && compareVersions(historical.parts, maximum.parts) > 0) {
			maximum = historical
		}
		if (
			historical &&
			historical.value !== current.value &&
			(!maximumPrior ||
				compareVersions(historical.parts, maximumPrior.parts) > 0)
		) {
			maximumPrior = historical
		}
	}
	const historicalOrder = compareVersions(current.parts, maximum.parts)
	if (versionChanged ? historicalOrder <= 0 : historicalOrder < 0) {
		releaseError(
			`The current CLI version must be greater than historical version ${maximum.value}.`,
		)
	}

	const { inventory, reference } = await inspectReleaseTarget(current, deps)
	assertNoPartialStableRelease(inventory)
	assertPreviousReleasePublished(maximumPrior, inventory)
	if (inventory.exact === "published") {
		if (reference.status !== "present") {
				releaseError("The published CLI release tag is missing.")
		}
		const reservation = await inspectReleaseReservation(reference, current, deps)
		if (
			reservation.targetSha === input.currentSha &&
			reservation.runId === runId
		) {
			releaseError(
				"This workflow run already published its CLI release; reconcile or rerun only failed downstream jobs.",
			)
		}
		await assertCurrentMainOrdering(input.currentSha, current, deps)
		assertReservationInTriggerHistory(
			reservation,
			input.currentSha,
			current,
			deps,
		)
		if (
			versionChanged &&
			(reservation.targetSha !== input.currentSha || reservation.runId !== runId)
		) {
			releaseError("The published CLI version cannot be reused by this transition.")
		}
		return { version: current.value, bumped: false }
	}
	if (inventory.exact !== "missing") {
		releaseError(
			`Release target v${current.value} is partial or already reserved; reconcile it manually before retrying.`,
		)
	}
	if (reference.status === "present") {
		const reservation = await inspectReleaseReservation(reference, current, deps)
		if (
			reservation.targetSha === input.currentSha &&
			reservation.runId === runId
		) {
			return { version: current.value, bumped: true }
		}
		if (versionChanged) {
			releaseError(
				"The release reservation belongs to a different workflow run or revision.",
			)
		}
		await assertCurrentMainOrdering(input.currentSha, current, deps)
		assertReservationInTriggerHistory(
			reservation,
			input.currentSha,
			current,
			deps,
		)
		return { version: current.value, bumped: false }
	}
	await assertCurrentMainOrdering(input.currentSha, current, deps)
	assertInventoryCanAdvance(current, inventory)
	return { version: current.value, bumped: true }
}

const objectValue = (value: unknown, label: string) => {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		releaseError(`The published ${label} response is invalid.`)
	}
	return value as Record<string, unknown>
}

export const verifyCliRelease = async (
	currentSha: string,
	runId: string,
	root: string,
	deps: CliReleaseDependencies,
) => {
	const current = currentVersion(currentSha, deps)
	const tag = `v${current.value}`
	const encodedTag = encodeURIComponent(tag)
	const [releaseResult, referenceResult] = await Promise.all([
		deps.github(`releases/tags/${encodedTag}`),
		deps.github(`git/ref/tags/${encodedTag}`),
	])
	if (releaseResult.status !== "present" || referenceResult.status !== "present") {
		releaseError("The published release or tag is missing.")
	}

	const reservation = await inspectReleaseReservation(
		referenceResult,
		current,
		deps,
	)
	assertReservationOwner(reservation, currentSha, runId)

	const release = objectValue(releaseResult.value, "release")
	if (
		release.tag_name !== tag ||
		release.draft !== false ||
		release.prerelease !== false ||
		!Array.isArray(release.assets)
	) {
		releaseError("The published release is not a stable release for the expected tag.")
	}
	if (release.assets.length !== CLI_RELEASE_ASSETS.length) {
		releaseError("The published release has an unexpected base asset set.")
	}

	const assets = new Map<string, Record<string, unknown>>()
	for (const rawAsset of release.assets) {
		const asset = objectValue(rawAsset, "release asset")
		if (typeof asset.name !== "string" || assets.has(asset.name)) {
			releaseError("The published release has invalid or duplicate assets.")
		}
		assets.set(asset.name, asset)
	}

	for (const name of CLI_RELEASE_ASSETS) {
		const asset = assets.get(name)
		if (!asset) releaseError(`Published release asset ${name} is missing.`)
		const filePath = path.join(root, "cli", "dist", name)
		const [digest, size] = await Promise.all([
			deps.fileDigest(filePath),
			Promise.resolve(deps.fileSize(filePath)),
		])
		if (
			asset.state !== "uploaded" ||
			asset.size !== size ||
			asset.digest !== `sha256:${digest}`
		) {
			releaseError(`Published release asset ${name} failed verification.`)
		}
	}

	return { version: current.value, tag }
}

const sha256File = (filePath: string) =>
	new Promise<string>((resolve, reject) => {
		const hash = createHash("sha256")
		const stream = createReadStream(filePath)
		stream.on("data", (chunk) => hash.update(chunk))
		stream.on("error", reject)
		stream.on("end", () => resolve(hash.digest("hex")))
	})

const cancelResponseBody = async (body: ReadableStream<Uint8Array> | null) => {
	try {
		await body?.cancel()
	} catch {
		// Cancellation is best-effort after the response has already failed policy.
	}
}

const readBoundedJsonResponse = async (response: Response) => {
	const declaredLength = response.headers.get("content-length")
	if (declaredLength !== null) {
		if (!/^(0|[1-9][0-9]*)$/.test(declaredLength)) {
			await cancelResponseBody(response.body)
			releaseError("The GitHub release response length is invalid.")
		}
		const length = Number(declaredLength)
		if (!Number.isSafeInteger(length) || length > MAX_GITHUB_RESPONSE_BYTES) {
			await cancelResponseBody(response.body)
			releaseError("The GitHub release response exceeded its bound.")
		}
	}
	if (!response.body) {
		releaseError("The GitHub release response is invalid.")
	}

	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let totalBytes = 0
	const readNext = async () => {
		try {
			return await reader.read()
		} catch {
			return releaseError("The GitHub release response could not be read.")
		}
	}
	try {
		while (true) {
			const { done, value } = await readNext()
			if (done) break
			totalBytes += value.byteLength
			if (totalBytes > MAX_GITHUB_RESPONSE_BYTES) {
				value.fill(0)
				try {
					await reader.cancel()
				} catch {
					// The size violation is already the authoritative failure.
				}
				releaseError("The GitHub release response exceeded its bound.")
			}
			chunks.push(value)
		}

		const bytes = new Uint8Array(totalBytes)
		let offset = 0
		for (const chunk of chunks) {
			bytes.set(chunk, offset)
			offset += chunk.byteLength
		}
		try {
			return JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			) as unknown
		} catch {
			return releaseError("The GitHub release response is invalid.")
		} finally {
			bytes.fill(0)
		}
	} finally {
		reader.releaseLock()
		for (const chunk of chunks) chunk.fill(0)
	}
}

export const createCliReleaseDependencies = (options: {
	root: string
	repository: string
	apiUrl: string
	token: string
	fetchImpl?: (
		input: string | URL | Request,
		init?: RequestInit,
	) => Promise<Response>
}): CliReleaseDependencies => {
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) {
		releaseError("The GitHub repository identifier is invalid.")
	}
	const apiUrl = new URL(options.apiUrl)
	if (apiUrl.protocol !== "https:") {
		releaseError("The GitHub API URL must use HTTPS.")
	}
	if (!options.token) releaseError("The GitHub release token is unavailable.")
	const baseUrl = apiUrl.toString().replace(/\/$/, "")
	const fetchImpl = options.fetchImpl ?? fetch
	const gitEnvironment = { ...process.env }
	for (const key of Object.keys(gitEnvironment)) {
		if (key.startsWith("GIT_")) delete gitEnvironment[key]
	}
	Object.assign(gitEnvironment, {
		GIT_CONFIG_GLOBAL: os.devNull,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_NO_LAZY_FETCH: "1",
		GIT_NO_REPLACE_OBJECTS: "1",
		GIT_OPTIONAL_LOCKS: "0",
		GIT_TERMINAL_PROMPT: "0",
	})

	return {
		git: (args) =>
			execFileSync("git", [...args], {
				cwd: options.root,
				encoding: "utf8",
				env: gitEnvironment,
				maxBuffer: MAX_GIT_OUTPUT_BYTES,
				stdio: ["ignore", "pipe", "pipe"],
			}),
		github: async (pathname) => {
			let response: Response
			try {
				response = await fetchImpl(
					`${baseUrl}/repos/${options.repository}/${pathname}`,
					{
						headers: {
							Accept: "application/vnd.github+json",
							Authorization: `Bearer ${options.token}`,
							"X-GitHub-Api-Version": "2022-11-28",
						},
						redirect: "error",
						signal: AbortSignal.timeout(10_000),
					},
				)
			} catch {
				return releaseError("The GitHub release target could not be inspected.")
			}
			if (response.status === 404) {
				await cancelResponseBody(response.body)
				return { status: "missing" }
			}
			if (response.status !== 200) {
				await cancelResponseBody(response.body)
				return releaseError("The GitHub release target could not be inspected.")
			}
			return { status: "present", value: await readBoundedJsonResponse(response) }
		},
		createTag: async (tag, message, object) => {
			if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag)) {
				releaseError("The release tag reservation is invalid.")
			}
			if (
				typeof message !== "string" ||
				message.length === 0 ||
				message.length > 512
			) {
				releaseError("The release reservation marker is invalid.")
			}
			requireCommitSha(object, "release reservation target")
			let response: Response
			try {
				response = await fetchImpl(
					`${baseUrl}/repos/${options.repository}/git/tags`,
					{
						method: "POST",
						headers: {
							Accept: "application/vnd.github+json",
							Authorization: `Bearer ${options.token}`,
							"Content-Type": "application/json",
							"X-GitHub-Api-Version": "2022-11-28",
						},
						body: JSON.stringify({ tag, message, object, type: "commit" }),
						redirect: "error",
						signal: AbortSignal.timeout(10_000),
					},
				)
			} catch {
				return releaseError("The release reservation object could not be created.")
			}
			if (response.status !== 201) {
				await cancelResponseBody(response.body)
				return releaseError("The release reservation object could not be created.")
			}
			return readBoundedJsonResponse(response)
		},
		createReference: async (ref, sha) => {
			if (!/^refs\/tags\/v[0-9]+\.[0-9]+\.[0-9]+$/.test(ref)) {
				releaseError("The release tag reservation is invalid.")
			}
			requireCommitSha(sha, "release tag")
			let response: Response
			try {
				response = await fetchImpl(
					`${baseUrl}/repos/${options.repository}/git/refs`,
					{
						method: "POST",
						headers: {
							Accept: "application/vnd.github+json",
							Authorization: `Bearer ${options.token}`,
							"Content-Type": "application/json",
							"X-GitHub-Api-Version": "2022-11-28",
						},
						body: JSON.stringify({ ref, sha }),
						redirect: "error",
						signal: AbortSignal.timeout(10_000),
					},
				)
			} catch {
				return releaseError("The release tag could not be reserved.")
			}
			if (response.status === 409 || response.status === 422) {
				await cancelResponseBody(response.body)
				return { status: "conflict" }
			}
			if (response.status !== 201) {
				await cancelResponseBody(response.body)
				return releaseError("The release tag could not be reserved.")
			}
			return {
				status: "created",
				value: await readBoundedJsonResponse(response),
			}
		},
		fileDigest: sha256File,
		fileSize: (filePath) => statSync(filePath).size,
	}
}

const requiredEnvironment = (name: string) => {
	const value = process.env[name]
	if (!value) releaseError(`Required release environment ${name} is unavailable.`)
	return value
}

const main = async () => {
	const root = process.cwd()
	const deps = createCliReleaseDependencies({
		root,
		repository: requiredEnvironment("GITHUB_REPOSITORY"),
		apiUrl: requiredEnvironment("GITHUB_API_URL"),
		token: requiredEnvironment("GITHUB_TOKEN"),
	})
	const currentSha = requiredEnvironment("GITHUB_SHA")
	const runId = requiredEnvironment("GITHUB_RUN_ID")
	const mode = process.argv[2]
	if (mode === "--target-only") {
		const current = currentVersion(currentSha, deps)
		await assertReservedReleaseTarget(currentSha, current.value, runId, deps)
		return
	}
	if (mode === "--verify-release") {
		await verifyCliRelease(currentSha, runId, root, deps)
		return
	}
	if (mode !== undefined) releaseError("The release gate mode is invalid.")

	const result = await evaluateCliReleaseGate(
		{
			eventName: requiredEnvironment("GITHUB_EVENT_NAME"),
			beforeSha: process.env.DOTENC_RELEASE_BEFORE_SHA,
			currentSha,
			runId,
		},
		deps,
	)
	if (result.bumped) {
		await reserveCliReleaseTag(currentSha, result.version, runId, deps)
	}
	appendFileSync(
		requiredEnvironment("GITHUB_OUTPUT"),
		`version=${result.version}\nbumped=${result.bumped}\n`,
	)
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(
			error instanceof Error ? error.message : "The CLI release gate failed.",
		)
		process.exit(1)
	})
}
