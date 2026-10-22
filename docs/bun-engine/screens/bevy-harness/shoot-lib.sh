#!/bin/bash
# Evidence harness: Xvfb + lavapipe + BRP. Sourced by the scenario scripts.
B=$HOME/bevy2
BIN=$B/target/debug/bun-engine
OUT=${OUT:-$B/shots}
PORT=${PORT:-15702}
DISP=${DISP:-:77}
mkdir -p $OUT
export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json WGPU_BACKEND=vulkan DISPLAY=$DISP
export RUST_LOG=${RUST_LOG:-warn,wgpu=error,naga=warn}
XPID=
EPID=
start_x() { Xvfb $DISP -screen 0 ${SCREEN:-1280x720x24} -nolisten tcp >$OUT/xvfb.log 2>&1 & XPID=$!; sleep 1; }
stop_all() { [ -n "$EPID" ] && kill $EPID 2>/dev/null; sleep 1; [ -n "$XPID" ] && kill $XPID 2>/dev/null; EPID=; XPID=; }
brp() { curl -s -m 10 -X POST -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":${2:-null}}" http://127.0.0.1:$PORT; echo; }
wait_brp() { for i in $(seq 1 90); do brp bun/status 2>/dev/null | grep -q '"result"' && return 0; sleep 1; done; echo "BRP did not come up"; return 1; }
shot() { # name [delay frames]
  rm -f "$OUT/$1.png"; brp bun/capture "{\"path\":\"$OUT/$1.png\",\"delay\":${2:-3}}" >/dev/null
  for i in $(seq 1 30); do [ -s "$OUT/$1.png" ] && { echo "captured $1.png"; return 0; }; sleep 1; done
  echo "NO CAPTURE $1"; return 1
}
