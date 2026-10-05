# Weekly security review

Run every Monday at 09:00 America/Sao_Paulo. The Codex automation is
`weekly-dotenc-security-review`, attached to the security-review task.

## Scope and evidence

1. Read repository instructions and the latest report in `reviews/`. Record the
   review date/time zone, local branch/SHA, dirty paths, upstream main SHA, and
   published CLI version/gitHead. Preserve unrelated changes. Compare upstream
   through Git objects or an isolated checkout; never reset the active worktree.
2. Inventory all manifests and lockfiles. The root workspace covers `cli/`,
   `website/`, and `docs-site/` when present in the audited revision; `vscode-extension/` and `scripts/readme-demos/` have independent
   lockfiles. Include checked-in action bundles, runtime pins, container bases,
   installers, publisher tools, and newly added packages.
3. Run `bun audit --json` at each lockfile root and `bun audit --prod --json` at
   the repository root. Use `bun why <package>` separately for each finding and
   record its resolved version and dependency path. Inspect transitive overrides
   explicitly: an empty `bun outdated` result can omit an overridden runtime
   such as Electron. Audit commands send package
   names and versions to the registry; never send environment values or keys.
4. Check primary-source GitHub advisories, upstream releases and CVE records.
   Confirm affected ranges, patched versions, withdrawal status and publication
   dates. Deduplicate GHSA/CVE aliases and repeated hits across lockfiles. Keep
   upstream severity separate from demonstrated dotenc exposure. A clean npm
   audit does not cover the runtime, OS packages, bundled browser engines, or
   undisclosed vulnerabilities.
5. Give Bun specific attention: compare the installed version, `packageManager`,
   CLI test guard, workflow pins, Dockerfiles, demo tooling and the runtime
   embedded in standalone releases. Review security fixes and breaking changes
   after the pinned version. A Bun release overview may include older fixes;
   establish introduction/fix versions before attributing a CVE to the pin.
   Upgrading a developer's Bun does not repair already distributed binaries.
   When a fix is merged but unreleased, verify a checksum-matched released
   artifact with synthetic input before marking installed-user exposure fixed.
   Also check Node's bundled OpenSSL/Undici, Electron/Chromium, cryptographic
   dependencies, build tools and container distributions. Inventory published
   image packages and compare vendor security databases, including backports;
   never infer vulnerability solely from an upstream version number.
   Recheck previously patched libraries against newly published advisories;
   an earlier remediation does not cover later disclosures. Compare every
   installed OS source package, then narrow source-level hits to installed
   binaries/modules and reachable features. A lagging vendor security JSON
   feed may require the package commit/changelog plus signed repository indexes.
6. Review encryption/AAD, key parsing and minimum sizes, access revocation,
   plaintext/key lifetime, temp-file cleanup on errors, permissions, symlinks,
   bounded parsing, path validation, subprocess arguments/environment, provider
   redaction, extension Workspace Trust and machine-scoped settings, installers,
   Actions event trust, immutable dependencies and release provenance. Compare
   README and SECURITY claims with actual behavior. Identify local-only work.
7. Reproduce suspected bugs using generated keys, synthetic values and private
   temporary directories. Do not read real private keys or print real secrets.
   For cleanup bugs, use a real child process rather than mocking `process.exit`.
   Remove synthetic plaintext/key artifacts after recording redacted evidence.
8. Run relevant existing tests, lint and typecheck. For a full baseline use CLI,
   extension, website, diff-action, publisher and demo tests; verify the committed
   action bundle. Run Docker E2E when available. Record skips, unavailable tools,
   platforms not exercised and exact audit failures; never call those passes.
   If host stalls cause timeouts, retain the initial failure logs and report
   a bounded rerun at the unchanged revision separately; do not silently discard
   failures or change timeouts just to obtain a pass.
   For a local documentation-site branch, also run its own AGENTS.md checks in
   isolation and distinguish that result from main and public deployment.

## Commands

Run commands from their stated directory. Do not install or upgrade dependencies
in the active checkout just to make an audit pass.

| Directory | Commands |
| --- | --- |
| Repository root | `bun audit --json`; `bun audit --prod --json`; `bun outdated --recursive`; `bun run lint`; `bun run typecheck`; `bun run actions:test-diff`; `bun run actions:check-diff-bundle`; `bun run packages:test-publisher` |
| `cli/` | `bun run test`; `bun run test:e2e` |
| `vscode-extension/` | `bun audit --json`; `bun outdated`; `bun run test` |
| `website/` | `bun run test` |
| `docs-site/` (when present) | Root `bun run docs:check`; `bun run docs:test`; `bun run --cwd docs-site validate:cli`; `bun run site:build`; `bun run --cwd docs-site validate:links` |
| `scripts/readme-demos/` | `bun audit --json`; `bun outdated`; `bun run test` |

## Deliverable and boundaries

Save `reviews/YYYY-MM-DD.md` with a clear verdict, severity and remediation
priority, file/line evidence, resolved/fixed versions, primary-source links,
test results, remaining coverage gaps and changes since the previous review.
Keep safe machine-readable dependency evidence beside the report. Report both
new findings and whether earlier findings remain unresolved.

Ivan authorized end-to-end security maintenance on October 5, 2026. Each weekly
run must remediate available applicable security patches, obtain an independent
security review through the `grok` CLI, and ship and verify the fixes through the
normal protected release flow. Do not stop at an audit report or ask again for
routine scoped remediation/release permission.

1. Use an isolated checkout and preserve unrelated dirty work. Patch every
   affected lock scope and runtime/image pin; retain explicit residual findings
   where vendors have no applicable fix. Match application mitigations to demonstrated
   exposure; do not block normal workflows solely for a vulnerable version string.
   Runtime notices must distinguish vendor backports and npm's linked Node/OpenSSL
   from a possibly unrelated system openssl executable. Reassess new vendor disclosures even
   when a component was patched in the previous release.
2. Add meaningful regression checks, run required tests/builds/audits, and ask
   Grok to independently review the concrete diff and security trade-offs.
   Keep its model/session, reviewed revision and findings in local evidence.
   Address actionable findings and re-review substantive changes.
3. Bump affected package versions appropriately (patch for maintenance unless
   a different bump is required). Synchronize exact setup-action defaults.
   Open a non-draft PR, resolve human/bot feedback, and merge only the final
   reviewed head with required checks satisfied. Never bypass branch protection.
4. Use existing release channels. Verify the merged SHA, npm gitHead/integrity,
   release tag and checksums, embedded runtime, synthetic security behavior,
   both-architecture image packages/labels, and applicable signed repositories
   and fresh installs. A merged fix or available vendor package is not proof
   of a shipped fix. Recover failed publication through the existing workflow.
5. Record unavailable fixes, blocked review/CI/credentials or failed artifact
   verification accurately and notify Ivan with the concrete next action.
   Never invent a pass, silently waive an advisory, or weaken security gates.
   Track unresolved Debian OpenSSH/OpenSSL issues in this weekly review, including
   the actual published OCI distribution and older Bookworm/npm installations.
   Ivan removed the separate daily checker on October 5; do not recreate it.
   Check vendor backports and package availability on both architectures. Consider
   a workaround only for an identified reachable attack surface; an informational
   npm notice neither patches the host nor protects an OCI image.

This authorization excludes unrelated features, host upgrades, destructive
changes, external contact and public vulnerability disclosure. Keep detailed
unfixed reports and review transcripts local. Notify Ivan of shipped versions,
verification, meaningful findings or blockers; stay quiet only when no changes,
fixes or actionable findings remain.

