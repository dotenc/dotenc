# Nixpacks integration

Nixpacks is in maintenance mode and recommends Railpack for new deployments.
Use this path for existing Nixpacks applications; prefer
[Railpack](./RAILPACK.md) or a custom Dockerfile when starting a new deployment.

Nixpacks cannot compose files from an OCI image layer. The runtime-neutral path
is therefore to install a pinned standalone dotenc binary into the application
directory while keeping the provider-generated language runtime and commands.

## Runtime decryption

Add a `nixpacks.toml` at the application root. This example supports Linux x64
and arm64 builds and pins dotenc to `0.10.0`:

```toml
[phases.setup]
aptPkgs = ["...", "ca-certificates", "curl", "openssh-client", "tar"]

[phases.dotenc]
dependsOn = ["setup"]
cmds = ['''
set -eu
case "$(uname -m)" in
  x86_64) target="linux-x64" ;;
  aarch64|arm64) target="linux-arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
archive="dotenc-${target}.tar.gz"
url="https://github.com/dotenc/dotenc/releases/download/v0.10.0/${archive}"
mkdir -p /app/.dotenc-bin
curl -fsSLo "/tmp/${archive}" "$url"
tar -xzf "/tmp/${archive}" -C /app/.dotenc-bin
mv "/app/.dotenc-bin/dotenc-${target}" /app/.dotenc-bin/dotenc
chmod 0755 /app/.dotenc-bin/dotenc
rm "/tmp/${archive}"
''']

[phases.build]
dependsOn = ["...", "dotenc"]

[start]
cmd = "/app/.dotenc-bin/dotenc run --strict -e production <start-command> <arg>"
```

Replace `<start-command> <arg>` with the application's existing start command
and arguments. Update the pinned dotenc version intentionally when upgrading.

Configure these as runtime variables in the hosting platform:

- `DOTENC_PRIVATE_KEY_BASE64`: a dedicated key for this deployment
- `DOTENC_PRIVATE_KEY_PASSPHRASE`: only for a passphrase-protected key

Do not put either value in the `[variables]` section. Nixpacks variables are
included in the final image.

The repository must include `.dotenc/` and the selected encrypted environment.
The downloaded binary lives under `/app`, so it is normally retained when
Nixpacks packages the application.

## Check the final runtime

Nixpacks providers can choose different final images. Before relying on runtime
decryption, run `nixpacks plan .` and verify that the final image retains:

- `/app/.dotenc-bin/dotenc`
- `ca-certificates`
- `ssh-keygen` from `openssh-client`
- a glibc-based Linux runtime

Then build and inspect the image:

```bash
nixpacks build --name app-with-dotenc .
docker run --rm --entrypoint /app/.dotenc-bin/dotenc app-with-dotenc --version
docker run --rm --entrypoint sh app-with-dotenc -c 'command -v ssh-keygen'
```

If the provider selects a slim `runImage` that drops the binary or SSH runtime,
use a custom Dockerfile or Railpack. Do not switch Nixpacks' build image to
`ghcr.io/dotenc/cli`; that would replace the application's language toolchain.

## Build-time decryption

Nixpacks has no Railpack-style image input or first-class build-secret contract.
Its `--env` values are build variables, and platform integrations differ in how
they pass and persist them. For that reason, dotenc does not recommend
build-time decryption through Nixpacks.

When a build needs protected values, migrate that deployment to Railpack or a
custom Dockerfile with BuildKit secrets. Keep Nixpacks decryption at runtime.

## Coolify

Select the Nixpacks build pack and commit `nixpacks.toml`. Enable **Runtime
Variable** and disable **Build Variable** for the dotenc bootstrap variables.
This keeps the provider key out of the Nixpacks build environment.

See the complete [Coolify runbook](./COOLIFY.md) for dedicated key setup,
preview environments, and rotation guidance.

## References

- [Nixpacks configuration file](https://nixpacks.com/docs/configuration/file)
- [Nixpacks build phases](https://nixpacks.com/docs/how-it-works)
- [Nixpacks on Coolify](https://coolify.io/docs/applications/build-packs/nixpacks)
- [Railpack migration recommendation](https://nixpacks.com/docs)
