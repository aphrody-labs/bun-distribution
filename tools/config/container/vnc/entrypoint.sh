#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Starts the virtual desktop, then the remote desktop server on the container address (never 0.0.0.0).
# Secrets (APHRODY_REMOTE_TOKEN, APHRODY_VNC_PASSWORD) come from the environment, never from the image.
set -eu
: "${APHRODY_REMOTE_TOKEN:?APHRODY_REMOTE_TOKEN is required}"
: "${APHRODY_VNC_PASSWORD:?APHRODY_VNC_PASSWORD is required}"
export DISPLAY="${DISPLAY:-:99}"
SIZE="${APHRODY_DESKTOP_SIZE:-1600x900x24}"
ALLOW="${APHRODY_VNC_ALLOW:-172.16.0.0/12}"
rm -f "/tmp/.X11-unix/X${DISPLAY#:}" "/tmp/.X${DISPLAY#:}-lock"
Xvfb "$DISPLAY" -screen 0 "$SIZE" -nolisten tcp -dpi 96 &
n=0
until [ -S "/tmp/.X11-unix/X${DISPLAY#:}" ]; do n=$((n + 1)); [ "$n" -lt 50 ] || exit 1; sleep 0.2; done
openbox --startup /bin/true &
if [ "${APHRODY_DESKTOP_TERMINAL:-0}" = 1 ]; then xterm -geometry 100x30+60+60 & fi
IP="$(hostname -i | grep -oE '[0-9]+([.][0-9]+){3}' | head -n1)"
mkdir -p "$HOME/.aphrody"
exec aphrody infra --root "$HOME/.aphrody" remote serve --bind "$IP:8795" --vnc "$IP:5900" --vnc-allow "$ALLOW" --fps 10 --quality 70
