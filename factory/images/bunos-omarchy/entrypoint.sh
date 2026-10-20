#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Bounded headless compositor and loopback-only WayVNC supervisor.
set -euo pipefail
readonly runtime_dir=/run/user/1000
readonly home_dir=/run/bun-os/home
readonly log_dir=/run/bun-os
mkdir -p "$runtime_dir" "$home_dir/.config/hypr" "$log_dir"
chown -R 1000:1000 "$runtime_dir" "$home_dir" "$log_dir"
chmod 0700 "$runtime_dir"
install -m 0644 /usr/share/bun-os/headless.lua "$home_dir/.config/hypr/hyprland.lua"

omarchy_settings_file="$(pacman -Ql omarchy-settings | awk '$2 ~ /\/default\/hypr\/bootstrap\.lua$/ { print $2; exit }')"
[[ -n "$omarchy_settings_file" ]] || { echo 'Stable Omarchy settings package has no default Hyprland bootstrap' >&2; exit 25; }
export OMARCHY_PATH="${omarchy_settings_file%/default/hypr/bootstrap.lua}"
readonly wayvnc_bind="${BUNOS_WAYVNC_LISTEN:-127.0.0.1}"
readonly wayvnc_port="${BUNOS_WAYVNC_PORT:-5900}"

exec runuser -u omarchy -- env \
  HOME="$home_dir" USER=omarchy LOGNAME=omarchy \
  XDG_RUNTIME_DIR="$runtime_dir" XDG_CONFIG_HOME="$home_dir/.config" \
  XDG_SESSION_TYPE=wayland OMARCHY_PATH="$OMARCHY_PATH" \
  AQ_NO_KMS_REQUIREMENT=1 LIBGL_ALWAYS_SOFTWARE=1 \
  BUNOS_WAYVNC_LISTEN="$wayvnc_bind" BUNOS_WAYVNC_PORT="$wayvnc_port" \
  dbus-run-session -- bash -euo pipefail -c '
    Hyprland -c "$HOME/.config/hypr/hyprland.lua" > /run/bun-os/hyprland.log 2>&1 &
    compositor=$!
    trap "kill $compositor 2>/dev/null || true; wait $compositor 2>/dev/null || true" EXIT INT TERM
    display=""
    signature=""
    for _ in $(seq 1 30); do
      kill -0 "$compositor" 2>/dev/null || { cat /run/bun-os/hyprland.log >&2; exit 22; }
      display="$(find "$XDG_RUNTIME_DIR" -maxdepth 1 -type s -name "wayland-*" -printf "%f\n" -quit)"
      signature="$(hyprctl instances -j 2>/dev/null | jq -r ".[0].instance // .[0].signature // empty" 2>/dev/null || true)"
      [[ -n "$display" && -n "$signature" ]] && break
      sleep 1
    done
    [[ -n "$display" && -n "$signature" ]] || { echo "Hyprland display/instance not ready in 30 seconds" >&2; cat /run/bun-os/hyprland.log >&2; exit 23; }
    export WAYLAND_DISPLAY="$display" HYPRLAND_INSTANCE_SIGNATURE="$signature"
    hyprctl -j monitors > /run/bun-os/monitors.json
    jq -e "any(.[]; .name == \"HEADLESS-0\")" /run/bun-os/monitors.json >/dev/null
    wayvnc -o HEADLESS-0 "$BUNOS_WAYVNC_LISTEN" "$BUNOS_WAYVNC_PORT" > /run/bun-os/wayvnc.log 2>&1 &
    vnc=$!
    trap "kill $vnc $compositor 2>/dev/null || true; wait $vnc $compositor 2>/dev/null || true" EXIT INT TERM
    for _ in $(seq 1 10); do
      kill -0 "$vnc" 2>/dev/null || { cat /run/bun-os/wayvnc.log >&2; exit 24; }
      (echo > "/dev/tcp/$BUNOS_WAYVNC_LISTEN/$BUNOS_WAYVNC_PORT") >/dev/null 2>&1 && break
      sleep 1
    done
    kill -0 "$vnc" 2>/dev/null || exit 24
    wait -n "$compositor" "$vnc"
  '
