# Official Linux Package Repositories

> [!IMPORTANT]
> **Pre-launch status (2026-07-20):** the R2 bucket, custom domain, Cloudflare
> edge controls, and production signing secrets are provisioned, but the
> repositories are **not yet public or usable**. CI has not yet validated the
> signing-secret contents. A manual, non-publishing validation mode is ready to
> perform that check after this workflow reaches `main`; no first signed
> repository publication has completed. Do not advertise APT, RPM, or APK
> installation until the launch criteria below pass.

This document is the operator and security runbook for the official dotenc
Linux package repositories served from `https://packages.dotenc.org`.

## Ownership and trust boundaries

The package recipes, repository builder, publication workflow, and operational
documentation belong in this `dotenc/dotenc` monorepo. The separate
`dotenc.org` self-hostable cloud-service repository does not own package
publication. Keeping the package supply chain next to the CLI source and release
workflow makes the source revision, standalone binaries, native packages, and
repository metadata reviewable together.

The delivery path has four distinct responsibilities:

1. The dotenc release workflow builds the standalone CLI binaries from a tagged
   source revision and seals the four Linux archives plus `SHA256SUMS` in an
   immutable Actions artifact for the same workflow run. The first package
   signing accepts only that artifact, not mutable GitHub release assets.
2. Dedicated signing keys authenticate the repository metadata and, where the
   package format supports it, the package files themselves. APT authenticates
   `InRelease` and the package hashes reachable from it; dotenc `.deb` files do
   not carry a separate repository signature.
3. The private R2 API stores the published object tree in the
   `dotenc-packages` bucket.
4. Cloudflare exposes that tree only through `packages.dotenc.org`, enforces the
   HTTP policy, caches objects, and provides its managed DDoS protection.

Cloudflare does not establish package authenticity. A valid repository or
package signature, as applicable to the ecosystem, is still required even when
TLS and Cloudflare are functioning correctly. Conversely, signatures do not
prevent denial of service, stale publication, or deletion. Both layers are
required.

Public namespaces are intentionally limited to:

- `/apt/` — Debian and Ubuntu repository objects
- `/rpm/` — RPM repository objects
- `/apk/` — Alpine repository objects
- `/keys/` — public signing keys and repository bootstrap material

The R2 S3-compatible API is the authenticated write path. The R2-managed
`r2.dev` development URL is disabled so it cannot bypass the custom-domain WAF
and cache controls. Bucket listing is not a supported public interface.

## Launch criteria

Do not document the repository as an installation option until all of the
following are complete:

- Create separate offline OpenPGP primary keys and dedicated CI signing subkeys
  for APT and RPM publication. CI must receive secret-subkey-only exports, not
  either primary key's secret material.
- Create a separate Alpine RSA signing key.
- Back up both private primary keys and the Alpine key according to the custody
  policy below; put only the minimum online signing material in GitHub.
- Publish and independently verify the public keys, fingerprints, expiry dates,
  and rotation instructions; record the trust-root fingerprints outside the
  delivery path.
- Rehearse each ecosystem's key transition, including a new package release
  whenever the current exact-identity refresh path changes an APT, RPM, or APK
  signing identity.
- Protect the GitHub `linux-packages` environment and restrict its use to the
  intended release workflow/ref.
- Run the manual `validate_only` workflow on `main` with the current stable
  version. It must policy-check the production keys, build and sign all package
  variants, verify the signed roots, and complete every clean local repository
  install without uploading an artifact, release asset, or R2 object.
- Verify that a first publication can consume only the immutable Linux-input
  artifact produced in the same release run. Manual and scheduled invocations
  must remain refresh-only.
- Produce the first signed publication without exposing private key material in
  logs, artifacts, caches, or repository history.
- Install and run `dotenc --version` from each repository in clean Debian,
  RPM-based, and Alpine test environments.
- Verify the public edge controls and cache headers described below.
- Exercise the metadata rollback procedure with a non-production publication.
- Only then update user-facing installation docs and `install.sh`.

## Provisioned Cloudflare baseline

The current production edge baseline is:

