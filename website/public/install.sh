#!/bin/sh
# dotenc universal install script
# Usage: curl -fsSL https://dotenc.org/install.sh | sh
set -eu

PACKAGES_URL="https://packages.dotenc.org"
INSTALLATION_GUIDE="https://github.com/dotenc/dotenc/blob/main/docs/INSTALLATION.md"

# Keep saved installer copies reproducible; the manual guide uses short aliases.
APT_KEY_SHA256="108333389e16fc3dbdb09938308639951ea6df5fb8f482eba562cafbc353c58f"
APT_KEY_URL="$PACKAGES_URL/keys/dotenc-apt-7BEFECEEA5921A0C3C431CFAA1A964033C1E2A5B-$APT_KEY_SHA256.asc"
RPM_KEY_SHA256="2600233af0c9acab0f047d2f0c1fbda5d5970187a41a67eecdd85240b983309b"
RPM_KEY_URL="$PACKAGES_URL/keys/dotenc-rpm-C1FFEF75009580AB4A9EDDE87486A84C0C27D6A2-$RPM_KEY_SHA256.asc"
APK_KEY_NAME="dotenc-600d1cdeb051ccba069f4c444aa76d9094caf23b3aea0a29f1a84e2bf3204128"
APK_KEY_SHA256="6b8e09be9c96801f9434f8b8e7c622cedcf6c343eb50483509dcd18a3b5b4b50"
APK_KEY_URL="$PACKAGES_URL/keys/$APK_KEY_NAME.rsa.pub"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

TEMP_KEY_FILE=""
TEMP_CONFIG_FILE=""

cleanup() {
	if [ -n "$TEMP_KEY_FILE" ]; then
		rm -f "$TEMP_KEY_FILE"
	fi
	if [ -n "$TEMP_CONFIG_FILE" ]; then
		rm -f "$TEMP_CONFIG_FILE"
	fi
}

trap cleanup 0
trap 'exit 1' HUP INT TERM

info() {
	printf '%b%s%b %s\n' "$CYAN$BOLD" "dotenc" "$RESET" "$1"
}

success() {
	printf '%b%s%b %s\n' "$GREEN" "✔" "$RESET" "$1"
}

error() {
	printf '%b%s%b %s\n' "$RED" "✘" "$RESET" "$1" >&2
	exit 1
}

has_controlling_terminal() {
	if ! { [ -t 0 ] || [ -t 1 ] || [ -t 2 ]; }; then
		return 1
	fi
	( : </dev/tty ) 2>/dev/null
}

can_elevate() {
	if [ "$(id -u)" = "0" ]; then
		return 0
	fi
	if ! command -v sudo >/dev/null 2>&1; then
		return 1
	fi
	if sudo -n true >/dev/null 2>&1; then
		return 0
	fi
	has_controlling_terminal
}

as_root() {
	if [ "$(id -u)" = "0" ]; then
		"$@"
	elif command -v sudo >/dev/null 2>&1; then
		sudo "$@"
	else
		error "Administrator access is required. See $INSTALLATION_GUIDE"
	fi
}

download_file() {
	source_url="$1"
	target_path="$2"

	if command -v curl >/dev/null 2>&1; then
		curl --fail --silent --show-error --location --proto '=https' \
			--output "$target_path" "$source_url"
	elif command -v wget >/dev/null 2>&1; then
		wget -q -O "$target_path" "$source_url"
	else
		error "curl or wget is required. See $INSTALLATION_GUIDE"
	fi
}

verify_sha256() {
	expected_sha256="$1"
	target_path="$2"

	if command -v sha256sum >/dev/null 2>&1; then
		hash_output="$(sha256sum "$target_path")"
	elif command -v shasum >/dev/null 2>&1; then
		hash_output="$(shasum -a 256 "$target_path")"
	else
		error "sha256sum or shasum is required to verify the repository key"
	fi

	actual_sha256="${hash_output%% *}"
	if [ "$actual_sha256" != "$expected_sha256" ]; then
		error "Repository key checksum mismatch; refusing to install"
	fi
}

install_apt() {
	info "Installing from the signed APT repository..."
	TEMP_KEY_FILE="$(mktemp)"
	download_file "$APT_KEY_URL" "$TEMP_KEY_FILE"
	verify_sha256 "$APT_KEY_SHA256" "$TEMP_KEY_FILE"

	as_root apt-get update
	as_root apt-get install -y ca-certificates curl

	TEMP_CONFIG_FILE="$(mktemp)"
	printf '%s\n' \
		'Types: deb' \
		"URIs: $PACKAGES_URL/apt" \
		'Suites: stable' \
		'Components: main' \
		'Signed-By: /etc/apt/keyrings/dotenc.asc' \
		>"$TEMP_CONFIG_FILE"

	as_root install -d -m 0755 /etc/apt/keyrings
	as_root install -m 0644 "$TEMP_KEY_FILE" /etc/apt/keyrings/dotenc.asc
	as_root install -m 0644 "$TEMP_CONFIG_FILE" /etc/apt/sources.list.d/dotenc.sources
	as_root apt-get update
	as_root apt-get install -y dotenc
}

