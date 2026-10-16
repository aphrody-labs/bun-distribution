#!/usr/bin/env bash
# Build aphrody-shell-web for wasm32 and emit the wasm-bindgen package into packages/shell/web/pkg
# (browser, bundler and Tauri webview consume the same artifact). The shared owner is
# scripts/build/rust/wasm-package.ts: local cargo-serial in a cloud session, the VPS tunnel elsewhere.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec bun "$root/scripts/build/rust/wasm-package.ts" --crate aphrody-shell-web --out packages/shell/web/pkg "$@"
