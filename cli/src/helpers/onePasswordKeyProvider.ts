import { spawn } from "node:child_process"
import crypto from "node:crypto"
import { z } from "zod/v4"
import { getKeyFingerprint } from "./getKeyFingerprint"
import type {
	PrivateKeyEntry,
	UnsupportedPrivateKeyEntry,
} from "./getPrivateKeys"
import type { KeyCandidate } from "./keyCandidate"
import {
	type OnePasswordLocator,
	readOnePasswordLocator,
	removeOnePasswordLocator,
	writeOnePasswordLocator,
} from "./onePasswordLocatorCache"
import { parseOpenSSHPrivateKey } from "./parseOpenSSHKey"
import { parseOpenSSHPublicKey } from "./parseOpenSSHPublicKey"
import { validatePublicKey } from "./validatePublicKey"

const OP_TIMEOUT_MS = 60_000
const OP_DISCOVERY_TIMEOUT_MS = 60_000
const OP_ITEM_GET_CONCURRENCY = 4
const OP_METADATA_MAX_BYTES = 4 * 1024 * 1024
const OP_PRIVATE_KEY_MAX_BYTES = 256 * 1024
const OP_ERROR_MAX_BYTES = 256 * 1024
const ONE_PASSWORD_ID_PATTERN = /^[A-Za-z0-9]{26}$/

const accountSchema = z.looseObject({
	account_uuid: z.string().regex(ONE_PASSWORD_ID_PATTERN),
	email: z.string().optional(),
	url: z.string().optional(),
})

const accountsSchema = z.array(accountSchema)

const itemOverviewSchema = z.looseObject({
	id: z.string().regex(ONE_PASSWORD_ID_PATTERN),
	title: z.string(),
	vault: z.looseObject({
		id: z.string().regex(ONE_PASSWORD_ID_PATTERN),
		name: z.string().optional(),
	}),
})

const itemOverviewsSchema = z.array(itemOverviewSchema)

type OpCommandOptions = {
	maxOutputBytes?: number
	timeoutMs?: number
}

export type RunOpCommand = (
	args: string[],
	options?: OpCommandOptions,
) => Promise<Buffer>

type OnePasswordAccount = z.infer<typeof accountSchema>
type OnePasswordItemOverview = z.infer<typeof itemOverviewSchema>

export type UnavailableOnePasswordAccount = {
	label: string
	reason:
		| "authorization-or-access-failed"
		| "discovery-timeout"
		| "invalid-response"
}

export type OnePasswordDiscoveryResult = {
	status:
		| "available"
		| "not-installed"
		| "no-accounts"
		| "unavailable"
		| "unsupported-version"
	keys: KeyCandidate[]
	unsupportedKeys: UnsupportedPrivateKeyEntry[]
	unavailableAccounts: UnavailableOnePasswordAccount[]
}

export class OnePasswordProviderError extends Error {
	constructor(
		message: string,
		readonly code:
			| "not-installed"
			| "timeout"
			| "output-limit"
			| "command-failed"
			| "invalid-response"
			| "invalid-private-key"
			| "fingerprint-mismatch",
		options?: ErrorOptions,
	) {
		super(message, options)
		this.name = "OnePasswordProviderError"
	}
}

function clearChunks(chunks: Buffer[]) {
	for (const chunk of chunks) chunk.fill(0)
}

