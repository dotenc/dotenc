---
title: "Readable Git diffs"
description: "Readable Git diffs with dotenc, the Git-native encrypted environment CLI."
---

## Readable local Git diffs

![dotenc — animated terminal demo showing an encrypted environment rendered as a readable local Git diff](https://raw.githubusercontent.com/dotenc/dotenc/main/assets/demos/git-diff.webp)

### How does Git diff work?

Seamlessly. dotenc connects encrypted environment files to Git's native diff pipeline. When an authorized developer runs `git diff`, dotenc decrypts both revisions locally with their SSH key and shows the change that matters—a variable added, removed, or updated—instead of a wall of regenerated ciphertext.

Only encrypted `.env.*.enc` files are stored and committed. The readable view exists only on the developer's machine, so local reviews stay clear without a manual decrypt-and-re-encrypt workflow—even though every edit rotates the data key and rewrites the ciphertext.

`dotenc init` configures this automatically. Run it once in every clone. When it detects an existing dotenc project, it configures the clone-local Git driver without changing keys, environments, or access rules.

The driver is limited to `.env.*.enc`, and clone-local textconv caching is
disabled so Git does not persist decrypted output. `dotenc init` currently
writes the bare command `dotenc textconv`, so Git resolves `dotenc` from your
machine's `PATH`. Pinning a stable installed executable path is deferred; until
then, local executable resolution remains part of the trusted
developer-machine boundary.

Optionally, you can also enable [redacted diffs in pull requests](/docs/ci/pull-request-diffs/#redacted-pull-request-diffs).
