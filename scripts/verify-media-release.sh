#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_VERSION:?RELEASE_VERSION is required}"
ROOT=$(pwd)
STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT
for SUFFIX in '' '-arm64' '-x64'; do
  DEST="$STAGING/archive${SUFFIX:-universal}"
  mkdir "$DEST"
  tar -xzf "$ROOT/hass-agent-$RELEASE_VERSION-macos$SUFFIX.tar.gz" -C "$DEST"
  test -s "$DEST/THIRD-PARTY-NOTICES.md"
  test -s "$DEST/media/README.md"
  codesign --verify --strict "$DEST/hass-agent"
  # Universal and native archive execute; cross-architecture code still gets
  # signature validation. All embed the same universal helper inventory.
  if [[ -z "$SUFFIX" || "$(uname -m)" == "${SUFFIX#-}" || ( "$SUFFIX" == '-x64' && "$(uname -m)" == x86_64 ) ]]; then
    "$DEST/hass-agent" media-runtime-check
  fi
done
