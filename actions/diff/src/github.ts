import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import type { EncryptedEnvironmentInput } from "../../../cli/src/helpers/createEnvironmentDiffReport"
import { ACTION_LIMITS, type ActionLimits } from "./limits"
import {
	assertBoundedString,
	byteLength,
	isFullGitObjectId,
	isRecord,
	SafeActionError,
} from "./safety"

export type { EncryptedEnvironmentInput }

type GitHubClientOptions = {
	token: string
	repository: string
	apiUrl?: string
	fetchImpl?: FetchLike
	limits?: ActionLimits
}

export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>

type BlobDescriptor = {
	path: string
	sha: string
	size: number
}

const API_VERSION = "2022-11-28"

const environmentPathPattern = /^\.env\..+\.enc$/

const isEnvironmentPath = (filePath: string): boolean => {
	const basename = filePath.slice(filePath.lastIndexOf("/") + 1)
	return environmentPathPattern.test(basename)
}

const hasAsciiControl = (value: string): boolean =>
	Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0) ?? 0
		return codePoint <= 0x1f || codePoint === 0x7f
	})

const validatePath = (value: unknown, limits: ActionLimits): string => {
	const filePath = assertBoundedString(
		value,
		limits.maxPathBytes,
		"invalid_tree",
	)
	if (
		!filePath ||
		filePath.startsWith("/") ||
		filePath.includes("\\") ||
		hasAsciiControl(filePath) ||
		filePath
			.split("/")
			.some((segment) => !segment || segment === "." || segment === "..")
	) {
		throw new SafeActionError("invalid_tree")
	}

	return filePath
}

const decodeBase64 = (value: unknown): Buffer => {
	if (typeof value !== "string") {
		throw new SafeActionError("invalid_blob")
	}

	const normalized = value.replace(/\s/g, "")
	if (
		!normalized ||
		!/^[a-z0-9+/]*={0,2}$/i.test(normalized) ||
		normalized.length % 4 === 1
	) {
		throw new SafeActionError("invalid_blob")
	}

	const decoded = Buffer.from(normalized, "base64")
	const inputWithoutPadding = normalized.replace(/=+$/, "")
	const roundTrip = decoded.toString("base64").replace(/=+$/, "")
	if (inputWithoutPadding !== roundTrip) {
		throw new SafeActionError("invalid_blob")
	}

	return decoded
}

const verifyGitBlob = (expectedSha: string, content: Buffer): void => {
	const actualSha = createHash("sha1")
		.update(`blob ${content.byteLength}\0`, "utf8")
		.update(content)
		.digest("hex")
	if (actualSha !== expectedSha.toLowerCase()) {
		throw new SafeActionError("blob_identity_mismatch")
	}
}

const readBoundedResponse = async (
	response: Response,
	maxBytes: number,
): Promise<Uint8Array> => {
	const declaredLength = response.headers.get("content-length")
	if (declaredLength !== null) {
		const length = Number(declaredLength)
		if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
			throw new SafeActionError("github_response_too_large")
		}
	}

	if (!response.body) return new Uint8Array()

	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			total += value.byteLength
			if (total > maxBytes) {
				await reader.cancel()
				throw new SafeActionError("github_response_too_large")
			}
			chunks.push(value)
		}
	} finally {
		reader.releaseLock()
	}

	return Buffer.concat(chunks, total)
}

class GitHubApiError extends SafeActionError {
	readonly status: number

	constructor(status: number) {
		super("github_request_failed")
		this.name = "GitHubApiError"
		this.status = status
	}
}

export class GitHubClient {
	readonly #token: string
	readonly #owner: string
	readonly #repo: string
	readonly #apiUrl: URL
	readonly #fetch: FetchLike
	readonly #limits: ActionLimits
	readonly #blobContentBySha = new Map<string, Promise<string>>()

