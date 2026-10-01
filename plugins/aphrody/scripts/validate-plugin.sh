#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Validates the unified Aphrody plugin for its three clients: Claude Code
# (.claude-plugin), Codex (.codex-plugin) and Antigravity/agy (root plugin.json,
# mcp_config.json, hooks.json).
#
# Usage: scripts/validate-plugin.sh [PLUGIN_DIR]   (runs from any cwd)
#
# Errors (exit 1): invalid JSON, manifest/MCP/version drift, missing or invalid
# frontmatter, broken hook scripts, dangling skill references.
# Warnings (exit 0): hard-coded user paths and monorepo paths that do not exist.
# Every problem is reported; the script does not stop at the first one.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "${1:-$SELF_DIR/..}" && pwd)"
errors=0
warnings=0
err() { echo "FAIL: $*" >&2; errors=$((errors + 1)); }
warn() { echo "WARN: $*" >&2; warnings=$((warnings + 1)); }
ok() { echo "OK: $*"; }
rel() { printf '%s' "${1#"$PLUGIN_DIR"/}"; }

# JSON query: jq first, python3 as fallback (filters are kept jq/python neutral
# by only asking for simple paths through `jqp`).
if command -v jq >/dev/null 2>&1; then
  json_valid() { jq empty "$1" >/dev/null 2>&1; }
  jqr() { jq -r "$2" "$1" 2>/dev/null; }
