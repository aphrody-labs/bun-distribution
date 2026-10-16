#!/usr/bin/env bash
# Run the existing WASM, Bun and real Tauri webview shell gates in owner order.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
"$root/scripts/build/shell/build-wasm.sh"
(
  cd "$root/packages/shell/web"
  bun run typecheck
  bun test
)
bun "$root/scripts/build/desktop/e2e.ts"
