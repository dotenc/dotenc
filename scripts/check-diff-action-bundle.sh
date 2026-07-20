#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_PATH="$ROOT_DIR/actions/diff/dist/index.js"

if [[ ! -s "$BUNDLE_PATH" ]]; then
	printf 'Missing committed diff action bundle: %s\n' "$BUNDLE_PATH" >&2
	exit 1
fi

TEMP_BUNDLE="$(mktemp "${TMPDIR:-/tmp}/dotenc-diff-action.XXXXXX")"
SMOKE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dotenc-diff-smoke.XXXXXX")"

cleanup() {
	rm -f "$TEMP_BUNDLE"
	rm -f \
		"$SMOKE_DIR/event.json" \
		"$SMOKE_DIR/output" \
		"$SMOKE_DIR/summary" \
		"$SMOKE_DIR/stderr"
	rmdir "$SMOKE_DIR"
}
trap cleanup EXIT

(
	cd "$ROOT_DIR"
	bun build ./actions/diff/src/index.ts \
		--outfile "$TEMP_BUNDLE" \
		--target node \
		--format cjs
)

if ! cmp -s "$BUNDLE_PATH" "$TEMP_BUNDLE"; then
	printf '%s\n' \
		'Diff action bundle is stale. Run: bun run actions:build-diff' >&2
	exit 1
fi

node --check "$BUNDLE_PATH"

printf '%s\n' \
	'{"number":1,"repository":{"full_name":"dotenc/example"},"pull_request":{"number":1,"base":{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"head":{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}}' \
	> "$SMOKE_DIR/event.json"
: > "$SMOKE_DIR/output"
: > "$SMOKE_DIR/summary"

env \
	-u DOTENC_PRIVATE_KEY \
	-u DOTENC_PRIVATE_KEY_BASE64 \
	-u DOTENC_PRIVATE_KEY_PASSPHRASE \
	"GITHUB_EVENT_NAME=pull_request_target" \
	"GITHUB_EVENT_PATH=$SMOKE_DIR/event.json" \
	"GITHUB_REPOSITORY=dotenc/example" \
	"GITHUB_OUTPUT=$SMOKE_DIR/output" \
	"GITHUB_STEP_SUMMARY=$SMOKE_DIR/summary" \
	"INPUT_GITHUB-TOKEN=synthetic-token" \
	"INPUT_COMMENT=false" \
	"INPUT_FAIL-ON-ERROR=false" \
	node "$BUNDLE_PATH" 2> "$SMOKE_DIR/stderr"

grep -Fxq 'report=' "$SMOKE_DIR/output"
grep -Fxq 'has-changes=' "$SMOKE_DIR/output"
grep -Fxq 'comment-url=' "$SMOKE_DIR/output"
grep -Fq 'temporarily unavailable' "$SMOKE_DIR/summary"
if grep -Fq 'synthetic-token' "$SMOKE_DIR/stderr"; then
	printf '%s\n' 'Diff action runtime smoke test leaked its token.' >&2
	exit 1
fi
