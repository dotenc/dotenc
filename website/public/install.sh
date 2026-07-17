#!/bin/sh
# dotenc universal install script
# Usage: curl -fsSL https://dotenc.org/install.sh | sh
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info() {
	printf "${CYAN}${BOLD}dotenc${RESET} %s\n" "$1"
}

success() {
	printf "${GREEN}✔${RESET} %s\n" "$1"
}

error() {
	printf "${RED}✘${RESET} %s\n" "$1" >&2
	exit 1
}

# Detect OS
OS="$(uname -s)"

case "$OS" in
	Darwin|Linux)
		# Check for Homebrew
		if command -v brew >/dev/null 2>&1; then
			info "Installing via Homebrew..."
			brew tap ivanfilhoz/dotenc
			brew install dotenc
			success "dotenc installed via Homebrew"
		elif command -v npm >/dev/null 2>&1; then
			info "Homebrew not found. Installing via npm..."
			npm install -g @dotenc/cli
			success "dotenc installed via npm"
		elif command -v npx >/dev/null 2>&1; then
			info "Homebrew and npm not found. You can run dotenc with npx:"
			printf "\n  ${CYAN}npx @dotenc/cli${RESET}\n\n"
			info "Or install Homebrew first: https://brew.sh"
			exit 0
		else
			error "Neither Homebrew nor npm found. Please install one of them first:
  Homebrew: https://brew.sh
  Node.js:  https://nodejs.org"
		fi
		;;
	MINGW*|MSYS*|CYGWIN*)
		info "Detected Windows (Git Bash / MSYS2)"
		if command -v scoop >/dev/null 2>&1; then
			info "Installing via Scoop..."
			scoop bucket add dotenc https://github.com/ivanfilhoz/scoop-dotenc
			scoop install dotenc
			success "dotenc installed via Scoop"
		elif command -v npm >/dev/null 2>&1; then
			info "Scoop not found. Installing via npm..."
			npm install -g @dotenc/cli
			success "dotenc installed via npm"
		else
			printf "\n"
			info "Install via Scoop (recommended for Windows):"
			printf "\n  ${CYAN}scoop bucket add dotenc https://github.com/ivanfilhoz/scoop-dotenc${RESET}\n"
			printf "  ${CYAN}scoop install dotenc${RESET}\n\n"
			info "Or install via npm:"
			printf "\n  ${CYAN}npm install -g @dotenc/cli${RESET}\n\n"
			exit 0
		fi
		;;
	*)
		error "Unsupported OS: $OS. Please install manually:
  npm install -g @dotenc/cli
  Or download a binary from: https://github.com/dotenc/dotenc/releases"
		;;
esac

# Verify installation
if command -v dotenc >/dev/null 2>&1; then
	VERSION="$(dotenc --version 2>/dev/null || echo 'unknown')"
	printf "\n"
	success "dotenc ${VERSION} is ready!"
	printf "\n  Get started: ${CYAN}${BOLD}dotenc init${RESET}\n\n"
fi
