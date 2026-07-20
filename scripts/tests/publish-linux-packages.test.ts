import { createHash } from "node:crypto"
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
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

const temporaryDirectories: string[] = []

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
		]) {
			const escapedStepName = stepName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			expect(workflow).toMatch(
				new RegExp(
					`- name: ${escapedStepName}\\n\\s+if: [^\\n]*validate_only != 'true'`,
				),
			)
		}
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
