# dotenc GitHub Actions

This directory contains the monorepo implementation for reusable GitHub Actions
that use dotenc in CI.

- `actions/setup` installs `@dotenc/cli`.
- `actions/run` runs one command under `dotenc run --strict`.
- `actions/export` exports an explicit allowlist to later steps through
  `$GITHUB_ENV`.
- `actions/write-file` writes one decrypted variable to a file with restricted
  permissions.
- `actions/diff` compares encrypted environments from two exact Git commits and
  publishes a redacted pull-request report when it finds a verified change.

The public action names are wrapper repositories in the `dotenc` org:

- `dotenc/setup-action@v1`
- `dotenc/run-action@v1`
- `dotenc/export-action@v1`
- `dotenc/write-file-action@v1`
- `dotenc/diff-action@v1`

The wrapper repo templates live in `actions/wrapper-repos/`.

The trusted `pull_request_target` workflow example for the diff action lives at
[`actions/examples/diff.yml`](./examples/diff.yml). It deliberately does not
check out pull-request code.

A verified semantic no-op, including formatting-only or same-key ciphertext
churn, writes no job summary or new comment. With comments enabled, the action
removes every stale marker comment it verifies is its own; cleanup failure fails
the check. A dedicated-recipient data-key change is shown compactly as `Data key
rotated` only when plaintext bytes, the effective environment format version,
and recipient metadata are unchanged and all recipient wrapper blobs changed.
The action compares only the base and head keys unwrapped for that dedicated
recipient, using `timingSafeEqual`, and zeroes both keys afterward; it does not
verify every recipient wrapper's contents or emit a data key or any hash,
fingerprint, or other derived identifier of one.

`actions/diff/dist/index.js` is the committed Node 24 bundle used at runtime.
After changing its TypeScript source or the shared diff engine, run
`bun run actions:test-diff`, `bun run actions:typecheck-diff`, and
`bun run actions:build-diff`; CI rebuilds the bundle, compares it byte-for-byte,
and checks the committed artifact with Node 24.

See [docs/GITHUB_ACTIONS.md](../docs/GITHUB_ACTIONS.md) for setup guidance,
security notes, and examples.
