#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# PreToolUse(Bash) guard for the Aphrody Web package: a bare `bun test` run inside
# apps/bxc walks vendor/ and reports 60-140 pre-existing failures, so it must be
# scoped (`bun test test/ packages/ src/` or explicit files).
#
# Claude Code passes the tool call as JSON on stdin; exit 2 blocks the call and
# shows stderr to the model. Everything outside apps/bxc is left alone.
set -euo pipefail

input="$(cat)"
command="$(printf '%s' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(\([^"\\]\|\\.\)*\)".*/\1/p' | head -n 1)"
cwd="$(printf '%s' "$input" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\(\([^"\\]\|\\.\)*\)".*/\1/p' | head -n 1)"

in_bxc=false
case "$cwd" in *apps/bxc* | *apps\\\\bxc*) in_bxc=true ;; esac
case "$command" in *apps/bxc*) in_bxc=true ;; esac
$in_bxc || exit 0

# `bun test` with no path argument (flags only, or nothing).
if printf '%s' "$command" | grep -qE '(^|[;&|[:space:]])bun[[:space:]]+test([[:space:]]+-[^[:space:]]+)*[[:space:]]*($|[;&|])'; then
  echo "bxc: bare 'bun test' walks vendor/ and fails on pre-existing suites." >&2
  echo "Scope it: bun test test/ packages/ src/   (or explicit test files)." >&2
  exit 2
fi
exit 0
