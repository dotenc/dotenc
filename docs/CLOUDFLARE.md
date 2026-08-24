# Cloudflare runbook

Cloudflare has several deployment paths with different trust boundaries. Choose
the path by the machine that runs the secret-dependent build:

| Path | Build owner | dotenc identity lives in | Runtime secrets live in |
| --- | --- | --- | --- |
| Pages Git integration, static output only | Cloudflare Pages | Pages production or preview secret | Not applicable |
| Pages Direct Upload | External CI or a developer machine | That external runner | Cloudflare Pages secrets for Functions |
| Workers Builds | Cloudflare Workers Builds | Build Variables and Secrets | Worker secrets |
| External `wrangler deploy` | External CI or a developer machine | That external runner | Worker secrets |

Keep identities separate across Pages, Workers, production, and preview when
those paths execute code with different review guarantees. Never give a preview
build key access to the production build environment.

A build secret is still readable by the build runner before `dotenc run`
starts. Only attach a dotenc identity to builds whose branch authors,
dependency installation, and build scripts are trusted. If preview builds can
run untrusted changes, do not give their trigger a dotenc bootstrap key.

Cloudflare Pages project variables are available at both build time and to
Pages Functions at runtime. Because that would make a dotenc bootstrap private
key available to deployed code, use the Pages Git integration recipe below only
for strictly static output. If the project has a `functions/` directory, emits
`_worker.js`, or otherwise deploys Pages Functions, use Direct Upload instead.

## Shared setup

Add dotenc as a development dependency so the selected build runner installs a
project-pinned CLI:

```bash
npm install --save-dev @dotenc/cli
npm install --save-dev --save-exact wrangler@4.123.0
```

Commit the resulting manifest and lockfile. The examples call the installed
Wrangler binary as `./node_modules/.bin/wrangler` so the deployment cannot make
`npx` download an unreviewed version. Use the equivalent local-executable form
for the package manager that owns the project. This runbook was checked against
Wrangler 4.123.0. `wrangler versions upload` requires at least 3.40.0, and
versions before 3.73.0 require Cloudflare's legacy `--x-versions` flag.

Create dedicated `production-build` and `preview-build` environments as the
explicit build allowlists:

```bash
dotenc env create production-build
dotenc env edit production-build
dotenc env create preview-build
dotenc env edit preview-build
```

Put only values required by the build in these environments. Runtime-only
credentials belong in Cloudflare runtime secrets and must not be copied into a
build environment. For static sites, the generic path in this runbook supports
only values that are safe to publish. A private build-only credential requires
a project-specific artifact scanner as described under Direct Upload; without
that gate, do not provide it to a static build.

Create a dedicated key for each Cloudflare build boundary. This production
Pages example uses a passwordless automation key; if you protect the key with a
passphrase, also store `DOTENC_PRIVATE_KEY_PASSPHRASE` beside the private key:

```bash
ssh-keygen -t ed25519 \
  -f cloudflare_pages_production_key \
  -N "" \
  -C "cloudflare-pages-production"
dotenc key add cloudflare-pages-production \
  --from-ssh ./cloudflare_pages_production_key
dotenc auth grant production-build cloudflare-pages-production
git add .dotenc .env.production-build.enc
git commit -m "Grant Cloudflare Pages access to production build environment"
```

Encode the private key before placing it in the build provider's secret store:

```bash
base64 < cloudflare_pages_production_key | tr -d '\n'
```

Store that value as `DOTENC_PRIVATE_KEY_BASE64`, then delete the local key copy:

```bash
rm cloudflare_pages_production_key cloudflare_pages_production_key.pub
```

Repeat the process with different key names for every additional boundary, for
example `cloudflare-pages-preview`, `cloudflare-workers-production`, or
`cloudflare-workers-preview`. Grant each key only to its matching encrypted
environment.

## Pages Git integration

Use this path only when Cloudflare Pages owns a strictly static build. GitHub or
GitLab sends repository events, but Cloudflare checks out the code, installs
dependencies, runs the build command, and publishes the output.

### 1. Store production and preview build inputs

