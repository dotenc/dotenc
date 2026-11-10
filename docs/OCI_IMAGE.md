# dotenc CLI OCI image

`ghcr.io/dotenc/cli` packages the dotenc CLI as small glibc and Alpine/musl
Linux container images. They are intended for CI jobs, provider hooks,
multi-stage application builds, and smoke tests that need dotenc without
installing Node.js, Bun, or the npm package.

## Variants and tags

| Runtime | Rolling tag | Version tags | Dockerfile target |
| --- | --- | --- | --- |
| Debian 13 Trixie/glibc | `latest` | `<version>`, `v<version>` | `runtime` |
| Alpine/musl | `alpine` | `<version>-alpine`, `v<version>-alpine` | `runtime-alpine` |

Both variants are published for `linux/amd64` and `linux/arm64`. The Debian
variant remains the default. Starting with CLI 0.15.1, it uses Debian 13 Trixie
in place of Debian 12 Bookworm. Use the Alpine variant when the
CLI runs inside Alpine or its binary is copied into another musl-based image.

Do not copy a musl binary into a glibc application image, or a glibc binary into
an Alpine application image.

## Image contents

The runtime image contains:

- the compiled standalone `dotenc` Linux binary
- `ca-certificates`
- `openssh-client` for `ssh-keygen`-backed key workflows
- a non-root `dotenc` user

The Alpine variant also includes `libstdc++` and `libgcc`, which the compiled
Bun musl executable requires.

It intentionally does not include Node.js, Bun, npm, pnpm, Yarn, provider CLIs,
or application build tools. Keep the application's normal runtime and copy the
dotenc binary into it when the wrapped command needs those tools.

## Security maintenance

CI and release builds pull fresh base images, disable build-layer reuse, and
upgrade installed distribution packages before adding runtime dependencies.
Every runtime architecture must pass `scripts/check-image-security.sh` during
its build. You can rerun the same read-only check on a published image:

```bash
docker run --rm --entrypoint sh ghcr.io/dotenc/cli:0.15.4 /usr/local/bin/check-image-security
```

Reviewed minimum package versions (2026-11-09):

| Distribution | Packages | Minimum version |
| --- | --- | --- |
| Debian 13 | `apt`, `libapt-pkg7.0` | `3.0.4` |
| Debian 13 | `zlib1g` | `1:1.3.dfsg+really1.3.1-1+deb13u1` |
| Debian 13 | `openssl`, `libssl3t64`, `openssl-provider-legacy` | `3.5.7-1~deb13u3` |
| Debian 13 | `libpcre2-8-0` | `10.46-1~deb13u3` |
| Debian 13 | `perl-base` | `5.40.1-6+deb13u1` |
| Debian 13 | `liblzma5` | `5.8.1-1+deb13u2` |
| Alpine 3.24 | `zlib` | `1.4-r0` |
| Alpine 3.24 | `libssl3`, `libcrypto3` | `3.5.9-r0` |
| Alpine 3.24 | `openssh-client-common`, `openssh-client-default`, `openssh-keygen` | `10.3_p1-r2` |

