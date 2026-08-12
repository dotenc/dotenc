# 1Password SSH key connector design

## Status

Implemented in the CLI. Automated coverage uses generated keys and a fake
`op` executable; validation against real 1Password desktop authorization is
still required on each supported desktop operating system.

## Decision summary

dotenc should optionally use SSH Key items already stored in 1Password without
requiring project configuration or a 1Password shell plugin.

- `dotenc init` and interactive `dotenc key add` should show local keys
  immediately and discover supported 1Password SSH keys only after the user
  chooses a dedicated action.
- 1Password accounts must appear as separate categories. Account, vault, and
  item titles are presentation only; stable IDs identify every selection.
- Commands that decrypt environments, including `dotenc run`, should retrieve
  private material only for a key whose fingerprint is authorized by the
  selected environment.
- Successful selections and private-key retrievals should cache only the
  fingerprint-to-locator mapping in the user's machine-local cache. Warm
  decryptions should use that locator directly instead of repeating discovery.
- 1Password may present its normal system authorization dialog. Explicit user
  authorization is part of the intended flow, not an error or configuration
  step.
- Private keys retrieved from 1Password remain process-only by default. They
  must never be written to disk unless the user explicitly confirms the local
  `~/.ssh` copy option, and must never be forwarded to the wrapped command or
  included in logs or diagnostics.

The integration should use the installed `op` CLI directly. A shell plugin is
not the foundation for this feature because shell plugins require per-tool
initialization and a configured default credential, while this design requires
dotenc to discover and fingerprint-match all available SSH Key items.

## Goals

- Zero dotenc configuration for users who already have the 1Password CLI and
  desktop app integration configured.
- Preserve the existing behavior when `op` is absent or no 1Password accounts
  or supported SSH keys are available.
- Make account boundaries and duplicate item titles unambiguous.
- Reuse the current RSA and Ed25519 validation and cryptographic paths.
- Avoid retrieving private material during key discovery and selection.
- Retrieve at most one matching 1Password private key for a decryption
  operation.
- Skip account and item discovery when a verified machine-local locator is
  already available.
- Offer an explicit, secure-by-default choice between locator-only operation
  and an unencrypted local `~/.ssh` copy that avoids future provider prompts.
- Fail closed when the retrieved key does not match its discovered fingerprint
  or the environment recipient.

## Non-goals

- Synchronizing dotenc environments or variables with 1Password.
- Requiring or configuring a 1Password shell plugin.
- Replacing 1Password's SSH Agent or using it as a decryption API.
- Creating, importing, editing, moving, or deleting 1Password items.
- Persisting account, vault, or item IDs in the repository.
- Service-account or unattended CI support in the initial phase. Existing
  `DOTENC_PRIVATE_KEY_BASE64` and `DOTENC_PRIVATE_KEY` inputs remain the
  automation paths.
- Supporting key algorithms that dotenc does not already accept. The initial
  connector supports Ed25519 and RSA keys of at least 2048 bits.

## 1Password prerequisites and detection

The connector is available when all required local pieces are usable:

1. `op` resolves from `PATH` and `op --version` reports a supported 2.x release.
2. `op account list --format json` returns at least one configured account.
3. The selected account can be authorized through the user's existing
   1Password CLI authentication flow.

The desktop app integration is the intended local authentication path. Its
system authorization prompt and session lifetime remain owned by 1Password.
dotenc must not attempt to reproduce, suppress, or bypass that authorization.

Detection should be quiet until 1Password access is actually useful. If an
environment can already be decrypted with an environment-provided or local
filesystem key, runtime commands should not invoke `op` or trigger an
authorization prompt.

References:

