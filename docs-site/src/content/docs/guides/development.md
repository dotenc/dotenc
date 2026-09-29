---
title: "Development and personal profiles"
description: "Development and personal profiles with dotenc, the Git-native encrypted environment CLI."
---

## Run commands on an environment

For development, the `dev` command always loads the required shared
`development` environment and, when available, one accessible
`personal.<profile>` overlay:

```bash
dotenc dev <command> [...args]
```

Example:

```bash
dotenc dev node app.js
```

Personal profiles are discovered only along the effective ancestor chain (or
only in the current directory with `--local-only`). Access is tested by the
recipient fingerprint against your available private keys; `.dotenc/*.pub`
filenames are human-readable aliases and do not choose a namespaced
`personal.<profile>` profile.

- One accessible profile is selected automatically.
- Several accessible profiles prompt in an interactive terminal. In
  non-interactive use, pass `--profile <name>`.
- `--profile alice` means the `personal.alice` environment.
- No personal environment is a healthy state: `dev` runs with `development`
  only.
- A requested missing/inaccessible profile, or discovered profiles with no
  accessible candidate, warns and continues with `development` only. Add
  `--strict` to make that personal-profile failure fatal.
- `development` is always required, even without `--strict`.

```bash
dotenc dev --profile alice bun run start
dotenc dev --profile alice --strict bun run start
```

The `personal.*` namespace is a breaking replacement for legacy personal
environments named directly after a key alias. When no namespaced personal
profile is selected, `dotenc dev` may print a read-only warning about an
accessible environment that matches the former convention. The warning is only
a migration hint: `dev` never auto-loads or modifies the candidate, because an
unprefixed environment may be legitimate. This legacy hint requires the exact
`.dotenc/<name>.pub` alias to exist and validate, its fingerprint to be a
recipient in every effective `.env.<name>.enc` layer, and every layer to decrypt
and authenticate successfully. For example, this remains valid:

```bash
dotenc run -e alice bun run test
```

For existing personal environments, follow the [migration guide](/docs/guides/rename/).
