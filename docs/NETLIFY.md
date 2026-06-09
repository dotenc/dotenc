# Netlify runbook

This runbook describes the provider-owned cloud build path for Netlify. Choose
this path when Netlify Continuous Deployment owns the build and deploy
lifecycle: Netlify receives a Git event, checks out the repository, installs
dependencies, runs the build command, and deploys the publish directory.

Give Netlify its own dotenc identity. For this path, GitHub Actions does not
receive a dotenc provider key.

This document intentionally covers only Netlify-owned cloud builds. Advanced
helpers are tracked in
[docs/PROVIDER_HELPERS_ROADMAP.md](/docs/PROVIDER_HELPERS_ROADMAP.md) and
should get dedicated runbooks after they ship.

## When to use this

Use this runbook when a Netlify site keeps build-time configuration in encrypted
`.env.*.enc` files and needs those values during the Netlify build, for example:

- framework configuration read during `npm run build`, `vite build`,
  `astro build`, or another build command
- intentionally public client variables such as `PUBLIC_*`, `VITE_*`, or other
  framework-specific public prefixes
- API origins, feature flags, analytics IDs, or integration IDs that are safe to
  bundle
- build-time values used to generate redirects, headers, or static content

Do not put secrets that must stay hidden from users in framework-prefixed public
variables. Frameworks may inline those values into browser bundles.

Runtime secrets for Netlify Functions and Edge Functions should use Netlify
environment variables with the appropriate runtime scope. The cloud build path
below is for decrypting values during the build command, not for running dotenc
inside deployed functions.

## Cloud build with Netlify

| Path | Build runner | CD runner | GitHub secrets | dotenc identity | dotenc GitHub Actions |
| --- | --- | --- | --- | --- | --- |
| Cloud build | Netlify build workers | Netlify deploys | None | Netlify gets `DOTENC_PRIVATE_KEY_BASE64`, plus optional passphrase | No |

In this mode, GitHub only sends repository events through Netlify's Git
integration. Netlify is the system that decrypts dotenc values, so Netlify gets
the provider identity.

### 1. Create a dedicated Netlify key

Create a key specifically for Netlify. This example creates a passwordless key;
if you choose a passphrase-protected key, also store
`DOTENC_PRIVATE_KEY_PASSPHRASE` on Netlify as described below:

```bash
ssh-keygen -t ed25519 -f netlify_key -N "" -C "netlify"
```

Add the public key to the project and grant only the encrypted environments
that Netlify should build:

```bash
dotenc key add netlify --from-ssh ./netlify_key
dotenc auth grant production netlify
git add .dotenc .env.production.enc
git commit -m "Grant Netlify access to production environment"
```

If Deploy Previews or branch deploys use a separate encrypted environment,
grant that environment explicitly:

```bash
dotenc auth grant preview netlify
git add .dotenc .env.preview.enc
git commit -m "Grant Netlify access to preview environment"
```

### 2. Store the private key on Netlify

Create a Netlify environment variable named `DOTENC_PRIVATE_KEY_BASE64` in the
site or team settings for every deploy context that will run dotenc-backed
builds. If the private key is encrypted, also create
`DOTENC_PRIVATE_KEY_PASSPHRASE` in the same deploy contexts.

Recommended settings:

- Name: `DOTENC_PRIVATE_KEY_BASE64`
- Scope: `Builds`
- Deploy context: explicit contexts such as `production`, `deploy-preview`, or
  `branch-deploy`
- Secret flag: mark the value as containing secret values when using Netlify's
  Secrets Controller
- Ownership: site-level unless several Netlify sites intentionally share the
  same provider key

For passphrase-protected keys, use the same settings for
`DOTENC_PRIVATE_KEY_PASSPHRASE`.

The value must be the base64-encoded private key file:

```bash
base64 < netlify_key | tr -d '\n'
```

`DOTENC_PRIVATE_KEY` with the raw private key text is still supported for
backwards compatibility, but provider setup should prefer
`DOTENC_PRIVATE_KEY_BASE64`.

After the key is stored on Netlify, delete the local copy:

```bash
rm netlify_key netlify_key.pub
```

### 3. Install dotenc in the project build

Add dotenc as a development dependency so Netlify's normal install step makes
the CLI available to the build command:

```bash
npm install --save-dev @dotenc/cli
```

Use the package manager that matches the project if it is not npm.

### 4. Wrap the Netlify build command

Wrap the command that Netlify already runs. For a simple production-only site,
use a dedicated build script:

```json
{
  "scripts": {
    "build": "vite build",
    "build:netlify": "dotenc run --strict -e production npm run build"
  }
}
```

Set Netlify's build command in the UI or `netlify.toml`:

```toml
[build]
  command = "npm run build:netlify"
  publish = "dist"
```

For sites that use separate encrypted environments for production and deploy
previews, map Netlify's deploy context to a dotenc environment in a small
script:

```sh
#!/usr/bin/env sh
set -eu

selected="${DOTENC_ENVIRONMENT:-${CONTEXT:-production}}"

case "$selected" in
  production) dotenc_env="production" ;;
  deploy-preview|branch-deploy) dotenc_env="preview" ;;
  *) dotenc_env="$selected" ;;
esac

exec dotenc run --strict -e "$dotenc_env" npm run build
```

Then configure Netlify to run that script:

```toml
[build]
  command = "./scripts/netlify-build.sh"
  publish = "dist"
```

The Netlify key must be granted to every dotenc environment the script can
select.

## Security notes

- Use a separate dotenc key for Netlify instead of reusing a developer,
  GitHub Actions, Vercel, or EAS key.
- Grant the Netlify key only to environments that Netlify builds.
- Store the bootstrap key with the `Builds` scope. Add `Functions` or Edge
  runtime scopes only if deployed runtime code truly needs that variable.
- Do not store the Netlify provider key in GitHub for this path.
- Do not print decrypted values, run `env`, or enable shell tracing with
  `set -x`.
- Do not write decrypted `.env` files into the repository or publish directory.
- Keep runtime secrets in Netlify environment variables unless and until dotenc
  ships a dedicated runtime secret sync helper.
- Rotate the Netlify dotenc key and affected environment values if a Netlify
  build worker, deploy log, or site secret is suspected to be compromised.

## Troubleshooting

- `No private keys found`: `DOTENC_PRIVATE_KEY_BASE64` is missing, malformed,
  scoped to the wrong Netlify deploy context, or missing the `Builds` scope.
- `Environment not found`: the build selected a dotenc environment that is not
  committed or does not match the environment name passed to `-e`.
- `Permission denied`: the Netlify public key was added, but it has not been
  granted to the encrypted environment used by the build command.
- Values missing in browser code: confirm the framework's public-variable
  prefix and remember that only intentionally public values should use it.

## References

- [Netlify build configuration](https://docs.netlify.com/configure-builds/overview/)
- [Netlify build environment variables](https://docs.netlify.com/build/configure-builds/environment-variables/)
- [Netlify environment variables overview](https://docs.netlify.com/build/environment-variables/overview/)
- [Netlify Secrets Controller](https://docs.netlify.com/environment-variables/secrets-controller/)
- [Netlify file-based configuration](https://docs.netlify.com/build/configure-builds/file-based-configuration/)
