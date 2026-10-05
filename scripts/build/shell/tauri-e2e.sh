#!/usr/bin/env bash
# Real-webview e2e: assemble the frontend (WASM pkg + transpiled transports), build and run the
# aphrody-app example shell_e2e (real WebKitGTK webview, permission-checked IPC through the
# aphrody-shell-tauri plugin) and check what it reports.
# Needs webkit2gtk and broadwayd (GTK3 headless display, no X server).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
fe="$root/crates/ui/app/examples/shell_e2e/frontend"
"$root/scripts/build/shell/build-wasm.sh" >/dev/null
rm -rf "$fe/pkg" && mkdir -p "$fe/pkg"
cp "$root"/packages/shell/web/pkg/aphrody_shell_web{.js,_bg.wasm} "$fe/pkg/"
bun build "$root/packages/shell/web/src/index.ts" --outfile "$fe/index.js" >/dev/null
"$root/scripts/build/rust/cargo-serial.sh" build -p aphrody-app --example shell_e2e --features custom-protocol
broadwayd :7 >/dev/null 2>&1 &
bw=$!
trap 'kill $bw 2>/dev/null' EXIT
sleep 1
export APHRODY_SHELL_E2E_FRONTEND="$fe" GDK_BACKEND=broadway BROADWAY_DISPLAY=:7 WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
out="$(timeout 90 "$root/target/debug/examples/shell_e2e" 2>&1 || true)"
echo "$out" | grep E2E_RESULT || { echo "$out" | tail -20; exit 1; }
echo "$out" | grep -q 'LOCAL\[.*tauri-wasm' && echo "$out" | grep -q 'REMOTE\[.*pty-42'
