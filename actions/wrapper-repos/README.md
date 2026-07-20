# dotenc action wrapper repos

These directories are templates for the public GitHub Action repositories:

- `dotenc/setup-action`
- `dotenc/run-action`
- `dotenc/export-action`
- `dotenc/write-file-action`
- `dotenc/diff-action`

Each wrapper keeps the clean public name (`dotenc/export-action@v1`) while
delegating implementation to this monorepo at
`dotenc/dotenc/actions/<name>@v1`.

Publish flow:

1. Create the corresponding repository in the `dotenc` org.
2. Check out the wrapper repos locally under one parent directory.
3. Run:

   ```bash
   bun run actions:sync-wrappers -- --target-dir ../dotenc-action-wrappers
   ```

4. Review, commit, and push each wrapper repo.
5. Create or move the `v1` tag intentionally in each wrapper repo.

The implementation repo also needs a `v1` ref that contains the implementation
actions in `actions/`. The wrapper `v1` tags should point at wrapper commits
that delegate to the intended implementation `v1`.

For `diff-action`, publish the implementation ref and wrapper together. The
public wrapper delegates to `dotenc/dotenc/actions/diff@v1`; moving only one of
those refs can leave users on mismatched action code. Before moving the
implementation ref, run the diff action tests and typecheck, rebuild its
committed `dist/index.js`, and confirm the bundle check passes.

Keep the wrapper repos intentionally small. The implementation, tests, and
security documentation live here.
