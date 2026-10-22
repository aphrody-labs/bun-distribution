#!/usr/bin/env bash
# Build the Ghidra image and start the continuous RE worker on the VPS.
#   ./up.sh            build (if needed) and start
#   ./up.sh logs       follow the worker
#   ./up.sh status     per-target state and export sizes
#   ./up.sh analyze F  one-shot analysis of F (path inside /targets or /work)
set -euo pipefail
cd "$(dirname "$0")"
: "${RE_WORK:=/home/ubuntu/re/ghidra}"
: "${RE_EXTRA:=/home/ubuntu/re/targets}"
: "${GHIDRA_ROOT:=/home/ubuntu/re/opt}"
GHIDRA_VERSION=12.1.4
GHIDRA_BUILD=20260921
GHIDRA_SHA256=ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db
GHIDRA_DIR="$GHIDRA_ROOT/ghidra_${GHIDRA_VERSION}_PUBLIC"
export RE_WORK RE_EXTRA GHIDRA_DIR
mkdir -p "$RE_WORK/home" "$RE_EXTRA" "$GHIDRA_ROOT"

# The pinned NSA release, verified against the digest GitHub publishes; LICENSE and
# licenses/ stay intact in the unpacked tree.
if [ ! -x "$GHIDRA_DIR/support/analyzeHeadless" ]; then
  zip="$GHIDRA_ROOT/ghidra_${GHIDRA_VERSION}_PUBLIC_${GHIDRA_BUILD}.zip"
  curl -fL --retry 3 -o "$zip" \
    "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_${GHIDRA_VERSION}_build/${zip##*/}"
  echo "$GHIDRA_SHA256  $zip" | sha256sum -c -
  unzip -q "$zip" -d "$GHIDRA_ROOT"
  rm "$zip"
fi

case "${1:-up}" in
  up) docker compose up -d --build ;;
  logs) docker compose logs -f --tail=100 ghidra-re ;;
  status)
    cat "$RE_WORK/state.json" 2>/dev/null || echo "no state yet"
    du -sh "$RE_WORK"/out/* "$RE_WORK"/projects 2>/dev/null || true
    for m in "$RE_WORK"/out/*/meta.json; do [ -f "$m" ] && python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m["name"], m["sha256"][:12], "complete" if m.get("complete") else "in progress", {k: v.get("result") for k, v in m["phases"].items()})' "$m"; done
    ;;
  analyze) shift; docker compose run --rm ghidra-re analyze "$@" ;;
  down) docker compose down ;;
  *) echo "usage: $0 [up|logs|status|analyze FILE|down]" >&2; exit 2 ;;
esac