| Control | Required state |
| --- | --- |
| R2 bucket | `dotenc-packages`, Standard storage class |
| Public hostname | `packages.dotenc.org`, connected directly as the R2 custom domain |
| Origin bypass | Public `r2.dev` access disabled; R2 API writes require credentials |
| TLS | Minimum TLS version 1.2 |
| Methods | Only `GET` and `HEAD` |
| Paths | Only `/apt/`, `/rpm/`, `/apk/`, and `/keys/` prefixes |
| Query strings | Rejected by WAF; also ignored in the cache key as defense in depth |
| Cache eligibility | Matching `GET`/`HEAD` responses are eligible only when they carry `Cache-Control`; otherwise caching is bypassed |
| Browser TTL | Respect the origin object metadata |
| Cache key | Ignore query strings and enable cache-deception armor |
| Validation | Respect strong ETags for byte-for-byte revalidation |
| Revalidation | Do not serve stale content while an object is being revalidated |
| Negative caching | For allowed-path `404` and `410`, send `max-age=0, must-revalidate` to clients and set a separate Cloudflare edge TTL of 30 seconds; browsers do not reuse misses |
| Origin errors | Add `Cache-Control: no-store` to `5xx` responses |
| Tiering | Smart Tiered Cache enabled |

The WAF rule blocks the hostname root, paths outside the four prefixes, methods
other than `GET`/`HEAD`, and every request with a non-empty query string. The
cache key also ignores query strings so a future WAF regression cannot create
unbounded cache variants or allow query-string cache poisoning.

Cloudflare documents why an R2 custom domain is required for caching and WAF,
and recommends disabling `r2.dev` when those controls matter:
[R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/).
The cache behavior above follows
[Cache Rules settings](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/).

Treat this table as a drift checklist. Review it after any zone, bucket, DNS,
cache, or WAF change.

## Object cache policy

Set `Cache-Control` as R2 object metadata at upload time. The edge rule follows
origin cache headers and bypasses cache when the header is absent. The negative
response policy is applied at the edge because a missing R2 object has no
object metadata.

| Class | Examples | `Cache-Control` |
| --- | --- | --- |
| Immutable | Versioned `.deb`, `.rpm`, and `.apk` files; APT `by-hash` objects; checksum-named repository metadata; OpenPGP certificates named by primary fingerprint plus exact certificate digest; fingerprint-named APK public keys | `public, max-age=31536000, s-maxage=31536000, immutable, no-transform` |
| Mutable | APT `InRelease` and unhashed indexes; RPM `repodata/repomd.xml`; APK index roots; unversioned repository configs and key aliases | `public, max-age=60, s-maxage=300, must-revalidate, no-transform` |
| Negative response | Allowed-path `404` and `410` responses | Client-visible `max-age=0, must-revalidate`; separate Cloudflare status-code TTL of 30 seconds |

`max-age` controls browsers and package-manager HTTP caches; `s-maxage`
controls Cloudflare's shared cache. One year is safe only for content-addressed
or versioned paths that are never overwritten. Mutable roots get a 60-second
client TTL and a 300-second edge TTL to balance propagation time and origin
load. Negative responses are not reusable by browsers (`max-age=0`), while the
Cloudflare-only status-code rule may absorb repeated misses for 30 seconds. The
edge TTL is not advertised to clients through `s-maxage`.

Rules for object metadata:

- Never overwrite an immutable path with different bytes. Fail the publication
  if the remote object already exists with a different digest.
- Upload a strong ETag and a recorded SHA-256 digest where the publishing API
  supports them. Verify the SHA-256 manifest independently; an ETag is not a
  release signature.
- Give every public object an explicit content type and `Cache-Control` value.
- Name each immutable OpenPGP certificate object with both its primary-key
  fingerprint and the SHA-256 digest of the exact published certificate bytes.
  The fingerprint identifies the trust root; the digest lets a renewed
  certificate or changed subkey set coexist without overwriting the old object.
  APK public-key objects use the SHA-256 fingerprint of the public SPKI DER. An
  unversioned key URL is only a mutable bootstrap alias.
- Do not use query parameters for versions, cache busting, signatures, or
  repository selection. They are deliberately rejected.