export const runOpCommand: RunOpCommand = (
	args,
	options = {},
): Promise<Buffer> =>
	new Promise((resolve, reject) => {
		const maxOutputBytes = options.maxOutputBytes ?? OP_METADATA_MAX_BYTES
		const timeoutMs = options.timeoutMs ?? OP_TIMEOUT_MS
		const stdoutChunks: Buffer[] = []
		let stdoutBytes = 0
		let stderrBytes = 0
		let settled = false
		let timer: ReturnType<typeof setTimeout>

		const child = spawn("op", args, {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		})

		const finishWithError = (error: OnePasswordProviderError) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			clearChunks(stdoutChunks)
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL")
			}
			reject(error)
		}

		timer = setTimeout(() => {
			finishWithError(
				new OnePasswordProviderError(
					"1Password CLI did not respond before the authorization timeout.",
					"timeout",
				),
			)
		}, timeoutMs)

		child.stdout.on("data", (chunk: Buffer | string) => {
			const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
			if (settled) {
				bytes.fill(0)
				return
			}
			stdoutBytes += bytes.length
			if (stdoutBytes > maxOutputBytes) {
				bytes.fill(0)
				finishWithError(
					new OnePasswordProviderError(
						"1Password CLI returned more data than dotenc can safely process.",
						"output-limit",
					),
				)
				return
			}
			stdoutChunks.push(bytes)
		})

		child.stderr.on("data", (chunk: Buffer | string) => {
			const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
			stderrBytes += bytes.length
			bytes.fill(0)
			if (stderrBytes > OP_ERROR_MAX_BYTES) {
				finishWithError(
					new OnePasswordProviderError(
						"1Password CLI returned excessive error output.",
						"output-limit",
					),
				)
			}
		})

		child.once("error", (error: NodeJS.ErrnoException) => {
			finishWithError(
				new OnePasswordProviderError(
					error.code === "ENOENT"
						? "1Password CLI is not installed."
						: "1Password CLI could not be started.",
					error.code === "ENOENT" ? "not-installed" : "command-failed",
					{ cause: error },
				),
			)
		})

		child.once("close", (code) => {
			if (settled) return
			if (code !== 0) {
				finishWithError(
					new OnePasswordProviderError(
						"1Password CLI could not complete the requested operation.",
						"command-failed",
					),
				)
				return
			}

			settled = true
			clearTimeout(timer)
			resolve(Buffer.concat(stdoutChunks, stdoutBytes))
			clearChunks(stdoutChunks)
		})
	})

function sanitizeDisplayText(value: string, fallback: string): string {
	const sanitized = Array.from(value)
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0
			return codePoint >= 0x20 && codePoint !== 0x7f && codePoint !== 0x9b
		})
		.join("")
		.trim()

	return (sanitized || fallback).slice(0, 120)
}

function shortId(id: string): string {
	return `${id.slice(0, 4)}...${id.slice(-4)}`
}

function accountLabel(account: OnePasswordAccount): string {
	const display = sanitizeDisplayText(
		account.url ?? account.email ?? "1Password account",
		"1Password account",
	)
	return `1Password - ${display} [${shortId(account.account_uuid)}]`
}

function parseJson(buffer: Buffer): unknown {
	try {
		return JSON.parse(buffer.toString("utf8"))
	} catch (error) {
		throw new OnePasswordProviderError(
			"1Password CLI returned invalid structured data.",
			"invalid-response",
			{ cause: error },
		)
	}
}

function parseJsonAndClear(buffer: Buffer): unknown {
	try {
		return parseJson(buffer)
	} finally {
		buffer.fill(0)
	}
}

function collectOpenSshPublicKeys(value: unknown, found = new Set<string>()) {
	if (typeof value === "string") {
		const trimmed = value.trim()
		if (
			/^(ssh-ed25519|ssh-rsa)\s+[A-Za-z0-9+/]+={0,2}(?:\s+.*)?$/.test(trimmed)
		) {
			found.add(trimmed)
		}
		return found
	}

	if (Array.isArray(value)) {
		for (const entry of value) collectOpenSshPublicKeys(entry, found)
		return found
	}

	if (value && typeof value === "object") {
		for (const entry of Object.values(value)) {
			collectOpenSshPublicKeys(entry, found)
		}
	}

	return found
}

function parseItemPublicKey(item: unknown): crypto.KeyObject {
	const parsedKeys = new Map<string, crypto.KeyObject>()
	for (const content of collectOpenSshPublicKeys(item)) {
		const publicKey = parseOpenSSHPublicKey(content)
		if (!publicKey) continue
		parsedKeys.set(getKeyFingerprint(publicKey), publicKey)
	}

	if (parsedKeys.size !== 1) {
		throw new OnePasswordProviderError(
			parsedKeys.size === 0
				? "1Password SSH Key item did not expose a supported public key."
				: "1Password SSH Key item exposed conflicting public keys.",
			"invalid-response",
		)
	}

	return parsedKeys.values().next().value as crypto.KeyObject
}

function detectAlgorithm(key: crypto.KeyObject): "rsa" | "ed25519" | null {
	if (key.asymmetricKeyType === "rsa") return "rsa"
	if (key.asymmetricKeyType === "ed25519") return "ed25519"
	return null
}

