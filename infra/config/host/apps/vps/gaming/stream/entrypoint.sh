#!/bin/sh
# Bun OS gamestream entrypoint.
#   GAMESTREAM_MODE=webrtc   (default) gamescope headless + PipeWire + Bun signalling + WebRTC sender
#   GAMESTREAM_MODE=wolf-app run the workload inside the Wayland compositor Wolf provides
#   GAMESTREAM_MODE=probe    print the Vulkan/GL/GStreamer capabilities and exit
set -eu

W=${GAMESTREAM_WIDTH:-1280}
H=${GAMESTREAM_HEIGHT:-720}
FPS=${GAMESTREAM_FPS:-60}
APP=${GAMESTREAM_APP:-glxgears -fullscreen}
GAMESCOPE_ARGS=${GAMESTREAM_GAMESCOPE_ARGS:-}

log() { printf '[gamestream] %s\n' "$*" >&2; }

probe() {
  vulkaninfo --summary 2>/dev/null | grep -E 'deviceName|apiVersion|driverName' || log "no Vulkan device"
  gamescope --version 2>&1 | head -n 1
  for e in pipewiresrc x264enc vp8enc opusenc webrtcbin nicesink rtph264pay; do
    if gst-inspect-1.0 --exists "$e"; then log "gst $e: ok"; else log "gst $e: MISSING"; fi
  done
}

case "${GAMESTREAM_MODE:-webrtc}" in
probe)
  probe
  exit 0
  ;;
wolf-app)
  # Wolf exports WAYLAND_DISPLAY, XDG_RUNTIME_DIR and PULSE_SERVER for its virtual compositor.
  log "wolf-app: WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-unset} app: $APP"
  if [ "${GAMESTREAM_WOLF_GAMESCOPE:-1}" = 1 ]; then
    # shellcheck disable=SC2086
    exec gamescope --backend wayland -W "$W" -H "$H" -w "$W" -h "$H" -r "$FPS" $GAMESCOPE_ARGS -- sh -c "$APP"
  fi
  exec sh -c "$APP"
  ;;
esac

mkdir -p -m 0700 "$XDG_RUNTIME_DIR"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
dbus-daemon --session --address="$DBUS_SESSION_BUS_ADDRESS" --nofork --nopidfile --syslog-only &
pipewire &
for _ in $(seq 50); do [ -S "$XDG_RUNTIME_DIR/pipewire-0" ] && break; sleep 0.1; done
wireplumber &
pipewire-pulse &
for _ in $(seq 50); do pactl info >/dev/null 2>&1 && break; sleep 0.1; done
pactl set-default-sink gamestream 2>/dev/null || log "default sink not set"

# gamescope renders the session at the internal resolution; the client upscales (FSR1).
# --backend headless needs no DRM device; Vulkan falls back to lavapipe.
# shellcheck disable=SC2086
gamescope --backend headless -W "$W" -H "$H" -w "$W" -h "$H" -r "$FPS" \
  --xwayland-count 1 $GAMESCOPE_ARGS -- sh -c "$APP" &
GAMESCOPE_PID=$!

# Xwayland of gamescope: first X socket that appears.
DISPLAY_NUM=""
for _ in $(seq 100); do
  for s in /tmp/.X11-unix/X*; do [ -S "$s" ] && DISPLAY_NUM=${s#/tmp/.X11-unix/X} && break 2; done
  sleep 0.1
done
[ -n "$DISPLAY_NUM" ] || { log "gamescope Xwayland did not start"; exit 1; }
export GAMESTREAM_DISPLAY=":$DISPLAY_NUM"
log "gamescope pid $GAMESCOPE_PID, Xwayland $GAMESTREAM_DISPLAY"

export GAMESTREAM_SENDER="python3 /opt/gamestream/sender.py"
cd /opt/bun-gamestream
exec bun src/server.ts
