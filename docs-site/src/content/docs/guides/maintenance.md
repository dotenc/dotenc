---
title: "Updates and integration helpers"
description: "Updates and integration helpers with dotenc, the Git-native encrypted environment CLI."
---

## Tooling and Maintenance

### CLI updates

```bash
dotenc update
```

Runs the appropriate update flow for your installation method (Homebrew, Scoop, npm, or manual binary instructions).

### Integration helpers

```bash
dotenc tools install-vscode-extension
dotenc tools install-agent-skill
dotenc tools install-agent-skill --force
dotenc tools install-github-diffs \
  --environment .env.production.enc
# Add --allow-fork only when the target repository is itself a fork.
```

- `install-vscode-extension` adds extension recommendations for supported editors and can open the extension page.
- `install-agent-skill` installs the dotenc agent skill through the pinned
  `skills@1.5.22` runner via Bun. The source is an immutable GitHub archive at
  [`dotenc/skills@dc3245191988923fced07c63b31df8184a1d1853`](https://github.com/dotenc/skills/commit/dc3245191988923fced07c63b31df8184a1d1853).
- Bun's `bun` executable must be available on `PATH`; the installer invokes its
  `bun x` package runner directly, and standalone dotenc binaries do not bundle
  Bun. `--force` maps to non-interactive mode (`-y`) for automation.
- `install-github-diffs` creates a dedicated, least-privilege GitHub identity,
  grants it only to explicitly selected environments (or `--all`), uploads its
  private key without writing it to disk, and generates the immutable-SHA-pinned
  redacted pull-request diff workflow. It requires authenticated `gh`, clean
  tracked selected environments, and `--allow-fork` to acknowledge installation
  when the target repository is itself a fork. Fork pull requests can expose
  the documented equality-oracle signal. See the
  [GitHub Actions runbook](/docs/ci/github-actions/#recommended-one-time-installer).
