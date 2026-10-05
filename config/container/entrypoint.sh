#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Container entrypoint: one command word selects the Aphrody surface, anything else runs as given.
#   mcp      yolo MCP server over stdio          m3-mcp   aphrody-m3 design MCP server over stdio
#   api      yolo HTTP API (needs YOLO_API_TOKEN, binds 0.0.0.0:$PORT)
#   yolo     the Bun CLI                         aphrody  the Rust multi-call CLI, when installed
#   shell    an interactive bash
set -eu

root="${APHRODY_ROOT:-/app}"
cmd="${1:-mcp}"
[ "$#" -eq 0 ] || shift

mkdir -p "${APHRODY_HOME:-$HOME/.aphrody}"
# A bind-mounted checkout hides the image's node_modules: restore them from the lockfile, never mutating it.
if [ ! -d "$root/node_modules" ] && [ -f "$root/bun.lock" ]; then
  (cd "$root" && bun install --frozen-lockfile >&2)
fi

case "$cmd" in
  mcp) exec bun "$root/apps/yolo/cli/src/index.ts" mcp "$@" ;;
  m3-mcp) exec bun "$root/m3/packages/m3-mcp/src/server.ts" "$@" ;;
  api)
    if [ -z "${YOLO_API_TOKEN:-}" ]; then
      echo "aphrody-entrypoint: YOLO_API_TOKEN is required to bind 0.0.0.0 (pass it as an environment secret, never bake it into an image)" >&2
      exit 64
    fi
    exec bun "$root/apps/yolo/cli/src/index.ts" api --host 0.0.0.0 --port "${PORT:-8999}" "$@"
    ;;
  yolo) exec bun "$root/apps/yolo/cli/src/index.ts" "$@" ;;
  aphrody)
    command -v aphrody >/dev/null 2>&1 || {
      echo "aphrody-entrypoint: the Rust 'aphrody' binary is not installed in this image (mount it or install it from APHRODY_DOWNLOAD_BASE)" >&2
      exit 127
    }
    exec aphrody "$@"
    ;;
  shell | bash | sh) exec bash "$@" ;;
  *) exec "$cmd" "$@" ;;
esac
