#!/usr/bin/env bash
# Run the continuous RE worker directly on the VPS host as transient systemd user units,
# for when the Docker root filesystem has no room for the image. Everything a lane writes
# (venv, projects, exports, JVM tmp) stays under $RE_WORK on /home.
#
#   ./run-host.sh [up]       start lane 0 of RE_SHARDS lanes (default 1: one lane, all targets)
#   ./run-host.sh logs [N]   follow lane N (default 0)
#   ./run-host.sh stop       stop every lane
#   ./run-host.sh status     per-target state across all lanes
#
# Parallel lanes: `RE_SHARDS=2 ./run-host.sh` starts lanes 0 and 1 over disjoint targets.
set -euo pipefail
cd "$(dirname "$0")"
: "${RE_WORK:=/home/ubuntu/re/ghidra}"
: "${GHIDRA_DIR:=/home/ubuntu/re/opt/ghidra_12.1.4_PUBLIC}"
: "${JAVA_HOME:=/usr/lib/jvm/java-21-openjdk-amd64}"
: "${IEVR_DIR:=/games/SteamLibrary/steamapps/common/INAZUMA ELEVEN Victory Road}"
: "${DBXV2_DIR:=/games/SteamLibrary/steamapps/common/DB Xenoverse 2}"
: "${RE_EXTRA:=/home/ubuntu/re/targets}"
: "${RE_SHARDS:=1}"
# Per-lane budget shares the box: tune down if CI needs the cores.
: "${RE_DECOMP_JOBS:=4}"
: "${RE_JVM_MAX_HEAP:=12g}"
: "${LANE_CPU_QUOTA:=400%}"
: "${LANE_MEM_MAX:=16G}"
UNIT=bun-ghidra-re

case "${1:-up}" in
  logs) exec journalctl --user -u "${UNIT}-${2:-0}" -f -n 100 ;;
  stop)
    for u in $(systemctl --user list-units --all --plain --no-legend "${UNIT}-*" | awk '{print $1}'); do
      systemctl --user stop "$u" || true
    done
    exit 0 ;;
  status)
    for s in "$RE_WORK"/state*.json; do [ -f "$s" ] && cat "$s"; done 2>/dev/null || echo "no state yet"
    du -sh "$RE_WORK"/out/* "$RE_WORK"/projects 2>/dev/null || true
    for m in "$RE_WORK"/out/*/meta.json; do [ -f "$m" ] && python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m["name"], m["sha256"][:12], "complete" if m.get("complete") else "in progress", {k: v.get("result") for k, v in m["phases"].items()})' "$m"; done
    exit 0 ;;
  up) ;;
  *) echo "usage: $0 [up|logs [N]|stop|status]" >&2; exit 2 ;;
esac

test -x "$GHIDRA_DIR/support/analyzeHeadless" || { echo "run ./up.sh once to fetch Ghidra into $GHIDRA_DIR" >&2; exit 1; }
mkdir -p "$RE_WORK/tmp" "$RE_WORK/host"
venv="$RE_WORK/host/venv"
if ! "$venv/bin/python" -c 'import pyghidra' 2>/dev/null; then
  python3 -m venv "$venv"
  TMPDIR="$RE_WORK/tmp" "$venv/bin/pip" install --no-cache-dir --no-index \
    --find-links "$GHIDRA_DIR/Ghidra/Features/PyGhidra/pypkg/dist" pyghidra
fi

# Same target layout as the container: /targets/{ievr,dbxv2,extra} map to host paths.
sed -e "s#/targets/ievr#$IEVR_DIR#g" -e "s#/targets/dbxv2#$DBXV2_DIR#g" -e "s#/targets/extra#$RE_EXTRA#g" targets.json >"$RE_WORK/host/targets.json"

start_lane() {
  shard="$1"
  unit="${UNIT}-${shard}"
  systemctl --user stop "$unit" 2>/dev/null || true
  systemctl --user reset-failed "$unit" 2>/dev/null || true
  systemd-run --user --unit="$unit" --collect \
    -p Restart=always -p RestartSec=60 \
    -p CPUQuota="$LANE_CPU_QUOTA" -p CPUWeight=25 -p IOWeight=25 -p MemoryMax="$LANE_MEM_MAX" -p MemorySwapMax=0 \
    -E GHIDRA_INSTALL_DIR="$GHIDRA_DIR" -E JAVA_HOME="$JAVA_HOME" -E PATH="$JAVA_HOME/bin:/usr/bin:/bin" \
    -E HOME="$RE_WORK/home" -E TMPDIR="$RE_WORK/tmp" -E PYTHONUNBUFFERED=1 \
    -E RE_WORK="$RE_WORK" -E RE_TARGETS="$RE_WORK/host/targets.json" \
    -E RE_SHARDS="$RE_SHARDS" -E RE_SHARD="$shard" \
    -E RE_DECOMP_JOBS="$RE_DECOMP_JOBS" -E RE_JVM_MAX_HEAP="$RE_JVM_MAX_HEAP" \
    -E RE_POLL_SECONDS="${RE_POLL_SECONDS:-600}" \
    nice -n 10 "$venv/bin/python" -I "$PWD/ghidra_re.py" loop
  echo "lane $shard -> $unit"
}

for shard in $(seq 0 $((RE_SHARDS - 1))); do start_lane "$shard"; done
systemctl --user list-units --no-pager "${UNIT}-*" | head -$((RE_SHARDS + 2))
