# Zed integration requirements and implementation plan

Researched 2026-10-15. Status: proposal; no Zed extension, CLI change, or
editor prototype has been implemented or validated by this plan.

## Recommendation

Preserve the central VS Code experience: open an encrypted environment, edit
plaintext in the native editor, and save ciphertext through the CLI. Adapt
navigation and management to Zed rather than reproducing the VS Code sidebar.

That editing experience is currently blocked by missing public editor APIs.
The extension surfaces inspected do not expose virtual filesystem providers,
custom document read/write handlers, or sensitive-buffer lifecycle controls.
Running a process is possible; integrating its output into a securely managed
editable document is the missing part. This is an inference from the documented
extension features and the public Rust/WIT interfaces, not a tested prototype
or a promise about future Zed releases.

Proceed with a small task-based integration for supported CLI workflows and a
technical specification for native encrypted editing. Treat those as separate
deliverables. Task support alone does not satisfy the requested editing parity.

## Evidence and scope

Local inspection used checkout HEAD
`f2c34e362a1ad4696f1c5c13fe2492168a012196` plus its existing uncommitted changes.
The local manifests declare CLI `0.14.2` and VS Code extension `0.6.3`;
these are checkout versions, not verified published versions.

Relevant implementation:

- `vscode-extension/src/extension.js`: `DotencFileSystemProvider`, automatic
  redirection, CLI calls, workspace trust checks, rotation and deletion actions.
- `vscode-extension/src/EnvironmentsProvider.js` and `KeysProvider.js`:
  environment discovery across directories and public-key navigation.
- `vscode-extension/package.json`: machine-scoped CLI path and automatic-open
  settings, menus, commands and sidebar contributions.
- `cli/src/commands/env/decrypt.ts` and `encrypt.ts`: JSON/stdin contract.
- `cli/src/helpers/encryptEnvironment.ts`: current ciphertext write behavior.
- `cli/src/commands/env/edit.ts`: existing external-editor workflow, which uses
  a temporary plaintext file and encrypts after the editor exits.
- `cli/src/commands/env/list.ts`, `auth/list.ts`, `key/list.ts` and
  `cli/src/program.ts`: available management commands and output formats.
- `README.md` / `cli/README.md`, `vscode-extension/README.md`, `SECURITY.md`:
  current documentation and security boundaries. No public Zed support claim
  should be added until the corresponding deliverable is validated.

External evidence checked:

