#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Validates the unified Aphrody/Dragon Ball plugin for its three
# clients: Claude Code (.claude-plugin), Codex (.codex-plugin) and Antigravity
# (plugin.json + mcp_config.json). Exits 1 on the first structural defect.
set -euo pipefail

PLUGIN_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
fail() { echo "FAIL: $*" >&2; exit 1; }
BUN="${BUN_EXE:-bun}"
json() { "$BUN" -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(JSON.stringify(eval('j'+process.argv[2])))" "$1" "$2"; }

echo "Validating the Aphrody plugin at $PLUGIN_DIR"

for manifest in .claude-plugin/plugin.json .codex-plugin/plugin.json plugin.json; do
  [[ -f "$PLUGIN_DIR/$manifest" ]] || fail "missing $manifest"
  [[ "$(json "$PLUGIN_DIR/$manifest" .name)" == '"aphrody"' ]] || fail "$manifest: name is not aphrody"
  echo "OK: $manifest"
done

# The plugin exposes one public MCP endpoint; the kernel routes to internal
# OS, AI, Dragon Ball and Web providers.
for config in .mcp.json mcp_config.json; do
  [[ -f "$PLUGIN_DIR/$config" ]] || fail "missing $config"
  servers="$(json "$PLUGIN_DIR/$config" '.mcpServers' )"
  [[ "$(json "$PLUGIN_DIR/$config" '.mcpServers && Object.keys(j.mcpServers).sort().join(",")')" == '"aphrody"' ]] \
    || fail "$config must declare only the unified aphrody server (got $servers)"
  [[ "$(json "$PLUGIN_DIR/$config" '.mcpServers.aphrody.command')" == *aphrody-kernel* ]] \
    || fail "$config: the aphrody server must run aphrody-kernel"
  [[ "$(json "$PLUGIN_DIR/$config" '.mcpServers.aphrody.args.join(",")')" == '"mcp"' ]] \
    || fail "$config: the aphrody kernel must use the mcp subcommand"
  echo "OK: $config -> unified Aphrody kernel MCP"
done
cmp -s "$PLUGIN_DIR/.mcp.json" "$PLUGIN_DIR/mcp_config.json" \
  || fail "mcp_config.json must remain the byte-for-byte Antigravity projection of .mcp.json"
echo "OK: MCP projections are identical"

count() { find "$PLUGIN_DIR/$1" -mindepth 1 -maxdepth 1 "${@:2}" | wc -l | tr -d ' '; }
echo "OK: $(count skills -type d) skills, $(count agents -name '*.md') agents, $(count commands -name '*.md') commands"

for skill in "$PLUGIN_DIR"/skills/*/SKILL.md; do
  head -n 20 "$skill" | grep -q '^name:' || fail "no name: in $skill"
  head -n 20 "$skill" | grep -q '^description:' || fail "no description: in $skill"
done
echo "OK: skill frontmatter"

# Context budget and cross-references: frontmatter is loaded into every
# session, so descriptions stay short, names match directories, and nothing
# points at a removed skill or at MCP tools the kernel no longer serves.
frontmatter() { awk 'NR==1 && /^---/ {f=1; next} f && /^---/ {exit} f' "$1"; }
for skill in "$PLUGIN_DIR"/skills/*/SKILL.md; do
  dir="$(basename "$(dirname "$skill")")"
  name="$(frontmatter "$skill" | sed -n 's/^name: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' | head -n1)"
  [[ "$name" == "$dir" ]] || fail "$skill: name '$name' does not match directory '$dir'"
  desc="$(frontmatter "$skill" | sed -n 's/^description: *//p' | head -n1)"
  [[ -n "$desc" && "$desc" != ">"* && "$desc" != "|"* ]] || fail "$skill: description must be a single line"
  (( ${#desc} <= 260 )) || fail "$skill: description is ${#desc} chars (max 260)"
done
for agent in "$PLUGIN_DIR"/agents/*.md; do
  desc="$(frontmatter "$agent" | sed -n 's/^description: *//p' | head -n1)"
  (( ${#desc} <= 260 )) || fail "$agent: description is ${#desc} chars (max 260)"
done
if grep -rn 'mcp__aphrody__' "$PLUGIN_DIR"/agents "$PLUGIN_DIR"/commands "$PLUGIN_DIR"/skills/*/SKILL.md \
  | grep -v 'skills/docs/SKILL.md'; then
  fail "references to mcp__aphrody__* tools, which aphrody-kernel does not serve"
fi
for ref in $(grep -rhoE '(^|[ `(])skills/[a-z0-9_-]+/' "$PLUGIN_DIR"/agents "$PLUGIN_DIR"/commands "$PLUGIN_DIR"/skills \
  | sed -E 's/^[^s]*//' | sort -u); do
  [[ -d "$PLUGIN_DIR/$ref" ]] || fail "dangling reference to $ref"
done
echo "OK: context budget and cross-references"

for agent in "$PLUGIN_DIR"/agents/*.md; do
  head -n 1 "$agent" | grep -q '^---' || fail "no frontmatter in $agent"
  grep -q '^description:' "$agent" || fail "no description: in $agent"
done
echo "OK: agent frontmatter"

hooks="$PLUGIN_DIR/hooks/hooks.json"
[[ -f "$hooks" ]] || fail "missing hooks/hooks.json"
for script in $(grep -o 'CLAUDE_PLUGIN_ROOT}/[^" \\]*\.sh' "$hooks" | sed 's|CLAUDE_PLUGIN_ROOT}/||'); do
  [[ -f "$PLUGIN_DIR/$script" ]] || fail "hooks.json references missing $script"
done
echo "OK: hooks.json and its scripts"

echo "Unified Aphrody plugin validation passed"
