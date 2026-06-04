import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import crypto from "node:crypto"
import * as realFs from "node:fs"
import * as realFsPromises from "node:fs/promises"
import realOs from "node:os"
import path from "node:path"

const CWD = "/workspace"
const HOME = "/home/tester"
const SSH_KEY_PATH = path.join(HOME, ".ssh", "id_ed25519")

// Per-test state
let writes: Map<string, string>
let createdDirs: Set<string>
let existingPaths: Set<string>
let readableFiles: Map<string, string>

// Module-level mocks
const existsSyncMock = mock((_p: unknown) => false)
const readFileMock = mock(async (_p: unknown, _enc?: unknown) => {
	const value = readableFiles?.get(String(_p))
	if (value === undefined) throw new Error(`ENOENT: ${String(_p)}`)
	return value
})
const mkdirMock = mock(async (_p: unknown) => {
	const normalized = String(_p)
	createdDirs?.add(normalized)
	existingPaths?.add(normalized)
})
const writeFileMock = mock(
	async (_p: unknown, data: unknown, _opts?: unknown) => {
		const normalized = String(_p)
		writes?.set(normalized, String(data))
		existingPaths?.add(normalized)
	},
)

const resolveProjectRootMock = mock(() => CWD)
const validateKeyNameMock = mock((_name: string) => ({
	valid: true as boolean,
	reason: undefined as string | undefined,
}))
const validatePublicKeyMock = mock((_key: unknown) => ({
	valid: true as boolean,
	reason: undefined as string | undefined,
}))
const isPassphraseProtectedMock = mock((_content: string) => false)
const parseOpenSSHPrivateKeyMock = mock(
	(_content: string) => null as crypto.KeyObject | null,
)
const choosePrivateKeyPromptMock = mock(async (_message: string) => {
	const { privateKey } = crypto.generateKeyPairSync("ed25519")
	return {
		name: "id_ed25519",
		privateKey,
		fingerprint: "fingerprint",
		algorithm: "ed25519" as const,
		rawPublicKey: Buffer.alloc(32),
	}
})
const inputKeyPromptMock = mock(async (_message: string) => "")
const inputNamePromptMock = mock(async (_message: string) => "alice")
const promptSelectMock = mock(async () => "paste" as "choose" | "paste")

mock.module("node:fs", () => ({ ...realFs, existsSync: existsSyncMock }))
mock.module("node:fs/promises", () => ({
	...realFsPromises,
	default: {
		...realFsPromises,
		readFile: readFileMock,
		mkdir: mkdirMock,
		writeFile: writeFileMock,
	},
}))
mock.module("node:os", () => ({ default: { ...realOs, homedir: () => HOME } }))
mock.module("../helpers/resolveProjectRoot", () => ({
	resolveProjectRoot: resolveProjectRootMock,
}))
mock.module("../helpers/validateKeyName", () => ({
	validateKeyName: validateKeyNameMock,
}))
mock.module("../helpers/validatePublicKey", () => ({
	validatePublicKey: validatePublicKeyMock,
}))
mock.module("../helpers/isPassphraseProtected", () => ({
	isPassphraseProtected: isPassphraseProtectedMock,
}))
mock.module("../helpers/parseOpenSSHKey", () => ({
	parseOpenSSHPrivateKey: parseOpenSSHPrivateKeyMock,
}))
mock.module("../prompts/choosePrivateKey", () => ({
	choosePrivateKeyPrompt: choosePrivateKeyPromptMock,
}))
mock.module("../prompts/inputKey", () => ({
	inputKeyPrompt: inputKeyPromptMock,
}))
mock.module("../prompts/inputName", () => ({
	inputNamePrompt: inputNamePromptMock,
}))
mock.module("../ui/prompts", () => ({ promptSelect: promptSelectMock }))

const { keyAddCommand } = await import("../commands/key/add")