function parsePrivateKey(buffer: Buffer): crypto.KeyObject | null {
	try {
		try {
			return crypto.createPrivateKey(buffer)
		} catch {
			return parseOpenSSHPrivateKey(buffer)
		}
	} finally {
		buffer.fill(0)
	}
}

function privateKeyEntry(
	name: string,
	privateKey: crypto.KeyObject,
): PrivateKeyEntry | null {
	const algorithm = detectAlgorithm(privateKey)
	if (!algorithm) return null

	const entry: PrivateKeyEntry = {
		name,
		privateKey,
		fingerprint: getKeyFingerprint(privateKey),
		algorithm,
	}

	if (algorithm === "ed25519") {
		const publicDer = crypto
			.createPublicKey(privateKey)
			.export({ type: "spki", format: "der" }) as Buffer
		entry.rawPublicKey = Buffer.from(publicDer.subarray(publicDer.length - 32))
		publicDer.fill(0)
	}

	return entry
}

function itemName(item: OnePasswordItemOverview): string {
	return sanitizeDisplayText(item.title, `SSH key ${shortId(item.id)}`)
}

function itemHint(
	item: OnePasswordItemOverview,
	algorithm: "rsa" | "ed25519",
): string {
	const vault = sanitizeDisplayText(
		item.vault.name ?? "vault",
		`vault ${shortId(item.vault.id)}`,
	)
	return `${algorithm} - ${vault}`
}

function itemSelector(
	accountId: string,
	item: OnePasswordItemOverview,
): string {
	return `1password:${accountId}:${item.vault.id}:${item.id}`
}

function privateKeyReference(locator: OnePasswordLocator): string {
	if (
		!ONE_PASSWORD_ID_PATTERN.test(locator.accountId) ||
		!ONE_PASSWORD_ID_PATTERN.test(locator.vaultId) ||
		!ONE_PASSWORD_ID_PATTERN.test(locator.itemId)
	) {
		throw new OnePasswordProviderError(
			"1Password returned an invalid object identifier.",
			"invalid-response",
		)
	}
	return `op://${locator.vaultId}/${locator.itemId}/private_key?ssh-format=openssh`
}

async function loadPrivateKeyFromLocator(
	fingerprint: string,
	locator: OnePasswordLocator,
	name: string,
	runCommand: RunOpCommand,
): Promise<PrivateKeyEntry> {
	let output: Buffer
	try {
		output = await runCommand(
			["read", "--account", locator.accountId, privateKeyReference(locator)],
			{ maxOutputBytes: OP_PRIVATE_KEY_MAX_BYTES },
		)
	} catch (error) {
		throw new OnePasswordProviderError(
			`Unable to retrieve ${name} from 1Password.`,
			"command-failed",
			{ cause: error },
		)
	}

	const privateKey = parsePrivateKey(output)
	if (!privateKey) {
		throw new OnePasswordProviderError(
			`1Password returned an invalid private key for ${name}.`,
			"invalid-private-key",
		)
	}

	const entry = privateKeyEntry(name, privateKey)
	if (!entry) {
		throw new OnePasswordProviderError(
			`1Password returned an unsupported private key for ${name}.`,
			"invalid-private-key",
		)
	}

	if (entry.fingerprint !== fingerprint) {
		entry.rawPublicKey?.fill(0)
		throw new OnePasswordProviderError(
			`The private key returned by 1Password no longer matches ${name}.`,
			"fingerprint-mismatch",
		)
	}

	return entry
}

function createCandidate(
	account: OnePasswordAccount,
	item: OnePasswordItemOverview,
	publicKey: crypto.KeyObject,
	runCommand: RunOpCommand,
	rememberLocator?: typeof writeOnePasswordLocator,
): KeyCandidate {
	const algorithm = detectAlgorithm(publicKey)
	if (!algorithm) {
		throw new OnePasswordProviderError(
			"1Password SSH key uses an unsupported algorithm.",
			"invalid-response",
		)
	}

	const validation = validatePublicKey(publicKey)
	if (!validation.valid) {
		throw new OnePasswordProviderError(validation.reason, "invalid-response")
	}

	const name = itemName(item)
	const fingerprint = getKeyFingerprint(publicKey)
	const label = accountLabel(account)
	const locator: OnePasswordLocator = {
		accountId: account.account_uuid,
		vaultId: item.vault.id,
		itemId: item.id,
	}

	return {
		source: "1password",
		selector: itemSelector(account.account_uuid, item),
		name,
		hint: itemHint(item, algorithm),
		group: {
			id: `1password:${account.account_uuid}`,
			label,
		},
		publicKey,
		fingerprint,
		algorithm,
		loadPrivateKey: async () => {
			const entry = await loadPrivateKeyFromLocator(
				fingerprint,
				locator,
				`${label} / ${name}`,
				runCommand,
			)
			await rememberLocator?.(fingerprint, locator)
			return entry
		},
	}
}

