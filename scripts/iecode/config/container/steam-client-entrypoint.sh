#!/bin/sh
set -eu

steam_uid=$(id -u steam)
if [ "$(stat -c %u /home/steam)" != "$steam_uid" ]; then
    chown steam:steam /home/steam
fi

su -s /bin/sh -c 'exec Xvfb :0 -screen 0 1280x800x24 -nolisten tcp -noreset' steam &
xvfb_pid=$!
openbox_pid=
x11vnc_pid=
websockify_pid=
steam_pid=

cleanup() {
    for pid in "$steam_pid" "$websockify_pid" "$x11vnc_pid" "$openbox_pid" "$xvfb_pid"; do
        [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 50); do
    [ -S /tmp/.X11-unix/X0 ] && break
    sleep 0.2
done
[ -S /tmp/.X11-unix/X0 ]

su -s /bin/sh -c 'DISPLAY=:0 exec openbox' steam &
openbox_pid=$!
su -s /bin/sh -c 'DISPLAY=:0 exec x11vnc -forever -shared -nopw -localhost -rfbport 5900' steam &
x11vnc_pid=$!
su -s /bin/sh -c 'exec websockify --web=/usr/share/novnc --heartbeat=30 0.0.0.0:6080 127.0.0.1:5900' steam &
websockify_pid=$!

su -s /bin/sh -c 'export DISPLAY=:0; exec dbus-run-session -- steam' steam &
steam_pid=$!
wait "$steam_pid"
