#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Update user-installed Rust channels and Cargo subcommands without touching workspace locks.
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
lock_dir="${XDG_CACHE_HOME:-$HOME/.cache}/aphrody"
mkdir -p "$lock_dir"
exec 9>"$lock_dir/rust-global-update.lock"
flock --exclusive 9

rustup update stable nightly
"$root/scripts/build/rust/cargo-serial.sh" +stable install-update --all