beforeEach(() => {
	writes = new Map()
	createdDirs = new Set()
	existingPaths = new Set([SSH_KEY_PATH])
	readableFiles = new Map()

	const { privateKey } = crypto.generateKeyPairSync("ed25519")
	const privatePem = privateKey
		.export({ type: "pkcs8", format: "pem" })
		.toString("utf-8")
	readableFiles.set(SSH_KEY_PATH, privatePem)

	existsSyncMock.mockImplementation((p) => existingPaths.has(String(p)))
	readFileMock.mockImplementation(async (p, _enc) => {
		const value = readableFiles.get(String(p))
		if (value === undefined) throw new Error(`ENOENT: ${String(p)}`)
		return value
	})
	mkdirMock.mockImplementation(async (p) => {
		createdDirs.add(String(p))
		existingPaths.add(String(p))
	})
	writeFileMock.mockImplementation(async (p, data, _opts) => {
		writes.set(String(p), String(data))
		existingPaths.add(String(p))
	})
	resolveProjectRootMock.mockImplementation(() => CWD)
	validateKeyNameMock.mockImplementation(() => ({
		valid: true,
		reason: undefined,
	}))
	validatePublicKeyMock.mockImplementation(() => ({
		valid: true,
		reason: undefined,
	}))
	isPassphraseProtectedMock.mockImplementation(() => false)
	parseOpenSSHPrivateKeyMock.mockImplementation(() => null)
	choosePrivateKeyPromptMock.mockImplementation(async () => {
		const { privateKey: pk } = crypto.generateKeyPairSync("ed25519")
		return {
			name: "id_ed25519",
			privateKey: pk,
			fingerprint: "fingerprint",
			algorithm: "ed25519" as const,
			rawPublicKey: Buffer.alloc(32),
		}
	})
	inputKeyPromptMock.mockImplementation(async () => "")
	inputNamePromptMock.mockImplementation(async () => "alice")
	promptSelectMock.mockImplementation(async () => "paste")

	delete process.env.DOTENC_PRIVATE_KEY_PASSPHRASE
})

