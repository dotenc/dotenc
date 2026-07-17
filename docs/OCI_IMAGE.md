# dotenc CLI OCI image

`ghcr.io/dotenc/cli` packages the dotenc CLI as a small Linux container image.
It is intended for CI jobs, provider hooks, and smoke tests that need dotenc
without installing Node.js, Bun, or the npm package.

## Image contents

The runtime image contains:

- the compiled standalone `dotenc` Linux binary
- `ca-certificates`
- `openssh-client` for `ssh-keygen`-backed key workflows
- a non-root `dotenc` user

It intentionally does not include Node.js, Bun, npm, pnpm, Yarn, provider CLIs,
or application build tools. Use this image for dotenc itself. Use a normal
runner install or a future builder image when the command wrapped by
`dotenc run` needs a language runtime.

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
docker build -t dotenc-cli -f cli/Dockerfile .
docker run --rm dotenc-cli --version
```

The Dockerfile supports `linux/amd64` and `linux/arm64` builds.

## Publishing

Stable CLI releases publish the image after the standalone binaries and GitHub
Release succeed. The release workflow publishes the same CLI version as
`latest`, `<version>`, and `v<version>`.

The workflow can also be dispatched manually to publish or recover the image
for the version currently declared in `cli/package.json`. A manual dispatch is
image-only: it does not publish npm, create a GitHub Release, or update the
Homebrew and Scoop repositories.

## Rollback

Roll back by pinning the previous known-good version tag:

```bash
docker pull ghcr.io/dotenc/cli:0.9.0
```

You can also switch the job back to `npm install -g @dotenc/cli`, Homebrew,
Scoop, or a standalone binary from GitHub Releases. No encrypted environment
format changes are tied to the image distribution path.
