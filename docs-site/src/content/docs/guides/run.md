---
title: "Run commands with secrets"
description: "Run commands with secrets with dotenc, the Git-native encrypted environment CLI."
---

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

Before spawning the command, dotenc rejects decrypted variables that can alter
executable resolution, runtime loaders, shell startup, or GitHub Actions
control files. It prints variable names only, never values. All decrypted
`DOTENC_*` names and the GitHub control-file names are reserved and cannot be
overridden. For an exceptional trusted workflow, allow one non-reserved process
variable at a time with a repeatable flag:

```bash
dotenc run -e test --allow-process-env NODE_OPTIONS node app.js
dotenc dev --allow-process-env NODE_OPTIONS npm start
```

The exemption is exact and has no wildcard form. Bare commands are resolved
against the original parent `PATH` before decrypted values are merged, so an
allowed decrypted `PATH` cannot redirect the initial executable. The child
never receives `DOTENC_PRIVATE_KEY_BASE64`, legacy `DOTENC_PRIVATE_KEY`,
`DOTENC_PRIVATE_KEY_PASSPHRASE`, or `DOTENC_ENV` from either source.

In a monorepo, `run` merges environment files from the project root down to the current directory (local values win). To load only from the current directory and skip ancestor directories:

```bash
dotenc run --local-only -e staging node app.js
dotenc dev --local-only npm start
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

`DOTENC_ENV` selects the environment for dotenc itself and is removed before
the wrapped child command starts.

### Update checks

The CLI checks for new versions when you run `dotenc dev` and prints a notification when an update is available.
