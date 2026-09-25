---
title: "1Password SSH keys"
description: "Use a fingerprint-matched SSH identity from 1Password."
---

## 1Password SSH keys (experimental)

When the 1Password CLI 2.x (`op`) is installed and authenticated, dotenc can use
SSH Key items without additional configuration. `dotenc init` and interactive
`dotenc key add` show local keys immediately. Choose **Use a key from
1Password (experimental)** under **Actions** to load public key metadata; a
temporary loading group is then replaced by account groups backed by stable
account IDs, so accounts and duplicate item titles remain unambiguous. For
scripts, `--private-key` and `--from-private-key` accept a qualified
`1password:<account-id>:<vault-id>:<item-id>` selector and load its provider
metadata directly.

After a 1Password key is selected or successfully used, dotenc stores a
disposable machine-local locator under `~/.cache/dotenc` (or the platform cache
directory). It contains only the public-key fingerprint and opaque account,
vault, and item IDs—never key material, names, account URLs, or project paths.
Later commands can go directly to one fingerprint-verified `op read` instead of
rescanning every account and SSH item. Invalid or mismatched entries are
evicted; transient CLI, timeout, and authorization failures preserve the
locator and fail the current operation without starting a full provider scan.

After an interactive 1Password selection, dotenc also offers to save an
unencrypted private-key copy in `~/.ssh`. The default remains locator-only. If
you explicitly opt in, dotenc fingerprint-verifies the retrieved key, chooses a
non-conflicting `id_<algorithm>_1password_<fingerprint>` filename, and writes it
with mode `0600`. This avoids future 1Password authorization and provider
latency, but expands private-key exposure from 1Password-managed memory access
to a persistent local file.

Local keys keep priority during decryption. If none matches an environment,
local commands such as `run`, `dev`, environment edit/decrypt, and access
rotation can ask `op` for one fingerprint-matched private key. 1Password may
show its native authorization dialog at that point. After `op read` returns,
the key remains only in the dotenc process: it is not written to disk, persisted
in project files, or forwarded to a wrapped command or its environment.
`dotenc whoami` likewise consults 1Password only when no project identity
matches a local key.

Git `textconv` may use an already cached locator and show the same authorization
dialog, but it never performs full 1Password discovery. Without a valid cached
locator it immediately preserves the encrypted diff content.

See [1Password SSH key connector](https://github.com/dotenc/dotenc/blob/main/docs/ONEPASSWORD_CONNECTOR.md) for the full
behavior and security boundaries.
