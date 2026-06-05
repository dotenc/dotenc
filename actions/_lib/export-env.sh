#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

dotenc_require DOTENC_NAMES
dotenc_require GITHUB_ENV
dotenc_bool DOTENC_REQUIRED
dotenc_bool DOTENC_MASK

inner_script="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/dotenc-export.XXXXXX")"
trap 'rm -f "$inner_script"' EXIT

cat >"$inner_script" <<'DOTENC_EXPORT_SCRIPT'
#!/usr/bin/env bash

set -euo pipefail

unset DOTENC_PRIVATE_KEY DOTENC_PRIVATE_KEY_PASSPHRASE

dotenc_error() {
	printf 'dotenc export action error: %s\n' "$*" >&2
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

dotenc_validate_variable_name() {
	local name="$1"

	if [[ ! "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
		dotenc_error "invalid environment variable name: $name"
		exit 1
	fi
}

dotenc_parse_names() {
	local line

	while IFS= read -r line || [[ -n "$line" ]]; do
		line="${line%%#*}"
		line="${line//,/ }"

		for name in $line; do
			printf '%s\n' "$name"
		done
	done <<<"$DOTENC_NAMES"
}

exported_count=0

while IFS= read -r name || [[ -n "$name" ]]; do
	[[ -z "$name" ]] && continue

	dotenc_validate_variable_name "$name"

	if [[ -z "${!name+x}" ]]; then
		if [[ "$DOTENC_REQUIRED" == "true" ]]; then
			dotenc_error "$name was not found in the decrypted environment."
			exit 1
		fi

		continue
	fi

	value="${!name-}"

	if [[ "$DOTENC_MASK" == "true" ]]; then
		dotenc_mask_value "$value"
	fi

	delimiter="DOTENC_${name}_$(date +%s)_${RANDOM}_${RANDOM}"
	while [[ "$value" == *"$delimiter"* ]]; do
		delimiter="DOTENC_${name}_$(date +%s)_${RANDOM}_${RANDOM}"
	done

	{
		printf '%s<<%s\n' "$name" "$delimiter"
		printf '%s\n' "$value"
		printf '%s\n' "$delimiter"
	} >>"$GITHUB_ENV"

	exported_count=$((exported_count + 1))
done < <(dotenc_parse_names)

if [[ "$exported_count" -eq 0 ]]; then
	dotenc_error "no variables were exported."
	exit 1
fi

printf 'Exported %s dotenc variable(s) to GITHUB_ENV.\n' "$exported_count"
DOTENC_EXPORT_SCRIPT

chmod 700 "$inner_script"
dotenc_run_script "$inner_script"
