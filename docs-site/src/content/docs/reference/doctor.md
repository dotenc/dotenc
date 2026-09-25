---
title: "Diagnose local setup"
description: "Diagnose local setup with dotenc, the Git-native encrypted environment CLI."
---

## Diagnose local setup

When a clone looks right but the local workflow does not, run:

```bash
dotenc doctor
```

The default scan follows the same effective scope as `dotenc dev`: project
root through the current directory. Use `--local-only` for only the current
directory, or `--all` for a bounded recursive audit from the project root.
`--profile alice` diagnoses the `personal.alice` suffix explicitly; it is not a
public-key alias lookup and cannot be combined with `--all`.

No personal profiles is healthy. Several accessible personal profiles is also
healthy; doctor reports that `dotenc dev` will prompt in an interactive
terminal. Warnings remain exit `0` by default so normal developer flow stays
usable; add `--strict` when warnings should fail automation.

Doctor is read-only and offline. It does not repair files, fetch Git history,
invoke 1Password, open an authorization prompt, or decrypt environment
content. It checks bounded envelope metadata and matching wrapped data keys in
memory, zeroes unwrapped keys, and inspects plaintext `.env` filenames and Git
state without reading plaintext file contents.

Human output stays compact and copyable:

```text
✓ development          2 layers, data key decryptable.
! personal.alice       A tracked personal profile was deleted from the working tree.
  Paths: .env.personal.alice.enc
  Run: git -C . --literal-pathspecs restore -- .env.personal.alice.enc

0 errors · 1 warning · 4 checks passed
```

On Windows, recovery lines are labeled `Run (PowerShell)` and use PowerShell
literal quoting. JSON recovery commands remain shell-neutral argv arrays on
every platform.

Exit codes are stable:

- `0` — the scan completed without errors; warnings are allowed unless
  `--strict` is set.
- `1` — errors were found, or `--strict` promoted one or more warnings.
- `2` — the invocation was invalid or the scan/evidence could not complete.

Use `dotenc doctor --json` for one versioned JSON object. `schemaVersion: 1`
accompanies `command`, `complete`, `scope`, optional project metadata, typed
`findings`, passed checks, `summary`, and `exitCode`. Finding paths are
project-relative and recovery commands are argv arrays, not shell strings. The
report never includes plaintext variable names or values, plaintext file
contents, ciphertext, wrapped data keys, private-key material or paths, cached
provider IDs, or raw provider exceptions.

For a recovery finding, a missing or empty `commands` array means doctor could
not establish a safe command from current local evidence; it is not permission
to guess. A fresh `dotenc env create personal.<profile>` suggestion appears
only when complete, non-shallow local history finds no recoverable revision,
and the message states that the new environment starts empty and cannot
recover old values. Doctor never fetches history to change that conclusion.
