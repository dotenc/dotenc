# Hierarchical Nesting — Implementation Reference

## Status

Implemented (Phase 1 in v0.8.0, Phase 2 in v0.9.0, simplified in v0.9.x).

## Objective

Enable consistent dotenc usage in monorepos and subfolders with:
- Project discovery through `.dotenc` via ancestor lookup.
- Hierarchical environments per folder.
- Recursive merge by default in `dotenc run` and `dotenc dev`, with last-in
  wins.
- `--local-only` in `dotenc run` and `dotenc dev` to restrict merge and profile
  discovery to the current directory.
- Matching diagnostic scopes in `dotenc doctor` without loading plaintext.

## Terminology

- `invocationDir`: current execution directory (`process.cwd()`).
- `projectRoot`: first ancestor (including `invocationDir`) that contains `.dotenc`.
- `local scope`: only `invocationDir`.

## Implemented Behavior

### Root resolution

1. Resolve `invocationDir` as a canonical path.
2. Traverse parent directories up to `/`.
3. The first directory containing `.dotenc` is `projectRoot`.
4. If none is found, fail with project-not-initialized error.
5. All key operations use this `projectRoot`.

---

### `dotenc run`

- Accepts `-e env1,env2,...` or `DOTENC_ENV`.
- Default: loads `.env.<name>.enc` at every level from `projectRoot` down to `invocationDir`, merging in order (deeper overrides higher; rightmost `-e` env overrides earlier ones).
- `--local-only`: loads only from `invocationDir`, skipping all ancestor levels.
- Decrypted `DOTENC_*` and GitHub Actions control-file names are reserved.
  Loader, runtime, shell-startup, and executable-resolution names are blocked
  before spawn unless each exact name is allowed with repeatable
  `--allow-process-env <name>`.
- The initial bare executable is resolved against the original parent `PATH`.
  The child does not receive dotenc's private-key bootstrap variables,
  passphrase, or `DOTENC_ENV`.

### `dotenc dev`

- Always loads required `development` with the same root-to-leaf merge rules.
- Discovers `.env.personal.*.enc` only at levels in the effective ancestor
  chain. `--local-only` restricts both discovery and loading to `invocationDir`.
- Groups layers by logical environment and considers a profile accessible only
  when every discovered layer decrypts through an available recipient/private
  key fingerprint. `.pub` aliases do not select profiles.
- Selects one accessible profile automatically, prompts for several in a TTY,
  and requires `--profile <name>` for non-interactive ambiguity.
- `--profile alice` always means `personal.alice`.
- No personal file means `development` only. Missing or inaccessible personal
  profiles warn and continue; `--strict` makes that personal failure fatal.
  `development` failure is always fatal.
- Accepts the same repeatable `--allow-process-env <name>` override as `run`.

---

### `dotenc doctor`

- Default: diagnoses the effective project-root-to-`invocationDir` chain, the
  same nesting scope used by `dev`.
- `--local-only`: diagnoses only `invocationDir` and skips ancestor layers.
- `--all`: performs a bounded recursive audit from `projectRoot` using the
  standard ignored-directory rules. It cannot be combined with `--local-only`
  or `--profile`.
- `--profile alice` always requests the `personal.alice` suffix. Public-key
  aliases remain display metadata and never select a profile.
- No personal profile is healthy. Multiple accessible profiles are also
  healthy and are reported as information because interactive `dev` will
  prompt for a choice.
- Doctor is read-only and offline: it never fetches Git history, invokes a key
  provider, mutates project or local configuration, reads plaintext `.env`
  contents, or decrypts encrypted environment content. It validates bounded
  envelopes and unwraps matching data-key copies only.

---

### `dotenc key add|list|remove`

- Always resolves `projectRoot` via ancestor lookup.
- Always reads/writes at `<projectRoot>/.dotenc`.
- `key remove`: removes the `.pub` file only — no automatic revoke or rotate. Users should run `dotenc auth purge <name>` for full offboarding.

---

### `dotenc auth grant|revoke|purge`

- Always resolves `projectRoot` via ancestor lookup.
- `auth purge <publicKey>`: resolves the alias to a fingerprint, validates and
  pre-decrypts every recursively discovered `.env.*.enc` file, revokes that
  fingerprint, rescans the tree, and removes all matching `.pub` aliases only
  after complete success. It fails closed and retains the key on unreadable,
  zero-recipient, rewrite, or verification failure. Requires confirmation
  (`--yes` to skip).

---

### `dotenc env list`

- **Default (no flags)**: lists environments in `invocationDir` only — flat names, no folder labels.
- **`--all`**: recursively discovers all `.env.*.enc` files from `projectRoot` downward; displays as `name  (relPath)` where `relPath` is relative to `projectRoot`.
- **`--json`**: outputs `{ "environments": [{ "name", "dir", "filePath" }, ...] }` for either mode. Empty results produce `{ "environments": [] }`.

---

### `dotenc env create`

- Always creates the environment file in `invocationDir`.
- To create an environment in a specific directory, `cd` to that directory first.
- Resolves `.dotenc/` via ancestor lookup for key access.

---

### `dotenc env edit`

- Operates on the `.env.<name>.enc` file in `invocationDir` directly. No ancestor search.
- To edit a nested environment, `cd` to its directory first.
- Resolves `.dotenc/` via ancestor lookup (for key access during re-encryption).

---

### `dotenc env encrypt` / `dotenc env decrypt`

- Operate on the `.env.<name>.enc` file in `invocationDir`.
- `.dotenc/` is resolved via ancestor lookup, so both commands work correctly from any subdirectory.

---

### `dotenc env rotate` / `dotenc env delete`

- Operate on the `.env.<name>.enc` file in `invocationDir` directly. No ancestor search.
- To target a nested environment, `cd` to its directory first.
- Require confirmation for destructive operations; `--yes` to skip.

---

### `dotenc env rotate --all`

- Recursively discovers all `.env.*.enc` files from `projectRoot` and rotates their data keys.
- Prints a per-file success/failure summary. Requires confirmation; `--yes` to skip.

---

## Key helpers

| Helper | Purpose |
|--------|---------|
| `resolveProjectRoot(dir, existsSync)` | Walks ancestors to find `.dotenc/` |
| `buildAncestorChain(root, leaf)` | Returns `[root, …intermediates, leaf]` — used by `run`/`dev` |
| `findEnvironmentsRecursive(rootDir)` | DFS scan for `.env.*.enc` files, skipping `node_modules`, `.git`, `dist`, etc. |

## Design principles

- **`cd` first**: `edit`, `encrypt`, and `decrypt` do not search ancestor directories for `.enc` files. The developer navigates to the target directory before running the command.
- **`.dotenc/` always resolved upward**: every command that needs public keys walks up to find the project root — no command requires being at the root.
- **`cd` first for writes**: `create`, `rotate`, and `delete` always operate on `invocationDir`. Navigate to the target directory before running the command. No flags or interactive prompts for path disambiguation.
- **`env list` is local by default**: discovering all environments across a large monorepo is an opt-in action (`--all`), keeping the common case fast and noise-free.
- **Personal profiles are fingerprint-selected**: filenames reserve the
  `personal.<profile>` namespace, while `.pub` aliases remain display-only.
- **Diagnostics mirror runtime scope without becoming runtime**: `doctor`
  follows effective/local/recursive nesting rules but never materializes the
  merged plaintext environment.