	constructor(options: GitHubClientOptions) {
		if (
			!options.token ||
			byteLength(options.token) > 4096 ||
			Array.from(options.token).some((character) => {
				const codePoint = character.codePointAt(0) ?? 0
				return codePoint <= 0x20 || codePoint === 0x7f
			})
		) {
			throw new SafeActionError("invalid_token")
		}

		const repositoryParts = options.repository.split("/")
		if (repositoryParts.length !== 2) {
			throw new SafeActionError("invalid_repository")
		}
		this.#owner = repositoryParts[0]
		this.#repo = repositoryParts[1]
		this.#token = options.token
		this.#fetch = options.fetchImpl ?? fetch
		this.#limits = options.limits ?? ACTION_LIMITS

		try {
			this.#apiUrl = new URL(options.apiUrl ?? "https://api.github.com")
		} catch {
			throw new SafeActionError("invalid_api_url")
		}
		if (
			this.#apiUrl.protocol !== "https:" ||
			this.#apiUrl.username ||
			this.#apiUrl.password ||
			this.#apiUrl.search ||
			this.#apiUrl.hash
		) {
			throw new SafeActionError("invalid_api_url")
		}
	}

	#endpoint(pathname: string): URL {
		const basePath = this.#apiUrl.pathname.replace(/\/$/, "")
		const url = new URL(this.#apiUrl)
		const queryIndex = pathname.indexOf("?")
		const pathOnly =
			queryIndex === -1 ? pathname : pathname.slice(0, queryIndex)
		url.pathname = `${basePath}${pathOnly}`
		url.search = queryIndex === -1 ? "" : pathname.slice(queryIndex)
		return url
	}

