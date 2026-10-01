#!/usr/bin/env bash
# Serialize Aphrody Cargo work across agents and terminals, and bound rustc fan-out.
set -euo pipefail

if (($# == 0)); then
    echo "usage: scripts/build/rust/cargo-serial.sh <cargo arguments...>" >&2
    exit 64
fi

jobs="${APHRODY_CARGO_JOBS:-6}"
if [[ ! "$jobs" =~ ^[1-6]$ ]]; then
    echo "APHRODY_CARGO_JOBS must be an integer from 1 through 6" >&2
    exit 64
fi

for arg in "$@"; do
    case "$arg" in
        -j|--jobs|-j[0-9]*|--jobs=*)
            echo "Do not override Cargo job count; set APHRODY_CARGO_JOBS=1..6 instead" >&2
            exit 64
            ;;
    esac
done

lock_dir="$HOME/.cache/aphrody"
lock_file="$lock_dir/cargo-build.lock"
wait_seconds="${APHRODY_CARGO_LOCK_TIMEOUT_SECS:-1800}"
if [[ ! "$wait_seconds" =~ ^[0-9]+$ ]]; then
    echo "APHRODY_CARGO_LOCK_TIMEOUT_SECS must be an integer" >&2
    exit 64
fi

mkdir -p "$lock_dir"
exec flock --exclusive --timeout "$wait_seconds" "$lock_file" \
    nice -n 10 env \
        CARGO_BUILD_JOBS="$jobs" \
        CARGO_INCREMENTAL=0 \
        CARGO_TERM_COLOR=never \
        cargo "$@"