## Publication transaction

Build and verify the complete repository tree before changing any public
metadata root. Publication order is part of the consistency model:

The initial publication runs only as the release workflow's `push`-triggered
same-run job and consumes the exact artifact ID emitted for its immutable
`linux-package-inputs-v<version>-attempt-<run-attempt>` Actions artifact.
`workflow_dispatch` and scheduled runs refuse to perform a first publication.
The manual dispatch defaults to `validate_only=true`: it builds the four Linux
binaries from the checked-out `main` revision, exercises the complete
production-key signing and clean-install path, and skips release-asset upload,
Actions artifact retention, R2 publication, cache purge, and public-edge
verification. This is a credential and builder preflight, not a release input;
it cannot create the canonical bundle or make a repository public. After the
first publication, the canonical GitHub release bundle contains the exact six
signed packages, a package digest manifest, and that manifest's detached
APT-subkey signature. Every refresh verifies that detached signature and all
package hashes before preserving the package set byte for byte and rebuilding
only repository metadata. The adjacent bundle checksum is a transport-integrity
check; the detached OpenPGP signature is the durable refresh trust input.

1. Build packages and metadata in an isolated temporary directory.
2. Verify package contents, checksums, repository signatures, signing-key
   fingerprints, and expected CLI version through clean local repository
   installs before publication.
3. Upload new immutable package objects, content-addressed metadata, and
   fingerprinted public keys with create-only semantics.
4. Upload mutable metadata dependencies that are not yet reachable from a
   public root, deferring each RPM `repomd.xml.asc` until its matching root is
   ready.
5. For each RPM architecture, upload `repomd.xml.asc` and immediately upload
   its matching `repomd.xml`. R2 cannot replace this detached-signature pair
   atomically, so keeping the two writes consecutive minimizes—but cannot
   eliminate—the fail-closed mismatch window.
6. Upload the self-contained APT `InRelease` and APK index roots. A client must
   never see metadata that references an object that has not finished uploading.
7. Purge exact URLs for every changed mutable root and for every newly created
   URL that could have a cached `404`/`410` response.
8. Fetch and compare the published configs, immutable bootstrap keys, package
   bytes, and signed repository roots through `packages.dotenc.org`; verify
   positive and negative cache behavior, range requests, and signing identities.

Purge exact URLs only. A hostname-wide purge throws away immutable cache
coverage, raises R2 read load, and expands the effect of an operator mistake.
Purging newly created URLs matters because missing objects are intentionally
cached for 30 seconds.

If publication fails before step 5, leave the old public roots untouched and
retry after correcting the failure. The exception is an interruption between an
RPM signature write and its immediately following root write: the old root then
has a mismatched detached signature and RPM clients fail closed. Restore or
finish that exact pair immediately and purge both URLs. If publication fails
after any root changes, use the rollback procedure; do not continue publishing
unrelated roots.

## GitHub `linux-packages` environment

The production publisher uses the GitHub environment named `linux-packages`.
Its currently provisioned configuration contract is:

| Kind | Name | Purpose / expected value |
| --- | --- | --- |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Account that owns the R2 bucket |
| Variable | `CLOUDFLARE_ZONE_ID` | `dotenc.org` zone used for exact-URL purge |
| Variable | `R2_BUCKET` | `dotenc-packages` |
| Variable | `R2_ENDPOINT` | Account-scoped R2 S3 endpoint |
| Variable | `PACKAGES_BASE_URL` | `https://packages.dotenc.org` |
| Repository variable (launch gate) | `LINUX_PACKAGES_ENABLED` | Keep unset or not `true` until every launch criterion passes; `true` enables the gated publisher and weekly refresh |
| Secret | `R2_ACCESS_KEY_ID` | Access-key ID for the bucket-scoped publisher token |
| Secret | `R2_SECRET_ACCESS_KEY` | Secret half of the R2 publisher credential |
| Secret | `CLOUDFLARE_CACHE_PURGE_TOKEN` | Token limited to cache purge for the `dotenc.org` zone |
| Secret | `PACKAGE_APT_GPG_PRIVATE_KEY_BASE64` | Base64 of an ASCII-armored APT secret-signing-subkey export with only a dummy primary-key stub |
| Secret | `PACKAGE_APT_GPG_PASSPHRASE` | Passphrase for the APT signing subkey |
| Secret | `PACKAGE_RPM_GPG_PRIVATE_KEY_BASE64` | Base64 of a passphrase-protected, ASCII-armored RPM secret-signing-subkey export with only a dummy primary-key stub |
| Secret | `PACKAGE_RPM_GPG_PASSPHRASE` | Passphrase for the RPM signing subkey |
| Secret | `PACKAGE_APK_PRIVATE_KEY_BASE64` | Base64 of the unencrypted RSA-4096 Alpine private key in PEM format |

