#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Bun version management and package-manager hygiene for one host (user systemd timer
# aphrody-bun-hygiene). Policy as docs/operations/infra/update/BUN.md: latest stable release that is
# at least MIN_AGE_DAYS old (bunfig minimumReleaseAge = 3 days); every host runs the same rule and converges.
# Never rewrites a lockfile or touches a shared working tree; reports only, except `bun upgrade` and cache prune.
set -uo pipefail
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
MIN_AGE_DAYS="${MIN_AGE_DAYS:-3}"; CACHE_MAX_GB="${CACHE_MAX_GB:-5}"; REPO="${APHRODY_ROOT:-$HOME/aphrody}"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/aphrody/log"; mkdir -p "$LOG_DIR"; LOG="$LOG_DIR/bun-hygiene.log"
exec > >(tee -a "$LOG") 2>&1
say() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
say "start host=$(hostname) bun=$(bun --version 2>/dev/null)"

# 1. version: newest stable release older than MIN_AGE_DAYS
rel=$(curl -fsSL --max-time 30 "https://api.github.com/repos/oven-sh/bun/releases?per_page=10" 2>/dev/null)
target=$(printf '%s' "$rel" | jq -r --argjson d "$MIN_AGE_DAYS" '[.[]|select(.prerelease==false and .draft==false and ((now - (.published_at|fromdateiso8601)) > ($d*86400)))][0].tag_name // empty' | sed 's/^bun-v//')
cur=$(bun --version 2>/dev/null)
if [ -n "$target" ] && [ "$target" != "$cur" ] && [ "$(printf '%s\n%s\n' "$cur" "$target" | sort -V | tail -1)" = "$target" ]; then
  say "upgrade $cur -> $target"
  curl -fsSL https://bun.sh/install | bash -s "bun-v$target" >/dev/null 2>&1 && say "bun now $(bun --version)" || say "WARN upgrade failed"
else say "version ok cur=$cur eligible=${target:-unknown}"; fi
mkdir -p "$HOME/.local/state/aphrody"; printf '%s\n' "$(bun --version)" > "$HOME/.local/state/aphrody/bun-version"

# 2. global packages and drift report
say "global packages"; bun pm ls -g 2>&1 | sed 's/^/  /'
say "outdated (global)"; (cd "$HOME/.bun/install/global" 2>/dev/null && bun outdated 2>&1 | sed 's/^/  /') || true
say "untrusted lifecycle scripts"; bun pm -g untrusted 2>&1 | sed 's/^/  /'

# 3. cache: report; prune entries untouched for 30 days only above the size threshold
cache=$(bun pm cache 2>/dev/null | tail -1)
if [ -d "$cache" ]; then
  kb=$(du -sk "$cache" 2>/dev/null | cut -f1); say "cache $cache ${kb}KB"
  if [ "${kb:-0}" -gt $((CACHE_MAX_GB*1024*1024)) ]; then find "$cache" -mindepth 1 -maxdepth 1 -atime +30 -exec rm -rf {} + ; say "pruned entries unused for 30 days"; fi
fi

# 4. lockfile verification in a temp context (checkout present only; never writes the tree)
if [ -d "$REPO/.git" ] && [ -f "$REPO/bun.lock" ]; then
  t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
  (cd "$REPO" && git ls-files -z -- bun.lock bunfig.toml patches '*package.json' | tar --null -T - -cf -) | tar -xf - -C "$t"
  if (cd "$t" && timeout 900 bun install --frozen-lockfile --dry-run --ignore-scripts >/dev/null 2>"$t/err"); then say "lockfile frozen-verify ok"; else say "WARN lockfile frozen-verify failed: $(tail -2 "$t/err" | tr '\n' ' ')"; fi
else say "lockfile verify skipped (no checkout at $REPO)"; fi
say "done"