In **Workers & Pages > your Pages project > Settings > Variables and Secrets**,
configure these values separately for Production and Preview:

| Name | Production | Preview | Type |
| --- | --- | --- | --- |
| `DOTENC_ENVIRONMENT` | `production-build` | `preview-build` | Plain text |
| `DOTENC_PRIVATE_KEY_BASE64` | Production Pages key | Preview Pages key | Secret / encrypted |
| `DOTENC_PRIVATE_KEY_PASSPHRASE` | Only when required | Only when required | Secret / encrypted |

The preview key must not be the production key and must not be granted to the
production build environment. Remember that code pushed to a connected branch
can run during the preview build. Omit the preview bootstrap key entirely when
those branch authors are not trusted with the preview build environment.

### 2. Wrap the existing build command

Add a small checked-in script such as `scripts/cloudflare-pages-build.sh`:

```sh
#!/usr/bin/env sh
set -eu

case "${DOTENC_ENVIRONMENT:-}" in
  production-build|preview-build) ;;
  *)
    echo "DOTENC_ENVIRONMENT must be production-build or preview-build" >&2
    exit 64
    ;;
esac

exec dotenc run --strict -e "$DOTENC_ENVIRONMENT" npm run build
```

Make it executable and set the Pages build command to:

```bash
chmod +x scripts/cloudflare-pages-build.sh
./scripts/cloudflare-pages-build.sh
```

Keep the existing build output directory. `dotenc run` passes decrypted values
only to the wrapped build and removes dotenc's bootstrap key variables before
starting it.

If the static site later adds Pages Functions or a framework starts emitting a
Worker, build externally, upload with Wrangler, and remove the Pages bootstrap
key. A project created for Direct Upload cannot later switch to Git integration
without creating a new project, so choose the ownership model before project
creation.

## Pages Direct Upload

Use Direct Upload when an external CI runner or a developer machine builds the
site. The runner gets the dotenc identity; Cloudflare receives only the already
built output.

Use provider-supported step-scoped secrets or separate jobs on fresh runners. A
different shell step in the same job is not isolation when Cloudflare
credentials are configured at job scope. The build must not inherit
`CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID`; only the deploy step receives
them. Conversely, the deploy step must not inherit the dotenc bootstrap key:

```bash
# Build step: only DOTENC_PRIVATE_KEY_BASE64 and its optional passphrase are scoped here.
if [ "${CLOUDFLARE_API_TOKEN+x}" = x ] || [ "${CLOUDFLARE_ACCOUNT_ID+x}" = x ]; then
  echo "Cloudflare credentials must not be present in the build step" >&2
  exit 1
fi
dotenc run --strict -e production-build npm run build

# Deploy step: only Cloudflare authentication is scoped here.
if [ "${DOTENC_PRIVATE_KEY_BASE64+x}" = x ] || \
   [ "${DOTENC_PRIVATE_KEY+x}" = x ] || \
   [ "${DOTENC_PRIVATE_KEY_PASSPHRASE+x}" = x ]; then
  echo "dotenc bootstrap credentials must not be present in the deploy step" >&2
  exit 1
fi
./node_modules/.bin/wrangler pages deploy dist \
  --project-name example-site \
  --branch main
```

Replace `dist`, the project name, branch, and environment with the project's
actual values. Use `wrangler login` for an interactive developer deployment.
For CI, create a narrowly scoped Cloudflare API token and keep it in the CI
provider's secret store. Do not commit it or put it in the dotenc-backed build
environment. An interactive local build and Wrangler's stored login share one
machine trust boundary, so run only reviewed build code in that mode.

Before upload, inspect the publish directory for generated dotenv files,
private-key headers, and bootstrap variable names. This baseline check reports
filenames only:

```bash
find dist -type f \( -name '.env' -o -name '.env.*' \) -print
rg -l \
  'BEGIN (OPENSSH|RSA|EC|DSA) PRIVATE KEY|DOTENC_PRIVATE_KEY(_BASE64|_PASSPHRASE)?' \
  dist
```

