#!/usr/bin/env bash

set -euo pipefail

dotenc_error() {
	printf 'dotenc action error: %s\n' "$*" >&2
}

dotenc_require() {
	local name="$1"
	local value="${!name-}"

	if [[ -z "$value" ]]; then
		dotenc_error "$name is required."
		exit 1
	fi
}

dotenc_bool() {
	local name="$1"
	local value="${!name-}"

	case "$value" in
		true | false)
			;;
		*)
			dotenc_error "$name must be either true or false."
			exit 1
			;;
	esac
}

dotenc_validate_variable_name() {
	local name="$1"

	if [[ ! "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
		dotenc_error "invalid environment variable name: $name"
		exit 1
	fi
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

dotenc_run_script() {
	local script="$1"
	local args=()

	dotenc_require DOTENC_ENVIRONMENT
	dotenc_bool DOTENC_STRICT
	dotenc_bool DOTENC_LOCAL_ONLY

	if [[ "$DOTENC_STRICT" == "true" ]]; then
		args+=(--strict)
	fi

	if [[ "$DOTENC_LOCAL_ONLY" == "true" ]]; then
		args+=(--local-only)
	fi

	dotenc run "${args[@]}" -e "$DOTENC_ENVIRONMENT" bash "$script"
}
