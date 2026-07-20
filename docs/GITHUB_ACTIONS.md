# GitHub Actions runbook

This runbook shows how to use dotenc as the bootstrap secret source for GitHub
Actions.

The intended model for ordinary CI jobs is one GitHub bootstrap key,
`DOTENC_PRIVATE_KEY_BASE64`, plus encrypted `.env.*.enc` files in the
repository. If the key is encrypted, also store
`DOTENC_PRIVATE_KEY_PASSPHRASE`. Provider tokens can live inside a dotenc
environment and be decrypted only in the jobs that need them. The privileged
pull-request diff workflow described below uses a separate identity and the
dedicated repository secret `DOTENC_DIFF_PRIVATE_KEY_BASE64`.

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

## Redacted pull-request diffs

`dotenc/diff-action@v1` compares the encrypted environments at the pull
request's exact base and head commits. It posts or updates one pull-request
comment and writes the same report to the job summary. Variable values never
appear in either report: only variable names are classified as added, changed,
or removed. Access changes are compared by public-key fingerprint, so grants,
revocations, and recipient renames are visible even when a side cannot be
decrypted.

The action ignores ciphertext and encrypted data-key churn when plaintext and
recipient access are semantically unchanged. Its versioned JSON `report`
output is intended for local hooks and future integrations as well as GitHub.
A semantic change is informational, so the action does not fail the check by
default.

Discovery is recursive, so environments under monorepo subdirectories are
reported by path. Added and deleted environment files are compared against an
empty side rather than being skipped.

### Recommended one-time installer

