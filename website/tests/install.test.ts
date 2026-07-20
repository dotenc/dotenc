import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const installerPath = resolve(import.meta.dir, "../public/install.sh")
const installer = readFileSync(installerPath, "utf8")
const temporaryRoots: string[] = []

const APT_KEY_SHA256 =
	"108333389e16fc3dbdb09938308639951ea6df5fb8f482eba562cafbc353c58f"
const RPM_KEY_SHA256 =
	"2600233af0c9acab0f047d2f0c1fbda5d5970187a41a67eecdd85240b983309b"
const APK_KEY_SHA256 =
	"6b8e09be9c96801f9434f8b8e7c622cedcf6c343eb50483509dcd18a3b5b4b50"

type InstallerOptions = {
	commands: string[]
	failCommand?: string
	hash?: string
	os?: string
	sudoNoninteractive?: boolean
	uid?: number
}

type InstallerResult = {
	calls: string
	status: number | null
	stderr: string
	stdout: string
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true })
	}
})

function writeCommand(binDirectory: string, name: string, body: string) {
	const commandPath = join(binDirectory, name)
	writeFileSync(commandPath, `#!/bin/sh\nset -eu\n${body}`)
	chmodSync(commandPath, 0o755)
}

function logInvocationBody(extra = "") {
	return `command_name="\${0##*/}"
{
	printf '%s' "$command_name"
	for argument in "$@"; do
		printf '\\t%s' "$argument"
	done
	printf '\\n'
} >> "$DOTENC_TEST_LOG"
if [ "\${DOTENC_TEST_FAIL_COMMAND:-}" = "$command_name" ]; then
	exit 23
fi
${extra}
`
}

function runInstaller(options: InstallerOptions): InstallerResult {
	const root = mkdtempSync(join(tmpdir(), "dotenc-installer-test-"))
	temporaryRoots.push(root)
	const binDirectory = join(root, "bin")
	const logPath = join(root, "calls.log")
	mkdirSync(binDirectory)
	writeFileSync(logPath, "")

	for (const utility of ["mktemp", "rm"]) {
		const utilityPath = Bun.which(utility)
		if (!utilityPath) throw new Error(`${utility} is required to run installer tests`)
		symlinkSync(utilityPath, join(binDirectory, utility))
	}

	writeCommand(
		binDirectory,
		"uname",
		`printf '%s\\n' "$DOTENC_TEST_OS"\n`,
	)
	writeCommand(
		binDirectory,
		"id",
		`if [ "\${1:-}" = "-u" ]; then printf '%s\\n' "$DOTENC_TEST_UID"; else exit 2; fi\n`,
	)
	writeCommand(
		binDirectory,
		"curl",
		logInvocationBody(`target_path=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		--output | -o)
			shift
			target_path="\${1:-}"
			;;
	esac
	shift
done
[ -n "$target_path" ]
printf '%s' 'mock public key' > "$target_path"`),
	)
	writeCommand(
		binDirectory,
		"sha256sum",
		logInvocationBody(`target_path=""
for argument in "$@"; do target_path="$argument"; done
printf '%s  %s\\n' "$DOTENC_TEST_HASH" "$target_path"`),
	)
	writeCommand(
		binDirectory,
		"sudo",
		`if [ "\${1:-}" = "-n" ] && [ "\${2:-}" = "true" ]; then
	printf '%s\\n' 'sudo\t-n\ttrue' >> "$DOTENC_TEST_LOG"
	if [ "$DOTENC_TEST_SUDO_NONINTERACTIVE" = "true" ]; then exit 0; else exit 1; fi
fi
${logInvocationBody('exec "$@"')}`,
	)
	writeCommand(
		binDirectory,
		"dotenc",
		logInvocationBody(`printf '%s\\n' '0.12.1'`),
	)
	writeCommand(binDirectory, "grep", logInvocationBody("exit 1"))
	writeCommand(
		binDirectory,
		"tee",
		logInvocationBody(`while IFS= read -r line; do
	printf 'FILE\\t%s\\n' "$line" >> "$DOTENC_TEST_LOG"
done`),
	)

	const genericCommands = new Set([
		...options.commands,
		"chmod",
		"cp",
		"install",
		"mkdir",
	])
	for (const command of genericCommands) {
		if (
			["curl", "dotenc", "grep", "id", "sha256sum", "sudo", "tee", "uname"].includes(
				command,
			)
		)
			continue
		const captureFiles =
			command === "install"
				? `for argument in "$@"; do
	if [ -f "$argument" ]; then
		while IFS= read -r line || [ -n "$line" ]; do
			printf 'FILE\\t%s\\n' "$line" >> "$DOTENC_TEST_LOG"
		done < "$argument"
	fi
done`
				: ""
		writeCommand(binDirectory, command, logInvocationBody(captureFiles))
	}

	const child = spawnSync("/bin/sh", [], {
		encoding: "utf8",
		env: {
			DOTENC_TEST_FAIL_COMMAND: options.failCommand ?? "",
			DOTENC_TEST_HASH: options.hash ?? APT_KEY_SHA256,
			DOTENC_TEST_LOG: logPath,
			DOTENC_TEST_OS: options.os ?? "Linux",
			DOTENC_TEST_SUDO_NONINTERACTIVE: String(
				options.sudoNoninteractive ?? false,
			),
			DOTENC_TEST_UID: String(options.uid ?? 0),
			PATH: binDirectory,
			TMPDIR: root,
		},
		input: installer,
	})

	return {
		calls: readFileSync(logPath, "utf8"),
		status: child.status,
		stderr: child.stderr,
		stdout: child.stdout,
	}
}

