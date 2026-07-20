# diff-action

Post a redacted semantic diff of dotenc environments on a pull request. The
report contains variable names and recipient changes, never decrypted values.

```yaml
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
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      # Never check out or execute pull-request code in this privileged job.
      # Replace the placeholder with the reviewed implementation commit SHA.
      - uses: dotenc/dotenc/actions/diff@REPLACE_WITH_REVIEWED_FULL_COMMIT_SHA
        with:
          github-token: ${{ github.token }}
          fail-on-error: "true"
        env:
          DOTENC_PRIVATE_KEY_BASE64: ${{ secrets.DOTENC_PRIVATE_KEY_BASE64 }}
          DOTENC_PRIVATE_KEY_PASSPHRASE: ${{ secrets.DOTENC_PRIVATE_KEY_PASSPHRASE }}
```

`pull_request_target` has access to repository secrets and a privileged token.
Keep this job on trusted base/action code, do not check out the pull-request
head, and do not install, build, source, or execute pull-request content. See
the full [setup and security guide](https://github.com/dotenc/dotenc/blob/main/docs/GITHUB_ACTIONS.md#redacted-pull-request-diffs).
The guide also explains immutable SHA pinning and the inherent chosen-plaintext
equality signal exposed by semantic changed/unchanged classification.
Use the workflow's `github.token`; custom PAT and GitHub App comment identities
are not supported by the marker-ownership check.

The action posts or updates one marker comment and writes the same Markdown to
`GITHUB_STEP_SUMMARY`. Semantic changes are informational. The hardened example
fails only if a complete trustworthy report cannot be produced or published.
Its `report` output is versioned JSON for automation.

`dotenc/diff-action@v1` is the convenient public wrapper and delegates to
`dotenc/dotenc/actions/diff@v1`. Because both are moving tags, the privileged
workflow above follows the full runbook and invokes the reviewed implementation
path at a full commit SHA instead.
