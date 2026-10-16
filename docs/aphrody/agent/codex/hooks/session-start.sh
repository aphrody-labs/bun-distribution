#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Claude cloud session bootstrap: pinned Bun, locked Bun dependencies, `yolo` on PATH, cloud build profile.
# Idempotent and non-interactive; does nothing outside a Claude Code cloud session.
set -euo pipefail

[[ "${CLAUDE_CODE_REMOTE:-}" == true ]] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)}"
bun_pin="$(sed -nE 's/^[[:space:]]*"packageManager":[[:space:]]*"bun@([^"]+)".*/\1/p' "$root/package.json" | head -1)"
bun_home="$HOME/.bun-$bun_pin"
bun_bin="$bun_home/node_modules/bun/bin/bun"
[[ -x "$bun_bin" ]] || bun_bin="$bun_home/node_modules/bun/bin/bun.exe"

if [[ -n "$bun_pin" && "$("$bun_bin" --version 2>/dev/null || true)" != "$bun_pin" ]]; then
    mkdir -p "$bun_home"
    [[ -f "$bun_home/package.json" ]] || printf '{"name":"bun-pin","private":true}\n' > "$bun_home/package.json"
    (cd "$bun_home" && bun add "bun@$bun_pin" >&2)
    [[ -x "$bun_home/node_modules/bun/bin/bun" ]] && bun_bin="$bun_home/node_modules/bun/bin/bun"
    [[ -x "$bun_home/node_modules/bun/bin/bun.exe" ]] && bun_bin="$bun_home/node_modules/bun/bin/bun.exe"
fi
if [[ -x "$bun_bin" ]]; then
    mkdir -p "$HOME/.local/bin"
    ln -sf "$bun_bin" "$HOME/.local/bin/bun"
    printf '#!/bin/sh\nexec bun "%s/packages/engine/yolo/src/index.ts" "$@"\n' "$root" > "$HOME/.local/bin/yolo"
    chmod +x "$HOME/.local/bin/yolo"
fi

(cd "$root" && bun install --frozen-lockfile >&2)

if [[ -n "${CLAUDE_ENV_FILE:-}" ]]; then
    {
        echo 'export APHRODY_CLOUD=1'
        echo 'export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"'
    } >> "$CLAUDE_ENV_FILE"
fi
# Rust, uv, Graphify, build tools and the code graph (background, tolerant).
[[ -x "$root/scripts/dev/cloud-setup.sh" ]] && bash "$root/scripts/dev/cloud-setup.sh" --background >&2 || true
