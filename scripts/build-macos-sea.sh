#!/usr/bin/env bash

set -euo pipefail

: "${NODE_VERSION:?NODE_VERSION is required}"

HOST_NODE_VERSION=$(node --version)
if [[ "$HOST_NODE_VERSION" != "v$NODE_VERSION" ]]; then
  echo "Expected Node v$NODE_VERSION, found $HOST_NODE_VERSION" >&2
  exit 1
fi

BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT

bash scripts/prepare-media-runtime.sh

curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
  --output "$BUILD_DIR/SHASUMS256.txt"

for ARCH in arm64 x64; do
  ARCHIVE="node-v${NODE_VERSION}-darwin-${ARCH}.tar.gz"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${ARCHIVE}" \
    --output "$BUILD_DIR/$ARCHIVE"

  (
    cd "$BUILD_DIR"
    grep "  ${ARCHIVE}$" SHASUMS256.txt | shasum -a 256 -c -
    tar -xzf "$ARCHIVE"
  )

  node scripts/build-sea.mjs \
    --executable "$BUILD_DIR/node-v${NODE_VERSION}-darwin-${ARCH}/bin/node" \
    --output "hass-agent-${ARCH}"
  chmod +x "hass-agent-${ARCH}"
  codesign --force --sign - "hass-agent-${ARCH}"
done

lipo -create -output hass-agent hass-agent-arm64 hass-agent-x64
chmod +x hass-agent
codesign --force --sign - hass-agent
