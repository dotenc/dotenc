# GitHub Actions runbook

This runbook shows how to use dotenc as the bootstrap secret for GitHub Actions.

The intended model is one GitHub secret, `DOTENC_PRIVATE_KEY`, plus encrypted
`.env.*.enc` files in the repository. Provider tokens such as `EXPO_TOKEN` can
live inside a dotenc environment and be decrypted only in the jobs that need
them.

## Provider-specific identity

Create a dedicated key for GitHub Actions instead of reusing a developer key or
an EAS key:

```bash
ssh-keygen -t ed25519 -f github_actions_key -N "" -C "github-actions"
dotenc key add github-actions --from-ssh ./github_actions_key
dotenc auth grant github-actions github-actions
git add .dotenc .env.github-actions.enc
git commit -m "Grant GitHub Actions access to CI environment"
```

Store the full private key text in GitHub as `DOTENC_PRIVATE_KEY`, including
the `BEGIN` and `END` lines. Delete the temporary private key after storing it.

Keep other providers separate. For example, an EAS Build worker should have its
own key stored on EAS as `DOTENC_PRIVATE_KEY`, and GitHub Actions should have a
different key stored in GitHub secrets.

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
    DOTENC_PRIVATE_KEY: ${{ secrets.DOTENC_PRIVATE_KEY }}
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
      EXPO_TOKEN
      NPM_TOKEN
  env:
    DOTENC_PRIVATE_KEY: ${{ secrets.DOTENC_PRIVATE_KEY }}

- run: npx eas-cli@latest build --platform android --profile production --non-interactive
```

The action refuses to export the entire environment. Every variable must be
named explicitly, and exported values are registered with GitHub log masking.

### Write a variable to a file

Use `write-file` for file-shaped credentials such as Google Play service
account JSON:

```yaml
- uses: dotenc/write-file-action@v1
  with:
    environment: github-actions
    name: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
    path: google-play-service-account.json
  env:
    DOTENC_PRIVATE_KEY: ${{ secrets.DOTENC_PRIVATE_KEY }}

- run: npx eas-cli@latest submit --platform android --profile production --latest --non-interactive --wait --verbose
```

The file is written with mode `0600` by default. Keep generated credential files
out of git.

## EAS build trigger example

In this pattern, GitHub Actions uses its own dotenc key to decrypt `EXPO_TOKEN`
and trigger EAS. EAS Build uses a separate dotenc key stored on EAS to decrypt
the app build environment.

```yaml
jobs:
  build_android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
      - uses: dotenc/setup-action@v1
      - uses: dotenc/export-action@v1
        with:
          environment: github-actions
          names: EXPO_TOKEN
        env:
          DOTENC_PRIVATE_KEY: ${{ secrets.DOTENC_PRIVATE_KEY }}
      - run: npx eas-cli@latest build --platform android --profile production --non-interactive
```

## Security notes

- Grant the GitHub Actions key only to the environments that job needs.
- Use separate keys for separate providers and trust boundaries.
- Prefer `run` for one command; use `export` only when values must persist to
  later steps.
- Keep `export` and `write-file` allowlists short and explicit.
- Do not print decrypted values, run `env`, or enable shell tracing with
  `set -x`.
- Rotate the dotenc key and the external provider token if a CI runner or
  secret store is suspected to be compromised.

## Publishing wrapper repos

The public names (`dotenc/export-action@v1`, etc.) are tiny wrapper repositories
in the `dotenc` org. Their templates live in `actions/wrapper-repos/`.

After creating and checking out the wrapper repositories under one parent
directory, sync them from this repo:

```bash
bun run actions:sync-wrappers -- --target-dir ../dotenc-action-wrappers
```

Then review, commit, push, and tag each wrapper repo:

```bash
git tag v1
git push origin v1
```

The implementation repo must also have a `v1` ref containing the implementation
actions in `actions/`, because the wrapper repos delegate to that ref.