Run the installer from an initialized dotenc repository with an authenticated
[GitHub CLI](https://cli.github.com/) session. Select each environment by its
repository-relative encrypted-file path (repeat `--environment`), or replace
the selection with `--all` only when every discovered environment is suitable
for this disclosure boundary:

```bash
gh auth status
dotenc tools install-github-diffs \
  --environment .env.production.enc
```

The automated installer currently targets GitHub.com repositories. GitHub
Enterprise Server installations need an explicit, administrator-reviewed
workflow because availability of actions hosted on GitHub.com depends on the
server's GitHub Connect policy.

GitHub repositories reported as forks are blocked by default. Add
`--allow-fork` only to acknowledge a deliberate installation into that fork.
The resulting workflow protects and comments on pull requests targeting the
fork; it does not install anything in or disclose secrets from the upstream
repository. Separately, any pull request author, including the author of a fork
pull request, can trigger an installed workflow and observe variable names,
recipient changes, and the changed/unchanged equality signal described below.

For non-interactive use, the command fails closed unless you provide `--yes`,
an explicit repeatable `--environment`/`-e` selection or `--all`, and
`--action-ref` with a reviewed 40-character commit SHA. Moving tags and branch
refs are not accepted.

The installer is intentionally a creation-only, safe first-install path. It:

- requires every selected `.env.*.enc` file to be Git-tracked and clean before
  making changes; interactive selection starts with nothing selected;
- generates a dedicated passwordless Ed25519 identity in memory, writes only
  its public key as `.dotenc/github-diff.pub` in each affected dotenc project,
  and grants that identity only to the explicitly selected environments;
- sends the base64-encoded private key only over standard input to
  `gh secret set`, storing it as the repository Actions secret
  `DOTENC_DIFF_PRIVATE_KEY_BASE64`; it never creates a private-key temporary
  file, places the private key in process arguments, or prints it;
- resolves and verifies the official diff implementation, then generates the
  hardened `.github/workflows/dotenc-diff.yml` with
  `pull_request_target`, minimal permissions, no checkout, and a full immutable
  action commit SHA; and
- refuses to overwrite an existing diff public key, workflow, or repository
  secret. Treat key rotation or repair of a partial existing installation as a
  separate, deliberate operation.

Do not edit the selected environments or installer target paths concurrently
with this command. The installer verifies file hashes before replacement and
before rollback, but filesystem compare-and-replace is not a cross-process
transaction. It also checks the fixed repository secret immediately before
upload; GitHub's secret write is an upsert rather than a conditional create, so
repository administrators should not create or rotate
`DOTENC_DIFF_PRIVATE_KEY_BASE64` during the installation window.

The secret upload is the final state-changing step. Before that upload, a
failure rolls back only the local files written by the installer. If GitHub's
response is interrupted and the remote result cannot be determined safely,
the command exits with repair instructions and preserves the matching local
changes rather than guessing or deleting a possibly successful secret. Check
the repository's Actions secrets before retrying.

After a successful install, review and commit the generated public key(s), the
updated selected encrypted environments, and the workflow. The installer does
not stage, commit, push, or modify branches for you.

### Machine-readable report

The `report` output sets `schemaVersion` to `1`. Each environment entry has
`path`, `name`, and `status` fields, plus:

- `variables`: a status and sorted `added`, `changed`, and `removed` name
  arrays, with an optional sanitized `reason` when comparison is unavailable.
- `access`: a status, `grants`, `revocations`, and `renames`, with an optional
  sanitized `reason`. Grant and revocation identities contain only `name` and
  public-key `fingerprint`; renames contain `fingerprint`, `from`, and `to`.

The GitHub Action and the independent
`createEnvironmentDiffReport(input, options?)` engine use this same schema. It
contains no values, hashes, lengths, prefixes, or reusable value-derived
material beyond the documented changed/unchanged equality classification.

Every string in the JSON report is still pull-request-controlled, untrusted
data. Parse it as JSON and validate the schema before using it. Never interpolate
the output directly into a `run:` command or generated script; pass it through
an environment variable or file and use a JSON parser without evaluating any
field as code.

### Manual setup alternative

Use a dedicated key for this privileged workflow. Do not reuse a developer key
or a production deployment key. Grant it only to the environments whose
semantic diffs reviewers are allowed to see:

```bash
ssh-keygen -t ed25519 -f github_diff_key -N "" -C "github-dotenc-diff"
dotenc key add github-diff --from-ssh ./github_diff_key
dotenc auth grant production github-diff
# Repeat `dotenc auth grant <environment> github-diff` only when needed.
git add .dotenc .env.production.enc
git commit -m "Grant the GitHub diff workflow access to production"
```

In a monorepo, run `dotenc auth grant` from the project containing the
environment and stage that environment's actual path. The public key and
recipient metadata are safe to commit; the private key is not.

Base64-encode the private key and send it over standard input to the dedicated
repository Actions secret `DOTENC_DIFF_PRIVATE_KEY_BASE64`:

```bash
base64 < github_diff_key | tr -d '\n' | \
  gh secret set DOTENC_DIFF_PRIVATE_KEY_BASE64 --app actions
```

If the key is passphrase-protected, also save its passphrase as
`DOTENC_DIFF_PRIVATE_KEY_PASSPHRASE` and add the optional mapping documented
below. The action uses the existing dotenc key parser in environment-only mode:
it requires `DOTENC_PRIVATE_KEY_BASE64` at runtime, ignores the legacy raw-key
variable, and never scans the runner's `~/.ssh`. Delete the local private-key
file after the secret has been stored. Repository administrators should rotate
this key if the workflow, a dependency, or the GitHub secret store may have
been compromised.

### Trusted automatic workflow

Save the following as `.github/workflows/dotenc-diff.yml` on the default
branch. It runs automatically when a pull request is opened, updated, or
reopened. As the final one-time setup step, replace
`REPLACE_WITH_REVIEWED_FULL_COMMIT_SHA` with the 40-character commit SHA that
contains the reviewed `actions/diff` implementation. Do not use a pull-request
ref or leave the placeholder unchanged:

```yaml
name: Redacted dotenc diff

on:
  pull_request_target:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: dotenc-diff-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  dotenc-diff:
    name: Redacted dotenc environment diff
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      # Never check out, install, build, source, or execute pull-request code.
      # Replace this placeholder once with the reviewed 40-character commit SHA.
      - name: Compare encrypted environments
        uses: dotenc/dotenc/actions/diff@REPLACE_WITH_REVIEWED_FULL_COMMIT_SHA
        with:
          github-token: ${{ github.token }}
          # Semantic changes stay informational. This fails only when a complete,
          # trustworthy report cannot be produced or published.
          fail-on-error: "true"
        env:
          # Dedicated passwordless identity created by install-github-diffs.
          DOTENC_PRIVATE_KEY_BASE64: ${{ secrets.DOTENC_DIFF_PRIVATE_KEY_BASE64 }}
```

The installer-generated identity is passwordless, so the generated workflow
does not need a passphrase secret. If you manually use a passphrase-protected
diff identity, add this mapping beside the private-key mapping:

```yaml
DOTENC_PRIVATE_KEY_PASSPHRASE: ${{ secrets.DOTENC_DIFF_PRIVATE_KEY_PASSPHRASE }}
```

Those are the exact required token permissions. Declaring them also sets every
unspecified `GITHUB_TOKEN` permission to `none`. `contents: read` lets the
action read the two commits and their blobs; `pull-requests: write` lets it
create or update its marker comment. Passing `github.token` explicitly keeps
the credential visible for review at the call site. Use the workflow's
`GITHUB_TOKEN`, not a PAT or GitHub App token: marker ownership is intentionally
bound to the GitHub Actions bot so an untrusted user cannot spoof a comment that
the action will overwrite.

Repository, pull-request number, and base/head object IDs are derived from and
strictly validated against GitHub's trusted event payload. They are not public
inputs, so the job cannot accidentally be configured to compare unrelated
objects or comment on a different pull request.

The per-pull-request concurrency group cancels an older in-flight run when a
new `synchronize` event arrives. Together with the hidden comment marker, this
prevents stale runs from racing to publish duplicate or outdated comments.

The checked-in copy of this example is
[`actions/examples/diff.yml`](../actions/examples/diff.yml).

### Why `pull_request_target` is safe only in this shape

GitHub documents that `pull_request_target` runs the workflow from the trusted
base repository context, but also gives that workflow repository secrets and a
potentially privileged token. Checking out and executing the pull-request head
in that context is a known repository-compromise pattern. Read GitHub's
[dedicated `pull_request_target` security guide](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target),
[event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target),
[secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use),
and [`permissions` reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)
before modifying this job.

The supplied workflow maintains that trust boundary:

- The workflow comes from the default branch and invokes the implementation at
  a reviewed full commit SHA; pull-request changes cannot replace either one
  for the current run.
- It has no checkout step. The action reads only exact `.env.*.enc` blobs from
  the base and head commit object IDs through the GitHub API. Pull-request file
  contents are treated as bounded, untrusted data and are never executed.
- It does not install dependencies, run builds or tests, source files, restore
  pull-request-controlled caches, or interpolate pull-request metadata into a
  shell command.
- It validates encrypted-file schemas and accepts at most 100 files per side,
  1 MiB per encrypted file, 10 MiB total input, and 1,024 bytes per path. Each
  environment is capped at 256 recipients, 1 MiB of decrypted plaintext in
  memory, and 4,096 variables. Paths and headings are escaped for Markdown;
  variable and recipient names have format controls neutralized and render only
  inside dynamically delimited fenced code blocks.
- It never persists decrypted plaintext and never reports values, hashes,
  lengths, prefixes, private-key material, passphrases, encrypted data keys, or
  ciphertext. Malformed or undecryptable input produces a bounded, sanitized
  status instead of raw input.

Semantic changed/unchanged classification necessarily reveals an equality
signal about each reported value. A pull-request author can use the committed
recipient public key to encrypt a guessed head value and observe whether the
action classifies that variable as changed. Repeated runs can therefore test
guesses for a base value even though the value, its hash, length, and prefixes
are never reported. Treat this as a chosen-plaintext equality oracle: grant the
dedicated diff key only to environments where that signal is acceptable, and
do not use it for low-entropy secrets whose values could be guessed feasibly.

The convenient `dotenc/diff-action@v1` wrapper and the implementation `v1` ref
are moving major-version tags. They are available for consistency with the
other public dotenc Actions, but this privileged workflow deliberately calls
`dotenc/dotenc/actions/diff@<full-commit-sha>` directly. GitHub documents a full
commit SHA as the only immutable way to consume an action. Update that reviewed
SHA intentionally; never pin the implementation to a ref from the pull request.

Do not add a checkout of `github.event.pull_request.head.sha`, `git fetch`,
`gh pr checkout`, package installation, or any command that executes files from
the pull request. If the workflow grows beyond this data-only review job, move
untrusted work to a separate unprivileged `pull_request` workflow with no
secrets or write token.

The action identifies its comment with a hidden marker and updates that comment
on `synchronize`, so repeated runs do not create comment spam. If either side
cannot be decrypted, independently verifiable recipient changes are still
shown and the variable section is marked unavailable with a sanitized reason.

The action outputs `report` (versioned redacted JSON), `has-changes`, and the
`comment-url` when a comment was created or updated. Set `comment: "false"` to
write only the job summary. `has-changes` is `true` for changed or unverified
environments, `false` only for a verified empty report, and empty if the action
fails before producing a report; `report` is also empty in that total-failure
case. The hardened workflow sets `fail-on-error: "true"` so unavailable input,
decryption, API, output, or comment failures cannot become a green required
check. Ordinary verified semantic changes remain informational and never fail.
The public action keeps `fail-on-error: "false"` as its general-purpose default.

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
