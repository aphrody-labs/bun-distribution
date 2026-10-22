#!/bin/bash
# Home scenario: states, directional navigation, kiosk flags.
source ~/bevy2/shoot-lib.sh
run_home() { # name library [extra args]
  local name=$1 lib=$2; shift 2
  $BIN home --library "$lib" --remote --size ${SIZE:-1280x720} --state-dir $OUT/state "$@" >$OUT/home-$name.log 2>&1 &
  EPID=$!
  wait_brp || { tail -20 $OUT/home-$name.log; return 1; }
  sleep 2
  WID=$(xdotool search --name "Bun Engine" | head -1); xdotool windowfocus $WID; xdotool mousemove 300 300; sleep 0.5
}
end_home() { brp bun/exit >/dev/null; sleep 2; kill $EPID 2>/dev/null; EPID=; }
start_x
xdotool mousemove 640 360
for state in loading empty error; do
  run_home $state mock:$state
  echo "--- $state"; brp bun/status | grep -o '"home":{[^}]*}'
  shot home-$state 6
  end_home
done
run_home ready mock
echo "--- ready initial"; brp bun/status | grep -o '"home":{[^}]*}'
shot home-ready 6
echo "--- navigation with real keys (xdotool)"
for step in Down Down Right Right Up; do
  xdotool key $step; sleep 0.6; echo "$step -> $(brp bun/status | grep -o '"focused":[^,}]*')"
done
shot home-focus-moved 4
echo "--- activate a filter chip via keys"
xdotool key Up; sleep 0.5; xdotool key Up; sleep 0.6; echo "focus: $(brp bun/status | grep -o '"focused":[^,}]*')"
xdotool key Return; sleep 1; brp bun/status | grep -o '"home":{[^}]*}'
shot home-filtered 6
xdotool key BackSpace; sleep 1; brp bun/status | grep -o '"home":{[^}]*}'
echo "--- Play"
brp bun/home '{"command":"up"}'; sleep 0.5; brp bun/status | grep -o '"focused":[^,}]*'
xdotool key Return; sleep 1; brp bun/status | grep -o '"last_launch":[^,}]*'
shot home-after-play 6
end_home
echo "--- small window 1024x768 and 800x600"
SIZE=1024x768 run_home s1024 mock; shot home-ready-1024x768 6; end_home
SIZE=800x600 run_home s800 mock; shot home-ready-800x600 6; end_home
echo "--- kiosk"
SIZE=640x480 run_home kiosk mock --kiosk
brp bun/status | grep -o '"window":{[^}]*}'
shot home-kiosk 6
end_home
stop_all
