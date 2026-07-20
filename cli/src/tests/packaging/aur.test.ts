import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
	AUR_INSTALL_METHOD_SHA256,
	parseReleaseChecksums,
	renderAurRecipe,
	runAurCli,
	validateAurRecipeOptions,
} from "../../../packaging/aur"

const X86_CHECKSUM = "a".repeat(64)
const ARM_CHECKSUM = "b".repeat(64)
const LICENSE_CHECKSUM = "c".repeat(64)

const options = {
	version: "1.2.3",
	checksums: {
		x86_64: X86_CHECKSUM,
		aarch64: ARM_CHECKSUM,
	},
	licenseSha256: LICENSE_CHECKSUM,
}

describe("AUR release checksum parsing", () => {
	test("selects the glibc x86_64 and aarch64 release archives", () => {
		const checksums = parseReleaseChecksums(
			[
				`${"d".repeat(64)}  dotenc-darwin-arm64.tar.gz`,
				`${X86_CHECKSUM.toUpperCase()}  dotenc-linux-x64.tar.gz`,
				`${ARM_CHECKSUM} *dotenc-linux-arm64.tar.gz`,
				`${"e".repeat(64)}  dotenc-linux-x64-musl.tar.gz`,
				"",
			].join("\r\n"),
		)

		expect(checksums).toEqual({
			x86_64: X86_CHECKSUM,
			aarch64: ARM_CHECKSUM,
		})
	})

	test("rejects missing, duplicate, and malformed entries", () => {
		expect(() =>
			parseReleaseChecksums(`${X86_CHECKSUM}  dotenc-linux-x64.tar.gz\n`),
		).toThrow("missing dotenc-linux-arm64.tar.gz")

		expect(() =>
			parseReleaseChecksums(
				[
					`${X86_CHECKSUM}  dotenc-linux-x64.tar.gz`,
					`${X86_CHECKSUM}  dotenc-linux-x64.tar.gz`,
					`${ARM_CHECKSUM}  dotenc-linux-arm64.tar.gz`,
				].join("\n"),
			),
		).toThrow("Duplicate SHA256SUMS entry")

		expect(() =>
			parseReleaseChecksums(`${X86_CHECKSUM}  ../dotenc-linux-x64.tar.gz\n`),
		).toThrow("Invalid SHA256SUMS line")
	})
})

