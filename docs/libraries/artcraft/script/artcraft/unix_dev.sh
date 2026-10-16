#!/usr/bin/env bash
set -euo pipefail
root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo 'Usage: ./script/artcraft/unix_dev.sh; Bun frontend reload + native Tauri 2 Rust watcher.'
  echo 'Requires Aphrody Bun 1.4.4, Rust, cargo-tauri 2 and native platform prerequisites.'
  exit 0
fi
source "$root_dir/script/common/frontend_preflight.sh"
frontend_preflight "$root_dir/frontend"
cd "$root_dir/frontend"
frontend_bun_install
exec bun scripts/unix-dev.mjs
