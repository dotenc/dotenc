import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const DEFAULT_LICENSE_FILE = resolve(REPOSITORY_ROOT, "LICENSE")
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CHECKSUM_LINE_PATTERN = /^([A-Fa-f0-9]{64}) [ *]([A-Za-z0-9][A-Za-z0-9._-]*)$/

export const AUR_PACKAGE_NAME = "dotenc-bin"
export const AUR_INSTALL_METHOD = "aur\n"
export const AUR_INSTALL_METHOD_SHA256 = createHash("sha256")
	.update(AUR_INSTALL_METHOD)
	.digest("hex")

const RELEASE_ASSETS = {
	x86_64: "dotenc-linux-x64.tar.gz",
	aarch64: "dotenc-linux-arm64.tar.gz",
} as const

export type AurArchitecture = keyof typeof RELEASE_ASSETS

export type AurRecipeOptions = {
	version: string
	checksums: Record<AurArchitecture, string>
	licenseSha256: string
}

export type AurRecipeFiles = {
	pkgbuild: string
	srcinfo: string
	installMethod: string
}

const assertSha256 = (value: string, label: string): string => {
	const normalized = value.toLowerCase()
	if (!SHA256_PATTERN.test(normalized)) {
		throw new Error(`${label} must be exactly 64 hexadecimal characters`)
	}
	return normalized
}

export const parseReleaseChecksums = (
	contents: string,
): Record<AurArchitecture, string> => {
	const checksums = new Map<string, string>()

	for (const rawLine of contents.split("\n")) {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
		if (line.length === 0) continue

		const match = CHECKSUM_LINE_PATTERN.exec(line)
		if (!match) {
			throw new Error(`Invalid SHA256SUMS line: ${line}`)
		}

		const [, checksum, filename] = match
		if (checksums.has(filename)) {
			throw new Error(`Duplicate SHA256SUMS entry: ${filename}`)
		}
		checksums.set(filename, checksum.toLowerCase())
	}

	const result = {} as Record<AurArchitecture, string>
	for (const [architecture, filename] of Object.entries(RELEASE_ASSETS) as [
		AurArchitecture,
		string,
	][]) {
		const checksum = checksums.get(filename)
		if (!checksum) {
			throw new Error(`SHA256SUMS is missing ${filename}`)
		}
		result[architecture] = assertSha256(checksum, filename)
	}

	return result
}

export const validateAurRecipeOptions = (
	options: AurRecipeOptions,
): AurRecipeOptions => {
	if (!VERSION_PATTERN.test(options.version)) {
		throw new Error(`Invalid stable semantic version: ${options.version}`)
	}

	return {
		version: options.version,
		checksums: {
			x86_64: assertSha256(options.checksums.x86_64, "x86_64 checksum"),
			aarch64: assertSha256(options.checksums.aarch64, "aarch64 checksum"),
		},
		licenseSha256: assertSha256(options.licenseSha256, "license checksum"),
	}
}

const releaseUrl = (version: string, asset: string) =>
	`https://github.com/dotenc/dotenc/releases/download/v${version}/${asset}`

const licenseUrl = (version: string) =>
	`https://raw.githubusercontent.com/dotenc/dotenc/v${version}/LICENSE`