The Cloudflare/R2 values and secrets live in the protected `linux-packages`
environment; `LINUX_PACKAGES_ENABLED` is deliberately a repository-level
variable so its job-level condition can be evaluated before GitHub enters that
environment. GitHub exposes only secret presence and update timestamps to
operators; the controlled workflow policy-checks key structure, exact signing
identities, and passphrases without printing their values. The manual dispatch's
default `validate_only=true` mode is the only path allowed to enter the
environment while the publication gate is disabled; it never receives R2 or
cache-purge secrets in an executing step and every external publication step is
skipped. `LINUX_PACKAGES_ENABLED` must remain disabled until that validation and
every other launch criterion pass. The workflow decodes each base64 value only
into an ephemeral, mode-`0600` file and requires both OpenPGP passphrase secrets
to be non-empty.

APT and RPM imports use separate ephemeral homes exposed only to their GPG
operations through `DOTENC_APT_GNUPGHOME` and `DOTENC_RPM_GNUPGHOME`; CI rejects
a usable primary secret or any extra usable secret subkey. APT and RPM metadata
signing read separate mode-`0600` passphrase files through
`DOTENC_APT_GPG_PASSPHRASE_FILE` and
`DOTENC_RPM_GPG_PASSPHRASE_FILE`. The RPM GPG home stays protected and is used
later to sign `repomd.xml`; it is never replaced by the unprotected nFPM copy.

`NFPM_RPM_KEY_FILE` names the durable, protected RPM secret-subkey export.
nFPM `2.47.0` cannot unlock its encrypted signing subkey beneath the required
dummy/offline primary. For native package builds, the repository builder uses
`DOTENC_RPM_GPG_PASSPHRASE_FILE` to sign an ephemeral probe with the exact
signing-subkey fingerprint, then creates a mode-`0700` staging directory inside
the workflow-owned signing directory supplied through
`DOTENC_PACKAGING_SECRET_SCRATCH_DIR`. It removes protection only in that
isolated copy, validates that a mode-`0600` export still contains the dummy
primary and exactly the declared signing subkey, and passes only that transient
file to the RPM nFPM child. Both `NFPM_RPM_PASSPHRASE` and
`NFPM_RPM_PASSPHRASE_FILE` are rejected, so nFPM receives no passphrase. The
builder scrubs the transient home, probe, command input, and export immediately
after native package generation and on failure, before package-manifest or
repository-metadata signing and before any publication step. The workflow exit
trap repeats cleanup if the process terminates unexpectedly. Metadata-only
refreshes skip nFPM and never materialize the unprotected export.

The package builder receives the Alpine key through `NFPM_APK_KEY_FILE`. It must
be unencrypted because `abuild-sign` is non-interactive. Alpine tools are
prepared before the key is mounted; the signer container receives only the
repository workspace and its read-only key directory and runs without a
network. Public certificates and key paths are not secrets. Never upload either
offline OpenPGP primary key merely to unblock a run.

The environment is restricted to `main`. The active `Protect main` repository
ruleset requires a pull request with the six CI jobs passing, blocks deletion
and force-pushes, and requires no approval count. This solo-maintainer setup
intentionally has no required environment reviewer so the weekly freshness job
can run unattended. Repository workflows must not print these values, pass them
to untrusted pull-request code, persist them in build artifacts, or expose them
to forked workflows. Rotate the R2 and purge tokens independently.

