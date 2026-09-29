# Maintaining the documentation

The public docs use Astro Starlight at `https://dotenc.org/docs/`. The existing
marketing homepage and docs are published as one GitHub Pages artifact.

From the repository root:

```bash
bun install --frozen-lockfile
bun run docs:dev
```

Open `http://127.0.0.1:4321/docs/` for live editing. Starlight's Pagefind search
is available in built output, so use this for a complete site review:

```bash
bun run site:build
bun run site:preview
```

Open `http://127.0.0.1:4322/docs/`. The same server serves the marketing homepage
at `/` and installer at `/install.sh`. Deep links resolve to static index files;
missing pages return the shared 404 document with status 404.

## Content ownership

- `src/content/docs/`: canonical workflow pages extracted from the old README,
  quick start, agent guidance, and reference explanations.
- `scripts/sources.ts`: explicit map of existing guides and security/extension
  documents to public routes. These retain their original canonical source and
  GitHub URLs. Site output rewrites their repository-relative Markdown links.
- `cli/src/program.ts`: the generated command reference comes from actual CLI
  `--help` subprocesses running in an empty temporary home. Machine interfaces
  are included; development-only mock commands are excluded.
- `src/content/docs/imported/` and `public/`: generated, ignored views. Preparing
  content also produces `/docs/markdown/<route>.md` and `/docs/llms.txt` for
  text-only retrieval. Do not hand-edit these outputs.

Run `bun run --cwd docs-site content:prepare` after changing imported sources or
CLI help while the dev server is running. Workflow Markdown edits reload directly.

## Validation

```bash
bun run docs:check
bun run docs:test
bun run --cwd docs-site validate:cli
bun run site:build
bun run --cwd docs-site validate:links
bun run lint
```

The CLI smoke runs real subprocesses with generated keys and an isolated home,
then removes the fixtures. It reads the quick-start application and dotenv
example from the actual page and verifies editing, precedence, access, renaming,
bootstrap isolation, and diagnostic contracts. It prints only status.

To validate an already installed published JS artifact without changing the
system CLI, set `DOTENC_DOCS_CLI` to its absolute entrypoint,
`DOTENC_DOCS_RUNTIME=node`, and `DOTENC_DOCS_PUBLISHED=1`. Published mode excludes
artifact-scanning checks because CLI 0.14.2 does not contain that command.

The link checker validates the combined artifact, including fragments, navigation,
stylesheets, scripts, and installer links. Review search, mobile navigation,
light/dark themes, keyboard focus, and copy buttons in a browser as well.

## Deployment and skill follow-up

The Pages workflow builds the homepage first (its build clears `website/dist`),
then copies the docs to `website/dist/docs/` and uploads one artifact. Do not
create an independent Pages deployment in this repository.

Keep README compatibility anchors and old provider-guide files available for
installed skills. After the docs are published and verified, the separate
`dotenc/skills` repository can add direct topic links and regenerate/release the
ChatGPT plugin bundle. This migration does not publish a plugin release.
