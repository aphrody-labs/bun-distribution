#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Runs inside the tmux session `yolo ship` starts on the build host (a copy of this file sits next to the
# artifacts, so the checkout below cannot rewrite it while bash reads it). It:
#   1. serializes behind the heavy lock, then checks the commit and its submodules out (never outside the lock,
#      so a build in progress never sees its sources change);
#   2. runs ship_remote.sh as a transient systemd unit with every kernel (cgroup v2) resource ceiling lifted:
#      full CPU share, no memory cap, no swap cap, no task or fd limit, protected from the OOM killer;
#   3. reports the result as the `yolo/ship` commit status on GitHub (Actions are not available to the repository,
#      the build host is its CI), best effort.
# usage: ship_unit.sh <sha> <workspace> <artifact-dir> <lock>
set -uo pipefail
sha=$1; ws=$2; out=$3; lock=$4
name="yolo-ship-${sha:0:12}"
user=$(id -un); group=$(id -gn)
log="$out/ship.log"
slug=$(git -C "$ws" remote get-url origin | sed -E 's#^(https://github\.com/|git@[^:]+:)##; s#\.git$##')
# commit statuses need write access: use the owner identity's token when it is logged in on the host (the active gh
# account may only read the repository); `gh auth token --user` leaves the host's active account unchanged
token=$(gh auth token --user "${YOLO_GH_USER:-aphrody-dev}" 2>/dev/null || true)
[ -z "$token" ] || export GH_TOKEN="$token"
gh_status() { # state description
  gh api -X POST "repos/$slug/statuses/$sha" -f state="$1" -f context="yolo/ship" \
    -f description="${2:0:139}" >/dev/null 2>&1 || echo "(commit status not posted: $1)" >> "$log"
}
fail() { echo "failed: $1" > "$out/STATUS"; echo "FAILED: $1" | tee -a "$log"; gh_status failure "VPS: $1"; exit 1; }

echo queued > "$out/STATUS"
echo "=== yolo ship $sha queued on $(hostname) ($(date -u +%FT%TZ))" | tee -a "$log"
gh_status pending "VPS: queued behind the build factory lock"
exec 9>"$lock"
flock 9
echo "=== lock acquired, checkout ($(date -u +%FT%TZ))" | tee -a "$log"
echo "running: checkout" > "$out/STATUS"
gh_status pending "VPS: building"
{
  git -C "$ws" checkout -f --detach "$sha" &&
    git -C "$ws" submodule sync --recursive &&
    git -C "$ws" submodule update --init --recursive --jobs 8 --filter=blob:none
} >> "$log" 2>&1 || fail "checkout of $sha and its submodules"

sudo -n systemctl stop "$name.service" 2>/dev/null || true
sudo -n /usr/bin/systemd-run --unit="$name" --collect --wait --pipe --quiet \
  --uid="$user" --gid="$group" --working-directory="$ws" \
  -p CPUWeight=10000 -p CPUQuota= -p IOWeight=10000 -p CPUSchedulingPolicy=batch \
  -p MemoryMin=0 -p MemoryLow=0 -p MemoryHigh=infinity -p MemoryMax=infinity -p MemorySwapMax=infinity \
  -p TasksMax=infinity -p LimitNOFILE=infinity -p LimitNPROC=infinity -p LimitMEMLOCK=infinity -p LimitCORE=0 \
  -p OOMScoreAdjust=-500 -p Delegate=yes \
  -- bash "$ws/scripts/release/ship_remote.sh" "$sha" "$ws" "$out" 2>&1 | tee -a "$log"
rc=${PIPESTATUS[0]}
# a stopped unit exits 0 while ship_remote.sh never reached ok/failed: report it instead of leaving "running"
grep -qE '^(ok|failed)' "$out/STATUS" || echo "stopped: unit $name ended before the build finished" > "$out/STATUS"
echo "unit $name exited $rc" | tee -a "$log"
case $(head -1 "$out/STATUS") in
  ok*) gh_status success "VPS: gates, tests, runtime, release assets, install and deploy smoke" ;;
  *) gh_status failure "VPS: $(head -1 "$out/STATUS")" ;;
esac
exit "$rc"
