---
title: "Share access with a team"
description: "Share access with a team with dotenc, the Git-native encrypted environment CLI."
---

## Team Collaboration

In a real-world scenario, you will likely have multiple environments (e.g., `development`, `test`, `production`) and a team of developers who need access to these environments. Let's walk through how to set this up.

### Granting access to a new team member

Alice needs access to development and test, but not production. On **her own
machine**, in her clone, she derives a PEM public key from her SSH identity:

```bash
dotenc key add alice --from-ssh ~/.ssh/id_ed25519
```

She shares only `.dotenc/alice.pub`, never her private key. The filename ending
in `.pub` is not enough to identify the format: a raw OpenSSH
`ssh-ed25519 ...` line from `~/.ssh/id_ed25519.pub` is not accepted by this CLI.
Use the PEM public key produced by dotenc.

An existing authorized teammate imports that public key and grants access:

```bash
git checkout -b grant-alice-key
dotenc key add alice --from-file alice.pub
dotenc auth grant development alice
dotenc auth grant test alice
git add .dotenc/alice.pub .env.development.enc .env.test.enc
git commit -m "Grant alice access to development and test environments"
git push
```

Now, Alice will be able to decrypt the `development` and `test` environments using her SSH key. Alice needs the dotenc CLI installed and her existing SSH private key available locally.

### Revoking access from a team member

To revoke a team member's key from every environment in the current repository
state (e.g., John), use `auth purge`:

```bash
dotenc auth purge john --yes
```

This resolves John's alias to its key fingerprint, preflights every environment,
revokes and re-encrypts every affected environment, verifies the fingerprint is
gone everywhere, and only then removes every `.pub` alias for that same key.
Then, commit your changes:

```bash
git checkout -b offboard-john
git add .
git commit -m "Offboard John from all environments"
git push origin offboard-john
```

Once merged, John's private key can no longer decrypt the current environment
files. `auth purge` does not rewrite Git history or erase existing clones, so
that key may still decrypt historical ciphertext addressed to it. Complete
offboarding also requires removing repository access and rotating every
external secret. If policy requires removing historical ciphertext, rewrite or
purge the retained history and require fresh clones, while assuming old clones,
mirrors, backups, and other copies remain readable.

If you only want to remove the key file without revoking environment access, use `key remove`:

```bash
dotenc key remove john
```

This removes the `.pub` file only. Access to encrypted environments is left intact until you run `auth purge`.

### Listing access

```bash
dotenc auth list [environment]
```

Lists all public keys that have access to the specified environment.
