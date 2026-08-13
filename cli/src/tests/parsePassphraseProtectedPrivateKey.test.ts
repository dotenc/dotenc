import { describe, expect, mock, test } from "bun:test"
import crypto from "node:crypto"
import { parsePassphraseProtectedPrivateKey } from "../helpers/parsePassphraseProtectedPrivateKey"

describe("parsePassphraseProtectedPrivateKey", () => {
	test("parses encrypted PEM directly with passphrase", async () => {
		const { privateKey } = crypto.generateKeyPairSync("ed25519")
		const encryptedPem = privateKey
			.export({
				type: "pkcs8",
				format: "pem",
				cipher: "aes-256-cbc",
				passphrase: "secret",
			})
			.toString("utf-8")

		const parsed = await parsePassphraseProtectedPrivateKey(
			encryptedPem,
			"secret",
		)
		expect(parsed).toBeDefined()
		expect(parsed?.asymmetricKeyType).toBe("ed25519")
	})

	test("falls back to ssh-keygen flow for encrypted OpenSSH content", async () => {
		const { privateKey } = crypto.generateKeyPairSync("ed25519")
		const unencryptedPem = privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString("utf-8")
		const created = crypto.createPrivateKey(unencryptedPem)

		let passphraseInput = ""
		const spawnSync = mock(
			(_command: string, _args: string[], options: { input?: Buffer }) => {
				passphraseInput = Buffer.from(options.input ?? []).toString("utf-8")
				return { status: 0, stdout: "", stderr: "" } as never
			},
		)
		const chmod = mock(async () => undefined)
		const writeFile = mock(async () => undefined)
		const secureEraseFile = mock(async () => undefined)
		const rm = mock(async () => undefined)
		const unlockedKeyContent = Buffer.from("UNENCRYPTED-OPENSSH-CONTENT")

		const parsed = await parsePassphraseProtectedPrivateKey(
			"-----BEGIN OPENSSH PRIVATE KEY-----\ninvalid\n-----END OPENSSH PRIVATE KEY-----",
			"secret",
			{
				createPrivateKey: mock((_input: unknown) => {
					throw new Error("no direct parse")
				}) as never,
				parseOpenSSHPrivateKey: mock(() => created),
				mkdtemp: mock(async () => "/tmp/dotenc-passphrase-abc") as never,
				chmod: chmod as never,
				writeFile: writeFile as never,
				readFile: mock(async () => unlockedKeyContent) as never,
				rm: rm as never,
				secureEraseFile: secureEraseFile as never,
				tmpdir: () => "/tmp",
				spawnSync: spawnSync as never,
			},
		)

		expect(parsed).toBe(created)
		// Passphrase must not appear in ssh-keygen arguments (process listing exposure).
		const [, spawnArgs, spawnOptions] = spawnSync.mock.calls[0] as [
			string,
			string[],
			{ env: NodeJS.ProcessEnv; input: Buffer },
		]
		expect(spawnArgs).not.toContain("-P")
		expect(spawnArgs).not.toContain("secret")
		expect(passphraseInput).toBe("secret")
		expect(spawnOptions.input.every((byte) => byte === 0)).toBe(true)
		expect(spawnOptions.env.DOTENC_PRIVATE_KEY_BASE64).toBeUndefined()
		expect(spawnOptions.env.DOTENC_PRIVATE_KEY_PASSPHRASE).toBeUndefined()
		expect(spawnOptions.env["INPUT_GITHUB-TOKEN"]).toBeUndefined()
		expect(spawnOptions.env.SSH_ASKPASS).toEndWith("/askpass.sh")
		expect(spawnOptions.env.SSH_ASKPASS_REQUIRE).toBe("force")
		expect(chmod).toHaveBeenCalledWith("/tmp/dotenc-passphrase-abc", 0o700)
		expect(writeFile).toHaveBeenCalledTimes(2)
		expect(writeFile.mock.calls.join(" ")).not.toContain("secret")
		expect(secureEraseFile).toHaveBeenCalledWith(
			"/tmp/dotenc-passphrase-abc/key",
		)
		expect(secureEraseFile).toHaveBeenCalledWith(
			"/tmp/dotenc-passphrase-abc/askpass.sh",
		)
		expect(rm).toHaveBeenCalledWith("/tmp/dotenc-passphrase-abc", {
			recursive: true,
			force: true,
		})
		expect(unlockedKeyContent.every((byte) => byte === 0)).toBe(true)
	})

	test("returns null when ssh-keygen fallback fails", async () => {
		const parsed = await parsePassphraseProtectedPrivateKey(
			"-----BEGIN OPENSSH PRIVATE KEY-----\ninvalid\n-----END OPENSSH PRIVATE KEY-----",
			"wrong",
			{
				createPrivateKey: mock((_input: unknown) => {
					throw new Error("no direct parse")
				}) as never,
				parseOpenSSHPrivateKey: mock((_input: string | Buffer) => null),
				mkdtemp: mock(async () => "/tmp/dotenc-passphrase-fail") as never,
				chmod: mock(async () => undefined) as never,
				writeFile: mock(async () => undefined) as never,
				readFile: mock(async () => Buffer.from("ignored")) as never,
				rm: mock(async () => undefined) as never,
				secureEraseFile: mock(async () => undefined) as never,
				tmpdir: () => "/tmp",
				spawnSync: mock(
					(_command: string, _args: string[], _options: unknown) =>
						({ status: 1, stdout: "", stderr: "bad passphrase" }) as never,
				) as never,
			},
		)

		expect(parsed).toBeNull()
	})
})