Stop the deployment and investigate if either command prints a path. This
baseline cannot detect an opaque credential embedded as an ordinary string. If
the build uses any private build-only value, add a required scanner that checks
the output bytes against every such value, fails closed on a match, and reports
only the variable name and repository-relative path. It must never print the
value, matching text, or surrounding content. Without that project-specific
gate, keep private values out of static builds.

A dedicated Cloudflare helper and artifact doctor remain tracked in the
[provider helpers roadmap](./PROVIDER_HELPERS_ROADMAP.md); this runbook does not
claim that an automated artifact or runtime-secret sync exists.

## Workers Builds

Workers Builds separates build variables and secrets from runtime variables and
secrets. Put the dotenc bootstrap identity in **Settings > Build > Build
Variables and Secrets**, never in the Worker's runtime **Variables and
Secrets**.

Configure production and non-production build triggers independently:

| Name | Production trigger | Non-production trigger | Type |
| --- | --- | --- | --- |
| `DOTENC_ENVIRONMENT` | `production-build` | `preview-build` | Plain text |
| `DOTENC_PRIVATE_KEY_BASE64` | Production Workers key | Preview Workers key | Build secret |
| `DOTENC_PRIVATE_KEY_PASSPHRASE` | Only when required | Only when required | Build secret |

Leave the non-production bootstrap fields unset when non-production branches
are not trusted with the preview build environment.

Use the same environment-selection script shape as the Pages example, but name
it for Workers and wrap the Worker's existing build command:

```sh
#!/usr/bin/env sh
set -eu

case "${DOTENC_ENVIRONMENT:-}" in
  production-build|preview-build) ;;
  *)
    echo "DOTENC_ENVIRONMENT must be production-build or preview-build" >&2
    exit 64
    ;;
esac

exec dotenc run --strict -e "$DOTENC_ENVIRONMENT" npm run build
```

Set that script as the Workers Build command. Cloudflare runs a separate deploy
command after it. Remove the dotenc bootstrap inputs before Wrangler starts by
using a checked-in deployment wrapper:

```sh
#!/usr/bin/env sh
set -eu

unset DOTENC_PRIVATE_KEY_BASE64
unset DOTENC_PRIVATE_KEY
unset DOTENC_PRIVATE_KEY_PASSPHRASE
unset DOTENC_ENV

case "${1:-}" in
  production) exec ./node_modules/.bin/wrangler deploy ;;
  preview) exec ./node_modules/.bin/wrangler versions upload ;;
  *)
    echo "usage: $0 production|preview" >&2
    exit 64
    ;;
esac
```

Configure the production deploy command as:

```bash
./scripts/cloudflare-workers-deploy.sh production
```

Configure the non-production branch deploy command as:

```bash
./scripts/cloudflare-workers-deploy.sh preview
```

The wrapper limits which repository processes inherit the bootstrap key; it
does not remove the key from Cloudflare's build runner itself. Treat dependency
installation, build scripts, and repository write access as part of that trust
boundary. Keep runtime credentials out of the build allowlist. If it contains a
private build-only value, make the build command run the safe-metadata artifact
gate described above before it succeeds.

## External Wrangler deployments

When an external CI runner owns a Workers build and deployment, give that runner
a dedicated dotenc identity. Keep Cloudflare's account ID and narrowly scoped
API token in the CI provider's secret store.

Require provider-supported step-scoped secrets or separate jobs on fresh
runners. Prefer a split build and deploy so the application build cannot
inherit the Cloudflare deployment token:

```bash
# Build step: expose the dotenc bootstrap secret, not Cloudflare credentials.
if [ "${CLOUDFLARE_API_TOKEN+x}" = x ] || [ "${CLOUDFLARE_ACCOUNT_ID+x}" = x ]; then
  echo "Cloudflare credentials must not be present in the build step" >&2
  exit 1
fi
dotenc run --strict -e production-build npm run build

# Deploy step: expose Cloudflare credentials, not the dotenc bootstrap secret.
if [ "${DOTENC_PRIVATE_KEY_BASE64+x}" = x ] || \
   [ "${DOTENC_PRIVATE_KEY+x}" = x ] || \
   [ "${DOTENC_PRIVATE_KEY_PASSPHRASE+x}" = x ]; then
  echo "dotenc bootstrap credentials must not be present in the deploy step" >&2
  exit 1
fi
./node_modules/.bin/wrangler deploy
```

