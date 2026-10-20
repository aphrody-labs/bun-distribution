#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Bounded local health probe; it never waits for a service indefinitely.
set -euo pipefail
readonly runtime_dir=/run/user/1000
socket="$(find "$runtime_dir" -maxdepth 1 -type s -name 'wayland-*' -printf '%f\n' -quit)"
signature="$(hyprctl instances -j 2>/dev/null | jq -r '.[0].instance // .[0].signature // empty' 2>/dev/null || true)"
[[ -n "$socket" && -n "$signature" ]] || exit 1
export XDG_RUNTIME_DIR="$runtime_dir" WAYLAND_DISPLAY="$socket" HYPRLAND_INSTANCE_SIGNATURE="$signature"
timeout 3s hyprctl -j monitors | jq -e 'any(.[]; .name == "HEADLESS-0")' >/dev/null
timeout 3s bash -c ':</dev/tcp/${BUNOS_WAYVNC_LISTEN:-127.0.0.1}/${BUNOS_WAYVNC_PORT:-5900}'
