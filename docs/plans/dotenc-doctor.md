# `dotenc doctor` Plan

Status: **implemented in `@dotenc/cli` 0.14.0; repair mode deferred**
Target release: `@dotenc/cli` 0.14.0
Accepted direction: 2026-08-13

## Objective

Provide a read-only, offline diagnostic and recovery-advice command for cases
where repository state is valid but a developer's local dotenc workflow is
degraded. `doctor` complements `dev`; it does not become another initializer,
secret editor, or external control plane.

## Command Contract

```text
dotenc doctor
dotenc doctor --profile <profile>
dotenc doctor --local-only
dotenc doctor --all
dotenc doctor --json
dotenc doctor --strict
```

The default scope mirrors `dotenc dev`: project root through the current
directory. `--all` performs a recursive repository audit using the standard
ignored-directory rules.

## Semantic Rules

- `development` is the required base environment.
- `personal.*` environments are optional overlays.
- Absence of all personal environments is healthy.
- `--profile alice` always means `personal.alice`.
- Profiles are discovered by filename namespace and access is decided by
  recipient/private-key fingerprint, never public-key alias.
- Multiple accessible profiles are healthy; report that `dev` will prompt.
- An accessible unprefixed environment that matches the former key-alias
  convention is only a possible legacy personal profile, never identity truth.
  Report it as migration advice without loading or changing it.
- A personal profile is reported missing only when there is current evidence:
  an explicit `--profile`, a tracked working-tree deletion, or an existing but
  unreadable/corrupt profile. Do not turn arbitrary Git history into warnings.
- Public-key aliases are display metadata only.

## Initial Checks

1. Resolve the project root and effective nesting chain.
2. Validate project public keys, algorithms, strength, duplicate fingerprints,
   and active private-key/provider fingerprint matches.
3. Validate effective `development` decryptability by unwrapping data keys
   without materializing plaintext.
4. Discover personal profiles and report accessible, ambiguous, missing,
   corrupt, or inaccessible states.
5. Diagnose possible legacy personal-profile candidates using the same bounded,
   fingerprint-correlated checks as `dev`; report collisions or partial
   `env rename` migrations without inferring that an arbitrary environment is
   personal.
6. Inspect Git status/history for exact recovery paths.
7. Inspect the local diff driver, textconv cache, attributes, plaintext `.env`
   hygiene, and local configuration permissions.
8. Under `--all`, validate every bounded envelope and report orphaned or stale
   recipient metadata.

## Severity and Exit Codes

| Condition | Severity |
| --- | --- |
| Project cannot be resolved or required `development` cannot load | error |
| Invalid required envelope or core key state | error |
| Missing/deleted/inaccessible personal overlay | warning |
| Missing clone-local integration or incomplete recovery evidence | warning |
| No personal profile, multiple usable profiles, duplicate display aliases | info |

- Exit `0`: scan completed without errors; warnings remain DX-compatible.
- Exit `1`: errors found, or warnings found with `--strict`.
- Exit `2`: invalid invocation or the scan could not complete.

## Output Contract

Human output is compact and actionable:

```text
✓ development          2 layers, data key decryptable.
! personal.alice       A tracked personal profile was deleted from the working tree.
  Paths: .env.personal.alice.enc
  Run: git -C . --literal-pathspecs restore -- .env.personal.alice.enc

0 errors · 1 warning · 4 checks passed
```

JSON output is stable, versioned, non-interactive, and contains typed finding
IDs, severity, project-relative paths, and commands represented as argv arrays.
It never contains plaintext, environment variable names or values, encrypted
payloads, wrapped keys, private-key material/paths, or raw provider exceptions.

## Recovery Guidance

- Uncommitted tracked deletion: `git restore -- <path>`.
- Committed deletion requested by `--profile`: find the latest local revision
  containing that exact path and suggest
  `git restore --source=<commit> -- <path>`.
- Shallow or absent local history: explain that local recovery is unavailable;
  never fetch automatically.
- Intentional fresh start: suggest `dotenc env create personal.<profile>` and
  state explicitly that it creates an empty environment and cannot recover old
  values.
- Accessible legacy candidate: suggest
  `dotenc env rename <source> personal.<profile>` and add `--all-layers` when
  any source layer is outside the current directory (including a single
  ancestor-only source). `doctor` never runs it.
- Partial cryptographic rename: report the remaining source and verified
  destination paths, then suggest completing cleanup or restoring tracked
  sources from Git before removing the destinations.
- Access mismatch: suggest the appropriate grant workflow without applying it.

## Repair Boundary

The 0.14.0 release is read-only and has no `--fix`.

A later `--fix` may repair deterministic clone-local configuration after
confirmation, such as the Git diff driver and disabled textconv cache. It must
never automatically choose a historical revision, create/delete/re-encrypt an
environment, grant/revoke/rotate/purge access, edit `.pub` files, modify the Git
index, create commits, fetch, or delete plaintext files.

## Implemented Shape

- Uses a typed, side-effect-free diagnostic engine rather than invoking
  commands that log or call `process.exit`.
- Shares bounded envelope parsing plus fingerprint-based personal-profile and
  possible-legacy discovery with `dotenc dev` so selection and advisory
  semantics cannot drift.
- Doctor candidate discovery unwraps only data keys and never materializes
  plaintext; normal `dev` discovery still authenticates encrypted content.
- Keeps provider failures typed as inconclusive where access cannot be tested;
  non-interactive execution never prompts or fabricates a result.

## Delivery Record

1. The bounded CLI envelope parser and personal-profile discovery foundations
   were completed for 0.13.0. The existing 0.13.0 `dev` helper proves access by
   decrypting content and may use configured key providers; 0.14.0 added the
   non-prompting, data-key-only diagnostic mode required by doctor's offline
   contract.
2. Fingerprint-based `dev` selection and soft personal-overlay behavior.
   Diagnostic-only legacy warnings and the explicit cryptographic `env rename`
   recovery path are also completed as 0.13.0 prerequisites.
3. Read-only doctor with human and JSON output shipped in 0.14.0.
4. Git-aware recovery evidence and `--all` repository checks shipped in 0.14.0.
5. A narrowly scoped `--fix` remains deferred until the read-only contract has
   operating evidence.
