# dotenc GitHub Actions

This directory contains the monorepo implementation for reusable GitHub Actions
that use dotenc in CI.

- `actions/setup` installs `@dotenc/cli`.
- `actions/run` runs one command under `dotenc run --strict`.
- `actions/export` exports an explicit allowlist to later steps through
  `$GITHUB_ENV`.
- `actions/write-file` writes one decrypted variable to a file with restricted
  permissions.

The public action names are wrapper repositories in the `dotenc` org:

- `dotenc/setup-action@v1`
- `dotenc/run-action@v1`
- `dotenc/export-action@v1`
- `dotenc/write-file-action@v1`

The wrapper repo templates live in `actions/wrapper-repos/`.

See [docs/GITHUB_ACTIONS.md](../docs/GITHUB_ACTIONS.md) for setup guidance,
security notes, and examples.
