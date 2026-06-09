# Passphrase-Protected SSH Keys (Initial Interactive Support)

## Summary

dotenc can use passphrase-protected keys when
`DOTENC_PRIVATE_KEY_PASSPHRASE` is provided.

This first phase adds passphrase handling through
`DOTENC_PRIVATE_KEY_PASSPHRASE`, plus an interactive bridge for conversion:

1. Passphrase-protected keys appear in the key selection list.
2. When selected, dotenc explains both options.
3. dotenc offers to create a passwordless copy (optional), e.g.
   `id_ed25519_passwordless`.
4. The original key remains unchanged.
5. The new passwordless copy is automatically selected and can be added to the
   project like any other supported key.

## Scope

Included:
- `dotenc init` (interactive and non-interactive)
- `dotenc key add` interactive choose mode
- `dotenc key add --from-ssh|--from-file|--from-string` when
  `DOTENC_PRIVATE_KEY_PASSPHRASE` is set
- `DOTENC_PRIVATE_KEY_BASE64`, legacy `DOTENC_PRIVATE_KEY`, and `~/.ssh` key
  discovery with `DOTENC_PRIVATE_KEY_PASSPHRASE`

Not included in this phase:
- direct interactive passphrase entry in dotenc command flows (outside the
  `ssh-keygen` conversion prompt)
- SSH agent integration

## UX Flow

When a passphrase-protected key is selected in interactive chooser mode:

1. dotenc prints that you can either set `DOTENC_PRIVATE_KEY_PASSPHRASE` to use
   it directly or create a passwordless copy.
2. dotenc asks: `Create a passwordless copy of this key now? (optional if DOTENC_PRIVATE_KEY_PASSPHRASE is set)`
3. If user declines, selection returns to the key list.
4. If user accepts:
   - dotenc copies the key to `<original>_passwordless` (or suffixed variants)
   - dotenc invokes `ssh-keygen -p -f <copy> -N ""` so OpenSSH prompts for the
     old passphrase and rewrites the copy without passphrase
   - dotenc re-scans keys and auto-selects the created copy

## Technical Design

### New helper

`cli/src/helpers/createPasswordlessSshKeyCopy.ts`

- Resolves destination name in `~/.ssh` using `_passwordless` suffix.
- Avoids collisions with both private and `.pub` files.
- Copies private key using exclusive copy semantics.
- Enforces `0o600` permissions on the new private key file.
- Executes `ssh-keygen` to strip passphrase from the copy.
- Returns `{ path, name }` for prompt auto-selection.
- On `ssh-keygen` failure, removes the created copy best-effort and returns an
  actionable error.

### Passphrase environment variable

- `DOTENC_PRIVATE_KEY_PASSPHRASE` is used to unlock passphrase-protected
  private keys in both interactive and non-interactive flows.
- Applies to:
  - `DOTENC_PRIVATE_KEY_BASE64`
  - legacy `DOTENC_PRIVATE_KEY`
  - `~/.ssh` key discovery
  - `dotenc key add --from-ssh|--from-file|--from-string` when input is
    passphrase-protected
- dotenc does not prompt for passphrases outside `ssh-keygen` copy conversion.

### Prompt integration

`cli/src/prompts/choosePrivateKey.ts`

- Passphrase keys are now selectable action items instead of disabled entries.
- Non-passphrase unsupported keys remain disabled.
- Adds confirm step before conversion and reworded guidance to mention
  `DOTENC_PRIVATE_KEY_PASSPHRASE`.
- On success, auto-selects the created key by name after re-scan.
- Non-interactive behavior is unchanged.

## Security Notes

- The original passphrase-protected key is never modified.
- The generated passwordless key is an explicit user opt-in artifact and should
  be treated like any other unencrypted SSH private key.
- dotenc does not prompt for passphrases in normal command execution; when using
  encrypted keys directly, passphrase input is provided via
  `DOTENC_PRIVATE_KEY_PASSPHRASE`.
- In conversion flow, passphrase prompt handling is delegated to `ssh-keygen`.

## Validation Coverage

Added/updated tests cover:

- passphrase key shown as selectable in interactive prompt
- confirm-yes conversion path
- confirm-no loop back to selection
- conversion failure warning + continued selection
- `_passwordless` collision handling
- helper spawn/copy/chmod/failure behavior
- non-interactive passphrase-only behavior unchanged
