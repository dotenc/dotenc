#!/bin/sh
# Reviewed vendor package floors; sources and remaining exposure: docs/OCI_IMAGE.md.
# Read-only, also run in each runtime image build before publication.
set -eu

# shellcheck source=/dev/null
. /etc/os-release

require_debian_version() {
	installed=$(dpkg-query -W -f='${Version}' "$1")
	if ! dpkg --compare-versions "$installed" ge "$2"; then
		printf '%s %s is below security minimum %s\n' "$1" "$installed" "$2" >&2
		exit 1
	fi
	printf '%s %s meets security minimum %s\n' "$1" "$installed" "$2"
}

require_alpine_version() {
	# apk evaluates revisions/backports using the distribution's version rules.
	if ! apk info --installed "$1>=$2" >/dev/null 2>&1; then
		printf '%s is missing or below security minimum %s\n' "$1" "$2" >&2
		exit 1
	fi
	apk list --installed "$1"
}

case "$ID:$VERSION_ID" in
	debian:13)
		require_debian_version openssl '3.5.7-1~deb13u3'
		require_debian_version libssl3t64 '3.5.7-1~deb13u3'
		require_debian_version openssl-provider-legacy '3.5.7-1~deb13u3'
		require_debian_version libpcre2-8-0 '10.46-1~deb13u3'
		require_debian_version perl-base '5.40.1-6+deb13u1'
		;;
	alpine:3.24.*)
		require_alpine_version libssl3 '3.5.9-r0'
		require_alpine_version libcrypto3 '3.5.9-r0'
		for package in openssh-client-common openssh-client-default openssh-keygen; do
			require_alpine_version "$package" '10.3_p1-r1'
		done
		;;
	*)
		printf 'No reviewed package floors for %s %s\n' "$ID" "$VERSION_ID" >&2
		exit 1
		;;
esac