install_rpm() {
	rpm_installer="$1"
	info "Installing from the signed RPM repository with $rpm_installer..."

	TEMP_KEY_FILE="$(mktemp)"
	download_file "$RPM_KEY_URL" "$TEMP_KEY_FILE"
	verify_sha256 "$RPM_KEY_SHA256" "$TEMP_KEY_FILE"

	TEMP_CONFIG_FILE="$(mktemp)"
	printf '%s\n' \
		'[dotenc]' \
		'name=dotenc' \
		"baseurl=$PACKAGES_URL/rpm/\$basearch" \
		'enabled=1' \
		'gpgcheck=1' \
		'repo_gpgcheck=1' \
		'gpgkey=file:///etc/pki/rpm-gpg/dotenc.asc' \
		'sslverify=1' \
		>"$TEMP_CONFIG_FILE"

	as_root install -d -m 0755 /etc/pki/rpm-gpg
	as_root install -m 0644 "$TEMP_KEY_FILE" /etc/pki/rpm-gpg/dotenc.asc
	as_root install -m 0644 "$TEMP_CONFIG_FILE" /etc/yum.repos.d/dotenc.repo
	as_root "$rpm_installer" install -y dotenc
}

install_apk() {
	info "Installing from the signed APK repository..."
	TEMP_KEY_FILE="$(mktemp)"
	download_file "$APK_KEY_URL" "$TEMP_KEY_FILE"
	verify_sha256 "$APK_KEY_SHA256" "$TEMP_KEY_FILE"

	as_root apk add --no-cache ca-certificates

	as_root mkdir -p /etc/apk/keys
	as_root cp "$TEMP_KEY_FILE" "/etc/apk/keys/$APK_KEY_NAME.rsa.pub"
	as_root chmod 0644 "/etc/apk/keys/$APK_KEY_NAME.rsa.pub"
	if ! grep -qxF "$PACKAGES_URL/apk/stable/main" /etc/apk/repositories 2>/dev/null; then
		printf '%s\n' "$PACKAGES_URL/apk/stable/main" \
			| as_root tee -a /etc/apk/repositories >/dev/null
	fi
	as_root apk update
	as_root apk add --no-cache dotenc
}

install_aur() {
	aur_helper="$1"
	if [ "$(id -u)" = "0" ]; then
		error "AUR packages cannot be built as root. Re-run the installer as a regular user."
	fi
	if ! has_controlling_terminal; then
		error "An interactive terminal is required to review and install the AUR package."
	fi

	info "Installing dotenc-bin from AUR with $aur_helper..."
	"$aur_helper" -S --needed dotenc-bin </dev/tty
}

install_unix_fallback() {
	if command -v brew >/dev/null 2>&1; then
		info "Installing via Homebrew..."
		brew tap ivanfilhoz/dotenc
		brew install dotenc
	elif command -v npm >/dev/null 2>&1; then
		info "Installing via npm..."
		npm install -g @dotenc/cli
	elif command -v npx >/dev/null 2>&1; then
		info "No supported installer is available. You can run dotenc with npx:"
		printf '\n  %bnpx @dotenc/cli%b\n\n' "$CYAN" "$RESET"
		info "Manual installation options: $INSTALLATION_GUIDE"
		exit 0
	else
		error "No supported package manager was found. See $INSTALLATION_GUIDE"
	fi
}

install_linux() {
	if command -v apt-get >/dev/null 2>&1; then
		if can_elevate; then
			install_apt
		else
			info "APT requires administrator access; trying a user-level installer..."
			install_unix_fallback
		fi
	elif command -v dnf >/dev/null 2>&1; then
		if can_elevate; then
			install_rpm dnf
		else
			info "DNF requires administrator access; trying a user-level installer..."
			install_unix_fallback
		fi
	elif command -v yum >/dev/null 2>&1; then
		if can_elevate; then
			install_rpm yum
		else
			info "Yum requires administrator access; trying a user-level installer..."
			install_unix_fallback
		fi
	elif command -v apk >/dev/null 2>&1; then
		if can_elevate; then
			install_apk
		else
			info "APK requires administrator access; trying a user-level installer..."
			install_unix_fallback
		fi
	elif command -v yay >/dev/null 2>&1 && has_controlling_terminal; then
		install_aur yay
	elif command -v paru >/dev/null 2>&1 && has_controlling_terminal; then
		install_aur paru
	else
		install_unix_fallback
	fi
}

OS="$(uname -s)"

case "$OS" in
	Darwin)
		install_unix_fallback
		;;
	Linux)
		install_linux
		;;
	MINGW* | MSYS* | CYGWIN*)
		info "Detected Windows (Git Bash / MSYS2)"
		if command -v scoop >/dev/null 2>&1; then
			info "Installing via Scoop..."
			scoop bucket add dotenc https://github.com/ivanfilhoz/scoop-dotenc
			scoop install dotenc
		elif command -v npm >/dev/null 2>&1; then
			info "Scoop not found. Installing via npm..."
			npm install -g @dotenc/cli
		else
			printf '\n'
			info "Manual installation options: $INSTALLATION_GUIDE"
			exit 0
		fi
		;;
	*)
		error "Unsupported OS: $OS. See $INSTALLATION_GUIDE"
		;;
esac

if command -v dotenc >/dev/null 2>&1; then
	VERSION="$(dotenc --version 2>/dev/null || printf '%s' 'unknown')"
	printf '\n'
	success "dotenc $VERSION is ready!"
	printf '\n  Get started: %b%s%b\n\n' "$CYAN$BOLD" "dotenc init" "$RESET"
fi
