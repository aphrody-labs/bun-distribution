#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Launch the canonical browser gaming package in the existing Gamescope owner.
set -eu

url=${BUN_OS_GAMING_URL:-https://aphrody.com/apps/game-dust-nds/index.html}
case "$url" in
  https://*|http://127.0.0.1:*/*|http://localhost:*/*) ;;
  *) echo 'BUN_OS_GAMING_URL must use HTTPS or a local development HTTP listener' >&2; exit 2 ;;
esac
browser=${BUN_OS_GAMING_BROWSER:-}
if [ -z "$browser" ]; then
  for candidate in chromium chromium-browser google-chrome; do
    if command -v "$candidate" >/dev/null 2>&1; then browser=$candidate; break; fi
  done
fi
[ -n "$browser" ] && command -v "$browser" >/dev/null 2>&1 || { echo 'Install Chromium through the gaming composition or set BUN_OS_GAMING_BROWSER' >&2; exit 1; }
command -v gamescope >/dev/null 2>&1 || { echo 'Gamescope is missing from the gaming composition' >&2; exit 1; }
if [ "${1:-}" = --check ]; then
  printf 'Gamescope browser: %s\nGaming URL: %s\n' "$browser" "$url"
  exit 0
fi
[ "$#" -eq 0 ] || { echo 'Usage: webos-gamescope.sh [--check]' >&2; exit 2; }
exec gamescope -W "${GAMESTREAM_WIDTH:-1280}" -H "${GAMESTREAM_HEIGHT:-720}" \
  -r "${GAMESTREAM_FPS:-60}" -- "$browser" --kiosk --no-first-run \
  --no-default-browser-check --ozone-platform=x11 "$url"
