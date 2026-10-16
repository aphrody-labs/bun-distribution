#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Container entrypoint: one command word selects the Aphrody surface, anything else runs as given.
#   mcp      the single MCP server over stdio (aphrody mcp-server; m3-mcp is an alias); yolo and M3 are its tool hosts
#   api      MCP Streamable HTTP service (aphrody-mcp http; needs APHRODY_MCP_HTTP_TOKEN[_FILE], binds 0.0.0.0:$PORT)
#   yolo     the Yolo CLI                        aphrody  the Rust multi-call CLI
#   shell    an interactive bash
set -eu

root="${APHRODY_ROOT:-/app}"
cmd="${1:-mcp}"
[ "$#" -eq 0 ] || shift

mkdir -p "${APHRODY_HOME:-$HOME/.aphrody}"
if [ -f "$root/scripts/dev/cloud-agent-home.ts" ] && command -v bun >/dev/null 2>&1; then
  if [ ! -f "${APHRODY_HOME:-$HOME/.aphrody}/workspaces/aphrody/AGENTS.md" ]; then
    bun "$root/scripts/dev/cloud-agent-home.ts" --apply >&2 || true
  fi
fi
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
    if [ -n "${APHRODY_MCP_HTTP_TOKEN_FILE:-}" ]; then
      [ -r "$APHRODY_MCP_HTTP_TOKEN_FILE" ] || {
        echo "aphrody-entrypoint: API secret file is not readable" >&2
        exit 64
      }
      APHRODY_MCP_HTTP_TOKEN="$(cat "$APHRODY_MCP_HTTP_TOKEN_FILE")"
      export APHRODY_MCP_HTTP_TOKEN
    fi
    if [ -z "${APHRODY_MCP_HTTP_TOKEN:-}" ]; then
      echo "aphrody-entrypoint: APHRODY_MCP_HTTP_TOKEN (32 bytes or more) is required to bind 0.0.0.0 (pass it as a secret, never bake it into an image)" >&2
      exit 64
    fi
    command -v aphrody-mcp >/dev/null 2>&1 || {
      echo "aphrody-entrypoint: aphrody-mcp is not installed in this image" >&2
      exit 127
    }
    # aphrody-mcp refuses non-loopback binds by design: it listens on the container loopback and socat exposes
    # that port on the container interface; the host publishes it on its own loopback only (compose).
    inner=18793
    socat "TCP-LISTEN:${PORT:-8999},fork,reuseaddr,bind=0.0.0.0" "TCP:127.0.0.1:$inner" &
    exec aphrody-mcp http --bind "127.0.0.1:$inner" "$@"
    ;;
  yolo)
    if command -v aphrody >/dev/null 2>&1; then exec aphrody yolo "$@"; fi
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
