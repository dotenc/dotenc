# dotenc CLI OCI image

`ghcr.io/dotenc/cli` packages the dotenc CLI as small glibc and Alpine/musl
Linux container images. They are intended for CI jobs, provider hooks,
multi-stage application builds, and smoke tests that need dotenc without
installing Node.js, Bun, or the npm package.

## Variants and tags

| Runtime | Rolling tag | Version tags | Dockerfile target |
| --- | --- | --- | --- |
| Debian/glibc | `latest` | `<version>`, `v<version>` | `runtime` |
| Alpine/musl | `alpine` | `<version>-alpine`, `v<version>-alpine` | `runtime-alpine` |

Both variants are published for `linux/amd64` and `linux/arm64`. The Debian
variant remains the default for compatibility. Use the Alpine variant when the
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
