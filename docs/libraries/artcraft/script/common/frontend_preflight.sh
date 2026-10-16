#!/usr/bin/env bash
# Native Bun frontend preflight shared by the Unix launchers.
frontend_preflight() {
  local frontend_path="$1"
  test -d "$frontend_path" || { echo "Frontend not found: $frontend_path" >&2; exit 1; }
  command -v bun >/dev/null || { echo 'Bun 1.4.4 from aphrody-labs/bun is required.' >&2; exit 1; }
  bun -e 'if (Bun.version !== "1.4.4" || !process.release.sourceUrl?.startsWith("https://github.com/aphrody-labs/bun/releases/download/")) throw new Error("Use the Aphrody Bun 1.4.4 runtime");'
}

frontend_bun_install() {
  bun install --frozen-lockfile --ignore-scripts
}
