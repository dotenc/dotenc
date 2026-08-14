# Security Audit Remediation Plan

Status: **implemented; validation complete**
Audit baseline: `@dotenc/cli` 0.12.3 and VS Code extension 0.6.1
Target releases: `@dotenc/cli` 0.13.0 and VS Code extension 0.6.2
Accepted: 2026-08-13
Completed: 2026-08-13
Updated: 2026-08-14

## Objective

Bring the implementation and `SECURITY.md` back into alignment after the
white-box audit of the CLI, VS Code extension, GitHub Actions, installers, and
documented trust model. Preserve dotenc's repository-owned, dependency-light
architecture while preventing encrypted environment data from becoming an
implicit process-execution or local-tooling control plane.

## Accepted Product and Threat-Model Decisions

- Git writers are trusted to create and replace repository state. Envelope
  signatures are therefore not part of this remediation.
- AES-GCM authenticates ciphertext relative to the envelope's data key; it does
  not establish the author of a replacement envelope. Git permissions, review,
  and history provide authorship and change integrity.
- No new external service or out-of-repository authority is introduced.
- `dotenc.autoViewDecrypted` remains `true` for developer experience. Workspace
  trust, machine-scoped settings, and accurate plaintext-lifecycle disclosure
  contain the associated risk.
- Personal development environments use the reserved `personal.<profile>`
  namespace. Public-key aliases are display metadata only and never select an
  environment.
- The namespace cutoff is immediate: `dev` never falls back to or mutates an
  unprefixed possible legacy profile. It may emit a read-only migration hint;
  legitimate names remain explicitly loadable with `dotenc run -e <name>`.
- Legacy migration uses the explicit, durable
  `dotenc env rename <source> personal.<profile>` operation. It is never part of
  launching an application through `dev`.
- `dotenc dev` treats personal environments as optional overlays. A personal
  failure warns and continues with `development`; `--strict` converts it to a
  failure.
- Monorepo root-to-leaf overlay precedence remains intentional.

## Finding Disposition

| Finding | Disposition |
| --- | --- |
| H1 envelope authenticity | Reclassify as documented trust boundary; no signature feature |
| H2 process environment injection | Fix now; block process-control variables before spawn |
| H3 workspace-controlled VS Code executable | Fix now; machine scope and Workspace Trust gates |
| M1 v1 create/init output | Fix now; write v2 with environment-name AAD |
| M2 bootstrap/control environment leakage | Fix now; reserve `DOTENC_*` and strip after merge |
| M3 key alias selects environment | Fix now; fingerprint-based `personal.*` discovery |
| M4 Git textconv safety | Fix now; local cache off and narrow attributes |
| M5 passphrase fallback temporaries | Harden now; private modes and best-effort zeroing |
| M6 purge partial success | Fix now; fingerprint preflight, fail closed, retain key on failure |
| L1 RSA validation | Fix now; strict public input and `modulusLength >= 2048` on use |
| L2 Ed25519 PKCS#8 extraction | Hardening; replace positional extraction with DER parsing |
| L3 unbounded envelope input | Fix now; bounded, strict CLI parsing |
| L4 editor denylist | Correct guarantees and validate explicit configuration; no shell-injection claim |
| L5 hygiene | Apply low-risk permission, installer, version-pinning, and Windows-launch hardening where compatibility is demonstrable |
| `autoViewDecrypted` default | Accepted product behavior; harden scope/trust and document backups |
| nesting precedence | Accepted behavior; keep documented rightmost/deeper-wins semantics |

## Implementation Workstreams

### 1. Child-process containment

- Reserve all decrypted names beginning with `DOTENC_`.
- Strip bootstrap private keys, passphrase, and `DOTENC_ENV` after merging so an
  encrypted file cannot reintroduce them.
- Block high-risk loader/runtime variables and prefixes by default, including
  `PATH`, `PATHEXT`, `ComSpec`, `NODE_OPTIONS`, `NODE_PATH`, `BASH_ENV`, `ENV`,
  `LD_*`, `DYLD_*`, `PYTHONPATH`, `PYTHONHOME`, `PERL5OPT`, `PERLLIB`,
  `RUBYOPT`, `RUBYLIB`, `JAVA_TOOL_OPTIONS`, and `_JAVA_OPTIONS`.