Ensure `wrangler deploy` does not rerun the secret-dependent build. If Wrangler
must own a build that needs private values, this generic external-runner path
cannot isolate the application build from the deployment token. Refactor the
build into a separate step or use Workers Builds; do not wrap that combined
operation with `dotenc run`. When the separate build uses a private build-only
value, run the safe-metadata artifact gate before the deploy job starts.

## Runtime secrets

Build-time values and runtime secrets are different lifecycles:

- Pages Functions secrets belong in encrypted Pages Variables and Secrets.
- Worker secrets belong in the Worker's runtime Variables and Secrets or
  Cloudflare Secrets Store bindings.
- Plaintext `vars` in a Wrangler configuration file are not suitable for
  secrets.

There is no shipped `dotenc cloudflare secrets sync` command. Until an
allowlisted helper exists, manage runtime secrets with Cloudflare's native
controls rather than writing a decrypted `.env` or JSON file in CI.

For one-off Worker changes,
`./node_modules/.bin/wrangler secret put <KEY>` prompts for a value, but it also
creates and immediately deploys a new Worker version. For gradual deployments,
use Cloudflare's versioned secret workflow instead. Pages secrets can be entered
as encrypted values in the dashboard or with
`./node_modules/.bin/wrangler pages secret put <KEY> --project-name <PROJECT>`.

## Rollback and revocation

- **Pages:** open the project's Deployments list and roll back to a previous
  successful production deployment. Preview deployments are not rollback
  targets.
- **Workers:** use the dashboard deployment history or
  `./node_modules/.bin/wrangler rollback [VERSION_ID]`. A rollback changes the
  active Worker version but does not revert data stored in KV, D1, R2, queues,
  or other bound resources.
- **Compromised dotenc identity:** revoke its public key from every granted
  environment, commit the encrypted metadata changes, rotate affected values,
  replace the provider secret, and redeploy from reviewed code.
- **Compromised Cloudflare API token:** revoke it in Cloudflare, create a
  narrower replacement, update the external CI secret, and audit recent
  deployments.

A rollback is not containment for an exposed key or value. Revoke and rotate
first, then restore a known-good deployment.

## Security checklist

- Use different dotenc keys for Pages and Workers, and for production and
  preview when preview code has a broader author set.
- Grant each provider key only to the encrypted environment it builds.
- Keep `DOTENC_PRIVATE_KEY_BASE64` in build secrets, never in source,
  `wrangler.jsonc`, `wrangler.toml`, or plaintext variables.
- Do not print decrypted values, run `env`, or enable shell tracing with
  `set -x` in a secret-bearing step.
- Do not write decrypted `.env`, `.dev.vars`, or JSON secret files into the
  repository, `.wrangler`, publish output, caches, or artifacts.
- Treat intentionally public client variables as public; frameworks may inline
  them into JavaScript or static assets.
- Pin dotenc and Wrangler through the project's package manifest and lockfile.
- Restrict Cloudflare API tokens to the required account and edit permissions.

## Troubleshooting

- `No private keys found`: the bootstrap key is missing, malformed, or attached
  to the wrong Pages environment or Workers build trigger.
- `Environment not found`: `DOTENC_ENVIRONMENT` selected an encrypted
  environment that is not present in the checked-out revision.
- `Permission denied`: the provider public key exists but was not granted to
  the selected environment.
- Pages build works but the key appears in a Function binding: Pages variables
  span build and runtime. Remove the key, rotate it, and move the build to
  Direct Upload.
- Worker preview decrypts production: stop the build, revoke that key's
  production grant, and configure a preview-only identity on the
  non-production trigger.

## References

- [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Pages Functions bindings and secrets](https://developers.cloudflare.com/pages/functions/bindings/)
- [Pages rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/)
- [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [External CI/CD authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [Wrangler Workers commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
