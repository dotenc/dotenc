---
title: "Monorepos and nested environments"
description: "Monorepos and nested environments with dotenc, the Git-native encrypted environment CLI."
---

## Monorepo Usage

dotenc works in monorepos out of the box. Run `dotenc init` once at the repository root to create a shared `.dotenc/` folder and a root-level environment. Subdirectory packages can then have their own `.env.*.enc` files that overlay the root.

**How environment loading works:**
- `dotenc run` walks from the project root to the current directory, loading and
  merging each requested environment. `dotenc dev` does the same for required
  `development` and its selected accessible `personal.<profile>`. Local values
  override root values.
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
