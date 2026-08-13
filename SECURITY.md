# Security

This document describes the security model, cryptographic design, and operational security practices of dotenc.

## Table of Contents

- [Threat Model](#threat-model)
- [Cryptographic Design](#cryptographic-design)
  - [Envelope Encryption](#envelope-encryption)
  - [Algorithms](#algorithms)
  - [Data Key Lifecycle](#data-key-lifecycle)
- [Key Material Handling](#key-material-handling)
  - [Private Key Isolation](#private-key-isolation)
  - [Temporary File Security](#temporary-file-security)
  - [File Permissions](#file-permissions)
- [Input Validation and Injection Prevention](#input-validation-and-injection-prevention)
- [Access Control Model](#access-control-model)
- [Operational Flow](#operational-flow)
- [VS Code Extension Trust Model](#vs-code-extension-trust-model)
- [Installation Script Trust Model](#installation-script-trust-model)
- [Linux Package Repository Trust Model](#linux-package-repository-trust-model)
- [OCI Image Trust Model](#oci-image-trust-model)
- [GitHub Actions Trust Model](#github-actions-trust-model)
- [Known Limitations](#known-limitations)
- [Vulnerability Reporting](#vulnerability-reporting)

---

## Threat Model

dotenc is designed to protect secrets at rest in a Git repository. Its security model assumes:

**Trusted repository writers:** Anyone allowed to merge or otherwise write Git
state is trusted to create, replace, and roll back dotenc envelopes and public
keys. Git permissions, review policy, and history are the authorship and change
integrity layer. dotenc does not add an envelope signature whose trust root is
independent of the repository.

**Protected against:**
- An attacker who can read the repository (including all `.enc` files and public keys in `.dotenc/`) but does not have access to any authorized SSH private key
- Forwarding dotenc bootstrap keys/passphrases or allowing decrypted
  process-control variables to silently take over a wrapped command
- Modification of a given AES-GCM ciphertext without its data key
- Path traversal or command injection via user-supplied names and editor configuration

**Not protected against:**
- An attacker who has already obtained an authorized SSH private key
- Secrets that were previously exposed before being stored in dotenc
- Secrets known to a user before their access was revoked (see [Access Control Model](#access-control-model))
- A trusted Git writer replacing an entire valid envelope, recipient list, or
  public key, or replaying an older valid Git revision
- A compromised machine where decryption takes place (memory forensics, malicious processes)
- Passphrase-protected keys when no passphrase source is provided — dotenc does not prompt interactively for passphrases; see [Known Limitations](#known-limitations)

---

## Cryptographic Design

### Envelope Encryption

dotenc uses envelope encryption: each environment has a single randomly generated **data key**, and that data key is individually encrypted for each authorized user using their SSH public key.

```
Environment secrets
        │
        ▼ AES-256-GCM (data key + v2 env name as AAD)
        │
Encrypted ciphertext (.env.*.enc)

Data key
        │
        ├─▶ ECIES encrypt (Ed25519 public key) → stored in .env.*.enc
        └─▶ RSA-OAEP encrypt (RSA public key)  → stored in .env.*.enc
```

This means:
- Only authorized users can decrypt the data key, and therefore the environment
- Re-keying an environment (adding or revoking access) only re-encrypts the data key, not the environment contents
- Rotating the data key generates a new random key and re-encrypts all environment contents

### Algorithms

| Operation | Algorithm | Parameters |
|-----------|-----------|------------|
| Environment encryption | AES-256-GCM | 96-bit random IV, 128-bit auth tag |
| Additional Authenticated Data | Version 2 environment name bound to ciphertext | Prevents ciphertext swap across environment names; legacy v1 has no AAD |
| Data key encryption (Ed25519 keys) | ECIES (`eciesjs` v0.4+) | X25519 ECDH + AES-GCM |
| Data key encryption (RSA keys) | RSA-OAEP | SHA-256 |
| Supported public key types | Ed25519, RSA ≥ 2048-bit | ECDSA and DSA are rejected |

**IV generation:** A fresh 12-byte random IV is generated for every encryption operation using Node.js `crypto.randomBytes()`. IVs are never reused.

**Ciphertext integrity:** AES-256-GCM detects modification of a ciphertext, auth
tag, IV, or v2 environment-name AAD relative to that envelope's data key. This
does not establish who authored a complete replacement envelope: a trusted Git
writer who can replace the envelope and its wrapped data key remains inside the
threat model's trust boundary.

New writes use envelope version 2 and bind the logical environment name as
Additional Authenticated Data (AAD), preventing the encrypted content from
being renamed or replayed under a different environment name without
re-encryption. Legacy envelopes with an absent version or `version: 1` remain
readable without AAD for migration compatibility.

### Data Key Lifecycle

1. On `dotenc env create` or `dotenc env edit`, a new 32-byte random data key is generated
2. The data key is encrypted for each authorized public key and stored in the `.enc` file header
3. The data key is never written to disk in plaintext
4. On decryption, the data key is held in memory only for the duration of the operation, then explicitly zeroed

---

## Key Material Handling

### Private Key Isolation

**Filesystem SSH private keys stay in `~/.ssh/`** — dotenc reads existing keys
in place and never moves them elsewhere. Public-only selection flows derive and
store only `.dotenc/<name>.pub`. Optional passwordless and 1Password local-copy
flows create a new `~/.ssh` file only after explicit user confirmation.

**1Password SSH private keys are memory-only by default** — when the installed `op`
CLI exposes configured accounts, dotenc can discover SSH Key items through
their public metadata. Interactive `dotenc init` and `dotenc key add` defer that
discovery until the user explicitly chooses the 1Password action; local key
selection in those pickers does not invoke `op`. When decryption finds only
passphrase-protected local keys and no cached provider match, dotenc reports the
passphrase guidance before provider discovery. Accounts are addressed by
complete `account_uuid`; vaults and items are addressed by stable IDs. Those
commands read only the ID-addressed `public_key` field during discovery; they do
not request a full item or private field during discovery or ordinary selection.
Selecting a 1Password key caches only
its canonical fingerprint and opaque account, vault, and item IDs in the
user's machine-local locator cache. If decryption has no matching
environment or filesystem key, dotenc retrieves exactly one
fingerprint-matched private key with `op read --account ...` through a pipe. It
first checks the locator cache, avoiding account and item discovery after a
successful selection or use. It validates the retrieved key's fingerprint
before use. Private key material is never stored in the locator cache, logged,
or added to a child process environment or argument.
A decryption batch reuses a fingerprint-verified in-memory provider key by its
canonical fingerprint, including across environments with different recipient
sets. The command that creates the shared decryption context owns its cleanup
and releases those batch references immediately after the decryption handoff;
they are never forwarded to a wrapped command. Authorization and session scope
remain controlled by the 1Password CLI and desktop app.

After an interactive 1Password selection, dotenc explains the trade-off and
defaults to keeping the private key provider-managed. If the user explicitly
confirms the local-copy option, dotenc retrieves and independently
fingerprint-verifies the returned OpenSSH key, and creates a
non-conflicting `~/.ssh/id_<algorithm>_1password_<fingerprint>` file. The SSH
directory is mode `0700`; the key file is created exclusively with mode `0600`.
Item titles never become paths, existing files are never overwritten, and a
failed write removes only a file created by that attempt before continuing with
locator-only behavior. This opt-in removes future 1Password authorization and
latency for that identity, but expands private-key exposure to persistent local
storage.

The built-in SSH public- and private-key fields are addressed by their stable
`public_key` and `private_key` IDs, not by language-dependent display labels.

`op` is invoked directly with an argument array, never through a shell.
Structured output is schema-checked, bounded, and subject to a timeout;
arbitrary stdout and stderr are not included in diagnostics. Buffered private
key output, including chunks delivered after a timeout or output-limit failure,
is overwritten before release. OpenSSH parsing also clears decoded key buffers
and temporary DER copies. The `op` child receives a sanitized copy of the
process environment with every `DOTENC_PRIVATE_KEY*` bootstrap variable
removed, while retaining the ordinary user and 1Password environment needed by
the installed CLI.

Account, vault, and item IDs are local metadata and are never persisted in
project files. The locator cache stores only `fingerprint -> accountId, vaultId,
itemId` entries under `~/.cache/dotenc` (or the applicable XDG/Windows cache
root), with `0700` directories and `0600` files. Entries use a bounded,
versioned schema and atomic replacement. No private or public key, item or vault
name, account URL, project path, negative result, or authorization decision is
cached. The cache is treated as untrusted and disposable: every retrieved
private key is fingerprint-verified, and invalid or mismatched locators are
evicted. Transient CLI, timeout, and authorization failures preserve the
locator and fail closed for the current operation without a full provider scan,
so a later process can retry the direct lookup.

**In-memory zeroing:** After the private key is used to decrypt the data key, the raw key bytes are explicitly overwritten with zeros before being released:

```typescript
// cli/src/helpers/decryptDataKey.ts
try {
    return eciesDecrypt(rawSeed, encryptedDataKey)
} finally {
    rawSeed.fill(0)   // zero Ed25519 seed bytes
    privDer.fill(0)   // zero DER-encoded private key buffer
}
```

**Provider bootstrap keys:** CI and provider runners should store bootstrap
private keys as `DOTENC_PRIVATE_KEY_BASE64`, a base64-encoded private key file.
`DOTENC_PRIVATE_KEY` with raw private key text remains supported for backwards
compatibility. Passphrase-protected bootstrap keys use
`DOTENC_PRIVATE_KEY_PASSPHRASE` with either format.

**Child process isolation:** `dotenc run` and `dotenc dev` construct the child
environment only after decrypting and validating every selected overlay.
Bootstrap material and dotenc controls are stripped from the final merged
environment, including `DOTENC_PRIVATE_KEY_BASE64`, legacy
`DOTENC_PRIVATE_KEY`, `DOTENC_PRIVATE_KEY_PASSPHRASE`, and `DOTENC_ENV`.
Decrypted names beginning with `DOTENC_` are reserved and cannot reintroduce
those values. After `op read` returns, the retrieved 1Password private key stays
inside the dotenc process and is never forwarded to the wrapped command.

Variables that can alter executable resolution, runtime loaders, shell startup,
or GitHub Actions control files are rejected before spawn. Only non-reserved
loader/runtime names can be explicitly allowed one exact name at a time; dotenc
and GitHub control names have no override. See [Input Validation and Injection
Prevention](#input-validation-and-injection-prevention) for the list and
override contract.

### Temporary File Security

`dotenc env edit` decrypts the environment into a temporary file for editing. This file is handled as follows:

- The plaintext file is created with mode `0o600` inside an OS-created
  temporary directory.
- It is overwritten with zeros best-effort before deletion, reducing
  straightforward filesystem recovery:

```typescript
// cli/src/commands/env/edit.ts
const stat = await fs.stat(tempFilePath)
await fs.writeFile(tempFilePath, Buffer.alloc(stat.size, 0))
```

- Signal handlers for `SIGINT` and `SIGTERM` perform the same best-effort
  overwrite before exit. Filesystem snapshots, copy-on-write storage, flash
  wear leveling, abrupt process termination, and editor backups can still
  retain plaintext; this is not a physical-erasure guarantee.

The OpenSSH passphrase fallback creates a mode-`0o700` temporary directory, a
mode-`0o600` private-key copy, and a mode-`0o700` fixed askpass helper. The
passphrase is sent through a mutable stdin buffer rather than written to a
passphrase file or process argument; the buffer and unlocked key bytes are
overwritten after use. Temporary key/helper files are logically overwritten,
synced, and removed best-effort. Filesystem snapshots, copy-on-write storage,
and flash wear leveling can retain older blocks, so this is exposure reduction,
not a physical-erasure guarantee.

### File Permissions

| Resource | Mode | Notes |
|----------|------|-------|
| SSH key directory (`~/.ssh/`) | `0o700` | Created if absent |
| Confirmed local SSH private-key copies | `0o600` | Created exclusively; never overwrite an existing path |
| Home configuration directory (`~/.dotenc/`) | `0o700` | Enforced when configuration is read or written |
| Home configuration (`~/.dotenc/config.json`) | `0o600` | Enforced when configuration is read or written |
| Temporary plaintext files | `0o600` | Best-effort overwrite before deletion; no physical-erasure guarantee |
| `.env.*.enc` files | Default umask | Encrypted; safe to be world-readable |
| `.dotenc/*.pub` files | Default umask | Public keys; intentionally public |

---

## Input Validation and Injection Prevention

**Environment and key names** are validated with a strict whitelist — only alphanumeric characters, dots, hyphens, and underscores are accepted. The values `.` and `..` and Windows reserved names (`CON`, `NUL`, `COM1`, etc.) are explicitly rejected.

**Public keys** stored in `.dotenc/*.pub` must be canonical, public-only SPKI
PEM. Private-key PEM, trailing data, non-canonical DER, and unsupported key
types are rejected. Keys are also validated before wrapping:
- RSA keys shorter than 2048 bits are rejected
- RSA modulus length must be available from the runtime key metadata
- ECDSA and DSA keys are rejected (unsupported)
- Ed25519 keys are accepted as preferred

Ed25519 SPKI and PKCS#8 values are parsed structurally. dotenc extracts the
public point and private seed from their DER BIT/OCTET STRING fields instead of
assuming that key bytes occupy the last 32 bytes of an encoding.

**Encrypted envelopes** read by CLI environment commands use a shared strict
bounded parser. The redacted diff action retains a separate bounded batch/report
parser for its action input contract. Both reject files over 1 MiB, JSON nesting
deeper than 16 levels, more than 256 recipients, unknown or duplicate fields,
duplicate recipient names or fingerprints, control characters, non-canonical
base64, unsupported versions, and oversized metadata or wrapped-key fields
before decryption. Only legacy version 1/absent and version 2 envelopes are
accepted.

**Editor commands** (from `$EDITOR`, `$VISUAL`, or `dotenc config editor`) are checked against a shell metacharacter denylist (`$`, `` ` ``, `(`, `)`, `;`, `|`, `<`, `>`, `&`, `!`, newlines) before use. Explicit `dotenc config editor` values are also rejected at configuration time. The editor is executed via `spawnSync` with arguments as an array, not through a shell, so shell interpolation does not occur. The configured editor and its arguments are nevertheless trusted local input and may activate editor-native behavior.

**Child command execution** (`dotenc run`, `dotenc dev`) uses `spawn()` with the command and arguments as separate values, never concatenated into a shell string.

**Decrypted environment content** is parsed with Node's built-in `node:util.parseEnv` parser before variables are passed to child processes.

**Process-control variables** from decrypted content are blocked by default.
Case-insensitive exact matches include `PATH`, `PATHEXT`, `COMSPEC`,
`NODE_OPTIONS`, `NODE_PATH`, `BASH_ENV`, `ENV`, `PYTHONPATH`, `PYTHONHOME`,
`PERL5OPT`, `PERL5LIB`, `PERLLIB`, `RUBYOPT`, `RUBYLIB`,
`JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS`, `_JAVA_OPTIONS`, and
`PHP_INI_SCAN_DIR`; the `LD_*` and `DYLD_*` prefixes are also blocked. The
GitHub Actions control names `GITHUB_ENV`, `GITHUB_OUTPUT`, `GITHUB_PATH`,
`GITHUB_STATE`, and `GITHUB_STEP_SUMMARY`, plus every decrypted `DOTENC_*`
name, are reserved and cannot be overridden. The CLI reports names only, never
values. A caller with an exceptional trusted workflow may opt in one exact
non-reserved name at a time with repeatable `--allow-process-env <name>` flags;
no wildcard exemption is provided. An allowed variable is still taken from
decrypted content only when present there. Bare commands are resolved against
the original parent `PATH` before the child environment is assembled, so an
allowed decrypted `PATH` cannot redirect dotenc's initial executable selection.

**Website development requests** are resolved against the explicit `public/`
and `src/` roots. URL-encoded pathnames are decoded once, malformed encodings
and null bytes are rejected, and both lexical and canonical paths are checked
against the selected root. Symlinks that resolve outside a static root are
rejected before the development server reads a file.

**README demo artifacts** use a fixed scene-name allowlist before constructing
recording, temporary-render, or published asset paths.

**Local E2E coverage artifacts** remain inside the named non-root test
container while tests run. The Docker client then copies them into a host-owned
directory created with mode `0700`, and an exit trap removes the temporary
container. This avoids granting broader host write access just to collect
coverage.

---

## Access Control Model

Access in dotenc is enforced cryptographically, not by policy:

- A user who is not in the authorized list for an environment cannot decrypt that environment's data key, and therefore cannot read the secrets
- Granting access re-encrypts the data key for the new user's public key; no re-encryption of the environment contents is required
- Revoking access removes the user's encrypted data key copy and re-encrypts the data key for all remaining users (requires the revoking user to have decrypt access)

**Important limitation:** Revoking access prevents future decryption but does not invalidate knowledge of secrets already seen by the revoked user. For full offboarding, rotate the affected external secrets (API keys, database passwords, etc.) and optionally run `dotenc env rotate <environment>` to generate a new data key.

Grant and revoke operations change Git-tracked files. Once committed, they are
reviewable in the repository history subject to that repository's writer,
branch-protection, and history-retention policy.

`dotenc auth purge <alias>` resolves the target `.pub` file to its canonical
fingerprint and treats every project alias with that fingerprint as the same
identity. Before changing anything, it validates every discovered envelope,
rejects a revocation that would leave zero recipients, and proves every
affected envelope decryptable. It then rewrites affected envelopes, rescans the
entire project, and removes all matching public-key aliases only after the
fingerprint is absent everywhere. An unreadable envelope, failed rewrite, or
failed verification returns non-zero and retains the public key for a safe
retry; a partial rewrite is possible but is never reported as successful.

---

## Operational Flow

### Project Root Resolution

When any dotenc command runs, it resolves the **project root** by walking ancestor directories from the current working directory, looking for a `.dotenc/` folder. Key material (public keys) is always read from and written to this resolved root, regardless of where the command was invoked. If no `.dotenc/` folder is found at any ancestor level, the command falls back to the current directory (which applies during `dotenc init` flows).

### Initialization and Clone-Local Git Integration

On first initialization, dotenc registers the selected public key and creates
the encrypted `development` and `personal.<name>` environments. If a plaintext
`.env` is migrated, it is removed only after the encrypted development
environment has been created successfully. New environment files use
exclusive, no-clobber writes, so a file that appears concurrently cannot be
overwritten.

When `dotenc init` detects an existing project, it performs Git setup only: it
configures `diff.dotenc.textconv=dotenc textconv` and
`diff.dotenc.cachetextconv=false` in that clone's local Git configuration, and
ensures the repository's `.env.*.enc diff=dotenc` attribute. The exact legacy
`*.enc diff=dotenc` marker is migrated without changing other user-owned
attributes. It does not prompt for or modify identities, keys, encrypted
environments, access rules, or a local plaintext `.env`. The Git subprocess
result is checked before `.gitattributes` is changed, so a configuration
failure aborts without reporting success or leaving a tracked attribute
change.

The `textconv` Git diff driver checks environment-provided and filesystem keys,
then may use a previously verified machine-local 1Password locator. It never
runs full account or item discovery. A warm locator can invoke one bounded
`op read` and trigger 1Password's native authorization dialog; the returned key
must match the environment fingerprint. On a cold, failed, stale, declined, or
mismatched cache lookup, `textconv` emits the raw encrypted content for Git
instead. Git textconv output caching is explicitly disabled because persisting
its plaintext output would violate dotenc's key and secret handling guarantees.
The clone-local command uses the `dotenc` executable resolved from the
developer machine's `PATH`; local executable resolution is therefore part of
the trusted-machine boundary.

### Hierarchical Environment Loading

`dotenc run` and `dotenc dev` support a hierarchical merge model for monorepo projects:

1. The ancestor chain from the project root to the invocation directory is computed.
2. For each requested environment name, dotenc scans every directory in the chain (root → local) for a `.env.${name}.enc` file.
3. Variables from deeper (more local) files override variables from shallower (root) files for the same name.
4. Missing files at any level are silently skipped — only existing files that fail to decrypt cause an error.

The `--local-only` flag narrows decryption scope to the current directory only, bypassing ancestor scanning entirely.

### Personal Development Profiles

`dotenc dev` always requires the `development` environment. It discovers only
`.env.personal.<profile>.enc` files along the effective ancestor chain, groups
same-named layers, and tests every layer with the existing fingerprint-based
private-key decryption context. Public-key aliases are display metadata and
never select a profile.

One accessible profile is selected automatically. Several accessible profiles
prompt in a TTY and require `--profile <name>` in non-interactive use; an
explicit `--profile alice` means `personal.alice`. With no personal files,
`dev` runs `development` alone. A requested missing/inaccessible profile, or a
discovered set with no accessible profile, warns and continues with
`development`; `--strict` makes the personal failure fatal. Failure to load the
required `development` environment is always fatal.

This namespace transition is deliberately not inferred from public-key names.
A legacy `.env.alice.enc` must be decrypted and re-encrypted as
`personal.alice`; renaming a version 2 file fails its environment-name AAD.

### Recursive Environment Discovery

Batch operations (`env rotate --all`, `auth purge`) recursively walk the project tree to find all `.env.*.enc` files. The following directories are explicitly excluded from this walk to avoid processing build artifacts or dependency caches: `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`, `vendor`.

### AAD and Multi-Level Environments

For version 2 envelopes, the **Additional Authenticated Data (AAD)** used during
AES-256-GCM encryption is the environment name only, not the file path. This
means same-named environments at different directory levels (for example, a
`staging` environment at the project root and one in `packages/web`) use the
same AAD value. They are treated as independent encrypted files that happen to
share a logical name, consistent with the hierarchical merge semantics
described above. Renaming a v2 file to a different environment name without
decrypting and re-encrypting it fails authentication. Legacy version 1/absent
envelopes do not have this binding.

---

## VS Code Extension Trust Model

The extension declares untrusted workspaces unsupported and gates its tree,
filesystem, decrypt, encrypt, rotate, delete, install, version, and update paths
on VS Code Workspace Trust. It does not execute the dotenc CLI while a
workspace is untrusted.

`dotenc.executablePath` and `dotenc.autoViewDecrypted` are machine-scoped. The
implementation reads only default or user/machine configuration and ignores
workspace and folder overrides defensively. Automatic decrypted view remains
enabled by default for developer experience, but only in a trusted workspace.
The first actual dotenc CLI operation starts the update check lazily; ordinary
extension startup does not spawn the CLI. Version, update, and install helpers
run from the extension directory rather than a workspace-controlled current
directory.

Opening a decrypted view materializes plaintext in VS Code's editor memory.
Unsaved dirty content can also be persisted by VS Code's hot-exit/backup
machinery, depending on editor settings and shutdown behavior. dotenc's custom
document scheme is not itself a claim that VS Code Local History stores the
document. Treat the editor profile and its backup storage as part of the
trusted machine, save or discard sensitive edits deliberately, and use
`Open Encrypted Source` when plaintext display is unnecessary.

---

## Installation Script Trust Model

The README and VS Code extension offer an installation helper that downloads
and runs the dotenc install script:

```bash
curl -fsSL https://dotenc.org/install.sh | sh
```

This is a standard pattern used by many developer tools (Homebrew, Rust, Node.js version managers, etc.). Security properties:

- **HTTPS only** — the connection is encrypted and the server's identity is verified by TLS certificate
- **User-initiated** — the script runs only when you explicitly trigger the install action; nothing runs automatically
- **Domain controlled by the project** — `dotenc.org` is under project ownership
- **Pinned Linux repository bootstrap** — before configuring APT, RPM, or APK,
  the script downloads an immutable public-key object and verifies its exact
  SHA-256. It then renders signature-enforcing repository configuration locally
  before installing dotenc. For RPM systems, `rpm --import` receives only the
  already verified temporary key; the same bytes are retained for DNF's
  file-backed `gpgkey`. The manual installation guide uses shorter mutable key
  aliases for readability but performs the same exact-byte checksum checks; the
  aliases alone are not trust roots.
- **Safe privilege selection** — native Linux repositories are selected only
  when the process is root, passwordless `sudo` succeeds, or an interactive
  terminal can accept a `sudo` prompt. Noninteractive callers such as the VS
  Code extension fall back to Homebrew or npm rather than hanging on a prompt.
- **Interactive AUR delegation** — the script delegates `dotenc-bin` only to an
  already installed `yay` or `paru` helper with a controlling terminal. It does
  not build an AUR recipe as root or silently confirm the transaction.
- **Downloader redirect containment** — `curl` permits only HTTPS transfers,
  including redirects. The `wget` fallback is used only for immutable direct
  bootstrap objects and refuses redirects entirely.

The embedded hashes protect the first package-manager trust root if
`packages.dotenc.org` alone is compromised. They cannot protect against a
compromise of `dotenc.org` that changes the installer itself; reviewing or
pinning the script before execution remains the stronger bootstrap choice.

If you prefer to audit the script before running it, download it first:

```bash
curl -fsSL https://dotenc.org/install.sh -o install.sh
# review install.sh
sh install.sh
```

`dotenc tools install-agent-skill` is a convenience installer. It pins the
third-party runner to `skills@1.5.22`, but currently resolves the separately
maintained `dotenc/skills` repository by its mutable repository name. Review
that source or install a known revision manually when immutable supply-chain
resolution is required.

Alternatively, follow the [installation guide](docs/INSTALLATION.md) to install
a native release package, configure APT or RPM manually, or use APK, AUR,
Homebrew, Scoop, npm, the `ghcr.io/dotenc/cli` OCI image, or a standalone
binary. Those paths do not execute the install script.

---

## Linux Package Repository Trust Model

Official signed APT, RPM, and APK repositories are live at
`packages.dotenc.org` for amd64 and arm64. The first signed publication was
`v0.12.1` on 2026-07-20; its protected preflight, clean-install matrix, phased
R2 publication, and public-edge checks all passed. The exact production trust
roots and immutable bootstrap objects are recorded in the
[Linux package repository guide](docs/LINUX_PACKAGES.md#production-trust-roots).

The trust model separates authenticity from delivery:

- APT and RPM use independent OpenPGP v4 RSA trust roots. Each primary key
  remains offline; CI receives only that ecosystem's RSA-4096 signing-subkey
  export with a dummy primary-secret stub. The production RPM export remains
  passphrase-protected at rest.
- APT signs `InRelease`, which authenticates repository indexes and the hashes
  of `.deb` files. The `.deb` files do not carry separate dotenc repository
  signatures.
- RPM signs both package files and `repomd.xml`. A separate RSA-4096 Alpine key
  signs APK packages and `APKINDEX.tar.gz` with RSA/SHA-256.
- New DEB and RPM packages carry only their ecosystem's validated public
  certificate and signature-enforcing update-channel configuration. They do not
  contain private keys or fetch trust material from the network during package
  installation. APT uses the package-managed keyring under
  `/usr/share/keyrings`; DNF uses the package-managed key under
  `/etc/pki/rpm-gpg` with both `gpgcheck=1` and `repo_gpgcheck=1`.
  Their repository files are vendor-managed: upgrades replace them so signing
  key or verification-policy changes cannot be stranded in an alternate config
  file, and uninstall removes them.
- Arch users receive a `dotenc-bin` AUR recipe that pins the SHA-256 of each
  tagged GitHub release archive. AUR stores build metadata rather than a dotenc
  binary repository, so this path uses none of the APT, RPM, or APK signing
  keys. Its separately gated publisher uses a dedicated AUR-only Ed25519 SSH
  identity and may update only the `dotenc-bin` AUR Git repository. CI accepts
  that identity only as an unencrypted base64-encoded environment secret,
  verifies the server's Ed25519 key against the fingerprint published by AUR,
  and uses strict host-key checking. The key is exposed only after an
  unprivileged, digest-pinned Arch build/install validation succeeds. Manual
  validation authenticates with AUR's read-only `help` command, then exits
  without cloning when publication is disabled. Pushes are non-forced and fail
  closed on downgrades or unexpected repository state.
- Package managers verify repository updates against explicitly installed
  dotenc public keys. HTTPS alone is not the repository package-authenticity
  boundary.
- The install script pins the SHA-256 of each exact APT, RPM, and APK bootstrap
  key outside the package host. The manual APT and RPM blocks in the
  [installation guide](docs/INSTALLATION.md) apply the same rule. Both paths
  verify downloaded key bytes before privileged repository configuration and
  render signature-enforcing configuration locally. Compromise of
  `packages.dotenc.org` alone therefore cannot substitute a first-install trust
  root without failing that digest check.
- A first package publication accepts Linux binaries only from the immutable
  Actions artifact created earlier in the same release run; manual and
  scheduled invocations are refresh-only. Later refreshes authenticate the
  canonical six-package bundle through its APT-subkey-signed digest manifest,
  not through the adjacent mutable checksum alone.
- After the signed repositories pass clean direct-package, repository, and
  public-edge verification, the publisher copies the exact DEB and RPM bytes to
  stable architecture-specific GitHub Release asset names. Existing assets must
  match byte-for-byte and are never overwritten; a checksum asset is generated
  from the same staged bytes and round-trip verified. Legacy canonical bundles
  that predate embedded update-channel files are not exposed as these
  installers.
- Versioned packages and content-addressed metadata are immutable. Signed
  mutable repository roots are published last so they never intentionally
  reference objects that have not finished uploading.
- Private signing keys must never be published to the package host, included in
  packages, stored in repository history, or exposed through workflow logs,
  artifacts, or caches.
- APT and RPM signing run in separate ephemeral GPG homes. The durable RPM
  signing-subkey export and its metadata-signing GPG home remain protected by
  `DOTENC_RPM_GPG_PASSPHRASE_FILE`. nFPM `2.47.0` cannot unlock a protected
  subkey beneath the required dummy/offline primary, so the builder first proves
  that passphrase by signing an ephemeral probe with the exact RPM subkey. It
  then creates an isolated mode-`0700` working directory, removes protection
  only from a copy, validates a mode-`0600` export containing the same dummy
  primary and exact signing subkey, and gives only that transient export to the
  nFPM RPM child. nFPM receives no passphrase. The builder scrubs the working
  copy immediately after native package generation and on failure, before
  metadata signing or publication; the workflow exit trap supplies a second
  cleanup boundary. The unprotected copy must never enter logs, artifacts,
  caches, container layers, or publication inputs.
- Alpine signing runs in a network-disabled container whose tools are prepared
  before its read-only key mount is attached; the R2 publication step receives
  no signing secrets.

The first installation of a DEB or RPM downloaded directly from GitHub Releases
trusts GitHub's TLS-protected release delivery. The RPM carries a signature, but
a clean machine does not yet have the public key needed to authenticate it; the
DEB has no independent per-package signature. The adjacent checksum detects
accidental corruption but is delivered through the same trust boundary. Once
installed, the embedded public key and repository configuration authenticate
future APT or DNF updates through the signed repository metadata and, for RPM,
the signed package itself. DNF keeps repository-metadata keys separately from
RPM's package-signature database, so it can require one local confirmation when
it first imports the package-provided certificate for metadata verification.
This bootstrap boundary is why the direct packages must not be described as
self-authenticating.

The repository objects are stored in the private-write
`dotenc-packages` Cloudflare R2 bucket and exposed through the
`packages.dotenc.org` custom domain. Cloudflare is responsible for TLS
termination, WAF enforcement, caching, and managed DDoS mitigation on that
public path. Public `r2.dev` access remains disabled to avoid an origin bypass.
Cloudflare and R2 do not replace package signatures and do not protect against a
compromised signing key or authorized publisher.

Mutable repository objects use a 60-second browser TTL and a 300-second shared
edge TTL. Allowed-path `404` and `410` responses expose
`max-age=0, must-revalidate` to clients, so browsers do not reuse misses;
Cloudflare applies a separate 30-second edge TTL that is not advertised through
`s-maxage`. Origin `5xx` responses are not stored.

APT metadata carries a 14-day `Valid-Until` and is refreshed weekly. RPM and
APK metadata have no client-enforced expiry, so a valid older signed repository
can be replayed to freeze those clients. Weekly freshness monitoring, exact URL
purges, and short mutable-object cache lifetimes detect or reduce accidental
staleness but cannot cryptographically prevent that replay. Rotation also
requires ecosystem-specific handling: RPM 4.x cannot be assumed to learn a new
subkey on an already imported primary certificate, and immutable RPM/APK
packages continue to require the public key that originally signed them. The
canonical package manifest is also pinned to the exact APT primary and signing
fingerprints. The current exact-identity refresh path therefore requires a new
package release when an APT, RPM, or APK signing identity changes. Immutable
OpenPGP certificate object names bind both the primary fingerprint and a digest
of the exact certificate, so a renewed certificate never overwrites an older
object with the same trust root.

Publication runs only when the GitHub repository variable
`LINUX_PACKAGES_ENABLED` is exactly `true`; the signing secrets remain scoped to
the protected `linux-packages` environment. `true` is the normal production
state, while `false` blocks future gated jobs. It is not a kill switch for an
in-flight publisher: incident response must also cancel active release,
Linux-package, and AUR runs and revoke credentials when warranted. A manual
dispatch can select a non-publishing validation mode while publication is
stopped: it policy-checks the production keys, signs all package variants and
repository roots, verifies them, and installs from clean local repositories,
while all release-asset, artifact-retention, R2, cache-purge, public-edge, and
AUR publication steps remain skipped. Both OpenPGP passphrase secrets are
mandatory in this production path. Re-enable publication after an incident
only when that validation and the relevant recovery checks in the launch
runbook pass.

The operational controls, cache classes, key-custody requirements, publication
order, verification, and recovery procedures are documented in
[Official Linux Package Repositories](docs/LINUX_PACKAGES.md).

---

## OCI Image Trust Model

The `ghcr.io/dotenc/cli` image packages the compiled standalone CLI for Linux
container environments. Debian/glibc and Alpine/musl variants contain the
`dotenc` binary, `ca-certificates`, and `openssh-client`. The Alpine variant also
contains `libstdc++` and `libgcc`, which its Bun-compiled musl binary requires.
Neither variant includes Node.js, Bun, npm, provider CLIs, application runtimes,
private keys, decrypted `.env` files, or provider tokens.

Security properties:

- **Release-built image** — the image is built from `cli/Dockerfile` by the
  release workflow after CLI version bumps or an authorized image-only manual
  dispatch.
- **Variant separation** — default tags contain the glibc binary; `-alpine`
  tags contain the musl binary. Copy only the variant matching the application
  image's libc.
- **Version pinning** — production CI should pin a specific image tag, and
  higher-assurance deployments should pin the manifest digest, instead of
  relying on the mutable `latest` or `alpine` rolling tags.
- **Release attestations** — published image manifests include BuildKit
  provenance and SBOM attestations as OCI referrers.
- **Non-root default** — the image runs as the unprivileged `dotenc` user by
  default. Use Docker's `--user` option when host-mounted files need the host
  UID/GID.
- **Runner-owned identity** — when `DOTENC_PRIVATE_KEY_BASE64`,
  `DOTENC_PRIVATE_KEY`, `DOTENC_PRIVATE_KEY_PASSPHRASE`, or mounted SSH keys are
  provided to the container, that container is the machine where decryption
  happens. Grant that provider key narrowly.
- **Mount discipline** — mount only the repository paths and optional SSH key
  paths needed for the command. Prefer `DOTENC_PRIVATE_KEY_BASE64` with a
  dedicated provider key over mounting a developer's full `~/.ssh` directory in
  automation.

The CLI image is not an application builder image. Commands wrapped by
`dotenc run` execute inside the same container, so they can only use tools
present in that image or mounted into it. For application builds and runtime
decryption, copy `/usr/local/bin/dotenc` from the matching image variant into
the application's existing image and install the documented runtime packages.
Never pass a bootstrap private key through Docker `ARG` or `ENV`; use runtime
environment injection or BuildKit secret mounts.

---

## GitHub Actions Trust Model

The reusable GitHub Actions exposed as `dotenc/*-action@v1` delegate to the
implementation actions in `actions/`, which are thin wrappers around the dotenc
CLI:

- `actions/setup` installs `@dotenc/cli` through npm. Its default is the exact
  CLI package version shipped with this repository (`0.13.0`), not npm's
  mutable `latest` tag. Pin the action ref to a commit when workflows also need
  an immutable action implementation.
- `actions/run` writes the requested command to a temporary script and executes
  it through `dotenc run --strict` by default. The CLI strips
  `DOTENC_PRIVATE_KEY_BASE64`, `DOTENC_PRIVATE_KEY`,
  `DOTENC_PRIVATE_KEY_PASSPHRASE`, and `DOTENC_ENV` before launching the child
  command, and the action wrappers also unset the three private-key bootstrap
  variables before running user commands. Decrypted runtime-loader,
  executable-resolution, and GitHub control-file variables are rejected before
  spawn.
- `actions/export` decrypts an environment through `dotenc run`, then writes
  only explicitly allowlisted variable names to `$GITHUB_ENV`. Values are
  registered with GitHub log masking before export.
- `actions/write-file` decrypts one named variable and writes it to a file with
  mode `0600` by default. This is intended for file-shaped credentials such as
  service account JSON.
- `actions/diff` is a bundled Node action that compares encrypted environment
  blobs without checking out the pull request. It accepts only the dedicated
  `DOTENC_PRIVATE_KEY_BASE64` identity (plus the existing optional passphrase),
  does not scan the runner's `~/.ssh`, and keeps decrypted dotenv content inside
  the process. Authenticated decrypted content must be valid UTF-8; malformed
  plaintext is rejected before dotenv parsing or comparison. For content-key
  comparison, it unwraps only the data-key copy for that dedicated recipient;
  it does not decrypt or verify every recipient's encrypted wrapper. Base and
  head data keys are compared in memory with
  `timingSafeEqual` and explicitly zeroed afterward. Neither a data key nor any
  hash, fingerprint, or other derived identifier of a data key is emitted. The
  public-key fingerprints in the access report identify recipients only. The
  report never contains values, value hashes, lengths, prefixes, encrypted data
  keys, or ciphertext. The passphrase-protected OpenSSH fallback gives
  `ssh-keygen` an allowlisted environment, so unrelated workflow secrets are
  not inherited by that child process.

`dotenc tools install-github-diffs` is a creation-only installer for this
privileged diff workflow. It requires an authenticated GitHub CLI session,
explicit repository-relative environment selection (or `--all`), and an
explicit `--allow-fork` acknowledgement before targeting a repository GitHub
reports as a fork. Every selected environment must already be Git-tracked and
clean. The automated installer currently accepts GitHub.com repositories only;
GitHub Enterprise Server action availability depends on administrator-managed
GitHub Connect policy. Non-interactive use additionally requires `--yes`, an
explicit `--environment`/`-e` selection or `--all`, and a full 40-character
`--action-ref`. Before changing state, the installer validates the repository
and remote identity, selected paths, decryptability and action limits, the
absence of the target workflow/public key/secret, and the official diff
action's resolved 40-character commit SHA.

The installer creates a dedicated passwordless Ed25519 identity in memory. It
writes only the public key to the affected `.dotenc/` project directories and
adds that recipient only to the selected encrypted environments. The PKCS#8
private key is never written to a temporary file, copied from `~/.ssh`, placed
in a child-process argument or environment variable, or printed. Its
base64-encoded form is passed only over standard input to a shell-free
`gh secret set` child process and stored in the repository Actions secret
`DOTENC_DIFF_PRIVATE_KEY_BASE64`; the generated workflow maps that secret to
the action's `DOTENC_PRIVATE_KEY_BASE64` environment variable. Mutable key
buffers are zeroed best-effort after upload.

The generated `pull_request_target` workflow has only `contents: read` and
`pull-requests: write`, performs no checkout, install, build, or arbitrary
command step, enables `fail-on-error`, and invokes the verified implementation
directly at its full immutable commit SHA.

The installer refuses to overwrite an existing diff key, workflow, or secret;
rotation and repair require a separate deliberate operation. It snapshots and
rolls back only installer-touched local files if a failure occurs before the
secret upload. The upload is last. If an interrupted GitHub response makes the
remote result ambiguous, the installer preserves the matching local state and
exits with repair instructions instead of guessing or deleting a possibly
successful secret. It never stages, commits, pushes, or changes branches.

Filesystem hash checks prevent the installer from knowingly replacing or
rolling back a path changed after its snapshot, but they are not an atomic
cross-process filesystem transaction. Do not modify selected environments or
target paths concurrently. The installer also rechecks the fixed Actions secret
immediately before upload, but GitHub's secret-write API is an upsert with no
conditional-create operation. Coordinate repository administrators so nobody
creates or rotates `DOTENC_DIFF_PRIVATE_KEY_BASE64` during that narrow window.

These actions intentionally do not provide a "decrypt everything" mode. Values
exported through `$GITHUB_ENV` remain available to later steps in the same job,
so grant CI keys narrowly and keep allowlists short.

The diff workflow is intentionally different from ordinary CI. It uses
`pull_request_target` so the trusted base-branch workflow can receive the
dedicated dotenc key and a token able to update one pull-request comment. That
event is privileged: the workflow must never check out, install dependencies
from, build, source, or execute pull-request content. The supplied workflow
executes the action implementation at a reviewed full commit SHA and treats the
base and head Git objects as untrusted data. The action resolves the event's
exact commit and tree object IDs, downloads only matching `.env.*.enc` blobs
through the GitHub API, applies bounded schemas and size limits, and escapes all
untrusted Markdown outside code blocks. It neutralizes format controls and
renders variable and recipient names inside dynamically delimited fenced code
blocks. Its token permissions are limited to `contents: read` and
`pull-requests: write`. The hardened example uses the workflow's `GITHUB_TOKEN`
and enables `fail-on-error`, so a missing or unverified report cannot satisfy a
required check while verified semantic changes remain informational.

A verified semantic no-op, including formatting-only edits or same-key
ciphertext and wrapper churn, produces no job summary or pull-request comment.
When comments are enabled, the action removes every stale marker comment it
verifies is its own; cleanup failure fails the check. Conversely, if the
dedicated recipient unwraps different base and head data keys while valid UTF-8
plaintext bytes, the effective environment format version, and recipient
metadata are unchanged, the action retains a compact `Data key rotated` entry
only when every encrypted wrapper blob also changed. A comparison failure or an
unchanged wrapper alongside different keys fails safely. This proves only what
the dedicated recipient unwrapped; it does not prove that every other recipient
wrapper contains that same key.

Grant the diff identity only to environments whose variable-name changes CI is
allowed to disclose. A contributor can trigger this workflow and observe the
redacted variable-name and recipient changes by opening a pull request, so the
dedicated key's grants define that disclosure boundary. See the
[GitHub Actions runbook](docs/GITHUB_ACTIONS.md) for the hardened workflow and
[GitHub's current `pull_request_target`
guidance](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target).

The changed/unchanged result is also an equality signal about a value. Because
recipient public keys are committed, a pull-request author can encrypt a guessed
head value and observe whether it equals the base value. This chosen-plaintext
oracle is inherent in semantic value comparison even though dotenc never emits
the value or reusable value-derived material beyond that classification. Do not
grant the diff key to environments containing guessable values unless that
equality signal is an accepted risk.

For provider pipelines, the dotenc identity belongs to the runner that actually
needs decrypted values. Use the reusable GitHub Actions only when GitHub
Actions runs the command that needs those values; otherwise, follow the
provider-specific runbook for that provider's own runner.

---

## Known Limitations

- **dotenc does not prompt for passphrases.** To use passphrase-protected SSH keys, provide `DOTENC_PRIVATE_KEY_PASSPHRASE` in the environment. In interactive key selection flows (`dotenc init`, interactive `dotenc key add`), dotenc can also create an optional passwordless copy (for example `id_ed25519_passwordless`) after explicit user confirmation.
- **No HSM, SSH-agent, or non-exportable hardware key support.** dotenc must be
  able to access exportable private key material from files in `~/.ssh/`, the
  recommended `DOTENC_PRIVATE_KEY_BASE64` environment variable, the legacy
  `DOTENC_PRIVATE_KEY` environment variable, or an installed 1Password CLI.
  The 1Password connector uses `op read`, so the selected private key enters the
  dotenc process memory instead of remaining behind SSH-agent signing
  operations. Explicit key selection flags such as `--private-key` and
  `--from-private-key` accept local key names, unambiguous 1Password item titles,
  or qualified `1password:<account>:<vault>:<item>` selectors.
- **Revocation is not retroactive.** See [Access Control Model](#access-control-model).
- **Envelope authenticity follows Git trust.** AES-GCM detects modification of
  a ciphertext under its data key, but dotenc does not independently sign
  complete envelopes or prevent a trusted repository writer from replacing or
  rolling back valid repository state.
- **No centralized policy engine.** Access control is enforced per-environment and per-repository, not across an organization.

---

## Vulnerability Reporting

If you discover a security vulnerability in dotenc, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, report via [GitHub Security Advisories](https://github.com/dotenc/dotenc/security/advisories/new). You will receive a response as soon as possible. Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Any relevant environment details (OS, dotenc version, key type)
