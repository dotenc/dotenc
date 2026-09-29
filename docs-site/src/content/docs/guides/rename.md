---
title: "Rename environments and migrate profiles"
description: "Rename environments and migrate profiles with dotenc, the Git-native encrypted environment CLI."
---

## Renaming an environment

Use `dotenc env rename <source> <destination>` to rename an environment.
Never move an encrypted file directly: its name is cryptographic context.

```bash
dotenc env rename alice personal.alice
dotenc dev --profile alice bun run test
```

For a profile layered from the project root through the current directory,
migrate every source layer in that effective chain with one reviewed operation:

```bash
dotenc env rename alice personal.alice --all-layers
```

Use `--all-layers` from a nested directory even when the only source is a
single ancestor layer; the default command looks only in the current directory.

The command shows the source and destination paths and asks for confirmation.
A non-interactive caller must pass `--yes`; that flag skips only the prompt, not
validation, exclusive destination creation, or verification. Without
`--all-layers`, `env rename` follows other single-environment commands and acts
only in the current directory. `--all-layers` does not scan unrelated sibling
packages.

This is a cryptographic rename, not a filesystem move. dotenc decrypts the
source, emits a version 2 destination using `personal.alice` as AAD and a fresh
ciphertext IV, and preserves the recipient entries exactly. Every destination
inode is created inside a private same-parent quarantine, published without
overwrite by a hard link, and parsed and decrypted under its new name. Its
private recovery link remains until source cleanup is complete. Before deleting
any source inode, dotenc moves every source into a private same-parent
quarantine, verifies its identity, content, and permissions, and re-verifies all
destinations. Before removing each destination recovery link, dotenc proves the
live path still names the verified inode or restores that inode exclusively. A
live source path recreated concurrently is never overwritten or deleted by
cleanup.

For `--all-layers`, all destinations are verified before source cleanup starts,
but multiple filesystem operations cannot be atomic across directories. A
write or verification failure keeps every source and attempts to remove any
destinations created by that invocation. If source cleanup fails partway, all
verified destinations remain, already removed sources stay removed, and the
remaining sources stay at their old or reported quarantine paths; the command
exits non-zero and lists the state. If an unexpected object blocks exclusive
restoration, or quarantine restoration cannot be proven, the affected
quarantine path is reported and every verified destination is retained as a
recovery copy. If a source vanishes
before quarantine, its unresolved path is reported and the verified destination
is kept. If an exclusive destination restore is blocked, its private recovery
path is kept and reported. Review `git diff`,
then either remove the remaining legacy sources to finish, or restore tracked
sources from Git and remove the new destinations to roll back. A failed
best-effort destination cleanup can leave both names and must be resolved before
retrying because the destination is never overwritten. Git cannot restore an
untracked source; after partial cleanup, its verified destination is the
remaining encrypted copy.
