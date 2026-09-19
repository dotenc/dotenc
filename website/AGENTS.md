# Website guidance

The marketing site is static HTML, CSS (compiled with Tailwind), and small vanilla JavaScript interactions. Keep it usable without JavaScript; use progressive enhancement for navigation, install tabs, and clipboard controls.

- Use the current brackets-and-dot brand from commit `13f7d67` (`ivanfilhoz/extension-logo`), brought into this site as `public/brand-symbol.svg` and `public/logo-square.png`. The old hexagon/circuit artwork is obsolete. The design uses a full blue hero, white logo brackets, a mint center and primary action, white content sections, and navy code/security surfaces. Use Manrope typography and rounded corners that echo the logo; keep product examples concrete.
- Keep the header/footer, hero, favicon, and social preview on the same current mark. `public/social.svg` is the editable source for `public/social.png` (render with `rsvg-convert public/social.svg -o public/social.png`).
- Agent skill/plugin content is sourced from the current `dotenc/skills` README. Distinguish the Codex plugin distributed through GitHub from GitHub Actions integrations; do not imply a public plugin-directory listing, bundled CLI, or automatic SSH access. The plugin includes the skill.
- Keep command examples aligned with `cli/README.md`, `docs/INSTALLATION.md`, and the CLI. Personal environments use `personal.<name>`.
- Use decorative, current-color SVGs for interface arrows instead of Unicode glyphs, which iOS can render as emoji. Hide these icons from assistive technology and label icon-only links.
- Open external links in a new tab with `target="_blank"` and `rel="noopener noreferrer"`; keep same-page navigation in the current tab.
- Link to the full security model and platform guides rather than duplicating their implementation details. Do not promise that revocation erases previously known secrets.
- Mobile navigation uses a native modal dialog with the same links as desktop. Preserve focus containment, Escape/backdrop closing, scroll restoration, safe-area spacing, and navigation without JavaScript.
- Run `bun run build`, `bun run test`, and scoped Biome checks. Check desktop and mobile layouts, keyboard navigation, installation tabs, and clipboard feedback in the browser.
- `bun run dev` serves port 3000. Generated `public/styles.css` and `dist/` are ignored; production CSS must come from the minified build, not a previous dev session.