else
  echo "WARN: jq not found; using python3 for JSON checks" >&2
  json_valid() { python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$1" 2>/dev/null; }
  jqr() {
    python3 - "$1" "$2" <<'PY' 2>/dev/null
import json, sys
data = json.load(open(sys.argv[1]))
expr = sys.argv[2]
# Supported forms: .a.b | .a.b | keys | .a.b | join(",")
parts = [p.strip() for p in expr.split("|")]
cur = data
for p in parts:
    if p == "keys": cur = sorted(cur.keys())
    elif p.startswith("join("): cur = ",".join(map(str, cur))
    else:
        for k in [k for k in p.split(".") if k]:
            cur = cur.get(k) if isinstance(cur, dict) else None
print("" if cur is None else (cur if isinstance(cur, str) else json.dumps(cur) if not isinstance(cur, list) else "\n".join(map(str, cur))))
PY
  }
fi

echo "Validating the Aphrody plugin at $PLUGIN_DIR"

# 1. Every JSON file parses.
while IFS= read -r file; do
  json_valid "$file" || err "invalid JSON: $(rel "$file")"
done < <(find "$PLUGIN_DIR" -name '*.json' -not -path '*/node_modules/*' -not -path '*/.git/*')
ok "JSON syntax"

# 2. Manifests: name, version consistency, marketplace entry.
version="$(jqr "$PLUGIN_DIR/.claude-plugin/plugin.json" '.version')"
for manifest in .claude-plugin/plugin.json .codex-plugin/plugin.json plugin.json; do
  path="$PLUGIN_DIR/$manifest"
  [[ -f "$path" ]] || { err "missing $manifest"; continue; }
  [[ "$(jqr "$path" '.name')" == "aphrody" ]] || err "$manifest: name is not aphrody"
  v="$(jqr "$path" '.version')"
  [[ "${v%%+*}" == "$version" ]] || err "$manifest: version $v differs from $version"
done
market="$PLUGIN_DIR/.claude-plugin/marketplace.json"
if [[ -f "$market" ]]; then
  [[ -n "$(jqr "$market" '.name')" && -n "$(jqr "$market" '.owner.name')" ]] \
    || err "marketplace.json: name and owner.name are required"
  if command -v jq >/dev/null 2>&1; then
    entry="$(jq -c '.plugins[] | select(.name == "aphrody")' "$market" 2>/dev/null)"
    [[ -n "$entry" ]] || err "marketplace.json: no aphrody plugin entry"
    [[ "$(jq -r '.version // empty' <<<"$entry")" == "$version" ]] \
      || err "marketplace.json: aphrody entry version differs from $version"
    [[ "$(jq -r '.source' <<<"$entry")" == "./" ]] || err "marketplace.json: aphrody source must be ./"
  fi
fi
grep -q "^## $version\b" "$PLUGIN_DIR/CHANGELOG.md" 2>/dev/null || err "CHANGELOG.md: no '## $version' entry"
for path in "$PLUGIN_DIR/.claude-plugin/plugin.json" "$PLUGIN_DIR/.codex-plugin/plugin.json"; do
  for key in homepage repository; do
    url="$(jqr "$path" ".$key")"
    [[ -z "$url" || "$url" == https://* ]] || err "$(rel "$path"): $key must be an https URL"
  done
done
ok "manifests (version $version)"

# 3. MCP: one public server keyed "aphrody" running `aphrody-kernel mcp`.
# .mcp.json (Claude Code, Codex) may use ${APHRODY_KERNEL_BIN:-aphrody-kernel};
# mcp_config.json (agy) keeps the literal binary name.
for config in .mcp.json mcp_config.json; do
  path="$PLUGIN_DIR/$config"
  [[ -f "$path" ]] || { err "missing $config"; continue; }
  servers="$(jqr "$path" '.mcpServers | keys | join(",")')"
  [[ "$servers" == "aphrody" ]] || err "$config must declare only the aphrody server (got: $servers)"
  [[ "$(jqr "$path" '.mcpServers.aphrody.command')" == *aphrody-kernel* ]] \
    || err "$config: the aphrody server must run aphrody-kernel"
  [[ "$(jqr "$path" '.mcpServers.aphrody.args | join(",")')" == "mcp" ]] \
    || err "$config: the aphrody server must use the mcp subcommand"
done
ok "MCP declarations"

# 4. Components and frontmatter.
count() { find "$PLUGIN_DIR/$1" -mindepth 1 -maxdepth 1 "${@:2}" 2>/dev/null | wc -l | tr -d ' '; }
echo "OK: $(count skills -type d) skills, $(count agents -name '*.md') agents, $(count commands -name '*.md') commands"

frontmatter() { awk 'NR==1 && /^---[[:space:]]*$/ {f=1; next} f && /^---[[:space:]]*$/ {exit} f' "$1"; }
fm_value() { frontmatter "$1" | sed -n "s/^$2:[[:space:]]*//p" | head -n 1 | sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/'; }

for dir in "$PLUGIN_DIR"/skills/*/; do
  skill="${dir}SKILL.md"
  [[ -f "$skill" ]] || { err "$(rel "$dir") has no SKILL.md"; continue; }
  [[ "$(head -n 1 "$skill")" =~ ^---[[:space:]]*$ ]] || { err "$(rel "$skill"): no frontmatter"; continue; }
  name="$(fm_value "$skill" name)"
  desc="$(fm_value "$skill" description)"
  [[ -n "$name" ]] || err "$(rel "$skill"): no name"
  [[ -z "$name" || "$name" == "$(basename "$dir")" ]] \
    || err "$(rel "$skill"): name '$name' does not match directory '$(basename "$dir")'"
  [[ -n "$desc" ]] || err "$(rel "$skill"): no description"
  [[ "$desc" != ">"* && "$desc" != "|"* ]] || err "$(rel "$skill"): description must be a single line"
  ((${#desc} <= 260)) || err "$(rel "$skill"): description is ${#desc} chars (max 260)"
done
ok "skill frontmatter checked"

for kind in agents commands; do
  for file in "$PLUGIN_DIR"/$kind/*.md; do
    [[ -f "$file" ]] || continue
    [[ "$(head -n 1 "$file")" =~ ^---[[:space:]]*$ ]] || { err "$(rel "$file"): no frontmatter"; continue; }
    desc="$(fm_value "$file" description)"
    [[ -n "$desc" ]] || err "$(rel "$file"): no description"
    ((${#desc} <= 260)) || err "$(rel "$file"): description is ${#desc} chars (max 260)"
    if [[ "$kind" == agents ]]; then
      [[ -n "$(fm_value "$file" name)" ]] || err "$(rel "$file"): no name"
    fi
  done
done
ok "agent and command frontmatter checked"

# Tool names: the kernel is reached as mcp__plugin_aphrody_aphrody__*; the
# old project-scope prefix mcp__aphrody__ does not resolve for plugin users.
while IFS= read -r hit; do
  err "stale MCP prefix (use mcp__plugin_aphrody_aphrody__*): $hit"
done < <(grep -rn 'mcp__aphrody__' "$PLUGIN_DIR"/agents "$PLUGIN_DIR"/commands "$PLUGIN_DIR"/skills/*/SKILL.md 2>/dev/null \
  | grep -v 'skills/docs/SKILL.md' | sed "s|$PLUGIN_DIR/||")

for ref in $(grep -rhoE '(^|[ `(])skills/[a-z0-9_-]+/' "$PLUGIN_DIR"/agents "$PLUGIN_DIR"/commands "$PLUGIN_DIR"/skills 2>/dev/null \
  | sed -E 's/^[^s]*//' | sort -u); do
  [[ -d "$PLUGIN_DIR/$ref" ]] || err "dangling reference to $ref"
done
ok "cross-references"

# 5. Hooks: both hook files parse, referenced scripts exist and pass bash -n.
hooks="$PLUGIN_DIR/hooks/hooks.json"
if [[ -f "$hooks" ]]; then
  [[ -n "$(jqr "$hooks" '.hooks')" ]] || err "hooks/hooks.json: missing top-level hooks wrapper"
  for script in $(grep -o 'CLAUDE_PLUGIN_ROOT}/[^" \\]*\.sh' "$hooks" | sed 's|CLAUDE_PLUGIN_ROOT}/||' | sort -u); do
    if [[ -f "$PLUGIN_DIR/$script" ]]; then
      bash -n "$PLUGIN_DIR/$script" || err "$script: bash syntax error"
    else
      err "hooks.json references missing $script"
    fi
  done
else
  err "missing hooks/hooks.json"
fi
ok "hooks"

# 6. Portability: no user-specific absolute paths, and monorepo paths that are
# cited in backticks must exist when the plugin sits inside the monorepo.
portable_scan=("$PLUGIN_DIR"/skills "$PLUGIN_DIR"/agents "$PLUGIN_DIR"/commands "$PLUGIN_DIR"/home
  "$PLUGIN_DIR"/examples "$PLUGIN_DIR"/docs "$PLUGIN_DIR"/README.md "$PLUGIN_DIR"/hooks
  "$PLUGIN_DIR"/.mcp.json "$PLUGIN_DIR"/mcp_config.json "$PLUGIN_DIR"/yolo.json)
while IFS= read -r hit; do
  warn "user-specific absolute path: $hit"
done < <(grep -rnE '/home/[a-z_][a-z0-9_-]*/|/Users/[A-Za-z]|[A-Za-z]:\\\\?Users\\\\?[A-Za-z]' \
  --include='*.md' --include='*.json' --include='*.sh' --include='*.ts' --include='*.py' --include='*.nu' \
  --include='*.ps1' --include='*.toml' --include='*.yaml' --include='*.yml' "${portable_scan[@]}" 2>/dev/null \
  | grep -vE '/home/(user|you|me|runner|<[^>]*>)/|/Users/(you|me|name|<)|\\Users\\(you|<)' \
  | sed "s|$PLUGIN_DIR/||" | cut -c1-200)

repo_root="$(git -C "$PLUGIN_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -n "$repo_root" && -d "$repo_root/crates/os/kernel" ]]; then
  missing=0
  while IFS=: read -r file line path; do
    path="${path%%:*}"; path="${path%/}"; path="${path%.}"
    [[ -e "$repo_root/$path" || -e "$PLUGIN_DIR/$path" ]] && continue
    warn "missing monorepo path \`$path\` in ${file#"$PLUGIN_DIR"/}:$line"
    missing=$((missing + 1))
  done < <(grep -rnoE '`(crates|apps|packages|docs|scripts|config|upstream)/[A-Za-z0-9._/-]+`' \
    "$PLUGIN_DIR"/skills "$PLUGIN_DIR"/agents "$PLUGIN_DIR"/commands "$PLUGIN_DIR"/docs \
    "$PLUGIN_DIR"/home "$PLUGIN_DIR"/README.md 2>/dev/null | tr -d '`')
  ok "portability scan against monorepo root ($missing missing path(s))"
else
  ok "portability scan (not inside the Aphrody monorepo; repo path check skipped)"
fi

echo
if ((errors > 0)); then
  echo "Aphrody plugin validation FAILED: $errors error(s), $warnings warning(s)" >&2
  exit 1
fi
echo "Aphrody plugin validation passed ($warnings warning(s))"