## Signing-key custody

Repository and package signatures are the durable supply-chain trust boundary.
Use separate keys so a compromise has a limited blast radius:

- Keep the independent APT and RPM OpenPGP primary keys offline. Use them for
  certification, rotation, and revocation only.
- Give CI exactly one RSA-4096 signing subkey from each trust root, as a
  secret-subkey-only export. The production RPM export must remain
  passphrase-protected. Prefer an expiry date and scheduled rotation over a
  perpetual online key.
- Use a separate Alpine RSA key. Do not derive it from, or share storage with,
  the OpenPGP CI subkey.
- Store encrypted offline backups in at least two administratively independent
  locations. Test recovery before launch. Record the public fingerprints and
  revocation material outside GitHub.
- Protect GitHub environment access with ref restrictions and repository rules;
  add a separate required reviewer when the maintainer model permits it without
  breaking the scheduled freshness guarantee. Import keys into an ephemeral
  keyring, set restrictive file permissions, and destroy the workspace after
  signing.
- Keep the nFPM compatibility export confined to its mode-`0700` staging
  directory, expose only its mode-`0600` file to the RPM nFPM child, and scrub it
  immediately after package generation. The original RPM keyring must remain
  protected for metadata signing.
- Publish only public keys under `/keys/`. Private keys, passphrases, revocation
  secrets, and unencrypted exports must never enter R2, GitHub artifacts,
  Actions caches, container layers, logs, or this repository.
- Pin third-party workflow actions to reviewed commit SHAs and minimize the code
  that runs after signing material becomes available.

Document the following before enabling each key: owner, purpose, full
fingerprint, creation and expiry dates, backup locations, authorized CI
environment, rotation date, and revocation procedure.

Rotation is ecosystem-specific and must be rehearsed before launch:

- Publish and distribute replacement APT trust material before switching the
  sole `InRelease` signature. Existing clients do not automatically replace a
  keyring file that an operator installed under `/etc/apt/keyrings`. The
  canonical package manifest is also verified against the exact configured APT
  primary and signing fingerprints; changing either fingerprint therefore
  requires a new canonical bundle through a new package release under the
  current workflow. Renewing a certificate without changing those fingerprints
  can use a new certificate-digest URL without invalidating the old manifest
  signature.
- Do not rely on RPM 4.x clients updating an imported certificate when only a
  new subkey is added under the same primary key. Use a separately planned RPM
  trust-root transition (normally a new primary certificate) or a tested
  pre-provisioning mechanism.
- RPM and APK packages in the canonical release bundle retain the signature
  and key name with which they were created. The current refresh path accepts
  one public key per ecosystem, so an RPM or APK transition requires publishing
  a new package release signed by the replacement key before switching the
  repository. Keep every required old public key available and distributed
  while old immutable packages remain supported; changing only a mutable key
  alias cannot re-sign them.
- APK RSA keys have no embedded expiry or revocation mechanism. Rotate to a new
  fingerprinted filename, distribute it through an independently authenticated
  channel, and explicitly retire packages that still require the old key.

## Freshness and replay limits

The publisher refreshes repository metadata every Monday at 04:17 UTC from the
canonical signed package bundle for the latest published release. APT
`InRelease` contains a current `Date` and a `Valid-Until` 14 days later; normal
APT clients reject expired metadata. The workflow also refuses a publication
that leaves less than six days of APT validity.

RPM `repomd.xml` and Alpine `APKINDEX.tar.gz` have signatures but no equivalent
client-enforced expiry. A valid old copy can therefore be replayed to freeze a
client on an earlier package set. The weekly refresh and monitoring detect
stalled publication, but they do not make replay cryptographically impossible.
TLS, cache purges, and short mutable-object TTLs reduce accidental staleness;
none is a substitute for signed freshness. Alert on a missed weekly run and on
public metadata whose publication timestamp is older than eight days.

## DDoS and abuse posture

