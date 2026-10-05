#!/usr/bin/env bash
# Serialize Aphrody Cargo work across agents and terminals, and bound rustc fan-out.
set -euo pipefail

if (($# == 0)); then
    echo "usage: scripts/build/rust/cargo-serial.sh <cargo arguments...>" >&2
    exit 64
fi

source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
factory_config="$source_root/config/build-factory.json"
cargo_command="${1#+}"
if [[ "$1" == +* ]]; then cargo_command="${2:-}"; fi
help_only=false
for arg in "$@"; do
    if [[ "$arg" == --help || "$arg" == -h ]]; then help_only=true; fi
done
case "$cargo_command" in
    build|b|check|c|test|t|clippy|rustdoc|doc|d|bench|run|r|install|rustc|nextest|xwin|zigbuild)
        if [[ "$help_only" == false && -f "$factory_config" && "${APHRODY_BUILD_HOST:-}" != vps && "${APHRODY_LOCAL_CARGO:-0}" != 1 ]]; then
            # The Workspace build-factory owner interprets the factory contract.
            factory_route="$(bun "$source_root/packages/infra/workspace/src/build-factory.ts" status --route)"
            if [[ "$factory_route" == factory ]]; then
                echo "Heavy Cargo execution belongs to the VPS factory; use yolo ops build-factory run --repo aphrody --revision <full-sha> -- scripts/build/rust/cargo-serial.sh <arguments>." >&2
                echo "APHRODY_LOCAL_CARGO=1 is only for an explicitly selected scoped diagnostic." >&2
                exit 64
            fi
        fi
        ;;
esac

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

lock_dir="${APHRODY_CARGO_LOCK_DIR:-$HOME/.cache/aphrody}"
lock_file="$lock_dir/cargo-build.lock"
wait_seconds="${APHRODY_CARGO_LOCK_TIMEOUT_SECS:-1800}"
if [[ ! "$wait_seconds" =~ ^[0-9]+$ ]]; then
    echo "APHRODY_CARGO_LOCK_TIMEOUT_SECS must be an integer" >&2
    exit 64
fi

mkdir -p "$lock_dir"
# Remote factory jobs should share a stable workspace-owned target directory.
# Keep this opt-in: native packagers consume the default target/ layout.
if [[ -n "${APHRODY_CARGO_TARGET_DIR:-}" ]]; then
    if [[ "$APHRODY_CARGO_TARGET_DIR" != /* ]]; then
        echo "APHRODY_CARGO_TARGET_DIR must be an absolute path" >&2
        exit 64
    fi
    for arg in "$@"; do
        case "$arg" in
            --target-dir|--target-dir=*)
                echo "Do not mix APHRODY_CARGO_TARGET_DIR with --target-dir" >&2
                exit 64
                ;;
        esac
    done
    export CARGO_TARGET_DIR="$APHRODY_CARGO_TARGET_DIR"
fi
# Preserve the operator's wrapper, including an explicit deliberate opt-out.
if [[ ! -v RUSTC_WRAPPER ]] && command -v sccache >/dev/null 2>&1; then
    export RUSTC_WRAPPER=sccache
fi
echo "[cargo-serial] waiting for $lock_file (jobs=$jobs, timeout=${wait_seconds}s)" >&2
# Keep ownership in flock itself. A spawned sccache daemon must not inherit
# the descriptor and hold the build lock after Cargo has exited.
exec flock --exclusive --close --timeout "$wait_seconds" "$lock_file" \
    nice -n 10 env \
        CARGO_BUILD_JOBS="$jobs" \
        CARGO_INCREMENTAL=0 \
        CARGO_TERM_COLOR=never \
        cargo "$@"
