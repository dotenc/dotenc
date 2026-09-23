# Artifact doctor implementation plan

Status: implemented; not released.
Compared with the provider-helper roadmap on 2026-09-22.

## Purpose and scope

Implement `dotenc doctor artifacts <directory>` as the reusable pre-upload
check described in [the provider roadmap](../PROVIDER_HELPERS_ROADMAP.md#artifact-doctor).
This is a content-reading command separate from the repository/data-key-only
[`dotenc doctor` contract](./dotenc-doctor.md). It works outside a dotenc project,
does not decrypt environments, fetch, execute build output, repair files, or
contact providers. Provider deployment wrappers remain separate roadmap work.

## Plan comparison and corrections

| Roadmap requirement | Initial local implementation | Updated acceptance |
| --- | --- | --- |
| Plaintext environment files | Filename checks with template/encrypted exclusions | Also flag `.env.gz` and `.env.br`; exclusions only suppress filename checks, not content scanning |
| Private-key material in builds | OpenSSH and PEM header matching | Preserve header checks in ordinary and decompressed assets |
| Dotenc bootstrap names | Names and active literal values | Also compare supported representations of active values |
| Explicit application allowlist | Repeatable `--secret-name`, literal values | Keep explicit selection; add finite common representations |
| Conservative results | Errors, warnings, strict mode, exits 0/1/2 | Unsupported recognized containers and malformed compressed data must not pass |
| No secret output | Generic findings, relative paths | Omit paths containing selected/bootstrap names or supported value representations; sanitize CLI parser failures |
| Bounded read-only scan | Chunked files and traversal counters | Bound directory enumeration before collection, total pattern memory, compressed input, and expanded bytes |
| Reproducible verification | Helper and mocked command tests | Add real CLI subprocess tests and compressed/encoded/redaction/limit fixtures |

## Command and result contract

```sh
dotenc doctor artifacts dist
dotenc doctor artifacts .vercel/output --secret-name DATABASE_URL --strict --json
```

Names appear in argv; values never need to. Selected values must already exist
in the scanner's environment and encode to 8 bytes–1 MiB. At most 128 distinct
names may be selected. Bootstrap values follow the same size bounds. Empty or
missing selected values and exceeded pattern budgets are invalid invocations.

The scanner compares literal values, JSON double-quoted string escaping,
JavaScript single-quote/backslash escaping, URI-component percent encoding
(upper/lowercase escapes), padded/unpadded base64, base64url, lower/uppercase
hex, and fully `\uXXXX`-escaped strings (upper/lowercase hex). It does not
recursively combine these transformations. Names and private-key headers are
literal patterns. Matches retain generic finding IDs; no matched bytes,
selected names, values, or absolute paths appear in reports. Sensitive relative
paths are omitted while finding counts remain. JSON schema version is 1.

- `0`: bounded scan completed without errors; warnings can exist.
- `1`: leak indicators, or warnings promoted by `--strict`.
- `2`: invalid invocation or incomplete inspection, including unsupported
  recognized containers. This takes precedence over any leak findings.

Both the human and JSON interfaces preserve these meanings. JSON/strict may
appear before or after `artifacts`; repository profile/scope options cannot be
combined with artifact inspection.

## Compression and resource boundaries

Inspect gzip identified by suffix or magic, and Brotli identified by `.br`.
Use bounded in-memory decompression; no temporary plaintext or archive
extraction. Scan both original and expanded bytes, count both toward the total,
and report paths to the outer artifact. Known ZIP/tar/7z/RAR/bzip2/xz/zstd
containers and nested compression are incomplete; scan unpacked output first.

| Resource | Default bound |
| --- | --- |
| Directories | 10,000 |
| Entries per directory | 25,000 |
| Total entries | 100,000 |
| Files | 50,000 |
| Raw file size | 128 MiB |
| Compressed input | 16 MiB per file |
| Expanded output | 32 MiB per file, also subject to remaining total |
| Total bytes, raw plus expanded | 512 MiB |
| Search patterns | 16 MiB total |
| Reported paths | 256 per finding category |

Reject symlinks and special files. Check opened files against the observed
identity and size and recheck metadata after reading. Best-effort zero owned
pattern/read/decompression buffers; generated strings and decoder internals
follow runtime memory management. Failed decoders conservatively consume their full
output allowance from the shared budget; successful byte counts remain separate
from that reservation.

## Deliberate remaining limits

Run after writers have stopped in a trusted build directory. This is not an
atomic filesystem snapshot or containment against an adversary replacing
ancestor directories concurrently. A successful result is not proof that no
secrets exist: unknown formats, unlabelled Brotli, arbitrary fragmentation,
partial/mixed/nested encodings, encryption, and arbitrary program evaluation
are outside the supported comparisons. Do not claim general deobfuscation or
universal archive coverage. No entropy heuristic or provider-secret discovery
is added; explicit allowlists remain the contract.

## Validation and release gate

Use synthetic values only. Verify detection across read boundaries; encoded
application/bootstrap values; clean/leaking gzip and Brotli; malformed streams,
expansion bombs and shared budgets; sensitive filenames and parser failures;
unsupported containers; symlinks; traversal limits; and real CLI JSON/strict
routing outside a repository. Existing doctor behavior must keep passing.

Before release: root lint, CLI typecheck, isolated CLI tests and coverage
(at least 90% lines), CLI build, and Node entrypoint help/version and diagnostic
smokes. Run the usual PR/review/release process separately when authorized;
implementation status alone does not establish publication.

## Validation record — 2026-09-22

- Bun 1.4.2 with a frozen root dependency install; root lint and CLI typecheck passed.
- Full isolated CLI coverage suite: 849 tests passed, zero failures; 91.70% line
  coverage overall, 100% lines/functions for the artifact command, and 95.64%
  lines / 100% functions for the artifact scanner.
- CLI build and Node entrypoint version/help passed. Compiled Node CLI smoke
  verified clean, gzip-leak, Brotli-leak, and unsupported-ZIP cases with the
  expected 0/1/2 exits, sanitized JSON, and no generated files. A separate Node
  smoke rejected gzip expansion above 32 MiB with exit `2`.
- This feature does not include a version bump or publication.

API reference: the [Node zlib documentation](https://nodejs.org/api/zlib.html)
defines `maxOutputLength` for bounded convenience-method decompression. Tests
exercise the bound on both supported compression formats in the pinned Bun
runtime; the built Node entrypoint is checked separately.
