# Installing dotenc

## Recommended

On macOS or Linux:

```sh
curl -fsSL https://dotenc.org/install.sh | sh
```

The installer chooses the native package manager when possible and falls back
to Homebrew or npm when administrator access is unavailable.

To review it before running:

```sh
curl -fsSL https://dotenc.org/install.sh -o dotenc-install.sh
less dotenc-install.sh
sh dotenc-install.sh
rm dotenc-install.sh
```

## Debian, Ubuntu, Fedora, and RHEL

Download the package for your system:

| System | x86-64 | ARM64 |
| --- | --- | --- |
| Debian or Ubuntu | [`.deb` (amd64)](https://github.com/dotenc/dotenc/releases/latest/download/dotenc-amd64.deb) | [`.deb` (arm64)](https://github.com/dotenc/dotenc/releases/latest/download/dotenc-arm64.deb) |
| Fedora or RHEL | [`.rpm` (x86_64)](https://github.com/dotenc/dotenc/releases/latest/download/dotenc-x86_64.rpm) | [`.rpm` (aarch64)](https://github.com/dotenc/dotenc/releases/latest/download/dotenc-aarch64.rpm) |

Then install the downloaded file:

```sh
# Debian or Ubuntu
sudo apt install ./dotenc-amd64.deb

# Fedora or RHEL
sudo dnf install ./dotenc-x86_64.rpm
```

Use the ARM64 filename from the table on ARM64 systems. The package also
installs dotenc's public signing key and repository configuration, so future
updates arrive through APT or DNF. DNF may ask once to confirm the embedded key
when it first refreshes signed repository metadata.

The first local package install trusts the GitHub Release download. Subsequent
updates are authenticated by the signed dotenc repository. See the
[Linux package trust model](../SECURITY.md#linux-package-repository-trust-model)
for the exact boundary.

## Other installation methods

### Alpine Linux

The [recommended installer](#recommended) configures the signed APK repository
and installs dotenc.

### Arch Linux

```sh
yay -S dotenc-bin
# or
paru -S dotenc-bin
```

### Homebrew

```sh
brew tap ivanfilhoz/dotenc
brew install dotenc
```

### Scoop

```powershell
scoop bucket add dotenc https://github.com/ivanfilhoz/scoop-dotenc
scoop install dotenc
```

### npm

```sh
npm install -g @dotenc/cli
```

### Docker or another OCI runtime

```sh
docker run --rm ghcr.io/dotenc/cli:latest --version
```

See the [OCI image guide](OCI_IMAGE.md) for version pinning, Alpine images, and
multi-stage examples.

### Standalone binary

Download the archive for your platform and `SHA256SUMS` from
[GitHub Releases](https://github.com/dotenc/dotenc/releases), verify the
checksum, and place the `dotenc` binary on your `PATH`.

<details>
<summary>Manual APT and RPM repository setup</summary>

The downloadable packages and recommended installer already perform this
setup. These commands are for systems where you want to configure the
repository yourself.

### APT

```sh
(
set -e

key_file="$(mktemp)"
curl -fsSL https://packages.dotenc.org/keys/linux/apt -o "$key_file"
echo "108333389e16fc3dbdb09938308639951ea6df5fb8f482eba562cafbc353c58f  $key_file" \
  | sha256sum --check
sudo install -d -m 0755 /etc/apt/keyrings
sudo install -m 0644 "$key_file" /etc/apt/keyrings/dotenc.asc
rm -f "$key_file"

sudo tee /etc/apt/sources.list.d/dotenc.sources >/dev/null <<'EOF'
Types: deb
URIs: https://packages.dotenc.org/apt
Suites: stable
Components: main
Signed-By: /etc/apt/keyrings/dotenc.asc
EOF

sudo apt update
sudo apt install dotenc
)
```

### RPM

```sh
(
set -e

key_file="$(mktemp)"
curl -fsSL https://packages.dotenc.org/keys/linux/rpm -o "$key_file"
echo "2600233af0c9acab0f047d2f0c1fbda5d5970187a41a67eecdd85240b983309b  $key_file" \
  | sha256sum --check
sudo install -d -m 0755 /etc/pki/rpm-gpg
sudo install -m 0644 "$key_file" /etc/pki/rpm-gpg/dotenc.asc
sudo rpm --import "$key_file"
rm -f "$key_file"

sudo tee /etc/yum.repos.d/dotenc.repo >/dev/null <<'EOF'
[dotenc]
name=dotenc
baseurl=https://packages.dotenc.org/rpm/$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/dotenc.asc
sslverify=1
EOF

sudo dnf install dotenc
)
```

Use `yum` instead of `dnf` where required. DNF may import the same certificate
again for repository-metadata verification because that key store is separate
from RPM's package-signature key store.

The production key fingerprints and immutable key URLs are recorded in the
[Linux package repository runbook](LINUX_PACKAGES.md#production-trust-roots).

</details>

## Verify

```sh
dotenc --version
dotenc init
```
