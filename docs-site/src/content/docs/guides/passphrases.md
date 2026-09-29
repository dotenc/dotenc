---
title: "Passphrase-protected keys"
description: "Use encrypted SSH keys without removing their protection."
---

Provide `DOTENC_PRIVATE_KEY_PASSPHRASE` through your local or CI secret-input
mechanism when using a passphrase-protected key. It applies to filesystem SSH
keys and the `DOTENC_PRIVATE_KEY_BASE64` bootstrap identity. Avoid putting the
passphrase in shell history, command arguments, or project files.

Interactive setup can offer to create a passwordless local copy. This is an
explicit opt-in: the original key stays unchanged, but the copy expands the
private key's exposure on disk. Decline that option if you want to retain
passphrase protection.

Normal commands do not open a dotenc passphrase prompt. The optional conversion
flow delegates prompting to `ssh-keygen`. SSH agent integration is not supported.
See [private-key handling](/docs/security/model/#private-key-isolation) for the
full security boundary, and [CI setup](/docs/ci/overview/) for bootstrap variables.
