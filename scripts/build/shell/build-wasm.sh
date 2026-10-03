#!/usr/bin/env bash
# Build aphrody-shell-web for wasm32 and emit JS bindings into packages/shell/web/pkg
# (browser, bundler and Tauri webview consume the same artifact).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
"$root/scripts/build/rust/cargo-serial.sh" build -p aphrody-shell-web --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir "$root/packages/shell/web/pkg" \
    "${CARGO_TARGET_DIR:-$root/target}/wasm32-unknown-unknown/release/aphrody_shell_web.wasm"
