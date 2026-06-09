# Provider helpers, plugins, and presets roadmap

This roadmap tracks provider integration ideas that are not yet shipped. Keep
provider runbooks focused on supported paths. Do not publish step-by-step
external-runner guidance for Vercel or Netlify until the matching helpers,
plugins, or presets exist.

## Product principles

- Preserve runner ownership: the machine that owns the build gets the dotenc
  identity.
- Keep provider keys separate across GitHub Actions, EAS, Vercel, Netlify,
  Cloudflare, and future providers.
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

Planned small OCI image containing only the dotenc CLI and the minimal runtime
needed to execute it.

Target use cases:

- shell-based CI jobs that want `dotenc` without a language-specific install
- provider build hooks that can run a container image
- reproducible smoke tests for released dotenc binaries

Expected requirements:

- multi-architecture Linux images, at least `linux/amd64` and `linux/arm64`
- pinned dotenc version tags plus `latest`
- no bundled secrets, tokens, or generated `.env` files
- release provenance, checksums, and SBOM if the release workflow supports them

### `ghcr.io/dotenc/builder`

Planned batteries-included image for provider-style builds.

Candidate contents:

- dotenc CLI
- Node.js, npm, pnpm, Yarn, and Bun
- Git, curl, jq, unzip, and common CA certificates
- optional provider CLIs in provider-specific variants

Candidate variants:

- `ghcr.io/dotenc/builder-node`
- `ghcr.io/dotenc/builder-bun`
- `ghcr.io/dotenc/vercel-builder`
- `ghcr.io/dotenc/netlify-builder`
- `ghcr.io/dotenc/cloudflare-builder`

The generic image should stay boring and predictable. Provider-specific images
can include heavier CLIs such as `vercel`, `netlify-cli`, or `wrangler`.

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

## Railpack preset

Railpack should be the first preset target because it is the newer container
builder path for platforms that want zero-config image generation.

Planned shape:

- detect Node/Bun/package-manager projects using Railpack's existing provider
  analysis
- add a dotenc install step without replacing the provider's dependency install
  logic
- wrap the generated build step with `dotenc run --strict`
- support a configured dotenc environment name, defaulting to the provider's
  production environment
- support BuildKit secrets where the host platform exposes them
- keep decrypted values out of final image layers and caches
- emit clear build-plan diagnostics without printing decrypted values

Open design questions:

- whether this ships as a reusable `railpack.json` fragment, a generator command
  such as `dotenc presets railpack`, or a Railpack provider contribution
- how to map preview/production environments portably across hosts
- whether provider-specific CLIs belong in the same preset or in separate
  builder images

References:

- [Railpack docs](https://railpack.com/)
- [Railpack configuration file](https://railpack.com/config/file/)
- [Railpack adding steps](https://railpack.com/guides/adding-steps)

## Nixpacks preset

Nixpacks remains important for compatibility with existing platforms and
self-hosted deployments even if Railpack becomes the preferred path.

Planned shape:

- provide `nixpacks.toml` and `nixpacks.json` examples
- extend provider-generated phases instead of replacing them
- install dotenc in the setup or install phase
- wrap the build phase with `dotenc run --strict`
- avoid putting decrypted values in `[variables]`, final image metadata, or
  runtime image layers
- keep start commands independent of dotenc unless the application explicitly
  needs runtime decryption

Open design questions:

- whether to ship static snippets only or a generator command such as
  `dotenc presets nixpacks`
- how to handle package-manager-specific `exec` commands without brittle
  detection
- how much provider-specific behavior belongs in a Nixpacks preset versus a
  Docker image

References:

- [Nixpacks configuration file](https://nixpacks.com/docs/configuration/file)
- [Nixpacks configuring builds](https://nixpacks.com/docs/guides/configuring-builds)
- [Nixpacks how it works](https://nixpacks.com/docs/how-it-works)

## Vercel helpers

Supported today: Vercel-owned cloud builds documented in
[docs/VERCEL.md](/docs/VERCEL.md).

Planned helpers:

- `@dotenc/vercel`
- `dotenc vercel build`
- `dotenc vercel doctor`
- `ghcr.io/dotenc/vercel-builder`

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
- `ghcr.io/dotenc/netlify-builder`

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
- `ghcr.io/dotenc/cloudflare-builder`

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
