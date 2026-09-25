# ![dotenc — animated terminal demo showing a Node.js app, dotenc env edit development in nano, and dotenc dev injecting the encrypted greeting](https://raw.githubusercontent.com/dotenc/dotenc/main/assets/demos/quickstart.webp)

[![NPM Version][npm-image]][npm-url]
[![Github License][license-image]](https://github.com/dotenc/dotenc/blob/main/LICENSE)
[![NPM Downloads][downloads-image]][npm-url]
[![CI][ci-image]][ci-url]
[![Codecov][codecov-image]][codecov-url]

🔐 Git-native encrypted environments powered by your SSH keys

## Features

- 🔒 Uses the battle-tested AES-256-GCM encryption algorithm
- 🔑 Uses your existing SSH keys - no extra key management
- 🚀 Secure command running with on-the-fly decryption
- ✍️ Easy and secure environment variable editing
- 🌍 Supports multiple and extensible environments
- 👤 Personal encrypted environments per developer
- 🔄 Automatic data key rotation on edits and access changes
- 🔍 Readable local Git diffs and redacted pull-request reviews
- 🛡️ Supports both RSA and Ed25519 SSH keys
- 🤖 Ready for the AI era — check out the official [dotenc skill](https://www.skills.sh/dotenc/skills/dotenc)

## Getting Started

```bash
dotenc init --name alice  # pick your SSH key and create personal.alice
dotenc env edit personal.alice  # add your personal secrets
dotenc dev npm start   # run with your encrypted env
```

Encrypted `.env.personal.alice.enc` committed.
No external services.
Uses your existing SSH keys.
Done.

## Installation

```bash
curl -fsSL https://dotenc.org/install.sh | sh
```

The installer selects a supported package manager for your system. To review
the script first or install manually with APT, RPM, APK, AUR, Homebrew, Scoop,
npm, a standalone binary, or an OCI image, see the
[installation guide](https://dotenc.org/docs/getting-started/installation/).

<a id="table-of-contents"></a>

## Documentation

**[Read the dotenc documentation](https://dotenc.org/docs/)**

| Start with | Guide |
| --- | --- |
| Your first encrypted environment | [Quick start](https://dotenc.org/docs/getting-started/quickstart/) |
| Everyday development | [Personal profiles](https://dotenc.org/docs/guides/development/) |
| Production and CI | [Run commands](https://dotenc.org/docs/guides/run/) · [CI/CD](https://dotenc.org/docs/ci/overview/) |
| Working with others | [Teams](https://dotenc.org/docs/guides/teams/) · [Offboarding](https://dotenc.org/docs/guides/offboarding/) |
| Troubleshooting | [Doctor](https://dotenc.org/docs/reference/doctor/) · [Command reference](https://dotenc.org/docs/reference/commands/) |
| Editors and agents | [VS Code](https://dotenc.org/docs/integrations/vscode/) · [Skill and plugin](https://dotenc.org/docs/integrations/agents/) |

## Security Model

Environment values are encrypted with AES-256-GCM; each recipient gets a wrapped
data key. Commit encrypted `.env.*.enc` files and public keys, never private keys
or plaintext environments. Your repository alone is not enough to decrypt them.

Repository writers and the local machine remain trusted. Revoking a key does
not erase previously learned secrets or old Git revisions: rotate external
credentials when offboarding. Read the [security model and reporting policy](https://github.com/dotenc/dotenc/blob/main/SECURITY.md).

## Readable local Git diffs

Run `dotenc init` in each clone to enable local, authorized Git diffs. Only the
encrypted files are committed. [Git workflow](https://dotenc.org/docs/guides/git-diffs/).

![Readable local Git diff](https://raw.githubusercontent.com/dotenc/dotenc/main/assets/demos/git-diff.webp)

## Provider runbooks

[All provider guides](https://dotenc.org/docs/ci/providers/):
[GitHub Actions](https://dotenc.org/docs/ci/github-actions/),
[Expo / EAS](https://dotenc.org/docs/ci/expo-eas/),
[Vercel](https://dotenc.org/docs/ci/vercel/),
[Netlify](https://dotenc.org/docs/ci/netlify/),
[Cloudflare](https://dotenc.org/docs/ci/cloudflare/),
[Coolify](https://dotenc.org/docs/ci/coolify/),
[Railpack](https://dotenc.org/docs/ci/railpack/), and
[Nixpacks](https://dotenc.org/docs/ci/nixpacks/).

## Documentation links from earlier versions

Existing bookmarks and installed skills can use the links below. The full
guides now live on the documentation site.

- <a id="why"></a>[Why?](https://dotenc.org/docs/concepts/when-to-use/)
- <a id="how-it-works"></a>[How It Works](https://dotenc.org/docs/concepts/how-it-works/)
- <a id="project-structure"></a>[Project Structure](https://dotenc.org/docs/concepts/how-it-works/)
- <a id="how-does-git-diff-work"></a>[How does Git diff work?](https://dotenc.org/docs/guides/git-diffs/)
- <a id="basic-usage"></a>[Basic Usage](https://dotenc.org/docs/getting-started/quickstart/)
- <a id="setup"></a>[Setup](https://dotenc.org/docs/getting-started/setup/)
- <a id="creating-a-new-environment"></a>[Creating a new environment](https://dotenc.org/docs/guides/environments/)
- <a id="renaming-an-environment"></a>[Renaming an environment](https://dotenc.org/docs/guides/rename/)
- <a id="listing-environments"></a>[Listing environments](https://dotenc.org/docs/guides/environments/)
- <a id="editing-an-environment"></a>[Editing an environment](https://dotenc.org/docs/guides/environments/)
- <a id="run-commands-on-an-environment"></a>[Run commands on an environment](https://dotenc.org/docs/guides/development/)
- <a id="checking-your-identity"></a>[Checking your identity](https://dotenc.org/docs/guides/keys/)
- <a id="tooling-and-maintenance"></a>[Tooling and Maintenance](https://dotenc.org/docs/guides/maintenance/)
- <a id="cli-updates"></a>[CLI updates](https://dotenc.org/docs/guides/maintenance/)
- <a id="integration-helpers"></a>[Integration helpers](https://dotenc.org/docs/guides/maintenance/)
- <a id="team-collaboration"></a>[Team Collaboration](https://dotenc.org/docs/guides/teams/)
- <a id="granting-access-to-a-new-team-member"></a>[Granting access to a new team member](https://dotenc.org/docs/guides/teams/)
- <a id="revoking-access-from-a-team-member"></a>[Revoking access from a team member](https://dotenc.org/docs/guides/teams/)
- <a id="listing-access"></a>[Listing access](https://dotenc.org/docs/guides/teams/)
- <a id="offboarding-a-team-member"></a>[Offboarding a Team Member](https://dotenc.org/docs/guides/offboarding/)
- <a id="individual-environment-management"></a>[Individual environment management](https://dotenc.org/docs/guides/environments/)
- <a id="cicd-integration"></a>[CI/CD Integration](https://dotenc.org/docs/ci/overview/)
- <a id="1-generate-a-dedicated-ci-key"></a>[1. Generate a dedicated CI key](https://dotenc.org/docs/ci/overview/)
- <a id="2-add-the-key-and-grant-access"></a>[2. Add the key and grant access](https://dotenc.org/docs/ci/overview/)
- <a id="3-set-the-private-key-in-your-ci-provider"></a>[3. Set the private key in your CI provider](https://dotenc.org/docs/ci/overview/)
- <a id="4-use-dotenc-in-your-ci-pipeline"></a>[4. Use dotenc in your CI pipeline](https://dotenc.org/docs/ci/overview/)
- <a id="github-actions-example"></a>[GitHub Actions example](https://dotenc.org/docs/ci/overview/)
- <a id="reusable-github-actions"></a>[Reusable GitHub Actions](https://dotenc.org/docs/ci/overview/)
- <a id="redacted-pull-request-diffs"></a>[Redacted pull-request diffs](https://dotenc.org/docs/ci/pull-request-diffs/)
- <a id="key-management"></a>[Key Management](https://dotenc.org/docs/guides/keys/)
- <a id="1password-ssh-keys-experimental"></a>[1Password SSH keys (experimental)](https://dotenc.org/docs/guides/1password/)
- <a id="supported-key-types"></a>[Supported Key Types](https://dotenc.org/docs/guides/keys/)
- <a id="adding-a-public-key"></a>[Adding a public key](https://dotenc.org/docs/guides/keys/)
- <a id="listing-public-keys"></a>[Listing public keys](https://dotenc.org/docs/guides/keys/)
- <a id="removing-a-public-key"></a>[Removing a public key](https://dotenc.org/docs/guides/keys/)
- <a id="monorepo-usage"></a>[Monorepo Usage](https://dotenc.org/docs/guides/monorepos/)
- <a id="tips"></a>[Tips](https://dotenc.org/docs/guides/run/)
- <a id="update-checks"></a>[Update checks](https://dotenc.org/docs/guides/run/)
- <a id="troubleshooting"></a>[Troubleshooting](https://dotenc.org/docs/reference/doctor/)
- <a id="diagnose-local-setup"></a>[Diagnose local setup](https://dotenc.org/docs/reference/doctor/)
- <a id="scan-deployment-artifacts"></a>[Scan deployment artifacts](https://dotenc.org/docs/reference/artifacts/)
- <a id="how-dotenc-compares"></a>[How dotenc compares](https://dotenc.org/docs/concepts/when-to-use/)
- <a id="when-not-to-use-dotenc"></a>[When NOT to use dotenc](https://dotenc.org/docs/concepts/when-to-use/)

## License

[MIT](https://github.com/dotenc/dotenc/blob/main/LICENSE)

[npm-image]: https://img.shields.io/npm/v/@dotenc/cli.svg
[license-image]: https://img.shields.io/github/license/dotenc/dotenc.svg
[downloads-image]: https://img.shields.io/npm/dm/@dotenc/cli.svg
[npm-url]: https://npmjs.org/package/@dotenc/cli
[ci-image]: https://github.com/dotenc/dotenc/actions/workflows/ci.yml/badge.svg
[ci-url]: https://github.com/dotenc/dotenc/actions/workflows/ci.yml
[codecov-image]: https://codecov.io/gh/dotenc/dotenc/graph/badge.svg?token=U2MKXVGBA0
[codecov-url]: https://codecov.io/gh/dotenc/dotenc
