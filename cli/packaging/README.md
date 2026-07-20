# Linux package repository builder

`repository.ts` is the single entrypoint for building the signed APT, RPM,
and Alpine repositories served from `https://packages.dotenc.org`. It consumes
the exact release binaries, fails closed on key/signature mismatches, and emits
an upload manifest with explicit content types, cache headers, and three-phase
publication ordering.

## Build

The input directory must contain:

- `dotenc-linux-x64` and `dotenc-linux-arm64` (baseline glibc)
- `dotenc-linux-x64-musl` and `dotenc-linux-arm64-musl`

Run `bun cli/packaging/repository.ts --help` for the complete interface. The
production form is:

```sh
DOTENC_APT_GNUPGHOME="$APT_CI_GNUPGHOME" \
DOTENC_RPM_GNUPGHOME="$RPM_CI_GNUPGHOME" \
NFPM_RPM_KEY_FILE="$KEYS/rpm.secret-subkeys.asc" \
NFPM_RPM_PASSPHRASE_FILE="$KEYS/rpm.passphrase" \
NFPM_APK_KEY_FILE="$KEYS/apk.rsa.pem" \
bun cli/packaging/repository.ts \
  --version "$VERSION" \
  --input-dir cli/dist \
  --output-dir "$OUTPUT" \
  --source-date-epoch "$TAG_COMMIT_EPOCH" \
  --publication-epoch "$CURRENT_UTC_EPOCH" \
  --apt-gpg-primary-fingerprint "$APT_PRIMARY_FINGERPRINT" \
  --apt-gpg-signing-fingerprint "$APT_SIGNING_FINGERPRINT" \
  --apt-gpg-public-key "$KEYS/apt.asc" \
  --rpm-gpg-primary-fingerprint "$RPM_PRIMARY_FINGERPRINT" \
  --rpm-gpg-signing-fingerprint "$RPM_SIGNING_FINGERPRINT" \
  --rpm-gpg-public-key "$KEYS/rpm.asc" \
  --apk-public-key "$KEYS/apk.rsa.pub" \
  --apk-key-name "$APK_KEY_NAME"
```

Omit `NFPM_RPM_PASSPHRASE_FILE` when the test key has no passphrase. The
builder deliberately rejects a clear `NFPM_RPM_PASSPHRASE` environment value.
Only stable `X.Y.Z` versions are accepted; distro-specific prerelease ordering
is intentionally outside this MVP.

Use separate, subkey-only `DOTENC_APT_GNUPGHOME` and
`DOTENC_RPM_GNUPGHOME` directories in production. `GNUPGHOME` remains a local
fallback for one combined subkey-only keyring. In either case the builder
passes it only to the exact GPG secret-key listing and signing subprocesses;
nFPM and repository/package tools never inherit it.

The build requires nFPM `2.47.0` exactly, plus `apt-ftparchive`, `gzip`,
`createrepo_c`, `gpg`, `gpgv`, `rpm`, `rpmkeys`, `dpkg-deb`, `apk`,
`abuild-gzsplit`, and `abuild-sign`. On an Ubuntu runner, provide pinned Alpine
container wrappers with `DOTENC_APK_COMMAND`, `DOTENC_ABUILD_GZSPLIT_COMMAND`,
and `DOTENC_ABUILD_SIGN_COMMAND`; each override is an executable path, not a
shell command string.

## Metadata refresh

Weekly refreshes must reuse the archived package bytes instead of rebuilding a
released version:

```sh
bun cli/packaging/repository.ts \
  --version "$VERSION" \
  --package-source-dir "$BUNDLE/public" \
  --package-source-manifest "$BUNDLE/package-bundle-manifest.json" \
  --output-dir "$OUTPUT" \
  --source-date-epoch "$TAG_COMMIT_EPOCH" \
  --publication-epoch "$CURRENT_UTC_EPOCH" \
  ...the same APT, RPM, and APK public-key/signing flags...
```

The source manifest pins the exact six signed package paths, sizes, SHA-256
digests, version, suite, component, and immutable source epoch. Its required
adjacent `package-bundle-manifest.json.asc` is signed by the exact APT signing
subkey. Refresh verifies that signature and all six digests before trusting the
bundle, then preserves both manifest files byte-for-byte. Refresh mode skips
nFPM and does not require `NFPM_RPM_KEY_FILE`; it still requires the APK private
key to sign the new index.

## Local test keys

Never use these commands for production custody. They create disposable,
short-lived test identities with offline-primary stubs in a separate CI
keyring, matching the builder's validation rules:

```sh
OFFLINE_GNUPGHOME=$(mktemp -d)
APT_CI_GNUPGHOME=$(mktemp -d)
RPM_CI_GNUPGHOME=$(mktemp -d)
KEYS=$(mktemp -d)
chmod 700 "$OFFLINE_GNUPGHOME" "$APT_CI_GNUPGHOME" \
  "$RPM_CI_GNUPGHOME" "$KEYS"

for PURPOSE in APT RPM; do
  IDENTITY="dotenc $PURPOSE test <${PURPOSE}@example.invalid>"
  GNUPGHOME="$OFFLINE_GNUPGHOME" gpg --batch --passphrase '' \
    --quick-gen-key "$IDENTITY" rsa4096 cert 45d
  PRIMARY=$(GNUPGHOME="$OFFLINE_GNUPGHOME" gpg --with-colons \
    --list-keys "$IDENTITY" | awk -F: '$1 == "fpr" { print $10; exit }')
  GNUPGHOME="$OFFLINE_GNUPGHOME" gpg --batch --passphrase '' \
    --quick-add-key "$PRIMARY" rsa4096 sign 45d
  SIGNING=$(GNUPGHOME="$OFFLINE_GNUPGHOME" gpg --with-colons \
    --with-subkey-fingerprint --list-keys "$PRIMARY" | \
    awk -F: '$1 == "sub" { found=1; next } found && $1 == "fpr" { print $10; exit }')
  LOWER=$(printf '%s' "$PURPOSE" | tr '[:upper:]' '[:lower:]')
  GNUPGHOME="$OFFLINE_GNUPGHOME" gpg --armor --export "$PRIMARY" \
    > "$KEYS/$LOWER.asc"
  GNUPGHOME="$OFFLINE_GNUPGHOME" gpg --batch --passphrase '' --armor \
    --export-secret-subkeys "$SIGNING!" > "$KEYS/$LOWER.secret-subkeys.asc"
  chmod 600 "$KEYS/$LOWER.secret-subkeys.asc"
  if [ "$PURPOSE" = APT ]; then
    CI_HOME=$APT_CI_GNUPGHOME
  else
    CI_HOME=$RPM_CI_GNUPGHOME
  fi
  GNUPGHOME="$CI_HOME" gpg --batch --import \
    "$KEYS/$LOWER.asc" "$KEYS/$LOWER.secret-subkeys.asc"
done

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 \
  -out "$KEYS/apk.rsa.pem"
openssl pkey -in "$KEYS/apk.rsa.pem" -pubout -out "$KEYS/apk.rsa.pub"
chmod 600 "$KEYS/apk.rsa.pem"
APK_DIGEST=$(openssl pkey -pubin -in "$KEYS/apk.rsa.pub" -outform DER | \
  openssl dgst -sha256 -r | awk '{print $1}')
APK_KEY_NAME="dotenc-$APK_DIGEST"
```

Read the APT and RPM fingerprints from `gpg --with-colons --list-keys` in their
respective CI keyrings, set
`NFPM_RPM_KEY_FILE="$KEYS/rpm.secret-subkeys.asc"`, and run the build command
above. A successful build has already verified:

- APT `InRelease` with isolated `gpgv` and the exact signing subkey;
- the detached signature on `package-bundle-manifest.json` with that same exact
  APT identity;
- both signed RPM packages and both signed `repomd.xml` roots;
- both RSA256-signed APK packages and indexes using the fingerprinted key name;
- package name, version, and architecture metadata; and
- that unrelated parent-process secrets were not inherited by tool subprocesses.

## Outputs and publication order

- `public/` contains only the allowed `apt/`, `rpm/`, `apk/`, and `keys/`
  namespaces.
- `package-bundle-manifest.json` and its ASCII detached `.asc` signature are the
  authenticated, deterministic six-package rollback and metadata-refresh
  bundle contract.
- `publication-manifest.json` is sorted by phase and path. The publisher uploads
  phase 1 immutable objects and phase 2 aliases/dependencies, defers each RPM
  detached signature until it can upload that signature and root consecutively,
  and then publishes the remaining phase 3 signed roots. It finally purges every
  listed path together to clear both stale content and cached 404/410 responses.

RPM requires a detached `repomd.xml.asc`, so R2 cannot make that pair fully
atomic. The publisher uploads the signature immediately before `repomd.xml`;
the brief race is availability-only because clients fail signature verification
closed.

APT/RPM immutable public-certificate object names include both the primary
fingerprint and SHA-256 of the exact certificate bytes; generated bootstrap
configs use those objects. Stable aliases remain convenience links only. APT's
`Valid-Until` limits stale-metadata replay to 14 days. RPM and APK metadata do
not provide an equivalent expiry field, so their freshness depends on the
scheduled publisher and Cloudflare purge/monitoring controls.

## Arch Linux / AUR recipe

`aur.ts` renders the complete, deterministic `dotenc-bin` AUR repository input:
`PKGBUILD`, `.SRCINFO`, and an `install-method` marker. It selects the glibc
`dotenc-linux-x64.tar.gz` and `dotenc-linux-arm64.tar.gz` release assets from
the existing `SHA256SUMS` file, installs the binary as `/usr/bin/dotenc`, and
installs the marker as `/usr/share/dotenc/install-method` with the value `aur`.

```sh
bun cli/packaging/aur.ts \
  --version 1.2.3 \
  --checksums cli/dist/SHA256SUMS \
  --output-dir /tmp/dotenc-bin-aur
```

The recipe declares `x86_64` for official Arch Linux and `aarch64` for the
Arch Linux ARM community. AUR publication is separate from the signed APT,
RPM, and APK repository builder: it consumes checksum-pinned GitHub release
assets and does not use any of the package-repository signing keys.
