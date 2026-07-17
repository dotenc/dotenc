# Coolify runbook

This runbook covers Git-based Coolify deployments that use encrypted dotenc
environments. It is intentionally application-runtime agnostic: keep the
application's existing build and start commands, then decide whether dotenc
should wrap the build command, the start command, or both.

Give Coolify its own dotenc identity. Do not reuse a developer, GitHub Actions,
or another provider key.

## Choose the deployment path

| Path | Best for | dotenc integration |
| --- | --- | --- |
| Dockerfile | Stable default and full control | Copy the CLI binary from the matching OCI image |
| Railpack | Generated images with a configurable build plan | Add the CLI image as a build or deploy layer |
| Nixpacks | Existing Nixpacks deployments | Install a pinned CLI during setup |

The Dockerfile path is the recommended default. Railpack is the preferred
generated-image path when it is available. Nixpacks remains a compatibility
path.

## 1. Create a dedicated Coolify key

Create a key specifically for the Coolify application:

```bash
ssh-keygen -t ed25519 -f coolify_key -N "" -C "coolify"
dotenc key add coolify --from-ssh ./coolify_key
dotenc auth grant production coolify
```

Commit the public key and rotated encrypted environment:

```bash
git add .dotenc .env.production.enc
git commit -m "Grant Coolify access to production"
```

Encode the private key for Coolify, then delete the local provider key after it
has been stored:

```bash
base64 < coolify_key | tr -d '\n'
rm coolify_key coolify_key.pub
```

## 2. Prefer runtime decryption for server applications

Runtime decryption keeps the provider key out of the image build. The final
image must contain:

- the application and its normal runtime
- `/usr/local/bin/dotenc`
- `ca-certificates` and `openssh-client`
- the committed `.dotenc/` directory and selected `.env.*.enc` files

Copy the dotenc binary from the image variant that matches the application's
runtime libc.

For Debian, Ubuntu, and other glibc-based images:

```dockerfile
FROM ghcr.io/dotenc/cli:<version> AS dotenc

FROM <existing-glibc-application-image>
# Add these before the application's existing USER instruction.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssh-client \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dotenc /usr/local/bin/dotenc /usr/local/bin/dotenc

# Keep the application's existing COPY, USER, EXPOSE, and build instructions.
CMD ["dotenc", "run", "--strict", "-e", "production", "<start-command>", "<arg>"]
```

For Alpine and other musl-based application images:

```dockerfile
FROM ghcr.io/dotenc/cli:<version>-alpine AS dotenc

FROM <existing-alpine-application-image>
# Add these before the application's existing USER instruction.
RUN apk add --no-cache ca-certificates openssh-client libstdc++ libgcc
COPY --from=dotenc /usr/local/bin/dotenc /usr/local/bin/dotenc

# Keep the application's existing COPY, USER, EXPOSE, and build instructions.
CMD ["dotenc", "run", "--strict", "-e", "production", "<start-command>", "<arg>"]
```

Replace the placeholder command and arguments with the application's existing
start command. For commands that require shell syntax, use `sh -c` explicitly:

```dockerfile
CMD ["dotenc", "run", "--strict", "-e", "production", "sh", "-c", "<start-command>"]
```

Do not copy the Alpine/musl binary into a glibc image, or the glibc binary into
an Alpine image.

## 3. Configure Coolify runtime variables

Create these variables in the Coolify application:

- `DOTENC_PRIVATE_KEY_BASE64`: the encoded Coolify private key
- `DOTENC_PRIVATE_KEY_PASSPHRASE`: only when the key is passphrase protected
- `DOTENC_ENVIRONMENT`: optional when a wrapper script selects the environment

For the provider key and optional passphrase:

- enable **Runtime Variable**
- disable **Build Variable**
- lock the value when the Coolify installation supports locked secrets
- enable **Literal** when the value must not interpolate `$` references

Coolify enables new variables for both build and runtime by default. Disabling
the build phase is what keeps a runtime-only provider key out of the build.

For Docker Compose deployments, declare the required runtime variables in the
service so Coolify discovers them:

```yaml
services:
  app:
    build: .
    environment:
      DOTENC_PRIVATE_KEY_BASE64: ${DOTENC_PRIVATE_KEY_BASE64:?}
      DOTENC_PRIVATE_KEY_PASSPHRASE: ${DOTENC_PRIVATE_KEY_PASSPHRASE:-}
```

## Build-time decryption

Only decrypt during the build when the build genuinely needs those values.
Examples include private package access, server-only code generation, or
configuration fetched from a protected service.

Keep the application's normal build image and copy in dotenc as shown above.
Then wrap the existing build command:

```dockerfile
RUN dotenc run --strict -e production sh -c '<build-command>'
```

In Coolify, enable **Build Variable** and **Use Docker Build Secrets** for the
provider key. Disable **Runtime Variable** when the running application does not
need dotenc. Coolify makes enabled build secrets available to `RUN` instructions
as environment variables when BuildKit is available, so the command above can
read `DOTENC_PRIVATE_KEY_BASE64` without an `ARG` or `ENV` instruction. Verify
that BuildKit is enabled: Coolify can fall back to ordinary build arguments on
older build servers.

Never use ordinary Docker build arguments for the provider key. Build arguments
can appear in image metadata and history. Build secrets are temporary, but the
decrypted values can still leak if the wrapped build writes them into generated
files, caches, logs, or the final image.

Client-side and static builds must only receive values that are intentionally
public. A framework can inline any value it reads into browser-visible output.

## Railpack and Nixpacks

- [Railpack integration](./RAILPACK.md) composes the dotenc binary directly
  from the published CLI image.
- [Nixpacks integration](./NIXPACKS.md) installs a pinned CLI in the generated
  build because Nixpacks does not support Railpack-style image layers.

## Preview and production environments

Use separate Coolify applications or preview deployments with separate dotenc
keys where practical. Grant each key only to the encrypted environments it
needs. A small wrapper can map a provider value to a dotenc environment:

```sh
#!/usr/bin/env sh
set -eu

environment="${DOTENC_ENVIRONMENT:-production}"
exec dotenc run --strict -e "$environment" "$@"
```

## Security notes

- Never store the Coolify private key in the repository, Dockerfile, Compose
  file, image, or committed build-pack configuration.
- Do not run `env`, enable `set -x`, or print decrypted values in deployment
  logs.
- Do not write plaintext `.env` files into image layers or persistent volumes.
- Use a numbered image tag or digest instead of `latest` or `alpine` in
  production.
- Rotate the Coolify key and affected environment values if build logs, image
  layers, or the Coolify server may have exposed the key.

## References

- [Coolify Dockerfile build pack](https://coolify.io/docs/applications/build-packs/dockerfile)
- [Coolify Docker Compose build pack](https://coolify.io/docs/applications/build-packs/docker-compose)
- [Coolify environment variables](https://coolify.io/docs/knowledge-base/environment-variables)
- [Coolify Railpack build pack](https://coolify.io/docs/applications/build-packs/railpack)
- [Coolify Nixpacks build pack](https://coolify.io/docs/applications/build-packs/nixpacks)
