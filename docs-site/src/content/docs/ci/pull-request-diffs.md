---
title: "Redacted pull-request diffs"
description: "Redacted pull-request diffs with dotenc, the Git-native encrypted environment CLI."
---

## Redacted pull-request diffs

Encrypted files are opaque in GitHub's native diff, so dotenc can add a
redacted semantic report to each pull request. Install the hardened workflow
with a dedicated, narrowly granted identity:

```bash
dotenc tools install-github-diffs \
  --environment .env.production.enc
```

The report intentionally exposes variable names, recipient changes, and a
changed/unchanged equality signal. Install it only when that disclosure is
acceptable for every pull-request author. Repositories that GitHub reports as
forks require an explicit `--allow-fork` acknowledgement.

The action posts or updates one comment that looks like this:

> ## dotenc environment diff
>
> ### production
>
> _Environment modified · <code>.env.production.enc</code>_
>
> #### Variables
>
> ```diff
> ~ DATABASE_URL
> + OPENAI_API_KEY
> - LEGACY_TOKEN
> ```
>
> #### Access
>
> ```diff
> ~ ci-old → ci-new
> + ci-production
> - contractor-john
> ```
>
> ### development
>
> _Data key rotated · <code>.env.development.enc</code>_

`+` means added or granted, `-` means removed or revoked, and `~` means
changed or renamed. A data-key-only rotation verified through the dedicated
diff recipient gets the compact entry shown above. Formatting-only edits and
same-key ciphertext churn publish no report; with comments enabled, the action
removes its stale bot-owned report comments. Reports contain variable names and
access metadata, never variable values.

The generated workflow is pinned to an immutable action commit and never
checks out pull-request code into the privileged reporting job. See the
[GitHub Actions runbook](/docs/ci/github-actions/)
for the security boundary, fork policy, and manual setup.
