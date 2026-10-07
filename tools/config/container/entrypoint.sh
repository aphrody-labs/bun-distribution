#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Container entrypoint: one command word selects the Aphrody surface, anything else runs as given.
#   mcp      the single MCP server over stdio (aphrody mcp-server; m3-mcp is an alias); yolo and M3 are its tool hosts
#   api      yolo HTTP API (needs YOLO_API_TOKEN, binds 0.0.0.0:$PORT)
#   yolo     the Yolo CLI                        aphrody  the Rust multi-call CLI
#   shell    an interactive bash
set -eu

root="${APHRODY_ROOT:-/app}"
cmd="${1:-mcp}"
[ "$#" -eq 0 ] || shift

mkdir -p "${APHRODY_HOME:-$HOME/.aphrody}"
# A bind-mounted checkout hides the image's node_modules: restore them from the lockfile, never mutating it.
if [ ! -d "$root/node_modules" ] && [ -f "$root/bun.lock" ]; then
  command -v bun >/dev/null 2>&1 || {
    echo "aphrody-entrypoint: a source checkout requires the dev or release-builder image" >&2
    exit 127
  }
  (cd "$root" && bun install --frozen-lockfile >&2)
fi

case "$cmd" in
  mcp | m3-mcp)
    if command -v aphrody-mcp >/dev/null 2>&1; then exec aphrody-mcp "$@"; fi
    command -v aphrody >/dev/null 2>&1 || {
      echo "aphrody-entrypoint: the Rust 'aphrody' binary is required for the MCP server (mount it or install it from APHRODY_DOWNLOAD_URL)" >&2
      exit 127
    }
    exec aphrody mcp-server "$@"
    ;;
  api)
    if [ -n "${YOLO_API_TOKEN_FILE:-}" ]; then
      [ -r "$YOLO_API_TOKEN_FILE" ] || {
        echo "aphrody-entrypoint: API secret file is not readable" >&2
        exit 64
      }
      YOLO_API_TOKEN="$(cat "$YOLO_API_TOKEN_FILE")"
      export YOLO_API_TOKEN
    fi
    if [ -z "${YOLO_API_TOKEN:-}" ]; then
      echo "aphrody-entrypoint: YOLO_API_TOKEN is required to bind 0.0.0.0 (pass it as an environment secret, never bake it into an image)" >&2
      exit 64
    fi
    if command -v yolo >/dev/null 2>&1; then
      exec yolo api --host 0.0.0.0 --port "${PORT:-8999}" "$@"
    fi
    [ -f "$root/packages/engine/yolo/src/index.ts" ] || {
      echo "aphrody-entrypoint: the Yolo CLI is required for the API" >&2
      exit 127
    }
    exec bun "$root/packages/engine/yolo/src/index.ts" api --host 0.0.0.0 --port "${PORT:-8999}" "$@"
    ;;
  yolo)
    if command -v yolo >/dev/null 2>&1; then exec yolo "$@"; fi
    [ -f "$root/packages/engine/yolo/src/index.ts" ] || {
      echo "aphrody-entrypoint: the Yolo CLI is not installed in this image" >&2
      exit 127
    }
    exec bun "$root/packages/engine/yolo/src/index.ts" "$@"
    ;;
  aphrody)
    command -v aphrody >/dev/null 2>&1 || {
      echo "aphrody-entrypoint: the Rust 'aphrody' binary is not installed in this image (mount it or install it from APHRODY_DOWNLOAD_URL)" >&2
      exit 127
    }
    exec aphrody "$@"
    ;;
  shell | bash) exec bash "$@" ;;
  sh) exec sh "$@" ;;
  *) exec "$cmd" "$@" ;;
esac
