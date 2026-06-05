#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

dotenc_require DOTENC_COMMAND

tmp_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
command_script="$(mktemp "$tmp_dir/dotenc-command.XXXXXX")"
trap 'rm -f "$command_script"' EXIT

chmod 700 "$command_script"
{
	printf 'unset DOTENC_PRIVATE_KEY DOTENC_PRIVATE_KEY_PASSPHRASE\n'
	printf '%s\n' "$DOTENC_COMMAND"
} >"$command_script"

dotenc_run_script "$command_script"
