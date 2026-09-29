---
title: "Offboard a teammate"
description: "Offboard a teammate with dotenc, the Git-native encrypted environment CLI."
---

## Offboarding a Team Member

Use `auth purge` to revoke a team member's key from every environment in the
current repository state and remove its public-key aliases in one operation:

```bash
dotenc auth purge <user> [--yes]
```

This command:
1. Resolves the named public-key alias to its fingerprint
2. Validates and pre-decrypts every affected environment before making changes
3. Revokes that fingerprint and re-encrypts each affected environment
4. Rescans the project and deletes all `.pub` aliases for that fingerprint only
   after complete verification

Unreadable environments, a zero-recipient result, a failed rewrite, or a failed
rescan make the command exit non-zero and retain the public key for a safe
retry. Some environments may already have been rewritten after a mid-operation
failure; the command never reports that state as successful.

This command does not rewrite Git history or erase existing clones. A holder of
the purged private key may still decrypt historical ciphertext that names that
key as a recipient.

After running `auth purge`, also:
- Remove the teammate's repository and organization access
- Rotate external secrets (database passwords, API tokens, etc.); this remains
  necessary because retained copies cannot be recalled
- Deploy updated configuration
- If policy requires removing historical ciphertext, rewrite or purge retained
  Git history and require fresh clones, while treating old clones, mirrors,
  backups, and other copies as still readable
