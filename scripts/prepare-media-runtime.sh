#!/usr/bin/env bash
# Build only at the pinned source revisions; no Homebrew dependency on endpoints.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SOURCE="$ROOT/dist/media-source"
BUILD="$ROOT/dist/media-build"
RUNTIME="$ROOT/dist/media-runtime"
COMMIT=3cfd5dcf78e7a619f7a42a3e2f29b06eb41027ea
ADAPTER=e3ff5021eb0875858bd05f48d2e9ba2e962d1cf6
if [[ ! -d "$SOURCE/.git" ]]; then
  git clone --no-checkout https://github.com/ungive/media-control.git "$SOURCE"
fi
git -C "$SOURCE" checkout --detach "$COMMIT"
git -C "$SOURCE" submodule update --init
[[ $(git -C "$SOURCE" rev-parse HEAD) == "$COMMIT" ]]
[[ $(git -C "$SOURCE/mediaremote-adapter" rev-parse HEAD) == "$ADAPTER" ]]
[[ -z $(git -C "$SOURCE" status --porcelain) ]]
[[ -z $(git -C "$SOURCE/mediaremote-adapter" status --porcelain) ]]
cmake -S "$SOURCE" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 -DCMAKE_INSTALL_PREFIX="$RUNTIME"
cmake --build "$BUILD" --parallel 2
cmake --install "$BUILD"
cp "$SOURCE/mediaremote-adapter/LICENSE" "$RUNTIME/LICENSE"
cp "$ROOT/THIRD-PARTY-NOTICES.md" "$RUNTIME/THIRD-PARTY-NOTICES.md"
codesign --force --sign - "$RUNTIME/lib/media-control/MediaRemoteAdapterTestClient"
codesign --verify --deep --strict "$RUNTIME/Frameworks/MediaRemoteAdapter.framework"
codesign --verify --strict "$RUNTIME/lib/media-control/MediaRemoteAdapterTestClient"
lipo "$RUNTIME/Frameworks/MediaRemoteAdapter.framework/MediaRemoteAdapter" -verify_arch arm64 x86_64
lipo "$RUNTIME/lib/media-control/MediaRemoteAdapterTestClient" -verify_arch arm64 x86_64
node "$ROOT/scripts/media-manifest.mjs" "$RUNTIME"
