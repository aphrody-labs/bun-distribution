#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Stand-in for a host desktop: weston headless (software), COSMIC nested in it,
# then grim captures COSMIC's own output.
export XDG_RUNTIME_DIR=/tmp/xdg-runtime; mkdir -p $XDG_RUNTIME_DIR; chmod 700 $XDG_RUNTIME_DIR
weston --backend=headless --renderer=pixman --width=1600 --height=1000 --socket=host-wl >/out/weston.log 2>&1 &
sleep 3
HOST_WAYLAND_SOCKET=$XDG_RUNTIME_DIR/host-wl LIBGL_ALWAYS_SOFTWARE=1 aphrody-desktop session >/out/cosmic.log 2>&1 &
sleep ${WAIT:-60}
ls -la $XDG_RUNTIME_DIR > /out/runtime.txt
for s in $XDG_RUNTIME_DIR/wayland-*; do
  case $s in *.lock) continue;; esac
  WAYLAND_DISPLAY=$s wayland-info > /out/info-$(basename $s).txt 2>&1
  WAYLAND_DISPLAY=$s grim /out/shot-$(basename $s).png > /out/grim-$(basename $s).log 2>&1
done
WAYLAND_DISPLAY=$XDG_RUNTIME_DIR/host-wl grim /out/shot-host.png > /out/grim-host.log 2>&1
ps > /out/ps.txt
