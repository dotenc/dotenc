# `dotenc doctor` Plan

Status: **planned; not implemented**
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
5. Inspect Git status/history for exact recovery paths.
6. Inspect the local diff driver, textconv cache, attributes, plaintext `.env`
   hygiene, and local configuration permissions.
7. Under `--all`, validate every bounded envelope and report orphaned or stale
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
✓ development          2 layers, decryptable
! personal.alice       deleted from the working tree
  Restore: git restore -- .env.personal.alice.enc

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
- Access mismatch: suggest the appropriate grant workflow without applying it.

## Repair Boundary

The first release is read-only and has no `--fix`.

A later `--fix` may repair deterministic clone-local configuration after
confirmation, such as the Git diff driver and disabled textconv cache. It must
never automatically choose a historical revision, create/delete/re-encrypt an
environment, grant/revoke/rotate/purge access, edit `.pub` files, modify the Git
index, create commits, fetch, or delete plaintext files.

## Implementation Shape

- Extract a typed, side-effect-free diagnostic engine rather than invoking
  commands that log or call `process.exit`.
- Share bounded envelope parsing and fingerprint-based personal-profile
  discovery with `dotenc dev` so selection semantics cannot drift.
- Candidate discovery may unwrap a data key but should not materialize
  plaintext unnecessarily.
- Keep provider failures typed as inconclusive where access cannot be tested;
  non-interactive execution never prompts or fabricates a result.

## Delivery Phases

1. Reuse the completed bounded CLI envelope parser and adapt personal-profile
   discovery for doctor. The existing 0.13.0 `dev` helper proves access by
   decrypting content and may use configured key providers; doctor still needs
   a non-prompting, data-key-only diagnostic mode compatible with its offline
   contract.
2. Fingerprint-based `dev` selection and soft personal-overlay behavior.
   **Completed as a 0.13.0 prerequisite.**
3. Read-only doctor with human and JSON output.
4. Git-aware recovery evidence and `--all` repository checks.
5. Revisit a narrowly scoped `--fix` only after the read-only contract is
   stable.