type LoadCachedOnePasswordPrivateKeyDeps = {
	runOpCommand: RunOpCommand
	readLocator: typeof readOnePasswordLocator
	removeLocator: typeof removeOnePasswordLocator
}

const defaultCachedKeyDeps: LoadCachedOnePasswordPrivateKeyDeps = {
	runOpCommand,
	readLocator: readOnePasswordLocator,
	removeLocator: removeOnePasswordLocator,
}

export async function loadCachedOnePasswordPrivateKey(
	fingerprints: string[],
	deps: LoadCachedOnePasswordPrivateKeyDeps = defaultCachedKeyDeps,
): Promise<PrivateKeyEntry | undefined> {
	const cached = (
		await Promise.all(
			[...new Set(fingerprints)].map(async (fingerprint) => {
				const locator = await deps.readLocator(fingerprint)
				return locator ? { fingerprint, locator } : undefined
			}),
		)
	)
		.filter((entry) => entry !== undefined)
		.sort((left, right) => {
			const leftSelector = `${left.locator.accountId}:${left.locator.vaultId}:${left.locator.itemId}`
			const rightSelector = `${right.locator.accountId}:${right.locator.vaultId}:${right.locator.itemId}`
			return leftSelector.localeCompare(rightSelector)
		})

	for (const { fingerprint, locator } of cached) {
		try {
			return await loadPrivateKeyFromLocator(
				fingerprint,
				locator,
				"cached SSH key",
				deps.runOpCommand,
			)
		} catch {
			await deps.removeLocator(fingerprint)
		}
	}

	return undefined
}

function emptyResult(
	status: OnePasswordDiscoveryResult["status"],
): OnePasswordDiscoveryResult {
	return { status, keys: [], unsupportedKeys: [], unavailableAccounts: [] }
}

type DiscoverOnePasswordDeps = {
	runOpCommand: RunOpCommand
	rememberLocator?: typeof writeOnePasswordLocator
	discoveryTimeoutMs?: number
	itemConcurrency?: number
	now?: () => number
}

const defaultDeps: DiscoverOnePasswordDeps = {
	runOpCommand,
	rememberLocator: writeOnePasswordLocator,
}

