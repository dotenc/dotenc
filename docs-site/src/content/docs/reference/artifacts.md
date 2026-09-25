---
title: "Scan deployment artifacts"
description: "Scan deployment artifacts with dotenc, the Git-native encrypted environment CLI."
---

:::caution[Not in CLI 0.14.2]
This command is merged on `main` but is not included in the published CLI
`0.14.2`. The examples below describe the upcoming release. Check
`dotenc doctor artifacts --help` before using them.
:::

## Scan deployment artifacts

Before uploading a generated build or publish directory, scan it for likely
secret leaks:

```bash
dotenc doctor artifacts dist
```

The scan fails on plaintext `.env` files, private-key headers, and any active
dotenc bootstrap value found in a regular artifact file. Bootstrap variable
names alone are warnings because a runtime reference can be intentional.
Encrypted `.env.*.enc` files and `.env.example`, `.env.sample`, and
`.env.template` files are not treated as plaintext environments.

To compare an application secret without putting its value on the command
line, pass only its environment-variable name. The option is
repeatable:

```bash
dotenc doctor artifacts .vercel/output \
  --secret-name DATABASE_URL \
  --secret-name OPENAI_API_KEY \
  --strict
```

Each selected name must identify a value already present in the doctor process
environment whose UTF-8 representation is between 8 bytes and 1 MiB. The scan
compares literal values and common JSON/JavaScript string escapes, URL encoding,
base64/base64url, hexadecimal, and fully Unicode-escaped representations. Value
matches are errors; name-only matches are warnings. The same size bounds
apply to active dotenc bootstrap values so a value that cannot be compared
safely makes the scan incomplete instead of being silently skipped. Reports
contain only generic finding categories and artifact-relative paths—never the
selected names or values. Paths containing a matched name or value representation
are omitted. Use `--json` for the versioned machine-readable
report.

Gzip (`.gz` or gzip magic bytes) and Brotli (`.br`) assets are also inspected
in memory. Decompression is limited to 16 MiB of compressed input and 32 MiB
of expanded output per file; both count toward the 512 MiB scan budget.
Recognized unsupported archives (including ZIP and tar), nested compression,
malformed compressed files, and exceeded limits return exit `2`. Scan an
unpacked build directory before packaging; the command never extracts files.

Run after the build has finished. This is a finite pattern check, not proof
that a build contains no secrets: arbitrary string splitting, mixed/nested
encodings, encryption, unknown container formats, and transformations outside
the supported representations still need review. It does not decrypt dotenc
environments; selected application values must already be available to the
scanner. At most 128 names and 16 MiB of total search patterns are supported.

The scanner reads regular files through bounded, no-follow file handles. It
does not follow symbolic links, and it exits `2` instead of claiming success
when an entry is unsafe, changes during inspection, cannot be read, or exceeds
a file, directory, entry, or byte limit. Exit `1` means a high-confidence leak
was found, or `--strict` promoted a warning; exit `0` means the bounded scan
completed without errors.
