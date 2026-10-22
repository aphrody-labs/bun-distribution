#!/bin/bash
# Machine scenario: filters, integer scale, F1 menu, pause, screenshot. Evidence in $OUT.
source ~/bevy2/shoot-lib.sh
ROM=${ROM:-$HOME/src/bun-os/vendor/tetanes/tetanes/assets/roms/alter_ego.nes}
rm -rf $OUT/state; start_x
$BIN run nes $ROM --remote --state-dir $OUT/state --size 1280x720 >$OUT/machine.log 2>&1 &
EPID=$!
wait_brp || { tail -20 $OUT/machine.log; stop_all; exit 1; }
sleep 3
WID=$(xdotool search --name "Bun Engine" | head -1); echo "window id $WID"; xdotool windowfocus $WID; xdotool mousemove 640 360; sleep 1
echo "--- initial status"; brp bun/status
for k in off plain scanlines crt lcd sharp; do
  echo "--- filter $k"; brp bun/filter "{\"kind\":\"$k\",\"strength\":0.6,\"integer_scale\":false}"; shot machine-filter-$k 6
done
echo "--- F1 via xdotool"
f0=$(brp bun/status | grep -o '"frames":[0-9]*' | head -1)
xdotool key F1; sleep 1.5
echo "after F1:"; brp bun/status
f1=$(brp bun/status | grep -o '"frames":[0-9]*' | head -1); sleep 1.5; f2=$(brp bun/status | grep -o '"frames":[0-9]*' | head -1)
echo "frames while menu open: $f1 then $f2 (equal = paused)"
shot machine-menu-open 4
xdotool key Down; sleep 0.5; shot machine-menu-down 4
xdotool key Down; sleep 0.5; xdotool key Down; sleep 0.5; shot machine-menu-screenshot-selected 4
xdotool key Return; sleep 4
echo "after Screenshot action:"; brp bun/status
ls -la $OUT/state/screenshots 2>/dev/null
echo "--- pause via BRP"
brp bun/pause '{"paused":true}'; a=$(brp bun/status | grep -o '"frames":[0-9]*' | head -1); sleep 2; b=$(brp bun/status | grep -o '"frames":[0-9]*' | head -1)
echo "paused frames: $a then $b"; shot machine-paused 4
brp bun/pause '{"paused":false}'; sleep 1; c=$(brp bun/status | grep -o '"frames":[0-9]*' | head -1); echo "resumed frames: $c"
echo "--- menu via BRP + Escape-less close"
brp bun/menu '{"open":true}'; sleep 1; brp bun/status | grep -o '"state":"[A-Za-z]*"'
brp bun/menu '{"open":false}'; sleep 1; brp bun/status | grep -o '"state":"[A-Za-z]*"'
echo "--- F2 cycle key"
brp bun/filter '{"kind":"off"}'; xdotool key F2; sleep 1; brp bun/status | grep -o '"filter":{[^}]*}'
brp bun/exit; sleep 3
echo "--- integer scale at a non-integer fit (1100x700 window: fit 2.92)"
$BIN run nes $ROM --remote --state-dir $OUT/state --size 1100x700 >$OUT/machine-int.log 2>&1 &
EPID=$!
wait_brp || { tail -20 $OUT/machine-int.log; stop_all; exit 1; }
sleep 2
brp bun/status | grep -o '"window":{[^}]*}'
for k in sharp scanlines; do
  brp bun/filter "{\"kind\":\"$k\",\"strength\":0.6,\"integer_scale\":false}"; shot machine-fit-$k 6
  brp bun/filter "{\"kind\":\"$k\",\"strength\":0.6,\"integer_scale\":true}"; shot machine-integer-$k 6
done
brp bun/exit; sleep 2
grep -iE "error|panic|wgpu|naga|shader" $OUT/machine.log | head -20
stop_all