export async function discoverOnePasswordKeyCandidates(
	deps: DiscoverOnePasswordDeps = defaultDeps,
): Promise<OnePasswordDiscoveryResult> {
	const now = deps.now ?? Date.now
	const deadline =
		now() + Math.max(1, deps.discoveryTimeoutMs ?? OP_DISCOVERY_TIMEOUT_MS)
	const itemConcurrency = Math.max(
		1,
		Math.floor(deps.itemConcurrency ?? OP_ITEM_GET_CONCURRENCY),
	)
	const deadlineExpired = () => now() >= deadline
	const runDiscoveryCommand: RunOpCommand = (args, options = {}) => {
		const remainingMs = deadline - now()
		if (remainingMs <= 0) {
			throw new OnePasswordProviderError(
				"1Password key discovery exceeded its overall time limit.",
				"timeout",
			)
		}
		return deps.runOpCommand(args, {
			...options,
			timeoutMs: Math.max(
				1,
				Math.min(options.timeoutMs ?? OP_TIMEOUT_MS, remainingMs),
			),
		})
	}

	let versionOutput: Buffer
	try {
		versionOutput = await runDiscoveryCommand(["--version"], {
			maxOutputBytes: 1024,
		})
	} catch (error) {
		if (
			error instanceof OnePasswordProviderError &&
			error.code === "not-installed"
		) {
			return emptyResult("not-installed")
		}
		return emptyResult("unavailable")
	}

	const version = versionOutput.toString("utf8").trim()
	versionOutput.fill(0)
	if (!/^2(?:\.|$)/.test(version)) return emptyResult("unsupported-version")

	let accounts: OnePasswordAccount[]
	try {
		const output = await runDiscoveryCommand([
			"account",
			"list",
			"--format",
			"json",
			"--no-color",
		])
		accounts = accountsSchema.parse(parseJsonAndClear(output))
	} catch {
		return emptyResult("unavailable")
	}

	if (accounts.length === 0) return emptyResult("no-accounts")

	accounts.sort((left, right) => {
		const labelComparison = accountLabel(left).localeCompare(
			accountLabel(right),
		)
		return (
			labelComparison || left.account_uuid.localeCompare(right.account_uuid)
		)
	})

	const result = emptyResult("available")
	const unavailableAccountReasons = new Set<string>()
	const markUnavailable = (
		account: OnePasswordAccount,
		reason: UnavailableOnePasswordAccount["reason"],
	) => {
		const reasonKey = `${account.account_uuid}:${reason}`
		if (unavailableAccountReasons.has(reasonKey)) return
		unavailableAccountReasons.add(reasonKey)
		const label = accountLabel(account)
		result.unavailableAccounts.push({ label, reason })
	}

	for (const [accountIndex, account] of accounts.entries()) {
		if (deadlineExpired()) {
			for (const remainingAccount of accounts.slice(accountIndex)) {
				markUnavailable(remainingAccount, "discovery-timeout")
			}
			break
		}

		let items: OnePasswordItemOverview[]
		try {
			const output = await runDiscoveryCommand([
				"item",
				"list",
				"--categories",
				"SSH Key",
				"--format",
				"json",
				"--no-color",
				"--account",
				account.account_uuid,
			])
			items = itemOverviewsSchema.parse(parseJsonAndClear(output))
		} catch (error) {
			markUnavailable(
				account,
				deadlineExpired() ||
					(error instanceof OnePasswordProviderError &&
						error.code === "timeout")
					? "discovery-timeout"
					: error instanceof OnePasswordProviderError &&
							error.code === "invalid-response"
						? "invalid-response"
						: "authorization-or-access-failed",
			)
			continue
		}

		items.sort((left, right) => {
			const titleComparison = itemName(left).localeCompare(itemName(right))
			return titleComparison || left.id.localeCompare(right.id)
		})

		type ItemResult =
			| { candidate: KeyCandidate }
			| { unsupported: UnsupportedPrivateKeyEntry }
		const itemResults: Array<ItemResult | undefined> = Array(items.length)
		let nextItemIndex = 0
		let discoveryTimedOut = false

		const worker = async () => {
			while (!discoveryTimedOut) {
				if (deadlineExpired()) {
					discoveryTimedOut = true
					return
				}
				const itemIndex = nextItemIndex
				if (itemIndex >= items.length) return
				nextItemIndex += 1
				const item = items[itemIndex]

				try {
					const output = await runDiscoveryCommand([
						"item",
						"get",
						item.id,
						"--vault",
						item.vault.id,
						"--format",
						"json",
						"--no-color",
						"--account",
						account.account_uuid,
					])
					if (deadlineExpired()) {
						output.fill(0)
						discoveryTimedOut = true
						return
					}
					const publicKey = parseItemPublicKey(parseJsonAndClear(output))
					itemResults[itemIndex] = {
						candidate: createCandidate(
							account,
							item,
							publicKey,
							deps.runOpCommand,
							deps.rememberLocator,
						),
					}
				} catch (error) {
					if (
						deadlineExpired() ||
						(error instanceof OnePasswordProviderError &&
							error.code === "timeout")
					) {
						discoveryTimedOut = true
						return
					}
					itemResults[itemIndex] = {
						unsupported: {
							name: `${accountLabel(account)} / ${itemName(item)}`,
							reason:
								error instanceof OnePasswordProviderError
									? error.message
									: "invalid 1Password SSH Key item",
						},
					}
				}
			}
		}

		await Promise.all(
			Array.from({ length: Math.min(itemConcurrency, items.length) }, worker),
		)

		for (const itemResult of itemResults) {
			if (!itemResult) continue
			if ("candidate" in itemResult) result.keys.push(itemResult.candidate)
			else result.unsupportedKeys.push(itemResult.unsupported)
		}
		if (discoveryTimedOut || nextItemIndex < items.length) {
			markUnavailable(account, "discovery-timeout")
		}
	}

	return result
}
