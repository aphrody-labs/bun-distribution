#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# PreToolUse(Bash) guard: block a bare `bun test` (no path argument) in a Bun
# package that vendors third-party sources. Bun's runner walks every directory,
# so a package with `package.json` + `vendor/` picks up the vendored suites and
# reports failures that are not the project's own (the original case was the
# former Aphrody Web `bxc` package). Scope the run instead:
#   bun test test/ src/        (or explicit test files)
#
# Generic and project-agnostic: the guard only applies when the directory the
# command runs in (the hook `cwd`, or the target of a leading `cd DIR &&`) has
# both `package.json` and a `vendor/` directory. Everywhere else it is a no-op.
# Opt out with APHRODY_ALLOW_BARE_BUN_TEST=1 or `enabled: false` in the
# project's `.claude/aphrody.local.md`.
#
# Claude Code passes the tool call as JSON on stdin; exit 2 blocks the call and
# shows stderr to the model. Uses jq when available, sed otherwise.
set -uo pipefail

[[ "${APHRODY_ALLOW_BARE_BUN_TEST:-0}" == "1" ]] && exit 0

input="$(cat)"

field() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null | head -n 1
  else
    printf '%s' "$input" \
      | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\(\([^\"\\\\]\|\\\\.\)*\)\".*/\1/p" | head -n 1
  fi
}
command="$(field '.tool_input.command' command)"
cwd="$(field '.cwd' cwd)"
[[ -n "$command" ]] || exit 0

# Fast path: nothing to check unless the command runs `bun test` bare.
printf '%s' "$command" \
  | grep -qE '(^|[;&|[:space:]])bun[[:space:]]+test([[:space:]]+-[^[:space:]]+)*[[:space:]]*($|[;&|])' \
  || exit 0

dir="${cwd:-${CLAUDE_PROJECT_DIR:-$PWD}}"
# Honour a leading `cd DIR && ...` / `cd DIR; ...`.
cd_target="$(printf '%s' "$command" | sed -n 's/^[[:space:]]*cd[[:space:]]\{1,\}\([^;&|[:space:]]\{1,\}\).*/\1/p' | head -n 1)"
if [[ -n "$cd_target" ]]; then
  cd_target="${cd_target%\"}"; cd_target="${cd_target#\"}"
  cd_target="${cd_target%\'}"; cd_target="${cd_target#\'}"
  case "$cd_target" in
    /*) dir="$cd_target" ;;
    *) dir="$dir/$cd_target" ;;
  esac
fi

# Per-project opt-out.
settings="${CLAUDE_PROJECT_DIR:-$dir}/.claude/aphrody.local.md"
if [[ -f "$settings" ]] \
  && sed -n '/^---$/,/^---$/p' "$settings" | grep -qE '^enabled:[[:space:]]*false'; then
  exit 0
fi

[[ -f "$dir/package.json" && -d "$dir/vendor" ]] || exit 0

echo "aphrody: bare 'bun test' in $dir also runs the suites under vendor/." >&2
echo "Scope it: bun test test/ src/   (or explicit test files)." >&2
echo "Override: APHRODY_ALLOW_BARE_BUN_TEST=1." >&2
exit 2