The Debian OpenSSL floor follows [DSA-6531-1](https://security-tracker.debian.org/tracker/DSA-6531-1),
which backports the September 29 fixes into Trixie's 3.5.7 package.
The upstream version alone therefore does not establish whether it is patched.
Alpine's OpenSSH package includes security backports despite its older upstream
version; use the [Alpine 3.24 security database](https://secdb.alpinelinux.org/v3.24/main.json)
when reviewing it. These minimums block known regressions, but are not a complete
or continuously updated vulnerability scan. Reassess all OS packages during
security reviews and raise the floors when new fixes become available.

The October 5 floors also require Debian's [PCRE2 backport](https://security-tracker.debian.org/tracker/CVE-2026-103111)
and [Perl update](https://security-tracker.debian.org/tracker/CVE-2026-7017), plus
Alpine's [OpenSSL 3.5.9 security update](https://github.com/alpinelinux/aports/commit/29b9ec24b1b5b39aeef51fa2a044210e2ec5258e).

The October 12 floor additionally requires Debian's `liblzma5` backport for
[GHSA-5qpq-xqfv-j9pg](https://github.com/tukaani-project/xz/security/advisories/GHSA-5qpq-xqfv-j9pg),
confirmed in the [Debian tracker](https://security-tracker.debian.org/tracker/TEMP-1147318-639065).
The defect requires decoder reinitialization after allocation failure; no direct
dotenc call path was established. The image includes liblzma through packaging
tools, so rebuilds require the available vendor fix.

Alpine additionally requires zlib `1.4-r0`: its security database tracks
`CVE-2026-4738` at that revision. Upstream's
[1.4 correction](https://github.com/madler/zlib/releases/tag/v1.4) is in
`contrib/infback9`, outside the libz loaded by the image. The earlier
gzip-write issue `CVE-2026-85091` was already fixed by Alpine's
[`1.3.2-r1` backport](https://github.com/alpinelinux/aports/commit/0afa2da0e8c8051c6f8f64a7a388e5a259904245). Debian's
[DSA-6613-1](https://security-tracker.debian.org/tracker/DSA-6613-1)
backports fixes for `CVE-2026-27171`, `CVE-2026-76844`, and
`CVE-2026-85091` to Trixie zlib `1:1.3.dfsg+really1.3.1-1+deb13u1`.
No dotenc call path to the vulnerable gzip write sequence was established;
the runtime images still ship zlib, so their package floors require the fixes.

Debian's [DSA-6607-1](https://security-tracker.debian.org/tracker/DSA-6607-1)
fixes APT's `CVE-2026-109518` download verification bypass in `3.0.4`.
Fresh official Trixie base images contain the fixed APT on both architectures,
and the image build pulls the base afresh and upgrades packages before use.

**Older Bookworm images and npm hosts:** the Trixie migration fixes the reviewed
September OpenSSL issues in default OCI images starting with 0.15.1. It does not upgrade
previously pulled Bookworm images or the host's Node/OpenSSL. Bookworm's
`3.0.22-1~deb12u2` OpenSSL update now fixes `CVE-2026-35189`, but old images
and npm hosts need their own update. The npm runtime notice is informational
and separate from the standalone OCI binary; it is not a mitigation or a claim
that the host is patched.

**Remaining Debian OpenSSH limitation:** as of 2026-11-09, Debian Trixie
(`openssh-client` `1:10.0p1-7+deb13u4`) and Bookworm have no fixed package recorded for the reviewed client issues CVE-2026-59995,
CVE-2026-59996, CVE-2026-60002, CVE-2026-73281 and CVE-2026-73282. For example,
[Debian tracks CVE-2026-73282 without a stable update](https://security-tracker.debian.org/tracker/CVE-2026-73282),
a concurrent remote-forwarding use-after-free. dotenc's key workflows use local
`ssh-keygen`; no affected dotenc call path was established. The image also ships
`ssh` and `ssh-agent`, which wrapped commands may use. Prefer the patched Alpine
variant where compatible if those SSH features are needed, and track Debian's
backports before treating the default image as fully remediated. Do not compare
upstream version strings alone or mix Debian unstable packages into the stable image.

The Trixie source package also lists [CVE-2026-55654](https://security-tracker.debian.org/tracker/CVE-2026-55654),
a GSSAPI/Kerberos authentication-indicator cleanup issue. That SSH server
authentication path is absent from this client-only image (`sshd` is not
installed). Reassess exposure if adding an SSH server or enabling additional
SSH features in a derived image. Track Debian residuals in the weekly security
review; there is no separate daily checker.

**New OpenSSH 10.6 advisories:** the [October 6 upstream release](https://www.openssh.org/txt/release-10.6)
fixes additional SFTP traversal, SSH username handling, compression and certificate
expiry issues. As of November 9, no corresponding client backport was verified in either
Trixie `1:10.0p1-7+deb13u4` or Alpine `10.3_p1-r2`. Alpine's earlier backports
cover the five previously tracked client advisories, not this new set. dotenc
uses key creation/passphrase conversion, not SSH certificate signing or network
SSH/SFTP. Wrapped commands must avoid untrusted SSH usernames and unsafe recursive
SFTP sources; leave SSH compression disabled when mixing trust levels. No `sshd`
is installed. Continue tracking vendor fixes weekly.

## Pull and verify

Pin a version tag for repeatable CI:

```bash
docker pull ghcr.io/dotenc/cli:0.10.0
docker run --rm ghcr.io/dotenc/cli:0.10.0 --version
```

`latest` tracks the newest published stable CLI image:

```bash
docker run --rm ghcr.io/dotenc/cli:latest --help
```

Use `alpine` or a numbered Alpine tag for musl:

```bash
docker run --rm ghcr.io/dotenc/cli:0.10.0-alpine --version
```

Rolling and version tags are mutable registry references. For a fully fixed
production input, resolve the multi-architecture manifest digest and pin it:

```bash
docker buildx imagetools inspect ghcr.io/dotenc/cli:0.10.0
docker run --rm ghcr.io/dotenc/cli@sha256:<manifest-digest> --version
```

Published images include BuildKit provenance and SBOM attestations as OCI
referrers.

## Add dotenc to an application image

The image is deliberately runtime-neutral. Use it as a multi-stage source and
keep the application's existing build, runtime, and start command.

For Debian, Ubuntu, and other glibc-based images:

```dockerfile
FROM ghcr.io/dotenc/cli:0.10.0 AS dotenc

FROM <existing-glibc-application-image>
# Add these before the application's existing USER instruction.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssh-client \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dotenc /usr/local/bin/dotenc /usr/local/bin/dotenc

# Keep the application's existing COPY, USER, EXPOSE, and build instructions.
CMD ["dotenc", "run", "--strict", "-e", "production", "<start-command>", "<arg>"]
```

For Alpine and other musl-based images:

```dockerfile
FROM ghcr.io/dotenc/cli:0.10.0-alpine AS dotenc

FROM <existing-alpine-application-image>
# Add these before the application's existing USER instruction.
RUN apk add --no-cache ca-certificates openssh-client libstdc++ libgcc
COPY --from=dotenc /usr/local/bin/dotenc /usr/local/bin/dotenc

# Keep the application's existing COPY, USER, EXPOSE, and build instructions.
CMD ["dotenc", "run", "--strict", "-e", "production", "<start-command>", "<arg>"]
```

Replace the placeholder with the application's existing executable and
arguments. For shell syntax, make the shell explicit:

```dockerfile
CMD ["dotenc", "run", "--strict", "-e", "production", "sh", "-c", "<start-command>"]
```

See the [Coolify](./COOLIFY.md), [Railpack](./RAILPACK.md), and
[Nixpacks](./NIXPACKS.md) guides for complete deployment patterns.

## CI usage with provider bootstrap keys

Prefer passing a dedicated provider key through `DOTENC_PRIVATE_KEY_BASE64`.
The container becomes the dotenc identity for that job, so grant this key only
to the environments the job needs.

```bash
docker run --rm \
  -v "$PWD:/workspace" \
  -e DOTENC_PRIVATE_KEY_BASE64 \
  -e DOTENC_PRIVATE_KEY_PASSPHRASE \
  ghcr.io/dotenc/cli:0.10.0 run --strict -e production sh -c 'test -n "$DATABASE_URL"'
```

Do not print decrypted values, run `env`, or write plaintext `.env` files into
the mounted workspace.

## Local use with SSH keys

For local experiments, mount only the project and SSH key directory needed by
dotenc. Run the container as your host UID/GID so mounted `0600` private keys
remain readable only by you:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/home/dotenc \
  -v "$PWD:/workspace" \
  -v "$HOME/.ssh:/home/dotenc/.ssh:ro" \
  ghcr.io/dotenc/cli:0.10.0 whoami
```

Mounting `~/.ssh` gives the container read access to the mounted keys. Prefer
`DOTENC_PRIVATE_KEY_BASE64` with a dedicated CI or provider key for automation.

## Build locally

```bash
docker build --target runtime -t dotenc-cli:debian -f cli/Dockerfile .
docker build --target runtime-alpine -t dotenc-cli:alpine -f cli/Dockerfile .
docker run --rm dotenc-cli:debian --version
docker run --rm dotenc-cli:alpine --version
```

The Dockerfile supports `linux/amd64` and `linux/arm64` builds.

## Publishing

Stable CLI releases publish both variants after the standalone binaries and
GitHub Release succeed. The release workflow publishes the Debian variant as
`latest`, `<version>`, and `v<version>`, and the Alpine variant as `alpine`,
`<version>-alpine`, and `v<version>-alpine`.

The workflow can also be dispatched manually to publish or recover the image
for the version currently declared in `cli/package.json`. A manual dispatch is
image-only: it does not publish npm, create a GitHub Release, or update the
Homebrew and Scoop repositories.

## Rollback

Roll back by pinning the previous known-good version tag:

```bash
docker pull ghcr.io/dotenc/cli:0.9.0
```

For Alpine, pin the previous Alpine tag:

```bash
docker pull ghcr.io/dotenc/cli:0.9.0-alpine
```

You can also switch the job back to `npm install -g @dotenc/cli`, Homebrew,
Scoop, or a standalone binary from GitHub Releases. No encrypted environment
format changes are tied to the image distribution path.

The October 26 security baseline also requires Debian `ca-certificates >=20250419+deb13u1` and Alpine `ca-certificates`/`ca-certificates-bundle >=20261020-r0`, available for both architectures, to remove compromised eMudhra trust anchors. Bun 1.4.4 embedded in the rebuilt CLI independently updates its bundled trust store and blocks the compromised intermediate public keys. System trust and embedded-runtime trust are separate surfaces.

Alpine `musl` and `musl-utils` must also be at least `1.2.6-r3` for CVE-2026-107891. Vendor security metadata and main indexes confirm that revision on amd64 and arm64; published images from 0.15.3 onward contain it.

Alpine's `10.3_p1-r2` OpenSSH package backports the
[server authentication fix](https://alpinelinux.org/posts/2026-11-05-openssh-password-authentication-bypass/)
for `CVE-2026-123158`. The dotenc images include client tools and `ssh-keygen`,
not `sshd`; this server-only exploit path is absent from them. Derived images
that add `sshd` must use a patched server package and restart it after upgrading.
