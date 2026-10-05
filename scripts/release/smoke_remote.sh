#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# D0 and D2 acceptance from freshly built release assets, on the build host:
#   D0  install.sh into an empty HOME from the release directory, then `yolo doctor`;
#   D2  `yolo create` with the installed executable, the scaffold's typecheck and tests, `build:bin` and
#       `pack:deploy`, then the extracted archive runs with no Bun, no HOME and a minimal PATH and answers /health.
# usage: smoke_remote.sh <release-dir> [previous-compatible-runtime-artifact]
set -euo pipefail
rel=$(cd "$1" && pwd)
previous_artifact="${2:-}"
work=$(mktemp -d /tmp/yolo-smoke.XXXXXX)
pid=""
cleanup() {
  if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT INT TERM
smoke_home="$work/home"
smoke_yolo_home="$smoke_home/.yolo"
mkdir -p "$smoke_home"

echo "--- D0: install from $rel into an empty HOME"
env -i HOME="$smoke_home" PATH=/usr/bin:/bin YOLO_RELEASE_DIR="$rel" YOLO_NO_MODIFY_PATH=1 sh "$rel/install.sh"
yolo="$smoke_yolo_home/bin/yolo"
portable() { env -i HOME="$smoke_home" PATH=/usr/bin:/bin YOLO_HOME="$smoke_yolo_home" "$yolo" "$@"; }
cd "$work"
portable version --json
portable doctor --json
portable runtime verify
portable scan --json
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' | portable mcp

echo "--- D2: scaffold, check, compile, pack"
cd "$work"
portable create smoke-app
cd smoke-app
bun install
tsc --noEmit
YOLO_HOME="$smoke_yolo_home" bun test
YOLO_HOME="$smoke_yolo_home" bun run build:bin
YOLO_HOME="$smoke_yolo_home" bun run pack:deploy
archive=$(ls dist/smoke-app-*.tar.gz | head -1)
mkdir -p "$work/srv"
tar -xzf "$archive" -C "$work/srv" --strip-components=1

echo "--- D2: run the extracted archive (no Bun, no HOME, minimal PATH, cwd = the archive itself)"
# A real deployment's systemd unit sets WorkingDirectory to the extracted archive, not the scaffold it came from
# (DEPLOY.md). Run it from there too: the scaffold's dev-only bunfig.toml (preload for the node_modules fallback)
# must never reach the deployed binary, which build:bin already enforces with compile.autoloadBunfig: false.
port=$((20000 + RANDOM % 20000))
(cd "$work/srv" && env -i PATH=/usr/bin:/bin PORT="$port" ./run.sh > "$work/srv.log" 2>&1) &
pid=$!
for _ in $(seq 1 100); do
  curl -fsS "http://127.0.0.1:$port/health" > "$work/health.json" 2>/dev/null && break
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.2
done
if ! grep -q '"ok":true' "$work/health.json" 2>/dev/null; then
  echo "the deployed archive did not answer /health:"
  cat "$work/srv.log"
  exit 1
fi
echo "deployed archive answers http://127.0.0.1:$port/health -> $(cat "$work/health.json")"

echo "--- D0: verified offline upgrade, uninstall and reinstall"
if [ -n "$previous_artifact" ]; then
  portable runtime install "$previous_artifact"
  portable doctor --json
fi
env -i HOME="$smoke_home" PATH=/usr/bin:/bin YOLO_HOME="$smoke_yolo_home" YOLO_NO_MODIFY_PATH=1 \
  "$yolo" upgrade --release-dir "$rel" --version "$(cat "$smoke_yolo_home/VERSION")"
portable doctor --json
if [ -n "$previous_artifact" ]; then
  portable runtime rollback
  portable doctor --json
  portable runtime rollback
  portable doctor --json
else
  echo "Runtime rollback not qualified: no previous compatible artifact supplied"
fi
portable uninstall --yes
test ! -e "$smoke_yolo_home"
env -i HOME="$smoke_home" PATH=/usr/bin:/bin YOLO_RELEASE_DIR="$rel" YOLO_NO_MODIFY_PATH=1 sh "$rel/install.sh"
portable doctor --json
