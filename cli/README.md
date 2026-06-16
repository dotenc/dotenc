# ![dotenc](/assets/logo.jpg "dotenc logo")

[![NPM Version][npm-image]][npm-url]
[![Github License][license-image]](/LICENSE)
[![NPM Downloads][downloads-image]][npm-url]
[![Codecov][codecov-image]][codecov-url]

🔐 Git-native encrypted environments powered by your SSH keys

## 30-Second Example

```bash
dotenc init            # pick your SSH key, choose a name
dotenc env edit alice  # add your personal secrets
dotenc dev npm start   # run with your encrypted env
```

Encrypted `.env.alice.enc` committed.
No external services.
Uses your existing SSH keys.
Done.

## Features

- 🔒 Uses the battle-tested AES-256-GCM encryption algorithm
- 🔑 Uses your existing SSH keys - no extra key management
- 🚀 Secure command running with on-the-fly decryption
- ✍️ Easy and secure environment variable editing
- 🌍 Supports multiple and extensible environments
- 👤 Personal encrypted environments per developer
- 🔄 Automatic data key rotation on edits
- 🛡️ Supports both RSA and Ed25519 SSH keys

## Table of Contents

- [30-Second Example](#30-second-example)
- [Features](#features)
- [Why?](#why)
- [Security Model](#security-model)
- [How It Works](#how-it-works)
  - [Project Structure](#project-structure)
- [Installation](#installation)
- [Basic Usage](#basic-usage)
  - [Setup](#setup)
  - [Creating a new environment](#creating-a-new-environment)
  - [Listing environments](#listing-environments)
  - [Editing an environment](#editing-an-environment)
  - [Run commands on an environment](#run-commands-on-an-environment)
  - [Checking your identity](#checking-your-identity)
- [Tooling and Maintenance](#tooling-and-maintenance)
  - [CLI updates](#cli-updates)
  - [Editor integration helpers](#editor-integration-helpers)
- [Team Collaboration](#team-collaboration)
  - [Granting access to a new team member](#granting-access-to-a-new-team-member)
  - [Revoking access from a team member](#revoking-access-from-a-team-member)
  - [Listing access](#listing-access)
- [Offboarding a Team Member](#offboarding-a-team-member)
- [CI/CD Integration](#cicd-integration)
  - [1. Generate a dedicated CI key](#1-generate-a-dedicated-ci-key)
  - [2. Add the key and grant access](#2-add-the-key-and-grant-access)
  - [3. Set the private key in your CI provider](#3-set-the-private-key-in-your-ci-provider)
  - [4. Use dotenc in your CI pipeline](#4-use-dotenc-in-your-ci-pipeline)
  - [GitHub Actions example](#github-actions-example)
  - [Reusable GitHub Actions](#reusable-github-actions)
  - [Provider runbooks](#provider-runbooks)
- [Key Management](#key-management)
  - [Supported Key Types](#supported-key-types)
  - [Adding a public key](#adding-a-public-key)
  - [Listing public keys](#listing-public-keys)
  - [Removing a public key](#removing-a-public-key)
- [Tips](#tips)
- [How dotenc compares](#how-dotenc-compares)
- [When NOT to use dotenc](#when-not-to-use-dotenc)
- [License](#license)

## Why?

Managing secrets and environment variables is critical for any modern application, but most solutions rely on third-party services and web dashboards. **dotenc** was created to solve these problems:

- **No Vendor Lock-In:** Your secrets and keys live in your codebase and your repository. You're never tied to a third-party provider or forced to migrate if pricing or policies change.
- **Improved Security:** Eliminate the risk of exposing secrets to external services. All encryption and decryption happen locally, and private keys never leave your machine.
- **Zero Key Management:** You already have SSH keys. dotenc uses them directly - no custom key generation, no extra files cluttering your home directory, no new workflows to learn.
- **Better Developer Experience:** No more juggling environment variables in a web UI or struggling to keep them in sync across branches. Everything is managed alongside your code, with simple CLI commands and full Git integration.
- **Seamless Collaboration:** Onboard or revoke team members with a single command. Grant or remove access per environment, and let Git handle the rest.
- **Fully Auditable:** Every grant and revoke is tracked within your Git history, so you always know who had access and when changes were made.
- **PR-Safe Environment Changes:** Environment variable updates live in the same pull request as your feature code. No more "merge → broken build → patch env → rebuild" workflow.

## Security Model

- Each environment has its own randomly generated 256-bit data key.
- Data keys are encrypted per-user using their SSH public key.
- dotenc uses AES-256-GCM for authenticated encryption.
- Your repository alone is not enough to decrypt secrets.
- Access can be revoked at any time.

For a detailed breakdown of the cryptographic design, key material handling, threat model, and vulnerability reporting, see [SECURITY.md](/SECURITY.md).

## How It Works

1. dotenc detects your existing SSH keys in `~/.ssh/` (Ed25519 or RSA);
2. Your public key is derived and stored in the project (`.dotenc/john.pub`);
3. A unique data key is generated for each environment;
4. The data key is encrypted with each authorized public key;
5. Environment variables are encrypted using the data key with AES-256-GCM;
6. Encrypted files (`.env.*.enc`) are committed to your repository;
7. When running commands, variables are decrypted on-the-fly using your SSH private key.

Your SSH private keys never leave `~/.ssh/`. dotenc reads them in place - nothing is copied, nothing is stored elsewhere.

### Project Structure

After setup, your project will look like:

```plaintext
.
├── .dotenc/
│   ├── alice.pub
│   ├── bob.pub
│   └── ...
├── .env.alice.enc
├── .env.production.enc
└── .env.development.enc
```

Encrypted files are committed to Git. Public keys are stored inside `.dotenc/`. Each developer gets a personal encrypted environment (e.g., `.env.alice.enc`).

## Installation

### Homebrew (macOS / Linux)

```bash
brew tap ivanfilhoz/dotenc
brew install dotenc
```

### Scoop (Windows)

```bash
scoop bucket add dotenc https://github.com/ivanfilhoz/scoop-dotenc
scoop install dotenc
```

### npm

```bash
npm install -g @dotenc/cli
```

### Standalone binary

Download the latest binary for your platform from the [GitHub Releases](https://github.com/ivanfilhoz/dotenc/releases) page.

## Basic Usage

### Setup

```bash
dotenc init
```

This will interactively guide you through the setup process:

1. Scanning your `~/.ssh/` directory for SSH keys (Ed25519, RSA, etc.);
2. Prompting for your username (defaults to your system username);
3. Letting you choose which SSH key to use;
4. Deriving the public key and storing it in `.dotenc/` (e.g., `.dotenc/alice.pub`);
5. Creating encrypted `development` and personal environments (e.g., `.env.development.enc`, `.env.alice.enc`).

No keys to generate. If you already have an SSH key (and you probably do), you're ready to go.

If you don't have an SSH key yet, just run `ssh-keygen` first - you'll want one anyway.

### Creating a new environment

```bash
dotenc env create [environment]
```

This command creates a new encrypted environment file under the specified name (e.g., `.env.development.enc`). Your personal environment is created automatically during `init`.
Environment names may contain letters, numbers, dots (`.`), hyphens (`-`), and underscores (`_`).

In a monorepo, `cd` to the target directory first, then run `dotenc env create`.

### Listing environments

```bash
dotenc env list
```

Lists encrypted environments in the current directory. Use `--all` to recursively list all environments across the project tree. Use `--json` for machine-readable output (`{ "environments": [...] }`).

### Editing an environment

```bash
dotenc env edit [environment]
```

Opens your system's default editor to modify the specified environment. To set a custom editor, use the `dotenc config editor` command. It will take precedence over your system's default editor. In a monorepo, `cd` to the directory containing the file before running `dotenc env edit`.

Example:

```bash
dotenc config editor vim
```

Currently supported `dotenc config` key: `editor`.
You can include editor arguments, for example: `dotenc config editor "code --wait"`.

### Run commands on an environment

For development, the `dev` command loads both the shared `development` environment and your personal environment automatically:

```bash
dotenc dev <command> [...args]
```

Example:

```bash
dotenc dev node app.js
```

For explicit environment control, use `run`:

```bash
dotenc run --env <environment> <command> [...args]
# or
dotenc run -e <environment> <command> [...args]
```

Example:

```bash
dotenc run -e production node app.js
```

You can also specify multiple environments:

```bash
dotenc run -e base,production node app.js
```

In the example above, `production` will override any variables also present in `base`.

If you want `run` to fail when any selected environment cannot be loaded, use strict mode:

```bash
dotenc run --strict -e base,production node app.js
```

In a monorepo, `run` merges environment files from the project root down to the current directory (local values win). To load only from the current directory and skip ancestor directories:

```bash
dotenc run --local-only -e staging node app.js
dotenc dev --local-only npm start
```

### Checking your identity

```bash
dotenc whoami
```

Shows your name, active SSH key, fingerprint, and the environments you have access to in this project.

## Tooling and Maintenance

### CLI updates

```bash
dotenc update
```

Runs the appropriate update flow for your installation method (Homebrew, Scoop, npm, or manual binary instructions).

### Editor integration helpers

```bash
dotenc tools install-vscode-extension
dotenc tools install-agent-skill
dotenc tools install-agent-skill --force
```

- `install-vscode-extension` adds extension recommendations for supported editors and can open the extension page.
- `install-agent-skill` installs the dotenc agent skill through `npx skills add`.
- `--force` maps to non-interactive mode (`-y`) for automation.

## Team Collaboration

In a real-world scenario, you will likely have multiple environments (e.g., `development`, `test`, `production`) and a team of developers who need access to these environments. Let's walk through how to set this up.

### Granting access to a new team member

Alice just joined your team and she needs access to the shared environments, except `production`. She already has an SSH key (because of course she does - she's a developer).

She sends you her public key (`~/.ssh/id_ed25519.pub`) — it's a public key, so Slack, email, or even a sticky note will do — and you grant her access:

```bash
git checkout -b grant-alice-key
dotenc key add alice --from-file alice.pub
dotenc auth grant development alice
dotenc auth grant test alice
git add .
git commit -m "Grant alice access to development and test environments"
git push
```

Now, Alice will be able to decrypt the `development` and `test` environments using her SSH key. No new tools for her to install, no custom keys to generate - just her existing SSH key.

### Revoking access from a team member

To fully offboard a team member (e.g., John), use `auth purge`:

```bash
dotenc auth purge john --yes
```

This revokes and re-encrypts every affected environment, then removes his public key file. Then, commit your changes:

```bash
git checkout -b offboard-john
git add .
git commit -m "Offboard John from all environments"
git push origin offboard-john
```

Once merged, he will no longer be able to decrypt any environments.

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

## Offboarding a Team Member

Use `auth purge` to fully offboard a team member in one step:

```bash
dotenc auth purge <user> [--yes]
```

This command:
1. Revokes the user's access from all environments they were granted
2. Re-encrypts each environment without their key (data key rotation)
3. Deletes their public key file from `.dotenc/`

After running `auth purge`, also:
- Rotate external secrets (database passwords, API tokens, etc.)
- Deploy updated configuration

### Individual environment management

```bash
dotenc env delete [environment] [--yes]
```

Deletes an environment file in the current directory. In a monorepo, `cd` to the directory containing the file first.

```bash
dotenc env rotate [environment]
```

Rotates the data key for a single environment in the current directory. In a monorepo, `cd` to the directory containing the file first.

```bash
dotenc env rotate --all [--yes]
```

Rotates the data key for all environments in one step — recursively discovers and rotates every `.env.*.enc` file under the project tree. Useful for periodic key rotation or after a security event.

## CI/CD Integration

CI runners and build servers need their own identity to decrypt environments. The approach is the same as local development: generate a key, grant access, and provide the private key at runtime.

### 1. Generate a dedicated CI key

Create an Ed25519 key pair for your CI environment. This example creates a
passwordless key; if you choose a passphrase-protected key, also set
`DOTENC_PRIVATE_KEY_PASSPHRASE` in your CI provider:

```bash
ssh-keygen -t ed25519 -f ci_key -N "" -C "ci"
```

This produces two files: `ci_key` (private) and `ci_key.pub` (public).

### 2. Add the key and grant access

Register the public key in the project and grant it access to the environments CI needs:

```bash
dotenc key add ci --from-ssh ./ci_key
dotenc auth grant test ci
dotenc auth grant production ci
git add .
git commit -m "Add CI key and grant access to test and production"
git push
```

### 3. Set the private key in your CI provider

Base64-encode the private key file and store the result as a secret environment
variable named `DOTENC_PRIVATE_KEY_BASE64` in your CI provider:

```bash
base64 < ci_key | tr -d '\n'
```

`DOTENC_PRIVATE_KEY` with the raw private key text is still supported for
backwards compatibility, but new provider setup should use
`DOTENC_PRIVATE_KEY_BASE64`.

If this private key is passphrase-protected, also set:

```bash
DOTENC_PRIVATE_KEY_PASSPHRASE=<your-passphrase>
```

Once stored, delete the local private key file:

```bash
rm ci_key
```

The public key (`ci_key.pub`) can also be deleted — it's already tracked inside `.dotenc/ci.pub`.

### 4. Use dotenc in your CI pipeline

With `DOTENC_PRIVATE_KEY_BASE64` set (and `DOTENC_PRIVATE_KEY_PASSPHRASE` when
using an encrypted key), dotenc will automatically pick up the key. No `~/.ssh`
directory required:

```bash
dotenc run -e test npm test
dotenc run -e production node app.js
```

### GitHub Actions example

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
      - run: npm ci
      - uses: dotenc/setup-action@v1
      - uses: dotenc/run-action@v1
        with:
          environment: test
          command: npm test
        env:
          DOTENC_PRIVATE_KEY_BASE64: ${{ secrets.DOTENC_PRIVATE_KEY_BASE64 }}
          DOTENC_PRIVATE_KEY_PASSPHRASE: ${{ secrets.DOTENC_PRIVATE_KEY_PASSPHRASE }}
```

### Reusable GitHub Actions

dotenc also ships reusable GitHub Actions for common CI patterns:

- `dotenc/setup-action@v1` installs the CLI.
- `dotenc/run-action@v1` runs one command under `dotenc run --strict`.
- `dotenc/export-action@v1` exports an explicit allowlist to later
  steps through `$GITHUB_ENV`.
- `dotenc/write-file-action@v1` writes one decrypted value to a
  `0600` file for file-shaped credentials.

This lets GitHub keep only the dotenc bootstrap secret(s) in GitHub while
provider tokens live in an encrypted dotenc environment for jobs that actually
run on GitHub. Store the bootstrap key as `DOTENC_PRIVATE_KEY_BASE64`. If the
bootstrap key is encrypted, also store `DOTENC_PRIVATE_KEY_PASSPHRASE`.
See [docs/GITHUB_ACTIONS.md](/docs/GITHUB_ACTIONS.md) for examples.

### Provider runbooks

Some CI/CD providers need extra setup because build steps, environment
resolution, or secret storage work differently from a generic shell pipeline.

- [GitHub Actions](/docs/GITHUB_ACTIONS.md) — use a dedicated GitHub Actions
  key, then run commands, export allowlisted variables, or write file-shaped
  credentials from encrypted dotenc environments.
- [Expo / EAS](/docs/EXPO_EAS.md) — choose one lean path: EAS cloud builds with
  an EAS dotenc identity, or GitHub local builds with a GitHub dotenc identity.
- [Vercel](/docs/VERCEL.md) — use a dedicated Vercel dotenc identity for
  Vercel-owned cloud builds, then wrap the Vercel build command.
- [Netlify](/docs/NETLIFY.md) — use a dedicated Netlify dotenc identity for
  Netlify-owned cloud builds, then wrap the Netlify build command.
- [Provider helpers roadmap](/docs/PROVIDER_HELPERS_ROADMAP.md) — track planned
  Docker images, Railpack/Nixpacks presets, provider plugins, and provider CLIs.

## Key Management

dotenc keeps key management minimal by design. Your SSH keys are your identity - dotenc just uses them.

> **Private keys** stay in `~/.ssh/` where they belong. They are never copied or moved.
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
dotenc key add [name] [--from-ssh <path>] [-f, --from-file <file>] [-s, --from-string <pem_string>]
```

Adds a public key into the project (`.dotenc/<name>.pub`).

- `--from-ssh <path>` — Derive the public key from an SSH key file (private or public). Supports both Ed25519 and RSA keys.
- `-f, --from-file <file>` — Read a public (or private) key from a PEM file.
- `-s, --from-string <pem_string>` — Use a PEM string directly.
- No arguments — Interactive mode: choose from your SSH keys or paste a PEM public key.
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

## Monorepo Usage

dotenc works in monorepos out of the box. Run `dotenc init` once at the repository root to create a shared `.dotenc/` folder and a root-level environment. Subdirectory packages can then have their own `.env.*.enc` files that overlay the root.

**How environment loading works:**
- `dotenc run` (and `dev`) walk from the project root to the current directory, loading and merging each layer. Local values override root values.
- Use `--local-only` to load only the current directory's environments, skipping ancestor layers.

**Creating, editing, rotating, and deleting environments:**

All `env` write commands operate on the current directory. `cd` to the target directory first:

```bash
# Create an environment in a package subdirectory
cd packages/web
dotenc env create staging

# Edit, rotate, or delete that same file
dotenc env edit staging
dotenc env rotate staging
dotenc env delete staging
```

**Listing environments:**
```bash
dotenc env list        # list environments in the current directory
dotenc env list --all  # recursively list all environments in the project
```

**Batch operations cover the whole tree:**
```bash
dotenc env rotate --all --yes  # rotate all .env.*.enc files recursively
dotenc auth purge alice --yes  # revoke alice from all envs in the project
```

## Tips

For convenience, you can setup your `package.json` file like this:

```jsonc
  // ...
  "scripts": {
    "dev": "dotenc dev tsx src/app.ts",
    "start": "dotenc run -e production node dist/app.js",
    "test": "dotenc run -e test vitest"
  }
```

Alternatively, the `DOTENC_ENV` variable can be used to set the environment, so the `-e` option can be omitted. For example:

```bash
  export DOTENC_ENV="production"
  dotenc run node app.js
```

### Update checks

The CLI checks for new versions when you run `dotenc dev` and prints a notification when an update is available.


## How dotenc compares

 dotenc is a Git-native encryption layer designed for teams who want encrypted environment files committed alongside their code.
It does not aim to replace centralized secret managers like Vault or Doppler — it serves a different operational model.

| Capability | dotenc | SOPS (+ age) | Vault | Doppler |
|-------------|---------|--------------|--------|----------|
| Git-native encrypted files | ✅ | ✅ | ❌ | ❌ |
| Uses existing SSH identity | ✅ | ❌ (age / PGP) | ❌ | ❌ |
| No external service required | ✅ | ✅ | ❌ | ❌ |
| Environments versioned with code | ✅ | ✅ | ❌ | ❌ |
| Centralized runtime secret API | ❌ | ❌ | ✅ | ✅ |
| Dynamic / short-lived secrets | ❌ | ❌ | ✅ | ❌ |
| Built-in org policy engine | ❌ | ❌ | ✅ | ✅ |
| Requires running infrastructure | ❌ | ❌ | ✅ | ❌ |

## When NOT to use dotenc

- If you require centralized policy enforcement
- If your compliance mandates HSM-backed key storage
- If you need runtime secret injection via remote API

## License

[MIT](https://github.com/ivanfilhoz/dotenc/blob/main/LICENSE)

[npm-image]: https://img.shields.io/npm/v/@dotenc/cli.svg
[license-image]: https://img.shields.io/github/license/ivanfilhoz/dotenc.svg
[downloads-image]: https://img.shields.io/npm/dm/@dotenc/cli.svg
[npm-url]: https://npmjs.org/package/@dotenc/cli
[codecov-image]: https://codecov.io/gh/ivanfilhoz/dotenc/graph/badge.svg?token=U2MKXVGBA0
[codecov-url]: https://codecov.io/gh/ivanfilhoz/dotenc
