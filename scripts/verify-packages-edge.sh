#!/bin/sh

set -eu

BASE_URL=${1:-https://packages.dotenc.org}
BASE_URL=${BASE_URL%/}
PROBE_ID="$(date +%s)-$$"
PROBE_PATH="/apt/.edge-probe-${PROBE_ID}"
PROBE_URL="${BASE_URL}${PROBE_PATH}"
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/dotenc-edge-verify.XXXXXX")

cleanup() {
	rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT HUP INT TERM

request() {
	method=$1
	url=$2
	headers=$3

	curl \
		--silent \
		--show-error \
		--tlsv1.2 \
		--tls-max 1.2 \
		--request "$method" \
		--dump-header "$headers" \
		--output /dev/null \
		--write-out '%{http_code}' \
		"$url"
}

assert_status() {
	expected=$1
	actual=$2
	label=$3

	if [ "$actual" != "$expected" ]; then
		echo "FAIL: ${label}: expected HTTP ${expected}, got ${actual}" >&2
		exit 1
	fi
}

assert_header_contains() {
	file=$1
	header=$2
	value=$3
	label=$4

	if ! tr -d '\r' < "$file" | grep -Eiq "^${header}:.*${value}"; then
		echo "FAIL: ${label}: missing ${header} containing ${value}" >&2
		exit 1
	fi
}

first_headers="${WORK_DIR}/first.headers"
second_headers="${WORK_DIR}/second.headers"
third_headers="${WORK_DIR}/third.headers"

first_status=$(request GET "$PROBE_URL" "$first_headers")
assert_status 404 "$first_status" "allowed repository namespace"
assert_header_contains "$first_headers" cache-control 'max-age=0' "negative browser cache policy"
assert_header_contains "$first_headers" cache-control must-revalidate "negative cache policy"

second_status=$(request GET "$PROBE_URL" "$second_headers")
assert_status 404 "$second_status" "second negative-cache probe"

if ! tr -d '\r' < "$second_headers" | grep -Eiq '^cf-cache-status:[[:space:]]*HIT$'; then
	sleep 1
	third_status=$(request GET "$PROBE_URL" "$third_headers")
	assert_status 404 "$third_status" "third negative-cache probe"
	assert_header_contains "$third_headers" cf-cache-status 'HIT$' "negative cache hit"
fi

root_status=$(request GET "$BASE_URL/" "${WORK_DIR}/root.headers")
assert_status 403 "$root_status" "repository root"

query_status=$(request GET "${PROBE_URL}?bypass=1" "${WORK_DIR}/query.headers")
assert_status 403 "$query_status" "query-string request"

post_status=$(request POST "$PROBE_URL" "${WORK_DIR}/post.headers")
assert_status 403 "$post_status" "write method"

namespace_status=$(request GET "${BASE_URL}/unexpected/path" "${WORK_DIR}/namespace.headers")
assert_status 403 "$namespace_status" "unexpected namespace"

if curl \
	--silent \
	--show-error \
	--tlsv1.1 \
	--tls-max 1.1 \
	--output /dev/null \
	"$PROBE_URL" 2>"${WORK_DIR}/tls11.stderr"; then
	echo "FAIL: TLS 1.1 connection unexpectedly succeeded" >&2
	exit 1
fi

echo "PASS: ${BASE_URL} enforces TLS 1.2+, repository allowlisting, read-only access, and negative caching."
