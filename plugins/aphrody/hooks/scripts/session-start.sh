#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SessionStart: print a one-line summary of the Aphrody kernel catalog.
#
# Portable: works in any project. When the kernel binary is absent, broken or
# slow, the hook prints nothing and exits 0 so the session starts normally.
# The full catalog stays available through `aphrody-kernel tools` and the MCP
# `tools/list`; it is never dumped into the session context.
set -uo pipefail

[[ "${APHRODY_PLUGIN_QUIET:-0}" == "1" ]] && exit 0

kernel="${APHRODY_KERNEL_BIN:-aphrody-kernel}"
command -v "$kernel" >/dev/null 2>&1 || exit 0

run() {
  if command -v timeout >/dev/null 2>&1; then timeout 4 "$@"; else "$@"; fi
}
catalog="$(run "$kernel" tools 2>/dev/null </dev/null)" || exit 0
[[ -n "$catalog" ]] || exit 0

if command -v jq >/dev/null 2>&1; then
  count="$(printf '%s' "$catalog" | jq -r 'if type == "array" then length elif type == "object" and has("tools") then (.tools | length) else empty end' 2>/dev/null)"
else
  count="$(printf '%s' "$catalog" | grep -o '"inputSchema"[[:space:]]*:' | wc -l | tr -d ' ')"
fi
[[ -n "${count:-}" && "$count" != "0" ]] || exit 0

echo "Aphrody kernel MCP available (${count} tools, server mcp__plugin_aphrody_aphrody__*). Prefer its tools over generic shell/web equivalents when they match the task."
exit 0
