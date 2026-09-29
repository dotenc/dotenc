---
title: "How dotenc works"
description: "How dotenc works with dotenc, the Git-native encrypted environment CLI."
---

## How It Works

1. dotenc detects your existing SSH keys in `~/.ssh/` (Ed25519 or RSA);
2. Your public key is derived and stored in the project (`.dotenc/john.pub`);
3. A unique data key is generated for each environment;
4. The data key is encrypted with each authorized public key;
5. Environment variables are encrypted using the data key with AES-256-GCM;
6. Encrypted files (`.env.*.enc`) are committed to your repository;
7. When running commands, variables are decrypted on-the-fly using your SSH private key.

By default, filesystem SSH private keys stay in `~/.ssh/` and dotenc reads them
in place. A persistent passwordless or 1Password-backed local copy is created
only through the explicitly confirmed opt-in flows documented below; provider
keys otherwise enter dotenc process memory only for the current operation.

### Project Structure

After setup, your project will look like:

```plaintext
.
├── .dotenc/
│   ├── alice.pub
│   ├── bob.pub
│   └── ...
├── .env.personal.alice.enc
├── .env.production.enc
└── .env.development.enc
```

Encrypted files are committed to Git. Public keys are stored inside `.dotenc/`.
Each developer can have a personal encrypted environment in the reserved
`personal.<profile>` namespace (for example,
`.env.personal.alice.enc`). Public-key filenames are display aliases only;
profile access is matched by key fingerprint.
