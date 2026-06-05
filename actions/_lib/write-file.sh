#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

dotenc_require DOTENC_VARIABLE
dotenc_require DOTENC_PATH
dotenc_bool DOTENC_REQUIRED
dotenc_bool DOTENC_MASK
dotenc_bool DOTENC_OVERWRITE
dotenc_bool DOTENC_CREATE_DIRECTORIES

if [[ ! "$DOTENC_FILE_MODE" =~ ^[0-7]{3,4}$ ]]; then
	dotenc_error "DOTENC_FILE_MODE must be an octal mode such as 600 or 0600."
	exit 1
fi

dotenc_validate_variable_name "$DOTENC_VARIABLE"

inner_script="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/dotenc-write-file.XXXXXX")"
trap 'rm -f "$inner_script"' EXIT

cat >"$inner_script" <<'DOTENC_WRITE_FILE_SCRIPT'
#!/usr/bin/env bash

set -euo pipefail

unset DOTENC_PRIVATE_KEY DOTENC_PRIVATE_KEY_PASSPHRASE

dotenc_error() {
	printf 'dotenc write-file action error: %s\n' "$*" >&2
}

dotenc_escape_workflow_command() {
	local value="$1"

	value="${value//'%'/'%25'}"
	value="${value//$'\r'/'%0D'}"
	value="${value//$'\n'/'%0A'}"

	printf '%s' "$value"
}

dotenc_mask_value() {
	local value="$1"
	local line

	while IFS= read -r line || [[ -n "$line" ]]; do
		if [[ -n "$line" ]]; then
			printf '::add-mask::%s\n' "$(dotenc_escape_workflow_command "$line")"
		fi
	done <<<"$value"
}

variable="$DOTENC_VARIABLE"
target="$DOTENC_PATH"

if [[ -z "${!variable+x}" ]]; then
	if [[ "$DOTENC_REQUIRED" == "true" ]]; then
		dotenc_error "$variable was not found in the decrypted environment."
		exit 1
	fi

	printf '%s was not found; no file was written.\n' "$variable"
	exit 0
fi

if [[ "$DOTENC_OVERWRITE" != "true" && -e "$target" ]]; then
	dotenc_error "$target already exists and overwrite is disabled."
	exit 1
fi

value="${!variable-}"

if [[ "$DOTENC_MASK" == "true" ]]; then
	dotenc_mask_value "$value"
fi

target_dir="$(dirname "$target")"
target_base="$(basename "$target")"

if [[ "$DOTENC_CREATE_DIRECTORIES" == "true" ]]; then
	mkdir -p "$target_dir"
elif [[ ! -d "$target_dir" ]]; then
	dotenc_error "$target_dir does not exist."
	exit 1
fi

old_umask="$(umask)"
umask 077
tmp_file="$(mktemp "$target_dir/.${target_base}.dotenc.XXXXXX")"
umask "$old_umask"
trap 'rm -f "$tmp_file"' EXIT

printf '%s' "$value" >"$tmp_file"
chmod "$DOTENC_FILE_MODE" "$tmp_file"
mv -f "$tmp_file" "$target"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
	printf 'path=%s\n' "$target" >>"$GITHUB_OUTPUT"
fi

printf 'Wrote %s to %s.\n' "$variable" "$target"
DOTENC_WRITE_FILE_SCRIPT

chmod 700 "$inner_script"
dotenc_run_script "$inner_script"
