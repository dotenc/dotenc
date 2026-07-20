# Installing dotenc

## Recommended installer

On macOS and Linux, run:

```sh
curl -fsSL https://dotenc.org/install.sh | sh
```

The installer chooses the native package path when it can do so safely:

| System | Preferred installation path |
| --- | --- |
| Debian and Ubuntu | Signed APT repository |
| Fedora and the RHEL family | Signed RPM repository through DNF or Yum |
| Alpine Linux | Signed APK repository |
| Arch Linux | `dotenc-bin` through an installed `yay` or `paru` helper |
| macOS | Homebrew |
| Other supported Unix environments | Homebrew or npm |
| Windows under Git Bash or MSYS2 | Scoop or npm |

If administrator access or an interactive prompt is unavailable, the script
falls back to Homebrew or npm without invoking `sudo` when one is available.

To inspect the script before running it:

```sh
curl -fsSL https://dotenc.org/install.sh -o dotenc-install.sh
less dotenc-install.sh
sh dotenc-install.sh
rm dotenc-install.sh
```

## Manual installation

### APT (Debian and Ubuntu)

```sh
(
set -e

# Install prerequisites.
sudo apt update
sudo apt install -y ca-certificates curl

# Add dotenc's signing key after verifying its pinned checksum.
sudo install -m 0755 -d /etc/apt/keyrings
key_file="$(mktemp)"
curl -fsSL \
  https://packages.dotenc.org/keys/dotenc-apt-7BEFECEEA5921A0C3C431CFAA1A964033C1E2A5B-108333389e16fc3dbdb09938308639951ea6df5fb8f482eba562cafbc353c58f.asc \
  -o "$key_file"
echo "108333389e16fc3dbdb09938308639951ea6df5fb8f482eba562cafbc353c58f  $key_file" \
  | sha256sum -c -
sudo install -m 0644 "$key_file" /etc/apt/keyrings/dotenc.asc
rm -f "$key_file"

# Add the dotenc repository.
sudo tee /etc/apt/sources.list.d/dotenc.sources >/dev/null <<'EOF'
Types: deb
URIs: https://packages.dotenc.org/apt
Suites: stable
Components: main
Signed-By: /etc/apt/keyrings/dotenc.asc
EOF

sudo apt update
sudo apt install -y dotenc
)
```

### RPM (Fedora and the RHEL family)

```sh
(
set -e

# Add dotenc's signing key after verifying its pinned checksum.
sudo install -m 0755 -d /etc/pki/rpm-gpg
key_file="$(mktemp)"
curl -fsSL \
  https://packages.dotenc.org/keys/dotenc-rpm-C1FFEF75009580AB4A9EDDE87486A84C0C27D6A2-2600233af0c9acab0f047d2f0c1fbda5d5970187a41a67eecdd85240b983309b.asc \
  -o "$key_file"
echo "2600233af0c9acab0f047d2f0c1fbda5d5970187a41a67eecdd85240b983309b  $key_file" \
  | sha256sum -c -
sudo install -m 0644 "$key_file" /etc/pki/rpm-gpg/dotenc.asc
rm -f "$key_file"

# Add the dotenc repository.
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

sudo dnf install -y dotenc
)
```

On systems that still use Yum, replace the final `dnf` command with `yum`.

### APK (Alpine Linux)

Run this block in a root shell:

```sh
(
set -e

# Install prerequisites.
apk add --no-cache ca-certificates

# Add dotenc's signing key after verifying its pinned checksum.
key_name=dotenc-600d1cdeb051ccba069f4c444aa76d9094caf23b3aea0a29f1a84e2bf3204128
key_file="$(mktemp)"
wget -q "https://packages.dotenc.org/keys/${key_name}.rsa.pub" -O "$key_file"
echo "6b8e09be9c96801f9434f8b8e7c622cedcf6c343eb50483509dcd18a3b5b4b50  $key_file" \
  | sha256sum -c -
cp "$key_file" "/etc/apk/keys/${key_name}.rsa.pub"
chmod 0644 "/etc/apk/keys/${key_name}.rsa.pub"
rm -f "$key_file"

# Add the dotenc repository.
grep -qxF 'https://packages.dotenc.org/apk/stable/main' /etc/apk/repositories \
  || echo 'https://packages.dotenc.org/apk/stable/main' \
  >> /etc/apk/repositories

apk update
apk add --no-cache dotenc
)
```

### AUR (Arch Linux)

Install [`dotenc-bin`](https://aur.archlinux.org/packages/dotenc-bin) with an
AUR helper:

```sh
yay -S dotenc-bin
# or
paru -S dotenc-bin
```

The AUR recipe verifies the SHA-256 of the tagged dotenc release archive. Plain
`pacman` does not install AUR recipes.

### Homebrew (macOS or Linux)

```sh
brew tap ivanfilhoz/dotenc
brew install dotenc
```

### Scoop (Windows)

```powershell
scoop bucket add dotenc https://github.com/ivanfilhoz/scoop-dotenc
scoop install dotenc
```

### npm

```sh
npm install -g @dotenc/cli
```

### Standalone binary

Download the archive for your platform from
[GitHub Releases](https://github.com/dotenc/dotenc/releases), verify it against
the release checksums, and place the `dotenc` binary on your `PATH`.

### Docker or another OCI runtime

```sh
docker run --rm ghcr.io/dotenc/cli:latest --version
docker run --rm ghcr.io/dotenc/cli:alpine --version
```

The images support `linux/amd64` and `linux/arm64`. They contain dotenc and the
minimal SSH-key runtime, but not an application runtime or provider CLI. See
the [OCI image guide](OCI_IMAGE.md) for tags, pinning, and multi-stage examples.

## Verify the installation

```sh
dotenc --version
dotenc init
```

The signed APT, RPM, and APK repositories support `amd64`/`x86_64` and
`arm64`/`aarch64`. Their production fingerprints and bootstrap identities are
recorded in the
[Linux package repository runbook](LINUX_PACKAGES.md#production-trust-roots).
For the installer and package authenticity boundaries, see the
[installation script trust model](../SECURITY.md#installation-script-trust-model)
and [Linux repository trust model](../SECURITY.md#linux-package-repository-trust-model).
