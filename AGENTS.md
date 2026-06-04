# AGENTS.md

## Why (Project Purpose)

`dotenc` is a security-focused monorepo for encrypted `.env` workflows powered by SSH keys.

Agent work here should preserve:

- security guarantees (no real secrets or private keys in repo/test artifacts)
- CLI correctness and packaging behavior
- developer UX across CLI, VS Code extension, and docs

## What (Repo Map)

- `cli/` — Bun + TypeScript CLI published as `@dotenc/cli` (`dotenc` command)
- `vscode-extension/` — VS Code extension that depends on the installed `dotenc` CLI
- `website/` — marketing/docs website build
- `scripts/` — coverage merge/summary scripts used by root test coverage workflows
- `skills/dotenc/` — operational skill docs for agents/users consuming dotenc in other repos
- `docs/` — implementation references and deep dives (read only when relevant)

Notes:

- Root workspaces are `cli` and `website` only (`vscode-extension/` is managed separately).
- Package versions are independent (`cli/package.json`, `vscode-extension/package.json`, etc.).

## How (Working Rules)

- Use `bun` for installs, scripts, tests, and builds.
- Prefer scoped checks in the package you changed before running broader repo checks.
- Follow existing code patterns and let deterministic tools (Biome/tests/typecheck) catch style issues.
- Do not commit real secrets, private keys, or local `.env` files. Use fixtures and temp directories.
- Keep changes minimal and package-scoped unless the task explicitly spans multiple packages.
- Keep `SECURITY.md` in sync with the implementation. Update it whenever you change cryptographic algorithms, key handling, file permissions, input validation, command execution, or the installation flow.

CLI packaging gotcha (important):

- `cli/src/cli.ts` already has the shebang. `bun build` preserves it in `dist/cli.js`.
- Do not prepend another shebang in build scripts (Node will fail if the file ends up with two shebang lines).

Bun temp files:

- Bun may create `cli/*.bun-build` temp files during builds. They are ignored and should not be committed.

## Setup / Installs

- Root deps: `bun install`
- CLI deps: included via root workspace install (or `cd cli && bun install`)
- Website deps: included via root workspace install (or `cd website && bun install`)
- VS Code extension deps: `cd vscode-extension && bun install` (separate from root workspaces)

## Validation (Run What Matches Your Change)

Root (cross-cutting changes):

- `bun run lint`
- `bun run typecheck`

CLI (`cli/`):

- `bun run test` (uses a custom patched Bun binary — always use `bun run test`, never call `bun test` directly)
- `bun run typecheck`
- `bun run build`
- If touching CLI packaging/bin behavior:
  - `node dist/cli.js --help`
  - `node dist/cli.js --version`
- If touching standalone binary release flow (platform-specific):
  - `bun run build:binary:darwin-arm64` (on macOS arm64)
  - `./dist/dotenc-darwin-arm64 --help`
- E2E (Docker required, slower):
  - `bun run test:e2e`

VS Code extension (`vscode-extension/`):

- `bun run test`
- `bun run typecheck`
- `bun run test:integration` (heavier; only when extension integration behavior changes)
- Integration tests do not run in sandboxed environments; run `bun run test:integration` on the host machine.

Website (`website/`):

- `bun run build`
- `bun run dev` (manual verification)

Coverage (when requested):

- Root summary: `bun run test:coverage`
- Full (includes CLI e2e coverage): `bun run test:coverage:full`

## Pre-Commit Gate

Before committing any CLI changes, all of the following must pass:

- `bun run lint`  (root or `cd cli`)
- `bun run typecheck`  (from `cli/`)
- `bun run test`  (from `cli/`)
- `bun run test:e2e`  (Docker — run when touching run/dev or any child-process path)

Coverage:
- CLI line coverage must stay ≥ 90%: `bun run test:coverage` in `cli/`.
- Every new command file must be fully exercised by unit tests.

## Progressive Disclosure (Read Only If Relevant)

- `README.md` — product purpose, security model, install methods, user workflows
- `cli/README.md` — CLI-focused usage and distribution context
- `SECURITY.md` — full cryptographic design, threat model, key material handling, and vulnerability reporting
- `vscode-extension/README.md` — extension behavior, prerequisites, settings
- `skills/dotenc/SKILL.md` — operational dotenc workflows for agents/users consuming dotenc in other repos; do not follow this skill for dotenc development work — inspect and modify source code directly instead
- `scripts/coverage-summary.sh` and `scripts/merge-lcov.ts` — coverage aggregation details
- `docs/` — implementation references and deep dives (e.g. `docs/NESTING.md`)

## Release / Versioning Notes

- npm CLI releases use `cli/package.json` version (`@dotenc/cli`), not the root `package.json` version.
- Validate both JS entrypoint (`dist/cli.js`) and compiled binary when changing CLI build/packaging behavior.