describe("keyAddCommand", () => {
	test("rejects when --from-ssh path does not exist", async () => {
		existsSyncMock.mockImplementation(() => false)

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			keyAddCommand("alice", { fromSsh: "~/.ssh/id_missing" }),
		).rejects.toThrow("exit(1)")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("rejects passphrase-protected SSH key content", async () => {
		isPassphraseProtectedMock.mockImplementation(() => true)

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			keyAddCommand("alice", { fromSsh: "~/.ssh/id_ed25519" }),
		).rejects.toThrow("exit(1)")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("supports passphrase-protected --from-ssh when DOTENC_PRIVATE_KEY_PASSPHRASE is provided", async () => {
		const { privateKey } = crypto.generateKeyPairSync("ed25519")
		const encryptedPrivatePem = privateKey
			.export({
				type: "pkcs8",
				format: "pem",
				cipher: "aes-256-cbc",
				passphrase: "secret",
			})
			.toString("utf-8")

		readableFiles.set(SSH_KEY_PATH, encryptedPrivatePem)
		isPassphraseProtectedMock.mockImplementation(() => true)
		process.env.DOTENC_PRIVATE_KEY_PASSPHRASE = "secret"

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await keyAddCommand("alice", { fromSsh: "~/.ssh/id_ed25519" })

		expect(writes.has(path.join(CWD, ".dotenc", "alice.pub"))).toBe(true)
		logSpy.mockRestore()
	})

	test("accepts --from-ssh private key and writes normalized .pub file", async () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await keyAddCommand("alice", { fromSsh: "~/.ssh/id_ed25519" })

		expect(writes.has(path.join(CWD, ".dotenc", "alice.pub"))).toBe(true)
		expect(
			logSpy.mock.calls.some((call) =>
				String(call[0]).includes("added successfully"),
			),
		).toBe(true)
		logSpy.mockRestore()
	})

	test("falls back to parsed OpenSSH private key for --from-ssh", async () => {
		const { privateKey } = crypto.generateKeyPairSync("ed25519")
		readableFiles.set(SSH_KEY_PATH, "OPENSSH-PRIVATE-KEY")

		const origCreatePrivateKey = crypto.createPrivateKey.bind(crypto)
		const privKeySpy = spyOn(crypto, "createPrivateKey").mockImplementation(
			() => {
				throw new Error("parse failed")
			},
		)
		parseOpenSSHPrivateKeyMock.mockImplementation(() => privateKey)

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await keyAddCommand("alice", { fromSsh: "~/.ssh/id_ed25519" })

		expect(writes.size).toBe(1)
		privKeySpy.mockRestore()
		logSpy.mockRestore()
		// Avoid unused variable warning
		void origCreatePrivateKey
	})

	test("uses public-key fallback when --from-ssh private key parse fails", async () => {
		const { publicKey } = crypto.generateKeyPairSync("ed25519")
		const publicPem = publicKey
			.export({ type: "spki", format: "pem" })
			.toString("utf-8")

		readableFiles.set(SSH_KEY_PATH, publicPem)
		const privKeySpy = spyOn(crypto, "createPrivateKey").mockImplementation(
			() => {
				throw new Error("not a private key")
			},
		)
		parseOpenSSHPrivateKeyMock.mockImplementation(() => null)

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await keyAddCommand("alice", { fromSsh: "~/.ssh/id_ed25519" })

		expect(writes.size).toBe(1)
		privKeySpy.mockRestore()
		logSpy.mockRestore()
	})

	test("logs details when --from-ssh content is invalid", async () => {
		readableFiles.set(SSH_KEY_PATH, "not a key")
		const privKeySpy = spyOn(crypto, "createPrivateKey").mockImplementation(
			() => {
				throw new Error("private parse failed")
			},
		)
		const pubKeySpy = spyOn(crypto, "createPublicKey").mockImplementation(
			() => {
				throw new Error("public parse failed")
			},
		)
		parseOpenSSHPrivateKeyMock.mockImplementation(() => null)

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			keyAddCommand("alice", { fromSsh: "~/.ssh/id_ed25519" }),
		).rejects.toThrow("exit(1)")

		const errors = errSpy.mock.calls.map((c) => String(c[0]))
		expect(errors.some((m) => m.includes("Invalid SSH key format"))).toBe(true)
		expect(errors.some((m) => m.includes("public parse failed"))).toBe(true)
		privKeySpy.mockRestore()
		pubKeySpy.mockRestore()
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("rejects when --from-file path does not exist", async () => {
		existsSyncMock.mockImplementation(
			(p) => String(p) === path.join(CWD, ".dotenc"),
		)

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			keyAddCommand("alice", { fromFile: "/tmp/missing.pem" }),
		).rejects.toThrow("exit(1)")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("rejects passphrase-protected --from-file keys", async () => {
		const { privateKey } = crypto.generateKeyPairSync("ed25519")
		const privatePem = privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString("utf-8")
		const fromFilePath = "/tmp/key.pem"

		existingSyncSetup([path.join(CWD, ".dotenc"), fromFilePath])
		readableFiles.set(fromFilePath, privatePem)
		isPassphraseProtectedMock.mockImplementation(() => true)

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			keyAddCommand("alice", { fromFile: fromFilePath }),
		).rejects.toThrow("exit(1)")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("supports passphrase-protected --from-file when DOTENC_PRIVATE_KEY_PASSPHRASE is provided", async () => {
		const { privateKey } = crypto.generateKeyPairSync("ed25519")
		const encryptedPrivatePem = privateKey
			.export({
				type: "pkcs8",
				format: "pem",
				cipher: "aes-256-cbc",
				passphrase: "secret",
			})
			.toString("utf-8")
		const fromFilePath = "/tmp/key.pem"

		existingSyncSetup([path.join(CWD, ".dotenc"), fromFilePath])
		readableFiles.set(fromFilePath, encryptedPrivatePem)
		isPassphraseProtectedMock.mockImplementation(() => true)
		process.env.DOTENC_PRIVATE_KEY_PASSPHRASE = "secret"

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await keyAddCommand("alice", { fromFile: fromFilePath })

		expect(writes.has(path.join(CWD, ".dotenc", "alice.pub"))).toBe(true)
		logSpy.mockRestore()
	})

	test("falls back to private key parse for --from-file", async () => {
		const { privateKey } = crypto.generateKeyPairSync("ed25519")
		const privatePem = privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString("utf-8")
		const fromFilePath = "/tmp/key.pem"

		existingSyncSetup([path.join(CWD, ".dotenc"), fromFilePath])
		readableFiles.set(fromFilePath, privatePem)

		const originalCreatePublicKey = crypto.createPublicKey.bind(crypto)
		let publicKeyCalls = 0
		const pubKeySpy = spyOn(crypto, "createPublicKey").mockImplementation(
			(input: unknown) => {
				publicKeyCalls++
				if (publicKeyCalls === 1) throw new Error("not public pem")
				return originalCreatePublicKey(input as crypto.KeyObject)
			},
		)

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await keyAddCommand("alice", { fromFile: fromFilePath })

		expect(writes.size).toBe(1)
		pubKeySpy.mockRestore()
		logSpy.mockRestore()
	})

	test("falls back to OpenSSH parser for --from-file", async () => {
		const { privateKey } = crypto.generateKeyPairSync("ed25519")
		const privatePem = privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString("utf-8")
		const fromFilePath = "/tmp/key.pem"

		existingSyncSetup([path.join(CWD, ".dotenc"), fromFilePath])
		readableFiles.set(fromFilePath, "OPENSSH PRIVATE KEY")

		// Create key object before spying so the mock can return it without calling the spy
		const parsedKey = crypto.createPrivateKey(privatePem)

		const originalCreatePublicKey = crypto.createPublicKey.bind(crypto)
		let createPublicKeyCalls = 0
		const pubKeySpy = spyOn(crypto, "createPublicKey").mockImplementation(
			(input: unknown) => {
				createPublicKeyCalls++
				if (createPublicKeyCalls === 1) throw new Error("bad public key")
				return originalCreatePublicKey(input as crypto.KeyObject)
			},
		)
		const privKeySpy = spyOn(crypto, "createPrivateKey").mockImplementation(
			() => {
				throw new Error("bad private key")
			},
		)
		parseOpenSSHPrivateKeyMock.mockImplementation(() => parsedKey)

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await keyAddCommand("alice", { fromFile: fromFilePath })

		expect(writes.size).toBe(1)
		pubKeySpy.mockRestore()
		privKeySpy.mockRestore()
		logSpy.mockRestore()
	})

	test("rejects invalid --from-file content", async () => {
		const fromFilePath = "/tmp/key.pem"

		existingSyncSetup([path.join(CWD, ".dotenc"), fromFilePath])
		readableFiles.set(fromFilePath, "not a key")

		const pubKeySpy = spyOn(crypto, "createPublicKey").mockImplementation(
			() => {
				throw new Error("bad public key")
			},
		)
		const privKeySpy = spyOn(crypto, "createPrivateKey").mockImplementation(
			() => {
				throw new Error("bad private key")
			},
		)
		parseOpenSSHPrivateKeyMock.mockImplementation(() => null)

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			keyAddCommand("alice", { fromFile: fromFilePath }),
		).rejects.toThrow("exit(1)")

		expect(
			errSpy.mock.calls.some((c) =>
				String(c[0]).includes("Invalid key format"),
			),
		).toBe(true)
		pubKeySpy.mockRestore()
		privKeySpy.mockRestore()
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("rejects passphrase-protected --from-string key without passphrase", async () => {
		isPassphraseProtectedMock.mockImplementation(() => true)

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(keyAddCommand("alice", { fromString: "any" })).rejects.toThrow(
			"exit(1)",
		)
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("supports passphrase-protected --from-string when DOTENC_PRIVATE_KEY_PASSPHRASE is provided", async () => {
		const { privateKey } = crypto.generateKeyPairSync("ed25519")
		const encryptedPrivatePem = privateKey
			.export({
				type: "pkcs8",
				format: "pem",
				cipher: "aes-256-cbc",
				passphrase: "secret",
			})
			.toString("utf-8")

		isPassphraseProtectedMock.mockImplementation(() => true)
		process.env.DOTENC_PRIVATE_KEY_PASSPHRASE = "secret"

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await keyAddCommand("alice", { fromString: encryptedPrivatePem })

		expect(writes.has(path.join(CWD, ".dotenc", "alice.pub"))).toBe(true)
		logSpy.mockRestore()
	})

	test("rejects invalid --from-string content", async () => {
		const pubKeySpy = spyOn(crypto, "createPublicKey").mockImplementation(
			() => {
				throw new Error("bad public key")
			},
		)
		const privKeySpy = spyOn(crypto, "createPrivateKey").mockImplementation(
			() => {
				throw new Error("bad private key")
			},
		)
		parseOpenSSHPrivateKeyMock.mockImplementation(() => null)

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			keyAddCommand("alice", { fromString: "invalid" }),
		).rejects.toThrow("exit(1)")
		pubKeySpy.mockRestore()
		privKeySpy.mockRestore()
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("supports --from-string private keys", async () => {
		const { privateKey } = crypto.generateKeyPairSync("ed25519")
		const privatePem = privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString("utf-8")

		const originalCreatePublicKey = crypto.createPublicKey.bind(crypto)
		let call = 0
		const pubKeySpy = spyOn(crypto, "createPublicKey").mockImplementation(
			(input: unknown) => {
				call++
				if (call === 1) throw new Error("not a public pem")
				return originalCreatePublicKey(input as crypto.KeyObject)
			},
		)

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await keyAddCommand("alice", { fromString: privatePem })

		expect(writes.size).toBe(1)
		pubKeySpy.mockRestore()
		logSpy.mockRestore()
	})

	test("interactive paste mode rejects empty input", async () => {
		promptSelectMock.mockImplementation(async () => "paste")
		inputKeyPromptMock.mockImplementation(async () => "")

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(keyAddCommand(undefined, undefined)).rejects.toThrow("exit(1)")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("interactive choose mode handles prompt errors", async () => {
		promptSelectMock.mockImplementation(async () => "choose")
		choosePrivateKeyPromptMock.mockImplementation(async () => {
			throw new Error("No private keys found")
		})

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(keyAddCommand(undefined, undefined)).rejects.toThrow("exit(1)")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("interactive choose mode uses selected key name when CLI name is missing", async () => {
		const { privateKey } = crypto.generateKeyPairSync("ed25519")

		promptSelectMock.mockImplementation(async () => "choose")
		choosePrivateKeyPromptMock.mockImplementation(async () => ({
			name: "selected_name",
			privateKey,
			fingerprint: "fingerprint",
			algorithm: "ed25519" as const,
			rawSeed: Buffer.alloc(32),
			rawPublicKey: Buffer.alloc(32),
		}))

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await keyAddCommand(undefined, undefined)

		expect(writes.has(path.join(CWD, ".dotenc", "selected_name.pub"))).toBe(
			true,
		)
		logSpy.mockRestore()
	})

	test("rejects when public key validation fails", async () => {
		validatePublicKeyMock.mockImplementation(() => ({
			valid: false,
			reason: "Invalid key: RSA key is too weak",
		}))

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			keyAddCommand("alice", { fromString: "anything" }),
		).rejects.toThrow("exit(1)")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("rejects invalid normalized key names", async () => {
		validateKeyNameMock.mockImplementation(() => ({
			valid: false,
			reason: "invalid key name",
		}))

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			keyAddCommand("invalid/../name", { fromString: "anything" }),
		).rejects.toThrow("exit(1)")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("creates .dotenc directory when absent", async () => {
		existingSyncSetup([SSH_KEY_PATH])

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await keyAddCommand("alice", { fromSsh: "~/.ssh/id_ed25519" })

		expect(createdDirs.has(path.join(CWD, ".dotenc"))).toBe(true)
		logSpy.mockRestore()
	})

	test("rejects duplicate key names", async () => {
		const duplicatePath = path.join(CWD, ".dotenc", "alice.pub")
		const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" })

		writeFileMock.mockImplementation(async (p, _data, _opts) => {
			if (String(p) === duplicatePath) throw eexistError
		})

		const errSpy = spyOn(console, "error").mockImplementation(() => {})
		const exitSpy = spyOn(process, "exit").mockImplementation((code): never => {
			throw new Error(`exit(${code})`)
		})

		await expect(
			keyAddCommand("alice", { fromString: "anything" }),
		).rejects.toThrow("exit(1)")
		errSpy.mockRestore()
		exitSpy.mockRestore()
	})

	test("writes to projectRoot .dotenc when cwd is a subdir", async () => {
		const projectRoot = "/workspace"
		const subdir = path.join(projectRoot, "packages", "web")

		const cwdSpy = spyOn(process, "cwd").mockReturnValue(subdir)
		resolveProjectRootMock.mockImplementation(() => projectRoot)

		const logSpy = spyOn(console, "log").mockImplementation(() => {})
		await keyAddCommand("alice", { fromSsh: "~/.ssh/id_ed25519" })

		// Key should be written to projectRoot/.dotenc, not subdir/.dotenc
		expect(writes.has(path.join(projectRoot, ".dotenc", "alice.pub"))).toBe(
			true,
		)
		cwdSpy.mockRestore()
		logSpy.mockRestore()
	})
})

// Helper to set up existsSyncMock with specific paths
function existingSyncSetup(paths: string[]) {
	const pathSet = new Set(paths)
	existsSyncMock.mockImplementation((p) => pathSet.has(String(p)))
}
