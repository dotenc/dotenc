---
title: "Identity and public keys"
description: "Identity and public keys with dotenc, the Git-native encrypted environment CLI."
---

## Checking your identity

```bash
dotenc whoami
```

Shows your name, active SSH key, fingerprint, and the environments you have access to in this project.
## Key Management

dotenc keeps key management minimal by design. Your SSH keys are your identity - dotenc just uses them.

> Existing **filesystem private keys** stay in `~/.ssh/` and are read in place.
> **Public keys** are stored in your project's `.dotenc/` folder, derived from the corresponding private keys.
## Supported Key Types

dotenc supports the following SSH key types:

- Ed25519
- RSA (2048-bit or larger)

These types are widely supported and provide strong security guarantees.

> **Note:** dotenc can use passphrase-protected SSH keys when `DOTENC_PRIVATE_KEY_PASSPHRASE` is set. In interactive flows (`dotenc init` and interactive `dotenc key add`), selecting a passphrase-protected key also offers an optional passwordless copy flow (for example `id_ed25519_passwordless`). If you prefer a dedicated passwordless key, you can generate one with:
>
> ```bash
> ssh-keygen -t ed25519 -N ""
> ```

### Adding a public key

```bash
dotenc key add [name] [--from-private-key <name-or-selector>] [--from-ssh <path>] [-f, --from-file <file>] [-s, --from-string <pem_string>]
```

Adds a public key into the project (`.dotenc/<name>.pub`).

- `--from-ssh <path>` — Derive a public key from your local SSH private key, or read a PEM public key. Supports Ed25519 and RSA; raw OpenSSH public-key lines are not accepted.
- `--from-private-key <name-or-selector>` — Choose a discovered private-key
  candidate by name or qualified selector.
- `-f, --from-file <file>` — Read a public (or private) key from a PEM file.
- `-s, --from-string <pem_string>` — Use a PEM string directly.
- No arguments — Interactive mode: choose a discovered SSH key, create a local
  key, or paste a PEM public key.
- Key names may contain letters, numbers, dots (`.`), hyphens (`-`), and underscores (`_`).

### Listing public keys

```bash
dotenc key list
```

Lists all public keys in the project, showing each key's name and algorithm.

### Removing a public key

```bash
dotenc key remove [name]
```

Removes the public key file from the project (`.dotenc/<name>.pub`). Does not revoke environment access. To fully offboard a key — revoking access from all environments and deleting the file — use `auth purge` instead.
