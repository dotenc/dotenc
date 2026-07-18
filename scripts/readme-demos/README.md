# README terminal demos

These scripts generate the animated terminal examples embedded in
`cli/README.md`. Terminalizer is isolated here because version `0.12.0` uses a
legacy native PTY and Electron renderer; it is not part of the root workspaces,
normal installs, or CI rendering.

## Prerequisites

- Bun 1.3.10
- Node 16 active on `PATH` (for Terminalizer's native PTY)
- WebP tools (`gif2webp` and `webpmux`; installed by Homebrew's `webp` formula)
- `git`, `ssh-keygen`, `nano`, and `expect`
- A real terminal/TTY when recording

Install the pinned authoring dependency with Node 16 active:

```bash
bun install --cwd scripts/readme-demos --frozen-lockfile
```

## Regenerate

From the repository root:

```bash
bun run readme:demos:record
bun run readme:demos:check
```

`record` creates the scripted scene, sanitizes its YAML, renders a high-density
lossless animated WebP, and removes the temporary home, repository, keys, and
renderer data. To render
the committed sanitized recordings without recording again:

```bash
bun run readme:demos:render
```

Visible commands are emitted one character at a time with a fixed varied
cadence. The quickstart opens the real `dotenc env edit` flow in nano; an
authoring-only Expect helper types and saves the fake greeting through the
editor. It invokes the real `dev` command action directly, avoiding the CLI's
unrelated network update check during authoring.

The committed outputs are:

- `scripts/readme-demos/recordings/*.yml` — sanitized, reviewable Terminalizer
  recordings
- `assets/demos/*.webp` — rendered README assets

## Safety rules

- Never run `terminalizer share`; it uploads the complete recording YAML.
- Keep `--skip-sharing` on every recording command.
- Only use the generated temporary SSH keys and obviously fake values.
- Review recording diffs and inspect every WebP frame before committing.
- Keep each asset under 3 MiB and within 2200×1200 pixels.
- Rendering is manual. CI runs the cheap checker, but does not install or run
  Terminalizer.
