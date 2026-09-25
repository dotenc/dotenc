---
title: "Set up a project or clone"
description: "Set up a project or clone with dotenc, the Git-native encrypted environment CLI."
---

## Setup

```bash
dotenc init
```

In a new project, this interactively guides you through the setup process:

1. Scanning your `~/.ssh/` directory for SSH keys (Ed25519, RSA, etc.);
2. Prompting for your username (defaults to your system username);
3. Letting you choose which SSH key to use;
4. Deriving the public key and storing it in `.dotenc/` (e.g., `.dotenc/alice.pub`);
5. Creating encrypted `development` and personal environments (for example,
   `.env.development.enc` and `.env.personal.alice.enc`).

In an existing clone, `dotenc init` only enables the local Git diff integration. It does not prompt for an identity or recreate keys and environments, so it is safe to run after every clone.

No keys to generate. If you already have an SSH key (and you probably do), you're ready to go.

If you don't have an SSH key yet, just run `ssh-keygen` first - you'll want one anyway.
