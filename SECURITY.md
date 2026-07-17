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
- [Installation Script Trust Model](#installation-script-trust-model)
- [OCI Image Trust Model](#oci-image-trust-model)
- [GitHub Actions Trust Model](#github-actions-trust-model)
- [Known Limitations](#known-limitations)
- [Vulnerability Reporting](#vulnerability-reporting)

---

## Threat Model

dotenc is designed to protect secrets at rest in a Git repository. Its security model assumes:

**Protected against:**
- An attacker who can read the repository (including all `.enc` files and public keys in `.dotenc/`) but does not have access to any authorized SSH private key
- Accidental secret exposure through environment variable leakage to child processes
- Tampering with encrypted files (authenticated encryption detects modification)
- Path traversal or command injection via user-supplied names and editor configuration

**Not protected against:**
- An attacker who has already obtained an authorized SSH private key
- Secrets that were previously exposed before being stored in dotenc
- Secrets known to a user before their access was revoked (see [Access Control Model](#access-control-model))
- A compromised machine where decryption takes place (memory forensics, malicious processes)
- Passphrase-protected keys when no passphrase source is provided — dotenc does not prompt interactively for passphrases; see [Known Limitations](#known-limitations)

---

## Cryptographic Design

### Envelope Encryption

dotenc uses envelope encryption: each environment has a single randomly generated **data key**, and that data key is individually encrypted for each authorized user using their SSH public key.

```
Environment secrets
        │
        ▼ AES-256-GCM (data key + env name as AAD)
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
| Additional Authenticated Data | Environment name bound to ciphertext | Prevents ciphertext swap across environments |
| Data key encryption (Ed25519 keys) | ECIES (`eciesjs` v0.4+) | X25519 ECDH + AES-GCM |
| Data key encryption (RSA keys) | RSA-OAEP | SHA-256 |
| Supported public key types | Ed25519, RSA ≥ 2048-bit | ECDSA and DSA are rejected |

**IV generation:** A fresh 12-byte random IV is generated for every encryption operation using Node.js `crypto.randomBytes()`. IVs are never reused.

**Authentication:** AES-256-GCM provides authenticated encryption. Any modification to the ciphertext, auth tag, or IV is detected during decryption and results in an error. The environment name is included as Additional Authenticated Data (AAD), preventing a ciphertext from one environment from being replayed against another.

### Data Key Lifecycle

1. On `dotenc env create` or `dotenc env edit`, a new 32-byte random data key is generated
2. The data key is encrypted for each authorized public key and stored in the `.enc` file header
3. The data key is never written to disk in plaintext
4. On decryption, the data key is held in memory only for the duration of the operation, then explicitly zeroed

---

## Key Material Handling

### Private Key Isolation

**SSH private keys stay in `~/.ssh/`** — dotenc reads them in place and never copies, moves, or stores them elsewhere. When `dotenc key add --from-private-key <name>` or an interactive key-selection flow is used, dotenc loads the selected private key only long enough to derive and store its public key in `.dotenc/<name>.pub`; the private key itself is not written to the repository.

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

**Child process isolation:** When running commands with `dotenc run` or
`dotenc dev`, the `DOTENC_PRIVATE_KEY_BASE64` and `DOTENC_PRIVATE_KEY`
environment variables are explicitly stripped from the child process
environment before launch. Injected secrets are limited to the decrypted
variables only:

```typescript
// cli/src/commands/run.ts
const {
    DOTENC_PRIVATE_KEY_BASE64: _privateKeyBase64,
    DOTENC_PRIVATE_KEY: _privateKey,
    ...baseEnv
} = process.env
const mergedEnv = { ...baseEnv, ...decryptedEnv }
spawn(command, args, { env: mergedEnv })
```

### Temporary File Security

`dotenc env edit` decrypts the environment into a temporary file for editing. This file is handled securely:

- Created in a temporary directory with mode `0o600` (readable only by the current user)
- **Overwritten with zeros** before deletion, preventing recovery from the filesystem:

```typescript
// cli/src/commands/env/edit.ts
const stat = await fs.stat(tempFilePath)
await fs.writeFile(tempFilePath, Buffer.alloc(stat.size, 0))
```

- Signal handlers for `SIGINT` and `SIGTERM` ensure secure erasure even if the process is interrupted mid-edit

### File Permissions

| Resource | Mode | Notes |
|----------|------|-------|
| SSH key directory (`~/.ssh/`) | `0o700` | Created if absent |
| Temporary plaintext files | `0o600` | Zeroed before deletion |
| `.env.*.enc` files | Default umask | Encrypted; safe to be world-readable |
| `.dotenc/*.pub` files | Default umask | Public keys; intentionally public |

---

## Input Validation and Injection Prevention

**Environment and key names** are validated with a strict whitelist — only alphanumeric characters, dots, hyphens, and underscores are accepted. The values `.` and `..` and Windows reserved names (`CON`, `NUL`, `COM1`, etc.) are explicitly rejected.

**Public keys** are validated before use:
- RSA keys shorter than 2048 bits are rejected
- ECDSA and DSA keys are rejected (unsupported)
- Ed25519 keys are accepted as preferred

**Editor commands** (from `$EDITOR`, `$VISUAL`, or `dotenc config editor`) are checked against a shell metacharacter denylist (`$`, `` ` ``, `(`, `)`, `;`, `|`, `<`, `>`, `&`, `!`, newlines) before use. The editor is then executed via `spawnSync` with arguments as an array — not through a shell — so no shell interpolation occurs.

**Child command execution** (`dotenc run`, `dotenc dev`) uses `spawn()` with the command and arguments as separate values, never concatenated into a shell string.

**Decrypted environment content** is parsed with Node's built-in `node:util.parseEnv` parser before variables are passed to child processes.

---

## Access Control Model

Access in dotenc is enforced cryptographically, not by policy:

- A user who is not in the authorized list for an environment cannot decrypt that environment's data key, and therefore cannot read the secrets
- Granting access re-encrypts the data key for the new user's public key; no re-encryption of the environment contents is required
- Revoking access removes the user's encrypted data key copy and re-encrypts the data key for all remaining users (requires the revoking user to have decrypt access)

**Important limitation:** Revoking access prevents future decryption but does not invalidate knowledge of secrets already seen by the revoked user. For full offboarding, rotate the affected external secrets (API keys, database passwords, etc.) and optionally run `dotenc env rotate <environment>` to generate a new data key.

All grant and revoke operations are reflected in Git-tracked files, providing a full audit trail in repository history.

---

## Operational Flow

### Project Root Resolution

When any dotenc command runs, it resolves the **project root** by walking ancestor directories from the current working directory, looking for a `.dotenc/` folder. Key material (public keys) is always read from and written to this resolved root, regardless of where the command was invoked. If no `.dotenc/` folder is found at any ancestor level, the command falls back to the current directory (which applies during `dotenc init` flows).

### Hierarchical Environment Loading

`dotenc run` and `dotenc dev` support a hierarchical merge model for monorepo projects:

1. The ancestor chain from the project root to the invocation directory is computed.
2. For each requested environment name, dotenc scans every directory in the chain (root → local) for a `.env.${name}.enc` file.
3. Variables from deeper (more local) files override variables from shallower (root) files for the same name.
4. Missing files at any level are silently skipped — only existing files that fail to decrypt cause an error.

The `--local-only` flag narrows decryption scope to the current directory only, bypassing ancestor scanning entirely.

### Recursive Environment Discovery

Batch operations (`env rotate --all`, `auth purge`) recursively walk the project tree to find all `.env.*.enc` files. The following directories are explicitly excluded from this walk to avoid processing build artifacts or dependency caches: `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`, `vendor`.

### AAD and Multi-Level Environments

The **Additional Authenticated Data (AAD)** used during AES-256-GCM encryption is the environment name only — not the file path. This means same-named environments at different directory levels (e.g., a `staging` environment at the project root and one in `packages/web`) use the same AAD value. They are treated as independent encrypted files that happen to share a logical name, consistent with the hierarchical merge semantics described above.

---

## Installation Script Trust Model

The VS Code extension offers an installation helper that downloads and runs the dotenc install script:

```bash
curl -fsSL https://dotenc.org/install.sh | sh
```

This is a standard pattern used by many developer tools (Homebrew, Rust, Node.js version managers, etc.). Security properties:

- **HTTPS only** — the connection is encrypted and the server's identity is verified by TLS certificate
- **User-initiated** — the script runs only when you explicitly trigger the install action; nothing runs automatically
- **Domain controlled by the project** — `dotenc.org` is under project ownership

If you prefer to audit the script before running it, download it first:

```bash
curl -fsSL https://dotenc.org/install.sh -o install.sh
# review install.sh
sh install.sh
```

Alternatively, install via Homebrew, Scoop, npm, the
`ghcr.io/dotenc/cli` OCI image, or a standalone binary from the
[GitHub Releases](https://github.com/dotenc/dotenc/releases) page. None of
these methods use the install script.

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

- `actions/setup` installs `@dotenc/cli` through npm. Pin the action ref and
  CLI version when workflows need fully reproducible installs.
- `actions/run` writes the requested command to a temporary script and executes
  it through `dotenc run --strict` by default. The CLI still strips
  `DOTENC_PRIVATE_KEY_BASE64` and `DOTENC_PRIVATE_KEY` before launching the
  child command, and the action wrappers unset `DOTENC_PRIVATE_KEY_BASE64`,
  `DOTENC_PRIVATE_KEY`, and `DOTENC_PRIVATE_KEY_PASSPHRASE` before running user
  commands.
- `actions/export` decrypts an environment through `dotenc run`, then writes
  only explicitly allowlisted variable names to `$GITHUB_ENV`. Values are
  registered with GitHub log masking before export.
- `actions/write-file` decrypts one named variable and writes it to a file with
  mode `0600` by default. This is intended for file-shaped credentials such as
  service account JSON.

These actions intentionally do not provide a "decrypt everything" mode. Values
exported through `$GITHUB_ENV` remain available to later steps in the same job,
so grant CI keys narrowly and keep allowlists short.

For provider pipelines, the dotenc identity belongs to the runner that actually
needs decrypted values. Use the reusable GitHub Actions only when GitHub
Actions runs the command that needs those values; otherwise, follow the
provider-specific runbook for that provider's own runner.

---

## Known Limitations

- **dotenc does not prompt for passphrases.** To use passphrase-protected SSH keys, provide `DOTENC_PRIVATE_KEY_PASSPHRASE` in the environment. In interactive key selection flows (`dotenc init`, interactive `dotenc key add`), dotenc can also create an optional passwordless copy (for example `id_ed25519_passwordless`) after explicit user confirmation.
- **No HSM or hardware key support.** Private keys must be accessible as files in
  `~/.ssh/`, via the recommended `DOTENC_PRIVATE_KEY_BASE64` environment
  variable, or via the legacy `DOTENC_PRIVATE_KEY` environment variable.
  Explicit key selection flags such as `--private-key` and `--from-private-key`
  select from those file-backed keys by name.
- **Revocation is not retroactive.** See [Access Control Model](#access-control-model).
- **No centralized policy engine.** Access control is enforced per-environment and per-repository, not across an organization.

---

## Vulnerability Reporting

If you discover a security vulnerability in dotenc, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, report via [GitHub Security Advisories](https://github.com/dotenc/dotenc/security/advisories/new). You will receive a response as soon as possible. Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Any relevant environment details (OS, dotenc version, key type)
