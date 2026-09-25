---
title: "Create and edit environments"
description: "Create and edit environments with dotenc, the Git-native encrypted environment CLI."
---

## Creating a new environment

```bash
dotenc env create [environment]
```

This command creates a new encrypted environment file under the specified name (e.g., `.env.development.enc`). Your `personal.<profile>` environment is created automatically during `init`.
Environment names may contain letters, numbers, dots (`.`), hyphens (`-`), and underscores (`_`).

New and rewritten environments use format version 2, which binds the logical
environment name to the ciphertext. Existing version 1 envelopes remain
readable, but renaming a version 2 file requires decrypting and re-encrypting it
under the new name.

In a monorepo, `cd` to the target directory first, then run `dotenc env create`.
## Listing environments

```bash
dotenc env list
```

Lists encrypted environments in the current directory. Use `--all` to recursively list all environments across the project tree. Use `--json` for machine-readable output (`{ "environments": [...] }`).

## Editing an environment

```bash
dotenc env edit [environment]
```

Opens your system's default editor to modify the specified environment. To set a custom editor, use the `dotenc config editor` command. It will take precedence over your system's default editor. In a monorepo, `cd` to the directory containing the file before running `dotenc env edit`.

Example:

```bash
dotenc config editor vim
```

Currently supported `dotenc config` key: `editor`.
You can include editor arguments, for example: `dotenc config editor "code --wait"`.
The configured editor is trusted local input. Shell metacharacters are rejected
and the command is launched without a shell, but editor-specific arguments can
still enable editor-native behavior. On POSIX, dotenc enforces mode `0700` on
`~/.dotenc/` and `0600` on its `config.json` when reading or writing it. On
Windows, home-configuration persistence fails closed because the runtime cannot
safely prevent reparse-point replacement; use `EDITOR` or `VISUAL`, with
`notepad` as the platform fallback.
## Individual environment management

```bash
dotenc env delete [environment] [--yes]
```

Deletes an environment file in the current directory. In a monorepo, `cd` to the directory containing the file first.

```bash
dotenc env rotate [environment]
```

Rotates the data key for a single environment in the current directory. In a monorepo, `cd` to the directory containing the file first.

```bash
dotenc env rotate --all [--yes]
```

Rotates the data key for all environments in one step — recursively discovers and rotates every `.env.*.enc` file under the project tree. Useful for periodic key rotation or after a security event.
