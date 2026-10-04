#!/usr/bin/env bash
# Bundle the bot API; the canonical M3 administration is built by the web host.
set -uo pipefail
cd "$(dirname "$0")/.."

# Stage canonical Noto Color Emoji font from obscura-render if not present
CANONICAL_EMOJI="../../crates/web/obscura-render/assets/noto-color-emoji.ttf"
TARGET_EMOJI="assets/fonts/NotoColorEmoji.ttf"
if [ -f "$CANONICAL_EMOJI" ]; then
	mkdir -p assets/fonts
	if [ ! -f "$TARGET_EMOJI" ] || [ "$CANONICAL_EMOJI" -nt "$TARGET_EMOJI" ]; then
		cp "$CANONICAL_EMOJI" "$TARGET_EMOJI"
	fi
fi

BUN_BIN="${BUN_BIN:-$(command -v bun)}"
if [ -z "$BUN_BIN" ] || ! [ -x "$BUN_BIN" ]; then
	echo "✗ bun is required" >&2
	exit 1
fi
"$BUN_BIN" build src/index.ts --target=bun --outdir=dist
