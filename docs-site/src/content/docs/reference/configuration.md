---
title: "Configuration and environment variables"
description: "Configure identity, environment selection, and editor behavior."
---

## Editor

```bash
dotenc config editor
dotenc config editor "code --wait"
dotenc config editor --remove
```

`editor` is the only supported configuration key. The CLI also supports `EDITOR`
and `VISUAL`. Home configuration is protected by restrictive POSIX permissions;
Windows home-configuration persistence fails closed, so use `EDITOR` or `VISUAL`
there. See [editing environments](/docs/guides/environments/#editing-an-environment).

## Process environment

| Variable | Purpose |
| --- | --- |
| `DOTENC_PRIVATE_KEY_BASE64` | Base64-encoded private key for CI and automation; preferred bootstrap input. |
| `DOTENC_PRIVATE_KEY` | Legacy raw private key input; prefer the base64 form for new integrations. |
| `DOTENC_PRIVATE_KEY_PASSPHRASE` | Unlock a passphrase-protected bootstrap or filesystem key. |
| `DOTENC_ENV` | Default environment selection for `run` when `--env` is omitted. |
| `DOTENC_SKIP_UPDATE_CHECK` | Set to `1` to suppress CLI update checks. |
| `EDITOR`, `VISUAL` | Editor command fallback when a dotenc editor is not configured. |

The first four variables are removed before the wrapped command starts.
Decrypted `DOTENC_*` variables cannot override dotenc controls. Unsafe process
variables are rejected unless individually allowed; see [run command protections](/docs/guides/run/).

## JSON and exit codes

`env list --json` returns `{ "environments": [...] }`. Hidden encryption and
decryption commands use an `ok` result; see [agent editing](/docs/integrations/agents/).
Doctor has its own versioned report and exit contract: `0` for a completed scan
without errors, `1` for findings, and `2` for invalid or incomplete evidence.
Warnings cause failure only with `--strict`. See [diagnostics](/docs/reference/doctor/).

Child command failures are propagated by `run` and `dev`. Do not interpret every
nonzero dotenc exit as a doctor finding: the contract depends on the command.