describe("AUR recipe rendering", () => {
	test("renders deterministic dotenc-bin metadata for both Arch ecosystems", () => {
		const first = renderAurRecipe(options)
		const second = renderAurRecipe(options)

		expect(first).toEqual(second)
		expect(first.installMethod).toBe("aur\n")
		expect(AUR_INSTALL_METHOD_SHA256).toBe(
			createHash("sha256").update("aur\n").digest("hex"),
		)

		expect(first.pkgbuild).toContain("# SPDX-License-Identifier: 0BSD")
		expect(first.pkgbuild).toContain("pkgname=dotenc-bin")
		expect(first.pkgbuild).toContain("arch=('x86_64' 'aarch64')")
		expect(first.pkgbuild).toContain(
			"depends=('glibc' 'openssh' 'ca-certificates')",
		)
		expect(first.pkgbuild).toContain('provides=("dotenc=1.2.3")')
		expect(first.pkgbuild).toContain("conflicts=('dotenc')")
		expect(first.pkgbuild).toContain("options=('!strip')")
		expect(first.pkgbuild).toContain(
			"releases/download/v1.2.3/dotenc-linux-x64.tar.gz",
		)
		expect(first.pkgbuild).toContain(
			"releases/download/v1.2.3/dotenc-linux-arm64.tar.gz",
		)
		expect(first.pkgbuild).toContain(
			'install -Dm755 "$srcdir/$binary" "$pkgdir/usr/bin/dotenc"',
		)
		expect(first.pkgbuild).toContain(
			'"$pkgdir/usr/share/dotenc/install-method"',
		)
		expect(first.pkgbuild).toContain(
			'"$pkgdir/usr/share/licenses/$pkgname/LICENSE"',
		)

		expect(first.srcinfo).toContain("pkgbase = dotenc-bin")
		expect(first.srcinfo).toContain("source_x86_64 = dotenc-1.2.3-x86_64")
		expect(first.srcinfo).toContain("source_aarch64 = dotenc-1.2.3-aarch64")
		expect(first.srcinfo).toContain(`sha256sums_x86_64 = ${X86_CHECKSUM}`)
		expect(first.srcinfo).toContain(`sha256sums_aarch64 = ${ARM_CHECKSUM}`)
	})

	test("rejects unstable versions and invalid checksums", () => {
		expect(() =>
			validateAurRecipeOptions({ ...options, version: "1.2.3-rc.1" }),
		).toThrow("Invalid stable semantic version")
		expect(() =>
			validateAurRecipeOptions({
				...options,
				checksums: { ...options.checksums, x86_64: "not-a-checksum" },
			}),
		).toThrow("x86_64 checksum")
		expect(() =>
			validateAurRecipeOptions({ ...options, licenseSha256: "f" }),
		).toThrow("license checksum")
	})

	test("writes the complete AUR repository input through the CLI", async () => {
		const root = await mkdtemp(join(tmpdir(), "dotenc-aur-test-"))
		const checksumsFile = join(root, "SHA256SUMS")
		const licenseFile = join(root, "LICENSE")
		const outputDirectory = join(root, "output")
		const license = "test license\n"

		await Promise.all([
			writeFile(
				checksumsFile,
				`${X86_CHECKSUM}  dotenc-linux-x64.tar.gz\n${ARM_CHECKSUM}  dotenc-linux-arm64.tar.gz\n`,
			),
			writeFile(licenseFile, license),
		])

		await runAurCli([
			"--version",
			"1.2.3",
			"--checksums",
			checksumsFile,
			"--output-dir",
			outputDirectory,
			"--license-file",
			licenseFile,
		])

		const [pkgbuild, srcinfo, installMethod] = await Promise.all([
			readFile(join(outputDirectory, "PKGBUILD"), "utf8"),
			readFile(join(outputDirectory, ".SRCINFO"), "utf8"),
			readFile(join(outputDirectory, "install-method"), "utf8"),
		])

		expect(pkgbuild).toContain("pkgver=1.2.3")
		expect(srcinfo).toContain(
			`sha256sums = ${createHash("sha256").update(license).digest("hex")}`,
		)
		expect(installMethod).toBe("aur\n")
	})
})

describe("AUR publication workflow", () => {
	test("validates SSH read-only and keeps manual publication gated", async () => {
		const workflow = await readFile(
			resolve(
				import.meta.dir,
				"../../../../.github/workflows/publish-aur-package.yml",
			),
			"utf8",
		)

		expect(workflow).toMatch(
			/workflow_dispatch:[\s\S]*?publish:[\s\S]*?default: false/,
		)
		expect(workflow).toContain("github.event_name == 'workflow_dispatch'")
		expect(workflow).toContain("vars.AUR_PACKAGES_ENABLED == 'true'")
		expect(workflow).toContain(
			"SHA256:RFzBCUItH9LZS0cKB5UE6ceAYhBD5C8GeOBip8Z11+4",
		)
		expect(workflow).toContain("unset AUR_SSH_PRIVATE_KEY_BASE64")
		expect(workflow).toContain(
			'artifact_dir="$GITHUB_WORKSPACE/aur-recipe-artifact"',
		)
		expect(workflow).toContain("path: aur-recipe-artifact/")
		expect(workflow).not.toMatch(/runner\.temp.*dotenc-bin\/PKGBUILD/)
		expect(workflow).toContain('ssh -F "$ssh_config" -T aur.archlinux.org help')
		expect(workflow).toContain(
			'[[ "$PUBLISH_REQUESTED" != "true" || "$AUR_PACKAGES_ENABLED" != "true" ]]',
		)
		expect(workflow).toContain("push origin HEAD:master")
		expect(workflow).not.toMatch(/git[^\n]*push[^\n]*--force/)
	})
})