- Fail before spawning and report names only, never values.
- Provide an explicit, repeatable per-name override for exceptional workflows.
- Preserve GitHub Actions control inputs inherited from the runner while
  rejecting any decrypted `DOTENC_*` or GitHub file-command collision before
  the environment merge.

Acceptance: synthetic loader variables never execute payloads; decrypted
`DOTENC_*` never reaches the child; the four private/bootstrap `DOTENC_*`
variables are stripped regardless of source; other runner-owned action controls
remain available; an override releases only the named non-reserved variable.

### 2. Development-profile selection

- Discover `.env.personal.*.enc` only in the effective `dev` ancestor chain.
- Match candidates to available private keys by recipient fingerprint, not
  `.pub` basename.
- `--profile alice` always refers to `personal.alice`.
- Automatically select one accessible profile; prompt when several are
  accessible in a TTY; require `--profile` in non-interactive ambiguity.
- With no accessible profile, run `development` only.
- Warn and continue when an explicit personal profile is missing or cannot be
  loaded; fail under `--strict`.
- New initialization creates `personal.<name>` directly. Legacy profile
  migration uses `dotenc env rename <source> personal.<profile>` because v2 AAD
  prevents a filesystem rename.
- Keep possible-legacy detection advisory and read-only. Never auto-load,
  rename, or delete a candidate; an unprefixed file may be an intentional
  environment used by `dotenc run`.
- Rename only the current-directory layer by default. `--all-layers` targets
  the effective root-to-current-directory chain, not unrelated sibling trees.
- Require confirmation in a TTY and `--yes` in non-interactive use. Preserve
  recipient entries exactly, create every destination exclusively as v2 with
  destination-name AAD, and verify all destinations before source cleanup. Keep
  each verified destination inode anchored by a private same-parent hard link
  until source cleanup and final live-path verification are complete.
- Report rollback and cleanup state precisely. Destination setup failure keeps
  every source and attempts to remove created destinations. Multi-directory
  source deletion is not atomic: partial cleanup leaves all verified
  destinations, any already removed sources absent, and remaining sources at
  their original or reported quarantine paths. If a source vanishes before
  quarantine, retain the verified destination and report the unresolved path.

Acceptance: renaming or duplicating a `.pub` alias cannot change the selected
profile or load `production`; multiple matching keys for one profile yield one
choice. `dev` never auto-loads or mutates an unprefixed candidate. A successful
rename preserves the exact recipient set, proves the destination under its new
AAD before deleting the source, and cannot overwrite an existing destination.
An `--all-layers` partial cleanup exits non-zero and reports which sources were
removed and which remain while retaining every verified destination.

### 3. VS Code extension

- Keep auto-view enabled by default but make it machine-scoped.
- Make the CLI executable setting machine-scoped and defensively ignore
  workspace/folder configuration.
- Declare untrusted workspaces unsupported and gate every process/decryption
  path on `workspace.isTrusted`.
- Preserve trusted automatic redirect for an active encrypted editor.
- Remove unconditional version/update process execution from ordinary startup;
  perform it lazily on first dotenc use and outside a workspace-controlled cwd.
- Document plaintext in editor memory and possible hot-exit backup persistence;
  do not claim the custom URI participates in Local History.

### 4. Envelope and key handling

- Create v2 envelopes with environment-name AAD.
- Bound envelope bytes, recipients, strings, and decoded buffers before costly
  parsing/decryption; accept only legacy v1/absent and v2.
- Reject ambiguous duplicate JSON members, extra fields, non-canonical base64,
  and invalid recipient metadata using a shared parser across CLI
  environment-file readers. The diff action keeps its separately bounded batch
  parser.
- Accept only canonical SPKI public PEM files for new wrapping; reject private
  PEM material in `.pub` files.
- Enforce RSA modulus length on every wrapping path. Legacy weak keys may be
  considered only for decrypt-and-migrate if support can remain fail-closed.
