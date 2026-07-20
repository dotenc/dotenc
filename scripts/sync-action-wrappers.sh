#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/actions/wrapper-repos"
TARGET_DIR=""

repos=(
	"setup-action"
	"run-action"
	"export-action"
	"write-file-action"
	"diff-action"
)

usage() {
	cat <<'USAGE'
Usage: scripts/sync-action-wrappers.sh --target-dir <directory>

Copies wrapper action templates into local checkouts of the public wrapper repos.
The target directory should contain or receive these directories:

  setup-action
  run-action
  export-action
  write-file-action
  diff-action

This script only writes README.md and action.yml in each target directory. It
does not create GitHub repositories, commit, push, or tag releases.
USAGE
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--target-dir)
			TARGET_DIR="${2:-}"
			shift 2
			;;
		--help | -h)
			usage
			exit 0
			;;
		*)
			printf 'Unknown argument: %s\n\n' "$1" >&2
			usage >&2
			exit 1
			;;
	esac
done

if [[ -z "$TARGET_DIR" ]]; then
	printf 'Missing required --target-dir.\n\n' >&2
	usage >&2
	exit 1
fi

mkdir -p "$TARGET_DIR"

for repo in "${repos[@]}"; do
	source_repo="$SOURCE_DIR/$repo"
	target_repo="$TARGET_DIR/$repo"

	if [[ ! -f "$source_repo/action.yml" || ! -f "$source_repo/README.md" ]]; then
		printf 'Wrapper template is incomplete: %s\n' "$source_repo" >&2
		exit 1
	fi

	mkdir -p "$target_repo"
	install -m 0644 "$source_repo/action.yml" "$target_repo/action.yml"
	install -m 0644 "$source_repo/README.md" "$target_repo/README.md"

	printf 'Synced %s\n' "$target_repo"
done
