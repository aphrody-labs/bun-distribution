#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Local autonomous coding loop without Claude: the Aphrody agent (`aphrody exec --yolo`) on the local open-weight
# model, one bounded pass at a time, restarted until `var/yolo-loop.stop` exists. Each pass reads agy.md (open work),
# works the first item end to end (code, gates, commit, push) and exits. Heavy Cargo goes to the VPS (vps-cargo.ts).
#   bash scripts/dev/yolo-loop.sh            run (from WSL, or `C:\aphrody\yolo-loop.cmd` from Windows)
#   touch var/yolo-loop.stop                 stop after the current pass
set -u
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
model="${APHRODY_LOOP_MODEL:-qwen3-coder-30b-a3b-q4km}"
log="$root/var/yolo-loop.log"
mkdir -p var
rm -f var/yolo-loop.stop
pass=0
while [[ ! -f var/yolo-loop.stop ]]; do
  pass=$((pass + 1))
  git fetch -q workspace 2>/dev/null && git rebase -q --autostash workspace/main 2>/dev/null
  printf '\n=== pass %d %s ===\n' "$pass" "$(date -u +%FT%TZ)" >>"$log"
  aphrody exec --yolo --oss --local-provider llama -m "$model" -C "$root" \
    "Read AGENTS.md, PLAN.md and agy.md. Take the first open item of agy.md not yet done, finish it end to end: implement, run the scoped gates (Cargo only through scripts/build/rust/vps-cargo.ts), commit with explicit paths as aphrody-dev <contact@aphrody.com> without assistant attribution, push to workspace/main, and mark the item done in agy.md. Never stage secrets. When every item is done, create var/yolo-loop.stop." \
    >>"$log" 2>&1 || sleep 60
  sleep 5
done
echo "yolo-loop stopped after $pass passes" | tee -a "$log"
