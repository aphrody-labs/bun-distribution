#!/usr/bin/env bash
# Real-webview e2e: assemble the frontend (WASM pkg + transpiled transports), build and run the
# minimal Tauri app, and check the result it reports. Needs a display (WSLg/X11) and webkit2gtk.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
fe="$root/crates/shell/tauri-e2e/frontend"
"$root/scripts/build/shell/build-wasm.sh" >/dev/null
rm -rf "$fe/pkg" && mkdir -p "$fe/pkg"
cp "$root"/packages/shell/web/pkg/aphrody_shell_web{.js,_bg.wasm} "$fe/pkg/"
bun build "$root/packages/shell/web/src/index.ts" --outfile "$fe/index.js" >/dev/null
"$root/scripts/build/rust/cargo-serial.sh" build -p aphrody-shell-tauri-e2e
out="$(timeout 90 "$root/target/debug/aphrody-shell-tauri-e2e" 2>&1 || true)"
echo "$out" | grep E2E_RESULT || { echo "$out" | tail -20; exit 1; }
echo "$out" | grep -q 'LOCAL\[.*tauri-wasm' && echo "$out" | grep -q 'REMOTE\[.*pty-42'
