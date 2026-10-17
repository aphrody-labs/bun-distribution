#!/bin/sh
# Bun OS gamestream launcher (run as ubuntu on the VPS from this directory or any other).
#   ./up.sh webrtc     build if needed and start the WebRTC/WebGPU stream (default)
#   ./up.sh moonlight  seed the Wolf state and start Wolf for Moonlight clients
#   ./up.sh build      (re)build the image, niced and bounded
#   ./up.sh down       stop and remove both services
set -eu
cd "$(dirname "$0")"

BUN_BIN=${BUN_BIN:-$(command -v bun || true)}
[ -n "$BUN_BIN" ] || { echo "bun not found in PATH; export BUN_BIN" >&2; exit 1; }
export BUN_BIN=$(readlink -f "$BUN_BIN")
export WOLF_STATE=${WOLF_STATE:-/games/wolf}

files="-f compose.yaml"
[ -e /dev/ntsync ] && files="$files -f compose.ntsync.yaml"
compose() {
  # shellcheck disable=SC2086
  docker compose $files --profile webrtc --profile moonlight "$@"
}

build() {
  # The image is apt packages plus scripts (no compilation): a short, mostly IO-bound build.
  BUILDKIT_PROGRESS=plain nice -n 19 ionice -c 3 \
    docker build -f Containerfile --build-context gamestream=../../../../../../../packages/bun-gamestream \
      -t aphrody/bun-gamestream:local .
}

case "${1:-webrtc}" in
build) build ;;
webrtc)
  docker image inspect aphrody/bun-gamestream:local >/dev/null 2>&1 || build
  compose up -d --no-build gamestream
  ;;
moonlight)
  docker image inspect aphrody/bun-gamestream:local >/dev/null 2>&1 || build
  mkdir -p "$WOLF_STATE/cfg" "$WOLF_STATE/sockets" /games/SteamLibrary-wolf
  [ -f "$WOLF_STATE/cfg/config.toml" ] || cp wolf/config.toml "$WOLF_STATE/cfg/config.toml"
  compose up -d --no-build wolf
  ;;
down) compose down ;;
*) echo "usage: $0 [webrtc|moonlight|build|down]" >&2; exit 2 ;;
esac