describe("Linux native package selection", () => {
	test("configures the signed APT repository before installing dotenc", () => {
		const result = runInstaller({ commands: ["apt-get"] })

		expect(result.status).toBe(0)
		expect(result.calls).toContain(
			`dotenc-apt-7BEFECEEA5921A0C3C431CFAA1A964033C1E2A5B-${APT_KEY_SHA256}.asc`,
		)
		expect(result.calls).toContain("FILE\tSigned-By: /etc/apt/keyrings/dotenc.asc")
		expect(result.calls).toContain("apt-get\tinstall\t-y\tdotenc")
		expect(result.calls.indexOf("sha256sum")).toBeLessThan(
			result.calls.indexOf("apt-get"),
		)
	})

	test.each(["dnf", "yum"])(
		"configures the signed RPM repository with %s",
		(rpmInstaller) => {
			const result = runInstaller({
				commands: [rpmInstaller],
				hash: RPM_KEY_SHA256,
			})

			expect(result.status).toBe(0)
			expect(result.calls).toContain(
				`dotenc-rpm-C1FFEF75009580AB4A9EDDE87486A84C0C27D6A2-${RPM_KEY_SHA256}.asc`,
			)
			expect(result.calls).toContain("FILE\tgpgcheck=1")
			expect(result.calls).toContain("FILE\trepo_gpgcheck=1")
			expect(result.calls).toContain(
				"FILE\tgpgkey=file:///etc/pki/rpm-gpg/dotenc.asc",
			)
			expect(result.calls).toContain("FILE\tsslverify=1")
			expect(result.calls).toContain(`${rpmInstaller}\tinstall\t-y\tdotenc`)
		},
	)

	test("configures the signed APK repository", () => {
		const result = runInstaller({ commands: ["apk"], hash: APK_KEY_SHA256 })

		expect(result.status).toBe(0)
		expect(result.calls).toContain(
			"dotenc-600d1cdeb051ccba069f4c444aa76d9094caf23b3aea0a29f1a84e2bf3204128.rsa.pub",
		)
		expect(result.calls).toContain("FILE\thttps://packages.dotenc.org/apk/stable/main")
		expect(result.calls).toContain("apk\tadd\t--no-cache\tdotenc")
	})

	test("uses passwordless sudo when available", () => {
		const result = runInstaller({
			commands: ["apt-get"],
			sudoNoninteractive: true,
			uid: 1000,
		})

		expect(result.status).toBe(0)
		expect(result.calls).toContain("sudo\t-n\ttrue")
		expect(result.calls).toContain("sudo\tapt-get\tinstall\t-y\tdotenc")
	})

	test("prefers the native manager over Homebrew and npm", () => {
		const result = runInstaller({ commands: ["apt-get", "brew", "npm"] })

		expect(result.status).toBe(0)
		expect(result.calls).toContain("apt-get\tinstall\t-y\tdotenc")
		expect(result.calls).not.toContain("brew\t")
		expect(result.calls).not.toContain("npm\t")
	})

	test("falls back to npm when a noninteractive caller cannot elevate", () => {
		const result = runInstaller({ commands: ["apt-get", "npm"], uid: 1000 })

		expect(result.status).toBe(0)
		expect(result.calls).toContain("sudo\t-n\ttrue")
		expect(result.calls).not.toContain("apt-get\t")
		expect(result.calls).toContain("npm\tinstall\t-g\t@dotenc/cli")
	})

	test("does not invoke an AUR helper without an interactive terminal", () => {
		const result = runInstaller({ commands: ["yay", "paru", "npm"], uid: 1000 })

		expect(result.status).toBe(0)
		expect(result.calls).not.toContain("yay\t")
		expect(result.calls).not.toContain("paru\t")
		expect(result.calls).toContain("npm\tinstall\t-g\t@dotenc/cli")
		expect(installer).not.toContain("--noconfirm")
	})
})

describe("bootstrap failure handling", () => {
	test.each([
		["APT", "apt-get"],
		["RPM", "dnf"],
		["APK", "apk"],
	])("%s key mismatch performs no privileged or package-manager action", (_, manager) => {
		const result = runInstaller({ commands: [manager], hash: "0".repeat(64) })

		expect(result.status).not.toBe(0)
		expect(result.stderr).toContain("Repository key checksum mismatch")
		expect(result.calls).not.toContain(`${manager}\t`)
		expect(result.calls).not.toContain("install\t")
		expect(result.calls).not.toContain("sudo\t")
	})

	test("does not fall through when the selected package manager fails", () => {
		const result = runInstaller({
			commands: ["apt-get", "npm"],
			failCommand: "apt-get",
		})

		expect(result.status).toBe(23)
		expect(result.calls).not.toContain("npm\t")
	})
})

describe("existing platform fallbacks", () => {
	test("uses Homebrew on macOS", () => {
		const result = runInstaller({ commands: ["brew", "npm"], os: "Darwin" })

		expect(result.status).toBe(0)
		expect(result.calls).toContain("brew\ttap\tivanfilhoz/dotenc")
		expect(result.calls).toContain("brew\tinstall\tdotenc")
		expect(result.calls).not.toContain("npm\t")
	})

	test("uses Scoop under Git Bash", () => {
		const result = runInstaller({ commands: ["scoop", "npm"], os: "MINGW64_NT" })

		expect(result.status).toBe(0)
		expect(result.calls).toContain(
			"scoop\tbucket\tadd\tdotenc\thttps://github.com/ivanfilhoz/scoop-dotenc",
		)
		expect(result.calls).toContain("scoop\tinstall\tdotenc")
		expect(result.calls).not.toContain("npm\t")
	})

	test("rejects an unsupported OS without a silent success", () => {
		const result = runInstaller({ commands: [], os: "Plan9" })

		expect(result.status).not.toBe(0)
		expect(result.stderr).toContain("Unsupported OS: Plan9")
	})
})
