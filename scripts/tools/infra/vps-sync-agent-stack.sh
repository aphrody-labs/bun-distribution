#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Sync the agent tool stack (bxc CLI, aphrody + aphrody-mcp, optional x-cli) and
# agent MCP configs on an ops host from the current monorepo source owner.
# Explicit root overrides retain compatibility with existing snapshot callers.
# APHRODY_ROOT and APHRODY_WEB_ROOT default to the current monorepo;
# BXC_DATA_DIR defaults to $APHRODY_WEB_ROOT/var/bxc. The bxc MCP tools are
# served by aphrody-mcp (crates/aphrody-mcp/src/bxc_tools.rs): there is no
# separate bxc-mcp binary any more. Production runtimes ship through the
# all-in-one bundle (docs/operations/infra/IMMUTABLE-RELEASES.md), not through this script.
set -euo pipefail

INFRA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APHRODY_ROOT="${APHRODY_ROOT:-$INFRA_ROOT}"
APHRODY_WEB_ROOT="${APHRODY_WEB_ROOT:-$APHRODY_ROOT}"
BXC_ROOT="${BXC_ROOT:-$APHRODY_WEB_ROOT/scripts/tools/web/apps/bxc}"
if [[ ! -f "$BXC_ROOT/bin/bxc" && -f "$APHRODY_WEB_ROOT/apps/bxc/bin/bxc" ]]; then
  BXC_ROOT="$APHRODY_WEB_ROOT/apps/bxc"
fi
CARGO_WRAPPER="$APHRODY_ROOT/scripts/build/rust/cargo-serial.sh"
LOCAL_BIN="${HOME}/.local/bin"
MCP_CONFIG="${HOME}/.config/aphrody/mcp.json"
BXC_DATA_DIR="${BXC_DATA_DIR:-$APHRODY_WEB_ROOT/var/bxc}"
mkdir -p "$LOCAL_BIN"

echo "==> [1/6] Install aphrody-web dependencies + link the bxc CLI"
bun install --cwd "$APHRODY_WEB_ROOT" --frozen-lockfile
if [[ -f "$BXC_ROOT/bin/bxc" ]] && [[ "$(readlink -f "$BXC_ROOT/bin/bxc")" != "$(readlink -f "$LOCAL_BIN/bxc" 2>/dev/null || echo MISSING)" ]]; then
  ln -sfn "$BXC_ROOT/bin/bxc" "$LOCAL_BIN/bxc"
fi

echo "==> [2/6] Build Rust x-cli (optional; aphrody x via the multi-call binary)"
if [[ "${BUILD_X_CLIENT:-0}" == "1" ]]; then
  command -v cargo >/dev/null || { echo 'BUILD_X_CLIENT requires Cargo' >&2; exit 1; }
  [[ -x "$CARGO_WRAPPER" ]] || { echo "missing serialized Cargo owner: $CARGO_WRAPPER" >&2; exit 1; }
  (cd "$APHRODY_WEB_ROOT" && "$CARGO_WRAPPER" build --release --locked -p aphrody --bin aphrody)
  x_target="${APHRODY_CARGO_TARGET_DIR:-$(cd "$APHRODY_WEB_ROOT" && cargo metadata --format-version 1 --no-deps | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')}"
  [[ -f "$x_target/release/aphrody" ]] || { echo "build produced no aphrody in $x_target/release" >&2; exit 1; }
  # x-cli is the aphrody multi-call binary under its former name (dispatch on argv[0]).
  install -m 755 "$x_target/release/aphrody" "$LOCAL_BIN/x-cli"
fi

echo "==> [3/6] aphrody + aphrody-mcp binaries"
ai_target="$(cd "$APHRODY_ROOT" && cargo metadata --format-version 1 --no-deps 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])' || true)"
APHRODY_RELEASE=""
for d in "${ai_target:-$APHRODY_ROOT/target}/x86_64-unknown-linux-gnu/release" "${ai_target:-$APHRODY_ROOT/target}/release"; do
  [[ -x "$d/aphrody" ]] && APHRODY_RELEASE="$d" && break
done
if [[ -n "$APHRODY_RELEASE" ]]; then
  # aphrody-mcp is the aphrody multi-call binary under its former name (dispatch on argv[0]).
  for bin in aphrody-mcp aphrody; do
    install -m 755 "$APHRODY_RELEASE/aphrody" "$LOCAL_BIN/$bin"
    echo "    installed $LOCAL_BIN/$bin"
  done
elif command -v aphrody-mcp &>/dev/null; then
  echo "    aphrody-mcp already in PATH"
else
  echo "    skip: use the VPS factory owner to build aphrody-mcp and aphrody through $CARGO_WRAPPER"
fi

echo "==> [4/6] Ensure MCP config"
mkdir -p "$(dirname "$MCP_CONFIG")" "$BXC_DATA_DIR"
if [[ ! -f "$MCP_CONFIG" ]]; then
  cat >"$MCP_CONFIG" <<EOF
{
  "mcpServers": {
    "aphrody": {
      "command": "$LOCAL_BIN/aphrody-mcp",
      "args": [],
      "env": {
        "BXC_DB_PATH": "$BXC_DATA_DIR/bxc.sqlite",
        "BXC_MEMORY_DB": "$BXC_DATA_DIR/bxc-memory.sqlite",
        "REDIS_URL": "redis://127.0.0.1:6379"
      }
    }
  }
}
EOF
fi

echo "==> [5/6] Grok MCP compat (config.toml)"
GROK_CFG="${HOME}/.grok/config.toml"
if [[ -f "$GROK_CFG" ]] && ! grep -q 'mcp_servers.aphrody' "$GROK_CFG" 2>/dev/null; then
  cat >>"$GROK_CFG" <<EOF

[mcp_servers.aphrody]
command = "$LOCAL_BIN/aphrody-mcp"
startup_timeout_sec = 15
tool_timeout_sec = 120
EOF
  echo "    appended [mcp_servers.aphrody] to $GROK_CFG"
fi

echo "==> [6/6] Refresh agent-stack docs"
AGENT_DOCS_DIR="${APHRODY_AGENT_DOCS_DIR:-$APHRODY_ROOT/var/agent-stack}"
mkdir -p "$AGENT_DOCS_DIR"
for cmd in agy grok claude bxc aphrody; do
  if command -v "$cmd" &>/dev/null; then
    "$cmd" --help >"$AGENT_DOCS_DIR/${cmd}-help.txt" 2>&1 || true
  fi
done

echo "==> Health checks"
command -v bxc && bxc --version 2>/dev/null || true
command -v aphrody-mcp && echo "aphrody-mcp: ok" || echo "aphrody-mcp: MISSING"
test -f "$MCP_CONFIG" && echo "mcp.json: ok"
