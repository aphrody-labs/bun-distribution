#!/usr/bin/env bash
set -euo pipefail
export GIT_TERMINAL_PROMPT=0
repo=/home/ubuntu/src/shenron
state=/var/lib/shenron-main-sync
mkdir -p "$state"
exec 9>"$state/sync.lock"
flock -n 9 || exit 0
[[ $(git -C "$repo" branch --show-current) == main ]] || { echo 'Refusing non-main checkout' >&2; exit 2; }
[[ -z $(git -C "$repo" status --porcelain) ]] || { echo 'Local changes preserved; synchronization skipped' >&2; exit 2; }
git -C "$repo" fetch --quiet origin main
git -C "$repo" merge-base --is-ancestor HEAD origin/main || { echo 'Divergent local commits preserved' >&2; exit 2; }
git -C "$repo" merge --quiet --ff-only origin/main
git -C "$repo" rev-parse HEAD
