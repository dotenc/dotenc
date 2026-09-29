---
title: "dotenc documentation"
description: "Keep encrypted environments beside the code that uses them."
---

Keep your environment files encrypted in Git. Use your SSH key to edit them,
share access, and run your app with the right configuration.

## Start with a working environment

[Install dotenc](/docs/getting-started/installation/), then follow the
[quick start](/docs/getting-started/quickstart/). You need an SSH key and a local
project; no secrets service is required.

```bash
dotenc init --name alice
dotenc env edit personal.alice
dotenc dev node app.js
```

## Find your workflow

| I want to… | Read |
| --- | --- |
| Configure my own development environment | [Personal profiles](/docs/guides/development/) |
| Run a build or app with specific environments | [Run commands](/docs/guides/run/) |
| Give a teammate access | [Team collaboration](/docs/guides/teams/) |
| Use encrypted configuration in CI | [CI/CD setup](/docs/ci/overview/) and [provider guides](/docs/ci/providers/) |
| Work in a monorepo | [Nested environments](/docs/guides/monorepos/) |
| Use my editor or an agent | [VS Code](/docs/integrations/vscode/) and [agent workflows](/docs/integrations/agents/) |
| Understand a failure | [Read-only diagnostics](/docs/reference/doctor/) |
| Look up a flag | [Command reference](/docs/reference/commands/) |

## Know the boundary

Commit encrypted `.env.*.enc` files and public keys. Keep plaintext environments
and private keys out of Git. Revoking access cannot erase secrets someone
already knows. Read the [security overview](/docs/security/overview/) before
sharing production access.

These guides target published CLI **0.14.2**. Upcoming functionality is labeled;
check `dotenc --version` when following a guide on an older installation.

For text-only access, use the [Markdown index](/docs/llms.txt).
