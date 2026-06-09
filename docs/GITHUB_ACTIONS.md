# GitHub Actions runbook

This runbook shows how to use dotenc as the bootstrap secret source for GitHub
Actions.

The intended model is one GitHub bootstrap key, `DOTENC_PRIVATE_KEY_BASE64`,
plus encrypted `.env.*.enc` files in the repository. If the key is encrypted,
also store `DOTENC_PRIVATE_KEY_PASSPHRASE`. Provider tokens can live inside a
dotenc environment and be decrypted only in the jobs that need them.

## Provider-specific identity

Create a dedicated key for GitHub Actions instead of reusing a developer key or
another provider key:

```bash
ssh-keygen -t ed25519 -f github_actions_key -N "" -C "github-actions"
dotenc key add github-actions --from-ssh ./github_actions_key
dotenc auth grant github-actions github-actions
git add .dotenc .env.github-actions.enc
git commit -m "Grant GitHub Actions access to CI environment"
```

These examples use `github-actions` as a narrow CI-only environment. For a job
that actually runs production release commands on GitHub, it is also valid to
grant the GitHub Actions key to `production` and use
`environment: production`, so release-only authentication values and submission
credentials live with the production release environment.

Store the base64-encoded private key in GitHub as
`DOTENC_PRIVATE_KEY_BASE64`:

```bash
base64 < github_actions_key | tr -d '\n'
```

If the key is encrypted, also store `DOTENC_PRIVATE_KEY_PASSPHRASE`. Delete the
temporary private key after storing it. `DOTENC_PRIVATE_KEY` with the raw
private key text remains supported for backwards compatibility, but new
provider setup should use `DOTENC_PRIVATE_KEY_BASE64`.

Keep provider identities separate. Give GitHub Actions a dotenc identity only
for jobs that actually run on GitHub, and grant that key only to the encrypted
environments those jobs need.

## Actions

Use the public `dotenc/*-action@v1` wrappers in normal workflows. In this
repository, local workflow tests can use `./actions/<name>`.

### Setup

```yaml
- uses: actions/checkout@v6
- uses: actions/setup-node@v6
  with:
    node-version: 24
- uses: dotenc/setup-action@v1
```

Pin the CLI version when reproducibility matters:

```yaml
- uses: dotenc/setup-action@v1
  with:
    version: 1.2.3
```

### Run one command

Use `run` when decrypted values are needed by a single command:

```yaml
- uses: dotenc/run-action@v1
  with:
    environment: test
    command: npm test
  env:
    DOTENC_PRIVATE_KEY_BASE64: ${{ secrets.DOTENC_PRIVATE_KEY_BASE64 }}
    DOTENC_PRIVATE_KEY_PASSPHRASE: ${{ secrets.DOTENC_PRIVATE_KEY_PASSPHRASE }}
```

The action runs with strict mode by default. If any selected environment is
missing or cannot decrypt, the step fails before the command starts.

### Export allowlisted variables

Use `export` only when later steps need decrypted values:

```yaml
- uses: dotenc/export-action@v1
  with:
    environment: github-actions
    names: |
      NPM_TOKEN
      SENTRY_AUTH_TOKEN
  env:
    DOTENC_PRIVATE_KEY_BASE64: ${{ secrets.DOTENC_PRIVATE_KEY_BASE64 }}
    DOTENC_PRIVATE_KEY_PASSPHRASE: ${{ secrets.DOTENC_PRIVATE_KEY_PASSPHRASE }}

- run: npm publish
```

The action refuses to export the entire environment. Every variable must be
named explicitly, and exported values are registered with GitHub log masking.

### Write a variable to a file

Use `write-file` for file-shaped credentials such as service account JSON:

```yaml
- uses: dotenc/write-file-action@v1
  with:
    environment: github-actions
    name: SERVICE_ACCOUNT_JSON
    path: service-account.json
  env:
    DOTENC_PRIVATE_KEY_BASE64: ${{ secrets.DOTENC_PRIVATE_KEY_BASE64 }}
    DOTENC_PRIVATE_KEY_PASSPHRASE: ${{ secrets.DOTENC_PRIVATE_KEY_PASSPHRASE }}

- run: node scripts/deploy.js --credentials service-account.json
```

The file is written with mode `0600` by default. Keep generated credential files
out of git.

## Security notes

- Grant the GitHub Actions key only to the environments that job needs.
- Use separate keys for separate providers and trust boundaries.
- Prefer `run` for one command; use `export` only when values must persist to
  later steps.
- Keep `export` and `write-file` allowlists short and explicit.
- Put provider-specific deployment guidance in the provider runbook, not in the
  generic GitHub Actions bootstrap.
- Do not print decrypted values, run `env`, or enable shell tracing with
  `set -x`.
- Rotate the dotenc key and the external provider token if a CI runner or
  secret store is suspected to be compromised.
