# Vercel runbook

This runbook describes the provider-owned cloud build path for Vercel. Choose
this path when Vercel's Git integration owns the build and deploy lifecycle:
Vercel checks out the repository, installs dependencies, runs the build command,
and deploys the resulting output.

Give Vercel its own dotenc identity. For this path, GitHub Actions does not
receive a dotenc provider key.

This document intentionally covers only Vercel-owned cloud builds. Advanced
helpers are tracked in
[docs/PROVIDER_HELPERS_ROADMAP.md](/docs/PROVIDER_HELPERS_ROADMAP.md) and
should get dedicated runbooks after they ship.

## When to use this

Use this runbook when a Vercel project keeps build-time configuration in
encrypted `.env.*.enc` files and needs those values during the Vercel build, for
example:

- framework configuration read during `next build`, `vite build`, or another
  build command
- intentionally public client variables such as `NEXT_PUBLIC_*`
- API origins, feature flags, analytics IDs, or integration IDs that are safe to
  bundle
- serverless function build configuration that is resolved before deployment

Do not put secrets that must stay hidden from users in client-exposed variables
such as `NEXT_PUBLIC_*`. Frameworks may inline those values into browser
bundles.

Runtime secrets for Vercel Functions should use Vercel environment variables
directly. The cloud build path below is for decrypting values during the build
command, not for running dotenc inside deployed serverless functions.

## Cloud build with Vercel

| Path | Build runner | CD runner | GitHub secrets | dotenc identity | dotenc GitHub Actions |
| --- | --- | --- | --- | --- | --- |
| Cloud build | Vercel build workers | Vercel deployments | None | Vercel gets `DOTENC_PRIVATE_KEY_BASE64`, plus optional passphrase | No |

In this mode, GitHub only sends repository events through the Vercel Git
integration. Vercel is the system that decrypts dotenc values, so Vercel gets
the provider identity.

### 1. Create a dedicated Vercel key

Create a key specifically for Vercel. This example creates a passwordless key;
if you choose a passphrase-protected key, also store
`DOTENC_PRIVATE_KEY_PASSPHRASE` on Vercel as described below:

```bash
ssh-keygen -t ed25519 -f vercel_key -N "" -C "vercel"
```

Add the public key to the project and grant only the encrypted environments
that Vercel should build:

```bash
dotenc key add vercel --from-ssh ./vercel_key
dotenc auth grant production vercel
git add .dotenc .env.production.enc
git commit -m "Grant Vercel access to production environment"
```

If Vercel Preview Deployments use a separate encrypted environment, grant that
environment explicitly:

```bash
dotenc auth grant preview vercel
git add .dotenc .env.preview.enc
git commit -m "Grant Vercel access to preview environment"
```

### 2. Store the private key on Vercel

Create a Vercel environment variable named `DOTENC_PRIVATE_KEY_BASE64` in the
project settings for every Vercel environment that will run dotenc-backed
builds. If the private key is encrypted, also create
`DOTENC_PRIVATE_KEY_PASSPHRASE` in the same Vercel environments.

Recommended settings:

- Name: `DOTENC_PRIVATE_KEY_BASE64`
- Environment: `Production`, `Preview`, or a custom environment that maps to a
  granted dotenc environment
- Type: sensitive where Vercel supports sensitive environment variables
- Scope: project-level unless several Vercel projects intentionally share the
  same provider key

For passphrase-protected keys, use the same settings for
`DOTENC_PRIVATE_KEY_PASSPHRASE`.

The value must be the base64-encoded private key file:

```bash
base64 < vercel_key | tr -d '\n'
```

`DOTENC_PRIVATE_KEY` with the raw private key text is still supported for
backwards compatibility, but provider setup should prefer
`DOTENC_PRIVATE_KEY_BASE64`.

After the key is stored on Vercel, delete the local copy:

```bash
rm vercel_key vercel_key.pub
```

### 3. Install dotenc in the project build

Add dotenc as a development dependency so Vercel's normal install step makes the
CLI available to the build command:

```bash
npm install --save-dev @dotenc/cli
```

Use the package manager that matches the project if it is not npm.

### 4. Wrap the Vercel build command

Wrap the command that Vercel already runs. For a simple production-only project,
use a dedicated build script:

```json
{
  "scripts": {
    "build": "next build",
    "build:vercel": "dotenc run --strict -e production npm run build"
  }
}
```

Set Vercel's Build Command to:

```bash
npm run build:vercel
```

For projects that use both production and preview encrypted environments, map
the Vercel environment to a dotenc environment in a small script:

```sh
#!/usr/bin/env sh
set -eu

selected="${DOTENC_ENVIRONMENT:-${VERCEL_TARGET_ENV:-${VERCEL_ENV:-production}}}"

case "$selected" in
  production) dotenc_env="production" ;;
  preview) dotenc_env="preview" ;;
  *) dotenc_env="$selected" ;;
esac

exec dotenc run --strict -e "$dotenc_env" npm run build
```

Set Vercel's Build Command to run that script, for example:

```bash
./scripts/vercel-build.sh
```

The Vercel key must be granted to every dotenc environment the script can
select.

## Security notes

- Use a separate dotenc key for Vercel instead of reusing a developer,
  GitHub Actions, Netlify, or EAS key.
- Grant the Vercel key only to environments that Vercel builds.
- Do not store the Vercel provider key in GitHub for this path.
- Do not print decrypted values, run `env`, or enable shell tracing with
  `set -x`.
- Do not write decrypted `.env` files into the repository or Vercel build
  output.
- Keep runtime secrets in Vercel environment variables unless and until dotenc
  ships a dedicated runtime secret sync helper.
- Rotate the Vercel dotenc key and affected environment values if a Vercel
  build worker, deploy log, or project secret is suspected to be compromised.

## Troubleshooting

- `No private keys found`: `DOTENC_PRIVATE_KEY_BASE64` is missing, malformed, or
  scoped to the wrong Vercel environment.
- `Environment not found`: the build selected a dotenc environment that is not
  committed or does not match the environment name passed to `-e`.
- `Permission denied`: the Vercel public key was added, but it has not been
  granted to the encrypted environment used by the build command.
- Values missing in browser code: confirm the framework's public-variable
  prefix and remember that only intentionally public values should use it.

## References

- [Vercel builds](https://vercel.com/docs/builds)
- [Vercel build configuration](https://vercel.com/docs/builds/configure-a-build)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Vercel sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
