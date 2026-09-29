# Documentation guidance

Use Bun from the repository root. This workspace builds static Starlight pages
mounted at `/docs/` inside the existing GitHub Pages artifact.

- Author workflow pages in `src/content/docs/`. Existing provider guides,
  installation, extension README, and SECURITY.md remain canonical outside this
  workspace; `scripts/sources.ts` explicitly lists their generated site views.
- Never edit or commit `src/content/docs/imported/`, `public/`, `.astro/`, or
  `dist/`. `bun run content:prepare` generates imported pages, CLI help, Markdown
  exports, and `llms.txt`. New generated routes need explicit sidebar entries.
- Keep source links, README compatibility anchors, and skill/provider URLs working.
  Update `legacy-anchors.json` if a migrated page moves. Do not publish internal
  plans or audit evidence through broad content globs.
- Check examples against the CLI, using disposable identities and an isolated
  home. Capture subprocess output; never expose private keys or decrypted data.
  Published CLI 0.14.2 does not include artifact scanning: keep upcoming-command
  notices until a release containing it has been independently verified.
- Preserve the blue/mint brand and keyboard/mobile usability. Test local search
  on the built preview: Starlight does not run Pagefind search in development.
  Configure code-block corners through Expressive Code `styleOverrides` so the
  title bar and code area share one frame; avoid overriding `pre` radii in CSS.
  Keep `astro build --force` in the production build to refresh cached Markdown
  when Expressive Code configuration changes its generated stylesheet hashes.
- Validation: root `bun run docs:check`, `bun run docs:test`,
  `bun run --cwd docs-site validate:cli`, `bun run site:build`,
  `bun run --cwd docs-site validate:links`, and `bun run lint`.
- `bun run docs:dev` starts the editing server on 127.0.0.1:4321.
  `bun run site:preview` serves the complete built site on 127.0.0.1:4322.
  Re-run content preparation after changing imported canonical files or CLI help,
  and rebuild the combined site before checking its preview.