	#repositoryPath(): string {
		return `/repos/${encodeURIComponent(this.#owner)}/${encodeURIComponent(this.#repo)}`
	}

	async #requestJson(
		pathname: string,
		maxResponseBytes: number,
		init: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {},
	): Promise<unknown> {
		let response: Response
		try {
			response = await this.#fetch(this.#endpoint(pathname), {
				method: init.method ?? "GET",
				headers: {
					Accept: "application/vnd.github+json",
					Authorization: `Bearer ${this.#token}`,
					"Content-Type": "application/json",
					"User-Agent": "dotenc-diff-action",
					"X-GitHub-Api-Version": API_VERSION,
				},
				body: init.body === undefined ? undefined : JSON.stringify(init.body),
				redirect: "error",
				signal: AbortSignal.timeout(this.#limits.requestTimeoutMs),
			})
		} catch {
			throw new SafeActionError("github_unavailable")
		}

		if (!response.ok) {
			try {
				await response.body?.cancel()
			} catch {
				// Do not surface or process an untrusted GitHub error body.
			}
			throw new GitHubApiError(response.status)
		}

		const body = await readBoundedResponse(response, maxResponseBytes)
		try {
			return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))
		} catch {
			throw new SafeActionError("invalid_github_response")
		}
	}

	async #getTreeSha(commitSha: string): Promise<string> {
		const response = await this.#requestJson(
			`${this.#repositoryPath()}/git/commits/${commitSha}`,
			this.#limits.commitResponseBytes,
		)
		if (
			!isRecord(response) ||
			!isFullGitObjectId(response.sha) ||
			response.sha.toLowerCase() !== commitSha ||
			!isRecord(response.tree) ||
			!isFullGitObjectId(response.tree.sha)
		) {
			throw new SafeActionError("invalid_commit")
		}

		return response.tree.sha.toLowerCase()
	}

	async #getBlobDescriptors(commitSha: string): Promise<BlobDescriptor[]> {
		if (!isFullGitObjectId(commitSha)) {
			throw new SafeActionError("invalid_commit")
		}

		const treeSha = await this.#getTreeSha(commitSha.toLowerCase())
		const response = await this.#requestJson(
			`${this.#repositoryPath()}/git/trees/${treeSha}?recursive=1`,
			this.#limits.treeResponseBytes,
		)
		if (
			!isRecord(response) ||
			response.truncated !== false ||
			!isFullGitObjectId(response.sha) ||
			response.sha.toLowerCase() !== treeSha ||
			!Array.isArray(response.tree) ||
			response.tree.length > this.#limits.maxTreeEntries
		) {
			throw new SafeActionError("invalid_tree")
		}

		const descriptors: BlobDescriptor[] = []
		const paths = new Set<string>()
		let totalBytes = 0
		for (const rawEntry of response.tree) {
			if (!isRecord(rawEntry) || typeof rawEntry.path !== "string") {
				throw new SafeActionError("invalid_tree")
			}
			if (!isEnvironmentPath(rawEntry.path)) continue
			const filePath = validatePath(rawEntry.path, this.#limits)
			const basename = filePath.slice(filePath.lastIndexOf("/") + 1)
			const environmentName = basename.slice(5, -4)
			if (byteLength(environmentName) > this.#limits.maxEnvironmentNameBytes) {
				throw new SafeActionError("invalid_environment_blob")
			}

			if (
				rawEntry.type !== "blob" ||
				(rawEntry.mode !== "100644" && rawEntry.mode !== "100755") ||
				!isFullGitObjectId(rawEntry.sha) ||
				!Number.isSafeInteger(rawEntry.size) ||
				(rawEntry.size as number) < 0 ||
				(rawEntry.size as number) > this.#limits.maxEnvironmentFileBytes ||
				paths.has(filePath)
			) {
				throw new SafeActionError("invalid_environment_blob")
			}

			totalBytes += rawEntry.size as number
			if (
				descriptors.length >= this.#limits.maxEnvironmentFilesPerSide ||
				totalBytes > this.#limits.maxEnvironmentBytesPerSide
			) {
				throw new SafeActionError("environment_limit_exceeded")
			}

			paths.add(filePath)
			descriptors.push({
				path: filePath,
				sha: rawEntry.sha.toLowerCase(),
				size: rawEntry.size as number,
			})
		}

		return descriptors.sort((left, right) =>
			left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
		)
	}

	async #getBlob(
		descriptor: BlobDescriptor,
	): Promise<EncryptedEnvironmentInput> {
		const response = await this.#requestJson(
			`${this.#repositoryPath()}/git/blobs/${descriptor.sha}`,
			this.#limits.maxEnvironmentFileBytes * 2 + 64 * 1024,
		)
		if (
			!isRecord(response) ||
			response.encoding !== "base64" ||
			!isFullGitObjectId(response.sha) ||
			response.sha.toLowerCase() !== descriptor.sha ||
			!Number.isSafeInteger(response.size) ||
			response.size !== descriptor.size
		) {
			throw new SafeActionError("invalid_blob")
		}

		const content = decodeBase64(response.content)
		if (
			content.byteLength !== descriptor.size ||
			content.byteLength > this.#limits.maxEnvironmentFileBytes
		) {
			throw new SafeActionError("invalid_blob")
		}
		verifyGitBlob(descriptor.sha, content)

		let text: string
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(content)
		} catch {
			throw new SafeActionError("invalid_blob")
		}

		return { path: descriptor.path, content: text }
	}

	async #loadBlobDescriptors(
		descriptors: BlobDescriptor[],
	): Promise<EncryptedEnvironmentInput[]> {
		const environments = new Array<EncryptedEnvironmentInput>(
			descriptors.length,
		)
		let nextIndex = 0
		const worker = async () => {
			while (nextIndex < descriptors.length) {
				const index = nextIndex
				nextIndex += 1
				const descriptor = descriptors[index]
				let content = this.#blobContentBySha.get(descriptor.sha)
				if (!content) {
					content = this.#getBlob(descriptor).then((blob) => blob.content)
					this.#blobContentBySha.set(descriptor.sha, content)
				}
				const resolvedContent = await content
				if (byteLength(resolvedContent) !== descriptor.size) {
					throw new SafeActionError("invalid_blob")
				}
				environments[index] = {
					path: descriptor.path,
					content: resolvedContent,
				}
			}
		}

		await Promise.all(
			Array.from({ length: Math.min(8, descriptors.length) }, () => worker()),
		)
		return environments
	}

	async getEncryptedEnvironments(
		commitSha: string,
	): Promise<EncryptedEnvironmentInput[]> {
		return this.#loadBlobDescriptors(await this.#getBlobDescriptors(commitSha))
	}

	async getEncryptedEnvironmentComparison(
		baseSha: string,
		headSha: string,
	): Promise<{
		base: EncryptedEnvironmentInput[]
		head: EncryptedEnvironmentInput[]
	}> {
		const [baseDescriptors, headDescriptors] = await Promise.all([
			this.#getBlobDescriptors(baseSha),
			this.#getBlobDescriptors(headSha),
		])
		const totalBytes = [...baseDescriptors, ...headDescriptors].reduce(
			(total, descriptor) =>
				total + descriptor.size + byteLength(descriptor.path),
			0,
		)
		if (totalBytes > this.#limits.maxEnvironmentBytesTotal) {
			throw new SafeActionError("environment_limit_exceeded")
		}

		const [base, head] = await Promise.all([
			this.#loadBlobDescriptors(baseDescriptors),
			this.#loadBlobDescriptors(headDescriptors),
		])
		return { base, head }
	}

	async upsertPullRequestComment(
		pullRequestNumber: number,
		marker: string,
		body: string,
	): Promise<string> {
		if (
			!Number.isSafeInteger(pullRequestNumber) ||
			pullRequestNumber < 1 ||
			!marker ||
			!body.startsWith(marker) ||
			byteLength(body) > this.#limits.maxCommentBytes
		) {
			throw new SafeActionError("invalid_comment")
		}

		let existingCommentId: number | undefined
		for (let page = 1; page <= this.#limits.maxCommentPages; page += 1) {
			const response = await this.#requestJson(
				`${this.#repositoryPath()}/issues/${pullRequestNumber}/comments?per_page=${this.#limits.commentsPerPage}&page=${page}`,
				this.#limits.commentResponseBytes,
			)
			if (
				!Array.isArray(response) ||
				response.length > this.#limits.commentsPerPage
			) {
				throw new SafeActionError("invalid_comments")
			}

			for (const comment of response) {
				if (
					isRecord(comment) &&
					Number.isSafeInteger(comment.id) &&
					(comment.id as number) > 0 &&
					typeof comment.body === "string" &&
					comment.body.startsWith(marker) &&
					isRecord(comment.user) &&
					comment.user.type === "Bot" &&
					comment.user.login === "github-actions[bot]"
				) {
					existingCommentId = comment.id as number
					break
				}
			}

			if (existingCommentId !== undefined) break
			if (response.length < this.#limits.commentsPerPage) break
			if (page === this.#limits.maxCommentPages) {
				throw new SafeActionError("comment_page_limit")
			}
		}

		const result = await this.#requestJson(
			existingCommentId === undefined
				? `${this.#repositoryPath()}/issues/${pullRequestNumber}/comments`
				: `${this.#repositoryPath()}/issues/comments/${existingCommentId}`,
			this.#limits.commentWriteResponseBytes,
			{
				method: existingCommentId === undefined ? "POST" : "PATCH",
				body: { body },
			},
		)

		if (!isRecord(result)) {
			throw new SafeActionError("invalid_comment_response")
		}
		const htmlUrl = assertBoundedString(
			result.html_url,
			4096,
			"invalid_comment_response",
		)
		try {
			const parsedUrl = new URL(htmlUrl)
			if (
				parsedUrl.protocol !== "https:" ||
				parsedUrl.username ||
				parsedUrl.password
			) {
				throw new SafeActionError("invalid_comment_response")
			}
		} catch (error) {
			if (error instanceof SafeActionError) throw error
			throw new SafeActionError("invalid_comment_response")
		}

		return htmlUrl
	}
}
