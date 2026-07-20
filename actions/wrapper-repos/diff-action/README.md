# diff-action

Post a redacted semantic diff of dotenc environments on a pull request. The
report contains variable names, recipient changes, and a compact verified
`Data key rotated` signal, never decrypted values.

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

For a non-empty report, the action posts or updates one marker comment and
writes the same Markdown to `GITHUB_STEP_SUMMARY`. A verified semantic no-op,
including formatting-only or same-key ciphertext churn, publishes neither
surface; with comments enabled, it removes every stale marker comment only
after verifying that each comment is its own. Cleanup failure always fails the
check. Semantic changes are informational. The hardened example fails only if
a complete trustworthy report cannot be produced or published. Its `report`
output is versioned JSON for automation.

The action unwraps and compares only the base and head data keys encrypted for
its dedicated recipient; it does not verify every recipient wrapper. It uses
`timingSafeEqual` in memory and explicitly zeroes both keys. No data key, or
hash, fingerprint, or other derived identifier of a data key, is emitted. If
those dedicated-recipient keys differ while plaintext bytes, the effective
environment format version, and recipient metadata are unchanged and every
encrypted wrapper blob changed, the report retains the compact `Data key
rotated` entry. Comparison failure or an unchanged wrapper alongside different
keys fails safely instead of claiming a rotation.

`dotenc/diff-action@v1` is the convenient public wrapper and delegates to
`dotenc/dotenc/actions/diff@v1`. Because both are moving tags, the privileged
workflow above follows the full runbook and invokes the reviewed implementation
path at a full commit SHA instead.
