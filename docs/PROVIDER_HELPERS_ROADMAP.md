# Provider helpers, plugins, and presets roadmap

This roadmap tracks provider integration helpers, plugins, images, and presets.
Keep provider runbooks focused on supported paths. Do not publish step-by-step
external-runner guidance for Vercel or Netlify until the matching helpers,
plugins, or presets exist.

## Product principles

- Preserve runner ownership: the machine that owns the build gets the dotenc
  identity.
- Keep provider keys separate across GitHub Actions, EAS, Vercel, Netlify,
  Coolify, Cloudflare, and future providers.
- Prefer wrapping one command with `dotenc run --strict` over exporting a whole
  decrypted environment.
- When values must cross process boundaries, require explicit allowlists.
- Separate build-time configuration from runtime secrets.
- Scan generated artifacts before upload whenever a helper builds outside the
  final provider.
- Never persist decrypted `.env` files, private keys, or provider tokens in
  repositories, Docker layers, build outputs, publish directories, or caches.

## Universal helpers

### `ghcr.io/dotenc/cli`

Small OCI images containing the compiled dotenc CLI and the minimal runtime
needed to execute it.

Status: implemented by [cli/Dockerfile](../cli/Dockerfile) and published by the
release workflow after CLI version bumps or an image-only manual dispatch.
Usage guidance lives in the [OCI image guide](./OCI_IMAGE.md).

Shipped variants:

- Debian/glibc: `latest`, `<version>`, and `v<version>`
- Alpine/musl: `alpine`, `<version>-alpine`, and `v<version>-alpine`
- `linux/amd64` and `linux/arm64` manifests for both variants
- release provenance and SBOM attestations

Target use cases:

- shell-based CI jobs that want `dotenc` without a language-specific install
- provider build hooks that can run a container image
- multi-stage application images that copy only `/usr/local/bin/dotenc`
- reproducible smoke tests for released dotenc binaries

### Builder images

Status: deferred until a concrete integration cannot be served by the CLI
images.

The supported pattern treats the application as an opaque executable: keep its
existing image, language runtime, build command, and start command; add dotenc;
then wrap the command that needs decrypted values. This covers common use cases
without making the documentation language or framework specific:

- Dockerfiles copy the binary from the matching glibc or musl CLI image.
- Railpack composes the binary as an image input layer.
- Nixpacks compatibility installs a pinned standalone binary.

A universal builder would need to own a growing matrix of language versions,
package managers, native libraries, and security updates. Provider-specific
builders would add another fast-moving matrix of external CLIs. Both duplicate
the application's existing build environment without removing the need to know
its actual build or start command.

Revisit builder images only when repeated production use cases demonstrate a
gap that image composition cannot solve, and define the smallest runtime or
provider-specific image from those concrete requirements.

### Key input ergonomics

Shipped CLI support:

- `DOTENC_PRIVATE_KEY_BASE64`: read a base64-encoded bootstrap private key
- `DOTENC_PRIVATE_KEY`: read raw private key text as a legacy compatibility path

Provider docs should recommend `DOTENC_PRIVATE_KEY_BASE64`. These are bootstrap
input formats only. dotenc should avoid printing which path or decoded value was
used beyond high-level diagnostics.

### Artifact doctor

Planned command:

```bash
dotenc doctor artifacts <dir>
```

Initial checks:

- committed or generated `.env` files in publish/build directories
- OpenSSH private key headers
- known dotenc bootstrap variable names
- configured secret names from an explicit allowlist
- obvious multiline key material in generated JavaScript, JSON, HTML, and text
  files

The doctor should be conservative: fail on high-confidence leaks, report
warnings for ambiguous matches, and never print full secret values.

## Railpack integration

Status: supported through the generic [Railpack integration guide](./RAILPACK.md).
Railpack can add `/usr/local/bin/dotenc` from the CLI image while preserving its
auto-detected language provider.

Supported shape:

- compose the dotenc CLI as a build or deploy image layer
- preserve Railpack's provider-generated runtime and dependency installation
- wrap an explicit existing build or start command with `dotenc run --strict`
- support a configured dotenc environment name, defaulting to the provider's
  production environment through a small optional wrapper
- use Railpack BuildKit secrets for build-time decryption
- keep decrypted values out of final image layers and caches

Deferred preset work:

- a generator such as `dotenc presets railpack`
- a Railpack provider contribution if the upstream extension model supports it
- how to map preview/production environments portably across hosts

A static fragment cannot wrap an unknown provider-generated build command, so
build-time examples require the application's existing command explicitly.

References:

