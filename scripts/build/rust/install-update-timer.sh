#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
bin_dir="${HOME}/.local/bin"
mkdir -p "$unit_dir"
mkdir -p "$bin_dir"
ln -sfn "$root/scripts/build/rust/update-global-tools.sh" "$bin_dir/aphrody-rust-update"
install -m 0644 "$root/config/systemd/user/aphrody-rust-update.service" "$unit_dir/"
install -m 0644 "$root/config/systemd/user/aphrody-rust-update.timer" "$unit_dir/"
systemctl --user daemon-reload
systemctl --user enable --now aphrody-rust-update.timer
systemctl --user status --no-pager aphrody-rust-update.timer