- Parse the Ed25519 PKCS#8 private-key OCTET STRING rather than taking the last
  32 DER bytes.
- Harden passphrase-unlock temporaries and global configuration permissions.

### 5. Git and offboarding correctness

- Write clone-local `diff.dotenc.cachetextconv=false`.
- Scope `.gitattributes` to `.env.*.enc` and migrate only dotenc's exact legacy
  marker without disturbing user attributes.
- Avoid a workspace-controlled textconv executable where a stable installed
  invocation can be represented portably; otherwise document the machine PATH
  trust explicitly.
- Resolve purge targets by fingerprint, preflight every environment, rotate all
  affected envelopes, rescan, and delete the public key only after complete
  success. Partial work must return non-zero and remain safely retryable.

### 6. Documentation and compatibility

- Update `SECURITY.md`, README, extension README, Actions documentation, and
  migration guidance with the implemented behavior.
- Preserve legacy v1 reads, but write only v2.
- Treat the personal namespace transition as a breaking change and provide an
  explicit `env rename` migration workflow; never guess that an arbitrary
  legacy environment was personal, and keep `run -e <legacy-name>` available
  for environments whose unprefixed name is intentional.
- Keep diagnostics static and secret-free.

## Validation Gates

- CLI: lint, typecheck, isolated unit tests, build, coverage at least 90%, JS
  entrypoint smoke, and Docker E2E for `run`/`dev`/child-process changes.
- VS Code extension: unit tests, typecheck, and host integration tests when the
  environment supports them.
- Cross-platform security tests for environment-name casing and process loader
  variables, with Windows behavior exercised in CI when local execution is not
  possible.
- Inspect the final diff for secret fixtures, unrelated changes, documentation
  drift, and exact recovery guidance.

## Completion Record

- Root lint passed across 255 files; CLI, VS Code extension, and diff-action
  typechecks passed.
- CLI build and JS entrypoint smokes passed at version 0.13.0. All 669 isolated
  unit tests passed. CLI line coverage is 93.25%.
- Docker E2E passed with 139 tests, one intentionally skipped parent-TTY test,
  and no failures. The suite includes a real `BASH_ENV` payload that is blocked
  before spawn and executes only under an exact explicit override.
- All 23 VS Code unit tests and both host integration tests passed. Extension
  line coverage is 95.20%, and package-content inspection passed.
- Website build and all 25 website/installer tests passed, including direct
  HTTP rejection for both downloaders and the no-redirect `wget` bootstrap case.
- Combined line coverage is 93.30%. `git diff --check` and a changed-content
  scan for private-key/token fixtures passed.

## Explicit Deferrals and Limitations

If Git writers ever leave the trust boundary, authenticity needs an independent
anchor that the same change cannot replace: locally pinned TOFU state, verified
Git signing policy, or another out-of-band root. Only then should a canonical
signed envelope format, signer rotation, and rollback protection be designed.
Adding a signature and verification key solely inside mutable repository state
would not provide that guarantee.

- The skill installer now invokes the exact `skills@1.5.22` runner through Bun
  and consumes the separately maintained `dotenc/skills` source through a
  full-commit GitHub archive URL. Updating either input remains an explicit
  release-maintenance task.
- Windows-only `shell: true` compatibility remains for fixed-argv npm/skill
  launcher paths. No decrypted or repository-controlled string is assembled
  into those commands; replacing the compatibility path requires Windows-host
  validation.
- Git textconv still resolves `dotenc` from the developer machine's `PATH`.
  Clone-local plaintext caching is disabled, and machine executable resolution
  is documented as part of the trusted-machine boundary.
- Best-effort overwrite reduces straightforward recovery of temporary key
  bytes but cannot guarantee physical erasure on copy-on-write filesystems,
  snapshots, SSDs, or other remapped storage.
- `dotenc doctor` remains a separate planned command. Its bounded parser and
  `dev` discovery foundations are complete, but a non-prompting, data-key-only
  diagnostic adapter, the command itself, and any repair mode remain pending.