1. [Developing extensions](https://zed.dev/docs/extensions/developing-extensions):
   documented extension categories and Rust/WASM workflow.
2. [Published Extension trait](https://docs.rs/zed_extension_api/0.7.0/zed_extension_api/trait.Extension.html),
   [upstream Rust API](https://github.com/zed-industries/zed/blob/9663d059bcf948689323753012982791e5094ba5/crates/extension_api/src/extension_api.rs)
   and [upstream WIT](https://github.com/zed-industries/zed/blob/9663d059bcf948689323753012982791e5094ba5/crates/extension_api/wit/since_v0.8.0/extension.wit):
   no equivalent to VS Code's `registerFileSystemProvider`. The published crate
   checked was `0.7.0`; upstream's `0.8.0` manifest has `publish = false`.
   Upstream APIs must not be advertised as released capabilities.
3. [Tasks](https://zed.dev/docs/tasks): terminal commands, worktree/file context,
   global or project task definitions, and keybindings for task selection.
4. [Env language](https://zed.dev/docs/languages/env): native dotenv highlighting;
   an additional grammar is unnecessary for a future plaintext editor.
5. [Worktree trust](https://zed.dev/docs/worktree-trust) and
   [extension capabilities](https://zed.dev/docs/extensions/capabilities):
   execution boundaries to verify, without assuming parity with VS Code trust.
6. [Publishing prerequisites](https://zed.dev/docs/extensions/publishing/prerequisites):
   API misuse is restricted; slash-command and agent-server extension submissions
   are deprecated. MCP is not a replacement for document editing.
7. [Publishing guide](https://zed.dev/docs/extensions/publishing/publishing-guide):
   public Git submodules with a supported extension subdirectory path.
8. [Local File Transformations proposal](https://github.com/zed-industries/zed/issues/12042):
   related upstream discussion, not evidence of an available extension API.

Recheck these surfaces against the chosen stable Zed release before implementation.
No local Zed version or runtime behavior was inspected in this research.

## Requirements and adaptation matrix

P0 means required for encrypted editing; P1 means useful integration or polish.

| Capability | Existing VS Code behavior | Zed adaptation | Priority / feasibility |
| --- | --- | --- | --- |
| Open `.env.<name>.enc` as plaintext | Native editor through `dotenc:` filesystem | Virtual document with an explicit open action first; automatic interception later | P0; missing public document API |
| Save encrypted content | Filesystem write delegates to CLI stdin | Native save delegates to CLI; ordinary file writes never receive plaintext | P0; missing public save API |
| Keep plaintext out of integration-created files | Provider exchanges content in memory | No plaintext temp file, session snapshot, backup or recovery artifact | P0; lifecycle controls require investigation/support |
| Dotenv highlighting | Native language selection | Reuse Zed Env support on the plaintext document | P0; language support exists, document integration blocked |
| List environments and folders | Dedicated tree view | Project panel for ciphertext; task list for CLI discovery now; picker later | P1; tasks available, custom picker blocked |
| Inspect public keys/access | Keys tree; CLI JSON includes recipient names | Terminal metadata commands now; read-only document metadata later | P1; no new secrets endpoint needed |
| Inspect encrypted source | Raw-source action | Existing project/file navigation; future explicit toggle | P1; raw file already accessible |
| Run the app with secrets | CLI workflow outside the editor provider | Zed terminal/task invoking `dotenc dev` or `dotenc run` | P1; available, child output remains application-owned |
| Rotate, delete, rename, grant/revoke | Some actions are in the extension, others CLI-only | Deliberate CLI tasks/terminal actions; rename via `env rename` only | P1; defer destructive convenience actions from first task bundle |
| Missing CLI or access | Actionable failures and install/update prompts | Clear diagnostics and official installation link | P0 for editing; no automatic installation in first version |
| Multiple roots/nested environments | Paths grouped by directory; CLI cwd is environment directory | Identify a target by canonical directory plus environment name | P0; explicitly test same names in different folders |

Recipient annotations, status actions and the sidebar are not prerequisites for
the first native editor. Preserve content exactly rather than inserting a
synthetic header into the dotenv payload. The inspected VS Code decrypt adapter
currently returns only `content`, even though CLI JSON also includes
`grantedUsers`; do not copy README claims without verifying their implementation.

## Security and correctness acceptance contract

The native integration must meet all of these before accepting real secrets:

1. Cryptography, SSH key discovery and access control stay in the dotenc CLI.
   The Rust adapter must not reimplement envelope cryptography or copy keys into
   extension storage, settings, logs or its WASM working directory.
2. Plaintext crosses local pipes into a sensitive editor buffer. Never place it
   in command arguments, task variables, environment variables, shell history,
   output panes, MCP responses, slash commands, or a mounted plaintext file.
3. Establish sensitive-buffer behavior before decrypting: no persistent session
   state, undo snapshots, backups, crash recovery or indexing containing content.
   Inspect Zed's actual persistence behavior; an untitled buffer or autosave
   setting alone is not sufficient evidence.
4. Prevent implicit AI context, edit prediction, language-server, formatter and
   collaboration access to the sensitive document. If the editor cannot enforce
   a required restriction, encrypted editing remains unavailable. A global user
   setting is not equivalent to a verified buffer policy. Manual copying and
   the trusted editor process remain security boundaries.
5. Save, autosave, Save All, Save As, duplicate/split views and close/reopen must
   preserve the write boundary. A failed save retains modified content in memory
   and does not report success. No alternate-path plaintext export is provided
   by this integration. Generic editor commands need explicit interception or
   rejection where they could bypass that rule.
6. Resolve the executable from trusted user/machine configuration. Do not allow
   `.zed/settings.json`, project tasks, relative repository executables or a
   repository-controlled PATH entry to silently replace it. Use argv-based
   process calls, bounded output, cancellation and timeouts in the adapter.
7. Decryption and mutation must require an explicitly trusted target worktree.
   Verify this per host/root; global extension execution permissions alone do
   not establish project trust. Do not enable `trust_all_worktrees` as setup.
8. Preserve environment-name AAD and exact target identity. Validate paths,
   names, symlinks and directory boundaries; use the environment file's directory
   as cwd, not a guessed project root. Reject unsupported targets clearly.
9. Preserve content bytes supported by the UTF-8 protocol, including CRLF,
   trailing newline and empty content. Do not trim or silently format secrets.
10. Keep logs to operation/status codes and sanitized metadata. Tests use
    synthetic secrets and generated disposable keys, including crash tests.

This contract targets accidental persistence and unintended disclosure through
editor integrations. It does not claim protection against a compromised host,
malicious editor code, OS swap/core dumps, or guaranteed erasure of all plaintext
copies from managed memory. The host/editor trust boundary in `SECURITY.md`
continues to apply. VS Code's current provider is a behavioral reference, not
proof that every requirement above is already enforced there.

## Shared CLI prerequisite: safe concurrent writes

The current decrypt JSON response is `{ ok: true, content, grantedUsers }`.
Encrypt accepts plaintext on stdin and returns `{ ok: true }`. Neither exposes
a revision token or `--if-match`. The inspected encryption helper uses
`fs.writeFile` directly; it does not implement a locked atomic replacement.
These are confirmed local gaps, not features to assume from previous plans.

Before stable native editing, specify and implement a backward-compatible
contract shared by editor clients:

- Decrypt returns an opaque revision derived from the exact envelope snapshot
  that was decrypted, covering ciphertext and recipient/key metadata.
- Encrypt accepts an expected revision and returns the committed revision.
- Under a per-target lock, reread the envelope, compare the revision, encrypt,
  and atomically replace ciphertext using a same-directory temporary ciphertext
  file. Specify permissions, flush/durability requirements and Windows behavior.
- Return structured conflict/busy outcomes, proposed as `ENVIRONMENT_CHANGED`
  and `ENVIRONMENT_BUSY`. They do not exist in today's editor protocol.
- Coordinate all cooperating writers: edit, encrypt, rotate, access mutations,
  rename, delete and creation as applicable. Define lock ordering for multi-file
  operations; one new editor-only mutex would not protect existing CLI writers.
- A changed or removed file must never be recreated/overwritten silently by a
  stale editor. On conflict retain the buffer; allow an explicit reread/reload
  with discard confirmation. Do not implement automatic merge or force-save
  in the first version.
- Document the boundary for non-cooperating writers such as Git checkout or
  external tools. Advisory locks plus a revision comparison do not provide a
  filesystem-wide transaction against arbitrary external writes.

Existing consumers can retain the old protocol during migration, but new Zed
editing must require the new capability. Choose its minimum CLI version only
after release; the VS Code minimum of `0.9.0` does not imply these capabilities.

## Delivery sequence

### Stage 0 — settle feasibility before creating an extension scaffold

Record a capability checklist for the selected stable Zed release: virtual
documents, read/save hooks, sensitive persistence, trust, AI/collaboration
exclusion, subprocess stdin/cancellation, and error/modified-state handling.
The public API inspection in this plan already fails the document/save gate.

Prepare a minimal upstream API proposal around encrypted-document providers,
using synthetic content and dotenc as a use case. The related transformations
issue is a starting point for research. Contacting maintainers or opening an
issue/PR is a separate authorized action; this plan does not do that.

Exit criterion: a supported API path with a testable lifecycle, or a recorded
upstream dependency. Do not spend implementation effort on an empty Rust
extension that cannot deliver the core workflow.

### Stage 1 — useful Zed integration with existing CLI commands

Provide an opt-in guide and reviewed task templates, initially for local
worktrees. Candidate location: `integrations/zed/`, with user documentation in
`docs-site/src/content/docs/integrations/zed.md` once tested.

- Metadata tasks: `dotenc env list --all`, `dotenc key list`, and
  `dotenc auth list <environment>` for an explicitly selected target directory.
  These display names/access metadata, not decrypted values.
- Application tasks: examples of `dotenc dev <command>` and
  `dotenc run -e <environment> -- <command>`, with literal project-specific
  commands and environment names reviewed by the user.
- Set cwd intentionally, keep task concurrency disabled by default, and retain
  Zed's default `save: "none"`. Do not interpolate `ZED_SELECTED_TEXT` or derive
  environment names through shell string manipulation. Validate quoting with
  spaces, metacharacters and same-name nested environments.
- Install templates through documented user action; do not overwrite a user's
  existing `.zed/tasks.json`, keymap or trust settings. Tasks are shell-based;
  do not describe their argument handling as equivalent to direct `spawn`.
- Keep `env decrypt` and the editor JSON protocol out of terminal task examples.
  `dotenc env edit` with Zed as an external editor is the existing temporary-file
  workflow, not an implementation of the no-plaintext-file requirement. It is
  outside this first task bundle.

Exit criterion: real Zed manual verification using fixtures, nested-directory
checks, and an honest guide labeling terminal support versus native editing.
This deliverable needs no registry extension or new cryptographic code.

### Stage 2 — implement and release the shared write protocol

Deliver the concurrency contract separately in the CLI, with subprocess tests
for racing saves, rotation/revocation, deletion/rename, failures before replace,
process termination and stale locks. Update `SECURITY.md` to reflect implemented
behavior. Follow the repository's CLI pre-commit/coverage gates, including e2e
for process paths. Migrate VS Code in a separate focused change.

This work is useful across editors, but does not remove the Zed API dependency.
Schedule it as an explicit CLI workstream rather than expanding the task-guide
change into a write-path refactor.

### Stage 3 — native editing prototype, conditional on Stage 0

Proposed package: `zed-extension/` in this monorepo, with a separate Rust crate,
`extension.toml`, `Cargo.lock`, package-level `AGENTS.md` and Rust-specific CI.
Existing Bun workspaces remain responsible for their current packages.
The registry supports a subdirectory in a public submodule, so a new repository
is not required. Candidate extension ID: `dotenc`, subject to availability and
the publishing rules at that time.

Implement explicit Open Environment, native save, reload, encrypted-source
navigation and safe failures first. Then evaluate automatic opening and a picker.
The UX is: choose environment → decrypt to protected Env document → edit → save
through the CLI with revision → mark clean only after confirmed commit.

Start with local macOS/Linux; Windows, SSH/WSL and other remote sessions require
separate process, key-source, host-trust and persistence validation before being
advertised. No forwarding of private keys is part of this design.

If native support requires a Zed core contribution, prototype there explicitly;
do not present a patched editor as an installable registry extension. Reassess
distribution when a stable public API exists.

### Stage 4 — acceptance and publication

Before release, exercise native open/edit/save, Save All/autosave, Save As,
duplicate views, conflicts, missing/old CLI, access denied, passphrase-required
keys, process failures, remote/unsupported-target rejection and trust changes.

Use a unique synthetic secret marker to inspect repository files, extension
storage, Zed session/recovery databases and logs after normal use, crash,
restart and forced termination. Inspect actual UI state and ciphertext with
independent CLI decryption; unit mocks do not establish persistence guarantees.
Verify AI, language-service and collaboration exclusion in the actual editor.

Require both CLI write safety and Zed document safety before calling the native
integration stable. Publish only a supported extension category, at the manually
tested commit, under the current registry requirements. Check whether CodeRabbit
is enabled on any new repository if one is later introduced.

## Alternatives considered

| Approach | Decision |
| --- | --- |
| Supported virtual-document provider | Preferred route when the public API exists; preserves native editing and the ciphertext write boundary. |
| Tasks and terminal | Deliver first for metadata and command running; explicitly limited in scope. |
| `dotenc env edit` using `zed --wait` | Existing external-editor design uses plaintext temporary files and saves back on editor exit; not equivalent to VS Code editing. |
| LSP replacing ciphertext with plaintext or formatting on save | Reject as the editing architecture: document writes and editor persistence remain outside its control. |
| MCP or slash commands returning secrets | Reject: agent-context output does not provide a private document save lifecycle. |
| FUSE/mounted plaintext filesystem | Reject for the first version: adds platform dependencies and exposes plaintext through ordinary filesystem access. |
| Long-running local daemon/HTTP bridge | No initial need; adds authentication, lifecycle and data-exposure work without fixing the editor's missing document hooks. |

## Decisions remaining

The recommended first scope is a local task integration plus the upstream API
specification. The first native editing milestone intentionally omits a custom
sidebar and destructive/access-management shortcuts.

Before beginning native implementation, settle the upstream extension path,
release-specific security capabilities and shared CLI protocol version. No
calendar estimate for native editing is credible while editor API availability
is an external dependency. No repository, upstream issue, PR, extension or
installation has been created by this planning work.
