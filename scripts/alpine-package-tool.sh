#!/bin/sh
set -eu

: "${DOTENC_APK_TOOLS_CONTAINER:?DOTENC_APK_TOOLS_CONTAINER is required}"

tool=$(basename "$0")
case "$tool" in
	apk | abuild-gzsplit | abuild-sign) ;;
	*)
		echo "Unsupported Alpine package tool: $tool" >&2
		exit 2
		;;
esac

exec docker exec --interactive --workdir "$PWD" "$DOTENC_APK_TOOLS_CONTAINER" "$tool" "$@"
