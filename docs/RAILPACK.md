# Railpack integration

Railpack can add dotenc to an auto-detected application without changing its
language provider or replacing its runtime. The integration has only two
application-specific inputs: the existing build command and the existing start
command.

Use the default `ghcr.io/dotenc/cli:<version>` image with Railpack's Debian-based
build and runtime images. Use a custom Dockerfile when the final application
image is Alpine; Railpack's `aptPackages` integration does not install Alpine
packages.

## Runtime decryption

Runtime decryption is the recommended path for server applications. Add a
`railpack.json` at the application root:

```json
{
  "$schema": "https://schema.railpack.com",
  "deploy": {
    "aptPackages": ["...", "ca-certificates", "openssh-client"],
    "inputs": [
      "...",
      {
        "image": "ghcr.io/dotenc/cli:0.10.0",
        "include": ["/usr/local/bin/dotenc"]
      }
    ],
    "startCommand": "dotenc run --strict -e production <start-command> <arg>"
  }
}
```

Replace `<start-command> <arg>` with the application's existing start command
and arguments. The image layer only contributes `/usr/local/bin/dotenc`; the
auto-detected application runtime, dependencies, and build plan remain owned by
Railpack.

Configure these as runtime variables in the hosting platform, not in
`deploy.variables`:

- `DOTENC_PRIVATE_KEY_BASE64`: a dedicated key for this deployment
- `DOTENC_PRIVATE_KEY_PASSPHRASE`: only for a passphrase-protected key

The repository must include `.dotenc/` and the selected encrypted environment.
Do not exclude those paths from the final deploy layer.

For dynamic preview and production selection, commit a small wrapper and make
it executable:

```sh
#!/usr/bin/env sh
set -eu

environment="${DOTENC_ENVIRONMENT:-production}"
exec dotenc run --strict -e "$environment" "$@"
```

Then use the wrapper as the start command:

```json
{
  "$schema": "https://schema.railpack.com",
  "deploy": {
    "aptPackages": ["...", "ca-certificates", "openssh-client"],
    "inputs": [
      "...",
      {
        "image": "ghcr.io/dotenc/cli:0.10.0",
        "include": ["/usr/local/bin/dotenc"]
      }
    ],
    "startCommand": "./scripts/dotenc-run <start-command> <arg>"
  }
}
```

Set `DOTENC_ENVIRONMENT` in the host for each deployment. Give preview and
production deployments separate dotenc keys where practical.

## Build-time decryption

Only decrypt during the build when the build genuinely requires protected
values. Railpack exposes declared build secrets to commands through BuildKit
secret mounts and does not save their values in the final image.

The build command must be explicit because a configuration fragment cannot
wrap an unknown provider-generated command. Start from the application's
existing build command and replace `<build-command>` below:

```json
{
  "$schema": "https://schema.railpack.com",
  "buildAptPackages": ["...", "ca-certificates", "openssh-client"],
  "secrets": ["DOTENC_PRIVATE_KEY_BASE64"],
  "steps": {
    "build": {
      "inputs": [
        "...",
        {
          "image": "ghcr.io/dotenc/cli:0.10.0",
          "include": ["/usr/local/bin/dotenc"]
        }
      ],
      "secrets": ["DOTENC_PRIVATE_KEY_BASE64"],
      "commands": [
        {
          "cmd": "dotenc run --strict -e production sh -c '<build-command>'",
          "customName": "Build with dotenc"
        }
      ]
    }
  }
}
```

When the key is passphrase protected, add
`DOTENC_PRIVATE_KEY_PASSPHRASE` to both `secrets` arrays. The platform must pass
the declared values to Railpack as build secrets. With the Railpack CLI, pass
them through `--env`; custom BuildKit frontends must also supply matching
`--secret` flags.

Do not add bootstrap keys or decrypted values to `variables`, because Railpack
variables are persisted into the image. Build secrets are temporary, but a
wrapped build can still leak decrypted values into logs, caches, generated
files, or browser-visible assets.

## Coolify

Select the Railpack build pack and commit `railpack.json`. For runtime
decryption, enable **Runtime Variable** and disable **Build Variable** on the
dotenc bootstrap variables. For build-time decryption, the values must reach
Railpack as build secrets; verify that the generated build uses BuildKit secret
mounts before relying on that path.

See the complete [Coolify runbook](./COOLIFY.md) for key setup and trust-boundary
guidance.

## Verification

Before deployment, inspect the generated plan and image:

```bash
railpack plan .
railpack build --name app-with-dotenc .
docker run --rm --entrypoint dotenc app-with-dotenc --version
```

When the configured start command requires bootstrap variables, override the
entrypoint or use a separate smoke command for image inspection. Also verify
that the application starts with a narrowly scoped test key before promoting
the deployment.

## References

- [Railpack configuration file](https://railpack.com/config/file/)
- [Railpack secrets](https://railpack.com/architecture/secrets)
- [Railpack image layers](https://railpack.com/config/file/#image-layer)
- [Railpack on Coolify](https://coolify.io/docs/applications/build-packs/railpack)