- [1Password CLI app integration](https://www.1password.dev/cli/app-integration)
- [1Password CLI app integration security](https://www.1password.dev/cli/app-integration-security)
- [Managing SSH keys in 1Password](https://www.1password.dev/ssh/manage-keys)

## Stable identities and account categories

`op account list --format json` returns an `account_uuid` for each configured
account. dotenc must use the complete `account_uuid` as the canonical account
identity and pass it explicitly to every account-scoped command:

```text
op ... --account <account_uuid>
```

Email addresses, sign-in URLs, account titles, recently used accounts, and
list order must not be used as identities. They may be used as display labels.
If display labels collide, append a shortened account ID for the human-facing
label while retaining the complete ID internally.

A discovered 1Password key is uniquely addressed by this tuple:

```ts
type OnePasswordKeyLocator = {
	accountId: string
	vaultId: string
	itemId: string
}
```

Interactive option values should encode the complete tuple rather than the
item title. One acceptable internal representation is:

```text
1password:<account_uuid>:<vault_id>:<item_id>
```

The key fingerprint remains the cryptographic identity. The locator only tells
dotenc where to retrieve the current item. A 1Password item ID may change when
the item moves to another vault, so a failed or mismatched cached lookup must be
evicted and rebuilt through discovery rather than treated as a permanent
cryptographic identifier.

1Password documents IDs as the stable and efficient way to address objects and
supports an account ID with `--account`:

- [1Password CLI identifiers](https://www.1password.dev/cli/reference#unique-identifiers-ids)
- [Using multiple 1Password accounts](https://www.1password.dev/cli/use-multiple-accounts)

## Key candidate model

The current private-key discovery helper eagerly returns parsed private keys.
The connector needs a lazy candidate model so discovery can operate on public
metadata and private material can be loaded only when necessary.

The implementation should introduce a contract equivalent to:

```ts
type KeyCandidate = {
	source: "environment" | "filesystem" | "1password"
	selector: string
	name: string
	fingerprint: string
	algorithm: "rsa" | "ed25519"
	publicKey: crypto.KeyObject
	loadPrivateKey: () => Promise<crypto.KeyObject>
}
```

The exact type may differ, but it must preserve these properties:

- discovery exposes the public key, algorithm, fingerprint, source, and an
  unambiguous selector;
- discovering a 1Password candidate does not retrieve its private key;
- callers that only need public material never call `loadPrivateKey`;
- the private loader verifies that the retrieved key still has the expected
  fingerprint;
- 1Password account, vault, and item IDs stay provider-specific and do not
  become part of dotenc's encrypted environment schema.

This refactor should preserve the existing environment-variable priority and
filesystem behavior in
[`getPrivateKeys.ts`](../cli/src/helpers/getPrivateKeys.ts).

## Discovery flow

### Accounts

1. Run `op account list --format json --no-color` using a direct child-process
   invocation.
2. Validate the JSON shape and collect the complete `account_uuid` plus safe
   display metadata.
3. Sort categories deterministically by display label, then account ID.
4. Query every account with an explicit `--account <account_uuid>` argument.

Authorization is per account. If access to an account is declined or fails,
dotenc must report that the account was unavailable. It must not silently
represent an unauthorized account as an account containing no SSH keys.

### SSH Key items

For each authorized account:

1. List active SSH Key items with `op item list --categories "SSH Key"
   --format json --account <account_uuid>`.
2. Address items by item and vault ID, never by title.
3. Retrieve only the public-key and fingerprint metadata needed for discovery.
   Do not use `--reveal` and do not retrieve private fields.
4. Parse and normalize the public key through Node's cryptographic APIs.
5. Calculate the canonical dotenc fingerprint with the existing
   [`getKeyFingerprint.ts`](../cli/src/helpers/getKeyFingerprint.ts) helper.
   Do not trust a display-formatted provider fingerprint as dotenc's canonical
   comparison value.
6. Apply the existing public-key policy: Ed25519 or RSA with a modulus of at
   least 2048 bits.

The exact JSON representation of SSH public-key details must be captured as
versioned test fixtures during implementation. Malformed or unsupported items
should appear in the existing unsupported-key diagnostics without exposing
their field values.

## Interactive selection UX

`dotenc init` and interactive `dotenc key add` should initially render local
keys and actions without invoking `op`:

```text
Local - ~/.ssh
  id_ed25519                                      ed25519
  id_rsa                                          rsa

Actions
  Use a key from 1Password                        load available SSH keys
  Create a new SSH key                            ed25519, recommended
```

Choosing the 1Password action should temporarily render a loading group while
public metadata discovery runs:

```text
1Password
  ◒ Loading SSH keys...
```

When discovery finishes, that temporary group is replaced by one category per
account:

```text
1Password - personal.1password.com [ABCD...1234]
  GitHub                                          ed25519
  Production                                      rsa

1Password - company.1password.com [WXYZ...9876]
  GitHub                                          ed25519
  Production                                      ed25519
```

Local keys and the remaining actions stay available in the refreshed picker.

Category headings are non-selectable. A complete account ID is never required
for visual scanning, but the selected value always contains the complete
account, vault, and item IDs.

The existing Consola select option supports labels, values, and hints but not
group headings. The implementation therefore needs a small grouped-select UI
extension instead of simulating headings with selectable options. The existing
flat picker remains valid for callers that do not need grouping.

Duplicate titles are valid, including duplicates within the same account.
Category boundaries and ID-backed option values must keep all such entries
distinct. Vault information may be added to the hint when two items in one
account would otherwise be visually identical.

### Non-interactive selection

Existing filesystem names remain valid for backwards compatibility. A
1Password key used with `--private-key` should use the fully qualified provider
selector. An unqualified 1Password title must not be accepted when it could
resolve to more than one item.

Error output may show a copyable qualified selector, but it should avoid
printing unrelated account or item identifiers.

## `dotenc init` and `dotenc key add`

The initialization and interactive key-add flows need only public key material:

1. Discover environment-provided and filesystem candidates.
2. Show them immediately with a **Use a key from 1Password** action.
3. Only after that action is selected, discover 1Password public metadata and
   replace the temporary loading group with stable account categories.
4. When a 1Password candidate is selected, use the already retrieved and
   validated public key and cache its fingerprint-to-locator mapping locally.
5. In an interactive terminal, explain the security trade-off and default to
   keeping the private key in 1Password.
6. Only after explicit confirmation, retrieve and fingerprint-verify the
   private key, then write the returned unencrypted OpenSSH copy under a generated,
   non-conflicting `~/.ssh/id_<algorithm>_1password_<fingerprint>` path with
   mode `0600`.
7. Export the public key in dotenc's existing SPKI PEM format.
8. Continue through the existing `key add` and environment creation paths.

These flows must not call `op read` merely to derive information already
available in public metadata. They may retrieve the private field only after
the user explicitly confirms the local-copy option. Non-interactive selection
keeps the locator-only behavior.

The repository key name remains owned by dotenc's existing prompts and
arguments. It does not need to equal the 1Password item title.

## Runtime decryption flow

Commands that need to decrypt an environment should resolve keys in this order:

1. Read the selected environment and its authorized recipient fingerprints.
2. Check environment-provided bootstrap keys.
3. Check keys in `~/.ssh`.
4. If no available local key matches an authorized fingerprint, check the
   machine-local locator cache for those fingerprints.
5. When a cached locator exists, retrieve that item directly and require its
   recalculated fingerprint to match the environment recipient.
6. If the cache misses or the locator is evicted after a failed or mismatched
   read, discover 1Password public candidates once.
7. Find a 1Password candidate whose canonical fingerprint matches an
   authorized recipient.
8. Retrieve only that item's private key.
9. Parse the key, recalculate its fingerprint, and compare it to both the
   discovered candidate and the environment recipient.
10. Cache the verified fingerprint-to-locator mapping and use the existing
    data-key decryption path.
11. Release references to the retrieved private material as soon as the
   operation completes.

Private key retrieval should use an ID-addressed secret reference and the
OpenSSH output format supported by the CLI, equivalent to:

```text
op read --account <account_uuid> \
  "op://<vault_id>/<item_id>/private_key?ssh-format=openssh"
```

`private_key` is the stable ID of the built-in SSH private-key field. Using the
field ID instead of its display label keeps retrieval independent of the
1Password account's language.

See the [1Password `op read` reference](https://www.1password.dev/cli/reference/commands/read).

If identical key material exists in multiple items, the candidates have the
same cryptographic fingerprint and are equivalent for dotenc access. Select one
using a deterministic full-locator ordering and retrieve only that copy.

All commands that share the private-key resolver should receive the same
capability, including `run`, `dev`, environment edit/decrypt flows, and
operations that must decrypt an environment before rotating access. The
connector must not be implemented only as a special case inside `run`.
`textconv` may use the locator-cache fast path, but it must never run full
1Password discovery. A warm cache therefore permits one direct `op read` and
the native authorization dialog. A cold, stale, declined, or mismatched lookup
returns encrypted content to Git immediately after the bounded direct read
fails; it does not fan out into account and item scans.

Identity-only flows may discover public metadata for project identities that
do not match a local private key. Plain `dev` keeps a local match provider-free;
an explicit `dev --identity` may broaden discovery so a 1Password-only project
identity remains selectable without retrieving private material early.

## Security boundaries

### Child process execution

- Invoke `op` directly with an argv array; never construct a shell command.
- Use JSON and no-color output for structured discovery.
- Set output limits and bounded timeouts. Discovery has a 60-second overall
  deadline, and public metadata reads use at most four concurrent `op item get`
  calls per account. An account whose discovery exceeds the deadline is
  reported as unavailable instead of being treated as empty.
- Treat unexpected stdout, malformed JSON, and nonzero exits as provider
  errors.
- Do not echo arbitrary `op` stdout or stderr in dotenc diagnostics.

### Private key handling

- Never pass a private key in command arguments.
- Capture the selected `op read` output through a pipe.
- Never write it to an environment variable, persistent cache, debug log,
  exception, or telemetry event.
- Never write it to a file unless an interactive user explicitly confirms the
  local-copy option. That copy must use a generated fingerprint-backed filename,
  exclusive creation, a `0700` SSH directory, and a `0600` private-key file.
- Never forward it to the command launched by `dotenc run`.
- Within one decryption batch, reuse discovery and a selected private key only
  in memory. Release the batch references before launching a wrapped command.
- Minimize intermediate strings and buffers, and zero mutable buffers where
  practical.
- Continue zeroing derived Ed25519 seed and PKCS#8 buffers in the existing
  decryption implementation.
- Verify the private key's fingerprint after retrieval to close the gap between
  discovery and use.

Unlike the 1Password SSH Agent, `op read` exports the private key into the
dotenc process. The SSH Agent exposes signing operations and cannot perform the
RSA/Ed25519 private decryption dotenc requires. The connector must document
this distinction and keep the exported key's lifetime as short as possible.

### Authorization scope

1Password CLI authorization is account- and terminal-session-scoped, not a
per-key decryption capability. dotenc must let 1Password present its native
authorization dialog and must not describe that approval as a key-specific SSH
Agent authorization.

### Metadata

Account, vault, and item IDs are not secret key material, but they reveal
provider structure and should be handled as private local metadata:

- do not commit them to `.dotenc`, encrypted environment files, or other
  project files;
- do not print complete IDs in routine UI;
- persist them only in the disposable machine-local locator cache, keyed by the
  canonical public-key fingerprint;
- never cache item titles, vault names, account URLs, public keys, private keys,
  project paths, authorization failures, or empty discovery results;
- create cache directories and files with modes `0700` and `0600`, use atomic
  replacement, validate a bounded versioned schema, and treat corruption as a
  cache miss;
- treat the cache as untrusted metadata: recalculate the retrieved private
  key's fingerprint before use and evict failed or mismatched locators.

On Unix-like systems the default root is `~/.cache/dotenc`, overridden by an
absolute `XDG_CACHE_HOME`. Windows uses `%LOCALAPPDATA%\dotenc\Cache`. Each
fingerprint has an independently replaceable entry so concurrent Git processes
cannot overwrite unrelated mappings.

## Failure behavior

| Condition | Required behavior |
| --- | --- |
| `op` is absent | Preserve the current environment and `~/.ssh` behavior without a warning. |
| No configured accounts | Preserve current behavior; mention 1Password only when explaining why no key was available. |
| Account authorization is required | Allow the native 1Password dialog to appear. |
| Authorization is declined | Report the affected account as unavailable; do not call it empty. |
| One of several accounts fails | Keep successful categories available and explicitly report the unavailable account. |
| No supported SSH Key items | Omit that account's empty key category; when no local key exists, preserve the no-private-keys guidance. |
| Duplicate account or item labels | Keep entries distinct through complete ID-backed values and disambiguating hints. |
| Cached item moved, removed, or mismatched | Evict the locator; normal decryptions rediscover once, while `textconv` returns encrypted content without scanning. |
| Confirmed local-copy write fails | Remove any partially created file, preserve existing files, warn safely, and continue with locator-only behavior. |
| Public/private fingerprint mismatch | Reject the key and fail closed before data-key decryption. |
| No candidate matches an environment | Return access denied only when at least one supported local or provider key was found; otherwise preserve the no-private-keys guidance. |
| `op` returns malformed or excessive output | Treat the provider as failed and do not parse partial key material. |
| Wrapped command starts | Ensure no 1Password private key is present in its argv or environment. |

## Compatibility

- `DOTENC_PRIVATE_KEY_BASE64` remains the preferred automation bootstrap input.
- `DOTENC_PRIVATE_KEY` remains the legacy raw-input path.
- Existing `~/.ssh` discovery, passphrase behavior, selectors, and key creation
  remain supported.
- Interactive local-key selection does not invoke `op`; 1Password discovery is
  an explicit action in the picker.
- Local matching keys take priority so existing users do not receive a new
  authorization prompt.
- The connector is optional at runtime and must not add a package-time or
  install-time dependency on 1Password.
- Standalone binaries invoke the user's installed `op` executable from `PATH`.

## Implementation outline

1. Add an `op` process adapter with strict JSON parsing, timeouts, output caps,
   account enumeration, SSH-item discovery, and selected-key retrieval.
2. Introduce the lazy key-candidate contract and adapt environment-variable
   and filesystem discovery to it.
3. Add grouped select support to the prompt layer.
4. Integrate opt-in public-only candidate discovery into `dotenc init` and
   interactive `dotenc key add` without delaying the initial local picker.
5. Integrate cache-first fingerprint-matched retrieval into the shared
   environment decryption path.
6. Allow `textconv` to use cached locators without enabling full discovery.
7. Update safe user-facing diagnostics for local and 1Password sources.
8. Update `SECURITY.md` when implementation changes key handling and child
   process execution.
9. Add unit, packaging, and manual integration coverage before documenting the
   connector as shipped.

## Acceptance criteria

- With no `op` executable, local key flows stay unchanged; choosing the
  1Password action reports that the CLI is not installed and keeps local keys
  available.
- Opening the interactive key picker and selecting a local key never invokes
  `op`; selecting the 1Password action invokes discovery once.
- With one 1Password account, supported SSH keys appear under one account
  category alongside the local-key category.
- With multiple accounts, every account has a distinct category backed by its
  complete `account_uuid`.
- Duplicate account labels, vault names, and item titles cannot select the
  wrong item.
- `dotenc init` and interactive `dotenc key add` retrieve a private 1Password
  field only after explicit confirmation of the local-copy option.
- Selecting a 1Password key stores only its public key in the dotenc project.
- Declining the local-copy prompt stores no private key outside 1Password;
  confirming it writes one fingerprint-verified unencrypted copy to `~/.ssh`.
- Selecting or successfully using a 1Password key stores only its fingerprint
  and opaque account, vault, and item IDs in the machine-local locator cache.
- A local decryption flow prompts through 1Password when no environment-provided
  or local filesystem key matches, retrieves one matching private key, and
  decrypts the environment successfully.
- A batch that decrypts multiple environments with the same 1Password item runs
  discovery and retrieves that private key only once.
- A later process with a warm locator skips account and item discovery and goes
  directly to one fingerprint-verified `op read`.
- `textconv` uses a warm locator but never runs full 1Password discovery.
- A retrieved key with a different fingerprint is rejected before use.
- RSA 2048+ and Ed25519 items work; weaker RSA and unsupported algorithms are
  rejected consistently with filesystem keys.
- Denied authorization, unsupported CLI versions, unavailable accounts,
  malformed output, and missing items have distinct safe diagnostics.
- Private key material never reaches files, logs, error messages, persistent
  caches, telemetry, or wrapped child processes.
- Unit tests use a fake `op` executable or injected process adapter and never
  require real accounts or keys.
- Manual integration smokes cover the supported desktop operating systems and
  verify the actual authorization-dialog lifecycle.

## Follow-up validation

- Verify the recursive public-key metadata extraction against the current
  release and establish a narrower minimum compatible 2.x CLI version. The
  implementation currently accepts `op` major version 2.
- Verify account-denial and partial multi-account behavior on macOS, Linux, and
  Windows.
- Measure repeated-account discovery latency and authorization behavior before
  considering any local metadata cache.
- Verify that private-key buffers can be cleared without weakening support for
  the current RSA and Ed25519 parsing paths.