Cloudflare is the DDoS protection layer for the public repository hostname. Its
proxied custom domain receives managed L3/L4 and HTTP DDoS mitigation; Cloudflare
states that DDoS protection is unmetered and attack traffic is excluded from
billing. See [DDoS protection FAQ](https://developers.cloudflare.com/ddos-protection/frequently-asked-questions/)
and [attack coverage](https://developers.cloudflare.com/ddos-protection/about/attack-coverage/).

The private origin path, strict WAF allowlist, and long-lived immutable cache
objects further reduce origin exposure. They do not protect against stolen R2
credentials, stolen signing keys, malicious authorized uploads, accidental
publication, or every form of legitimate-looking cache-miss traffic. Monitor
R2 operations, cache hit rate, 4xx/5xx rates, and token use, and configure
billing/usage alerts. No per-client rate-limit rule is part of the current
baseline; add one only after measuring normal package-manager traffic and
accounting for shared NAT and CI fleets.

## Verification

### Before every publication

- Confirm the release tag, source commit, version, architectures, and libc
  targets are the intended set.
- For a first publication, confirm the Linux inputs came from the immutable
  artifact in the same release run. For a refresh, confirm the canonical
  package manifest signature and its exact APT signing identity verify before
  trusting package hashes.
- Verify every package digest against the generated manifest.
- Verify the APT `InRelease` signature, RPM package and `repomd.xml` signatures,
  and APK package and `APKINDEX.tar.gz` signatures using only the public keys
  that users will receive.
- Inspect package contents and install/remove scripts; confirm no private keys,
  tokens, source `.env` files, or build paths are present.
- Confirm every output object has its intended immutable or mutable
  `Cache-Control` value.

### After publication

Use known URLs from the publication manifest; placeholders below are not
literal repository paths.

```bash
# A mutable root should expose the short policy.
curl --fail --silent --show-error --head \
  https://packages.dotenc.org/apt/<distribution>/InRelease

# A versioned package should expose the one-year immutable policy and ranges.
curl --fail --silent --show-error --head \
  https://packages.dotenc.org/apt/<path>/dotenc_<version>_<arch>.deb
curl --fail --silent --show-error --range 0-0 --output /dev/null \
  https://packages.dotenc.org/apt/<path>/dotenc_<version>_<arch>.deb
```

Check `Cache-Control`, `ETag`, `CF-Cache-Status`, `Content-Length`, content type,
and a `206` response for the range request. Then verify edge denial controls:

```bash
# Each request should return 403.
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  https://packages.dotenc.org/
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  'https://packages.dotenc.org/apt/not-found?bypass=1'
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  --request POST https://packages.dotenc.org/apt/not-found

# A repeated allowed miss should remain 404 and may become a cache HIT.
curl --silent --dump-header - --output /dev/null \
  https://packages.dotenc.org/apt/not-found
curl --silent --dump-header - --output /dev/null \
  https://packages.dotenc.org/apt/not-found
```

Also confirm TLS 1.2 succeeds, TLS 1.1 is rejected, public `r2.dev` access is
disabled, Smart Tiered Cache is enabled, and the WAF/cache rules still match the
baseline table. Cache fill is data-center dependent, so a missing `HIT` on the
second request is an investigation signal rather than a standalone publication
failure.

Finally, use fresh containers or VMs to configure each repository using its
published public key, refresh metadata, install dotenc, compare the installed
version and checksum with the release manifest, run `dotenc --version`, and
remove/reinstall the package.

## Rollback and incident recovery

Repository rollback means publishing **new, freshly signed mutable metadata**
that points to the last known-good immutable package set. Do not overwrite old
immutable objects, and do not merely restore expired or stale signed metadata.

An interrupted RPM pair update is a special availability recovery case. If the
new `repomd.xml.asc` reached R2 but its matching `repomd.xml` did not, immediately
retry the same verified publication or upload a verified matching signature and
root pair, purge both exact URLs, and confirm the pair through the public edge.
Never leave a detached signature and root from different builds in place.

Normal rollback:

1. Stop the active publisher and identify the last verified manifest.
2. Regenerate repository metadata from that known-good package set, preserving
   package-manager monotonicity requirements where applicable.
3. Verify and sign the regenerated metadata.
4. Upload dependencies first and mutable roots last.
5. Purge only the changed mutable URLs, verify through the custom domain, and
   run clean installation tests.
6. Remove the bad version from current indexes, but retain its immutable object
   for forensic analysis and clients that already pinned its digest. Delete and
   purge it only as an explicit security-incident decision.

Credential incidents:

- **R2 writer exposed:** disable the credential immediately, stop publication,
  inventory every object and metadata change, restore freshly signed known-good
  roots, purge affected exact URLs, and create a new bucket-scoped credential.
- **Cache purge token exposed:** revoke and replace it, audit purge activity,
  and verify metadata from origin and multiple edge locations.
- **APT or RPM CI signing subkey exposed:** stop publication, remove the
  affected GitHub secret, revoke the subkey with its offline primary, create a
  replacement according to that ecosystem's rotation plan, and publish signed
  key-transition instructions.
- **OpenPGP primary or Alpine private key exposed:** treat as a full trust-root
  compromise. Revoke/replace the key, preserve incident evidence, publish new
  bootstrap material through independently authenticated channels, and require
  users to install the new trust root explicitly.
- **Cloudflare outage or domain misconfiguration:** disable publication rather
  than directing users to `r2.dev`. Restore the custom-domain path and verify
  signatures, WAF behavior, and cache headers before resuming.

After any incident, rotate unrelated credentials only when evidence or shared
custody justifies it; indiscriminate rotation can obscure the audit trail.
Record the timeline, affected releases and keys, object inventory, user impact,
and corrective controls.

## Arch Linux / AUR

The Arch distribution path is the `dotenc-bin` AUR package, not a fourth
repository under `packages.dotenc.org`. The deterministic renderer at
`cli/packaging/aur.ts` consumes the tagged GitHub release archives and
`SHA256SUMS`, then emits `PKGBUILD`, `.SRCINFO`, and an `install-method` marker.
The publisher cross-checks those sums against GitHub's reported per-asset
SHA-256 digests; for an older release without a `SHA256SUMS` asset, it derives
the renderer input from those API digests so the current stable release can
still be validated and submitted.
The recipe installs:

- the x86_64 or aarch64 glibc standalone binary as `/usr/bin/dotenc`;
- `/usr/share/dotenc/install-method` containing `aur`; and
- the tagged MIT license under `/usr/share/licenses/dotenc-bin/`.

The `x86_64` recipe target supports official Arch Linux. The `aarch64` target
is for the Arch Linux ARM community, which is a separate project. AUR builds
verify the release-asset SHA-256 digests, so this path does not use the APT,
RPM, or APK repository-signing keys. Users update through an AUR helper such as
`yay` or `paru`; plain `pacman` does not synchronize AUR recipes.

**Pre-launch status:** `dotenc-bin` is rendered and tested in this repository
but is not yet published to AUR. Keep the repository variable
`AUR_PACKAGES_ENABLED=false` until the first publication is reviewed.
`.github/workflows/publish-aur-package.yml` defaults
manual dispatches to validation-only; it downloads the exact stable GitHub
Release inputs and performs a clean `makepkg` build/install in a digest-pinned
x86_64 Arch container. After that succeeds, a manual run also verifies the
configured SSH identity against AUR's read-only `help` command. It does not
clone or push the AUR repository unless both the manual `publish` input and the
launch gate are `true`. The release workflow calls it only after the GitHub
Release exists and the launch gate is `true`.

Publication needs a dedicated, **unencrypted Ed25519** SSH deployment key
registered to the dotenc AUR account. Store its private key as base64 in the
`linux-packages` environment secret `AUR_SSH_PRIVATE_KEY_BASE64`; the workflow
rejects encrypted or non-Ed25519 keys so it cannot fall back to an interactive
prompt. Do not reuse a source-repository SSH key or any package-signing key.
The publisher pins the Ed25519 fingerprint listed on the official
[`aur.archlinux.org` home page](https://aur.archlinux.org/) and accepts a
scanned host key only after its fingerprint matches. It then performs a
non-forced push that is idempotent for identical recipes and refuses version
downgrades, same-version content replacement, or unexpected tracked files.