export const renderAurRecipe = (
	unsafeOptions: AurRecipeOptions,
): AurRecipeFiles => {
	const options = validateAurRecipeOptions(unsafeOptions)
	const x86Source = `dotenc-${options.version}-x86_64.tar.gz::${releaseUrl(options.version, RELEASE_ASSETS.x86_64)}`
	const armSource = `dotenc-${options.version}-aarch64.tar.gz::${releaseUrl(options.version, RELEASE_ASSETS.aarch64)}`
	const licenseSource = `dotenc-${options.version}-LICENSE::${licenseUrl(options.version)}`

	const pkgbuild = `# SPDX-License-Identifier: 0BSD
# Maintainer: Dotenc <security@dotenc.org>

pkgname=${AUR_PACKAGE_NAME}
pkgver=${options.version}
pkgrel=1
pkgdesc='Git-native encrypted environments powered by SSH keys'
arch=('x86_64' 'aarch64')
url='https://dotenc.org'
license=('MIT')
depends=('glibc' 'openssh' 'ca-certificates')
provides=("dotenc=${options.version}")
conflicts=('dotenc')
options=('!strip')
source=(
  '${licenseSource}'
  'install-method'
)
sha256sums=(
  '${options.licenseSha256}'
  '${AUR_INSTALL_METHOD_SHA256}'
)
source_x86_64=('${x86Source}')
sha256sums_x86_64=('${options.checksums.x86_64}')
source_aarch64=('${armSource}')
sha256sums_aarch64=('${options.checksums.aarch64}')

check() {
  local binary
  case "$CARCH" in
    x86_64) binary='dotenc-linux-x64' ;;
    aarch64) binary='dotenc-linux-arm64' ;;
    *) return 1 ;;
  esac

  "$srcdir/$binary" --version | grep -Fqx "$pkgver"
}

package() {
  local binary
  case "$CARCH" in
    x86_64) binary='dotenc-linux-x64' ;;
    aarch64) binary='dotenc-linux-arm64' ;;
    *) return 1 ;;
  esac

  install -Dm755 "$srcdir/$binary" "$pkgdir/usr/bin/dotenc"
  install -Dm644 "$srcdir/install-method" "$pkgdir/usr/share/dotenc/install-method"
  install -Dm644 "$srcdir/dotenc-${options.version}-LICENSE" "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
`

	const srcinfo = `pkgbase = ${AUR_PACKAGE_NAME}
	pkgdesc = Git-native encrypted environments powered by SSH keys
	pkgver = ${options.version}
	pkgrel = 1
	url = https://dotenc.org
	arch = x86_64
	arch = aarch64
	license = MIT
	depends = glibc
	depends = openssh
	depends = ca-certificates
	provides = dotenc=${options.version}
	conflicts = dotenc
	options = !strip
	source = ${licenseSource}
	source = install-method
	sha256sums = ${options.licenseSha256}
	sha256sums = ${AUR_INSTALL_METHOD_SHA256}
	source_x86_64 = ${x86Source}
	sha256sums_x86_64 = ${options.checksums.x86_64}
	source_aarch64 = ${armSource}
	sha256sums_aarch64 = ${options.checksums.aarch64}

pkgname = ${AUR_PACKAGE_NAME}
`

	return { pkgbuild, srcinfo, installMethod: AUR_INSTALL_METHOD }
}

export const writeAurRecipe = async (
	outputDirectory: string,
	options: AurRecipeOptions,
): Promise<AurRecipeFiles> => {
	const files = renderAurRecipe(options)
	await mkdir(outputDirectory, { recursive: true, mode: 0o755 })
	await Promise.all([
		writeFile(resolve(outputDirectory, "PKGBUILD"), files.pkgbuild, {
			mode: 0o644,
		}),
		writeFile(resolve(outputDirectory, ".SRCINFO"), files.srcinfo, {
			mode: 0o644,
		}),
		writeFile(
			resolve(outputDirectory, "install-method"),
			files.installMethod,
			{ mode: 0o644 },
		),
	])
	return files
}

const HELP = `Usage: bun cli/packaging/aur.ts [options]

Options:
  --version <X.Y.Z>       Stable dotenc release version
  --checksums <path>      Release SHA256SUMS file
  --output-dir <path>     Directory for PKGBUILD, .SRCINFO, and install-method
  --license-file <path>   MIT license file from the tagged source tree
  --help                  Show this help
`

export const runAurCli = async (args: string[]): Promise<void> => {
	const parsed = parseArgs({
		args,
		options: {
			version: { type: "string" },
			checksums: { type: "string" },
			"output-dir": { type: "string" },
			"license-file": { type: "string" },
			help: { type: "boolean" },
		},
		strict: true,
		allowPositionals: false,
	})

	if (parsed.values.help) {
		process.stdout.write(HELP)
		return
	}

	const version = parsed.values.version
	const checksumsFile = parsed.values.checksums
	const outputDirectory = parsed.values["output-dir"]
	if (!version || !checksumsFile || !outputDirectory) {
		throw new Error("--version, --checksums, and --output-dir are required")
	}

	const licenseFile = parsed.values["license-file"] ?? DEFAULT_LICENSE_FILE
	const [checksumContents, licenseContents] = await Promise.all([
		readFile(resolve(checksumsFile), "utf8"),
		readFile(resolve(licenseFile)),
	])

	await writeAurRecipe(resolve(outputDirectory), {
		version,
		checksums: parseReleaseChecksums(checksumContents),
		licenseSha256: createHash("sha256").update(licenseContents).digest("hex"),
	})
}

if (import.meta.main) {
	runAurCli(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