- [Railpack docs](https://railpack.com/)
- [Railpack configuration file](https://railpack.com/config/file/)
- [Railpack adding steps](https://railpack.com/guides/adding-steps)

## Nixpacks compatibility

Status: supported for existing deployments through the generic
[Nixpacks integration guide](./NIXPACKS.md). Nixpacks is in maintenance mode and
recommends Railpack for new deployments.

Supported shape:

- install a pinned standalone dotenc binary in a provider-generated image
- preserve the auto-detected language provider and dependency phases
- support runtime decryption when the final image retains the binary and SSH
  runtime dependencies
- keep bootstrap keys out of Nixpacks `[variables]`
- direct build-time secret use to Railpack or a custom Dockerfile

Deferred preset work:

- a generator command such as `dotenc presets nixpacks`
- additional static fixtures if maintained Nixpacks hosts diverge in final-image
  behavior

References:

- [Nixpacks configuration file](https://nixpacks.com/docs/configuration/file)
- [Nixpacks configuring builds](https://nixpacks.com/docs/guides/configuring-builds)
- [Nixpacks how it works](https://nixpacks.com/docs/how-it-works)

## Coolify

Status: supported through the [Coolify runbook](./COOLIFY.md).

The Dockerfile path is the stable default, Railpack is the preferred generated
image path, and Nixpacks is documented for existing deployments. All three
paths use the same runtime-neutral contract: add dotenc to the existing
application image and wrap the existing command.

## Vercel helpers

Supported today: Vercel-owned cloud builds documented in
[docs/VERCEL.md](/docs/VERCEL.md).

Planned helpers:

- `@dotenc/vercel`
- `dotenc vercel build`
- `dotenc vercel doctor`

Candidate features:

- run `vercel pull` and `vercel build` under dotenc
- deploy prebuilt output with `vercel deploy --prebuilt`
- scan `.vercel/output` before deploy
- map Vercel `production`, `preview`, and custom environments to dotenc
  environments
- support the Vercel Build Output API without writing decrypted values into the
  output directory

Do not add a prebuilt or GitHub-runner Vercel runbook until the helper or preset
exists and has a verification story.

References:

- [Vercel Build Output API](https://vercel.com/docs/build-output-api/v3)
- [Vercel CLI build](https://vercel.com/docs/cli/build)
- [Vercel CLI deploy](https://vercel.com/docs/cli/deploy)

## Netlify helpers

Supported today: Netlify-owned cloud builds documented in
[docs/NETLIFY.md](/docs/NETLIFY.md).

Planned helpers:

- `netlify-plugin-dotenc`
- `@dotenc/netlify`
- `dotenc netlify doctor`

Candidate plugin features:

- validate `DOTENC_PRIVATE_KEY_BASE64` before the build command starts
- wrap or replace the configured Netlify build command
- map Netlify deploy contexts to dotenc environments
- fail early when a required encrypted environment is not available
- run artifact checks before Netlify publishes the site

Candidate CLI helper features:

- prepare prebuilt publish directories for Netlify deploys
- scan publish directories for leaked bootstrap keys and generated `.env` files
- sync allowlisted values to Netlify environment variables with explicit scopes
  and deploy contexts

Do not add a Netlify CLI or GitHub-runner deploy runbook until the plugin,
helper, or preset exists and has a verification story.

References:

- [Netlify Build Plugins](https://docs.netlify.com/build-plugins/)
- [Develop Netlify Build Plugins](https://docs.netlify.com/build-plugins/create-plugins/)
- [Netlify CLI environment variables](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/)

## Cloudflare helpers

Cloudflare should get its own runbook after the Vercel and Netlify cloud-build
docs land. The Cloudflare surface is broader and should be split by ownership:
Pages Git builds, Pages Direct Upload, Workers Builds, external Wrangler
deploys, and runtime secret sync.

Planned helpers:

- `@dotenc/cloudflare`
- `dotenc cloudflare pages deploy`
- `dotenc cloudflare worker deploy`
- `dotenc cloudflare secrets sync`
- `dotenc cloudflare doctor`

Candidate features:

- wrap `wrangler pages deploy` and `wrangler deploy`
- sync allowlisted values to Workers and Pages secrets
- generate temporary deploy-time secrets files with `0600` permissions and
  cleanup
- distinguish build-time values from runtime Workers secrets
- scan static assets, Worker bundles, and `.wrangler` outputs

References:

- [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)

## Documentation gates

Before any roadmap item graduates to a supported runbook:

- publish or commit the helper, plugin, image, or preset it depends on
- document the provider identity and trust boundary
- document install, configuration, and rollback steps
- include at least one copy-pasteable minimal example
- include artifact and secret-handling caveats
- verify the path in CI or with a reproducible fixture
- update `SECURITY.md` if key handling, file permissions, command execution, or
  install flow changed
