#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Host-local automatic release on the vps (APHRODY_BUILD_HOST=vps). Streamed by .github/workflows/release-main.yml:
#   ssh <vps> bash -s -- <full-sha> < scripts/release/auto-release.sh
# Same chain as the manual runs: downloads:publish plan -> build -> release -> verify, serialised by a lock so a
# running release is never interrupted (a later push waits, then publishes its own revision).
# Runbook: docs/operations/infra/AUTO-RELEASE.md.
set -euo pipefail
REV="${1:?usage: auto-release.sh <full-sha>}"
case "$REV" in *[!0-9a-f]* | "") echo "invalid revision" >&2; exit 2 ;; esac
[ "${#REV}" -eq 40 ] || { echo "revision must be a full sha" >&2; exit 2; }
# ONE checkout per repository (infra/config/host/host-policy.toml [layout]): the release builds in ~/src/aphrody, the
# checkout aphrody-sync fast-forwards; state and log live in ~/.aphrody/deploy.
SRC="$HOME/src/aphrody"
STATE="$HOME/.aphrody/deploy"
LOCK="$STATE/auto-release.lock"
LOG="$STATE/auto-release.log"
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH" APHRODY_BUILD_HOST=vps
mkdir -p "$STATE"
exec 9>"$LOCK"
flock -w 7200 9 || { echo "another release holds the lock" >&2; exit 3; }
{
  echo "== $(date -u +%FT%TZ) release $REV"
  if [ ! -d "$SRC/.git" ]; then git clone -q https://github.com/aphrody-labs/aphrody.git "$SRC"; fi
  cd "$SRC"
  git fetch -q origin main
  git merge-base --is-ancestor "$REV" origin/main || { echo "revision $REV is not on main" >&2; exit 2; }
  [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "$SRC is not on main" >&2; exit 3; }
  [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "$SRC has local changes" >&2; exit 3; }
  git merge -q --ff-only origin/main
  # main moved past $REV: publish the newer head (immutable ids), never rewind `current`.
  HEAD_REV="$(git rev-parse HEAD)"
  [ "$HEAD_REV" = "$REV" ] || { echo "main is at $HEAD_REV, publishing it (contains $REV)"; REV="$HEAD_REV"; }
  for p in aphrody yolo; do
    [ -d "plugins/$p/.git" ] || git clone -q --depth 1 "https://github.com/aphrody-labs/plugin-$p" "plugins/$p"
    git -C "plugins/$p" pull -q --ff-only || true
  done
  bun install --frozen-lockfile >/dev/null 2>&1 || bun install >/dev/null
  bun run downloads:publish plan --revision "$REV"
  bun run downloads:publish build --revision "$REV"
  bun run downloads:publish release --revision "$REV"
  bun run downloads:publish verify
  echo "== $(date -u +%FT%TZ) done"
} 2>&1 | tee "$LOG"
