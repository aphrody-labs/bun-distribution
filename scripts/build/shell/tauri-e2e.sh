#!/usr/bin/env bash
# Real-browser e2e: assemble the frontend (WASM pkg + transpiled transports), build and run the
# aphrody-app example shell_e2e (real CEF webview, permission-checked IPC through the
# aphrody-shell-tauri plugin) and check what it reports.
# Needs the CEF distribution (CEF_PATH, downloaded by the build when missing), GTK 4 libraries and an
# X server: CEF runs on X11 (XWayland under Wayland), so Xvfb is enough on a headless host.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
fe="$root/crates/ui/app/examples/shell_e2e/frontend"
"$root/scripts/build/shell/build-wasm.sh" >/dev/null
rm -rf "$fe/pkg" && mkdir -p "$fe/pkg"
cp "$root"/packages/shell/web/pkg/aphrody_shell_web{.js,_bg.wasm} "$fe/pkg/"
bun build "$root/packages/shell/web/src/index.ts" --outfile "$fe/index.js" >/dev/null
"$root/scripts/build/rust/cargo-serial.sh" build -p aphrody-app --example shell_e2e --features custom-protocol
display="${APHRODY_E2E_DISPLAY:-:97}"
if [ -z "${DISPLAY:-}" ]; then
  Xvfb "$display" -screen 0 1280x800x24 >/dev/null 2>&1 &
  xvfb=$!
  trap 'kill $xvfb 2>/dev/null' EXIT
  sleep 1
  export DISPLAY="$display"
fi
# Containers and CI images usually offer neither the setuid chrome-sandbox nor user namespaces.
export APHRODY_SHELL_E2E_FRONTEND="$fe" APHRODY_CEF_UNSAFE_NO_SANDBOX="${APHRODY_CEF_UNSAFE_NO_SANDBOX:-1}"
out="$(timeout 120 "$root/target/debug/examples/shell_e2e" 2>&1 || true)"
echo "$out" | grep E2E_RESULT || { echo "$out" | tail -20; exit 1; }
echo "$out" | grep -q 'LOCAL\[.*tauri-wasm' && echo "$out" | grep -q 'REMOTE\[.*pty-42'
