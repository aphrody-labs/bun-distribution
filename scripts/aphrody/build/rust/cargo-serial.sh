#!/usr/bin/env bash
# Serialize Aphrody Cargo work across agents and terminals, and bound rustc fan-out.
set -euo pipefail

if (($# == 0)); then
    echo "usage: scripts/aphrody/build/rust/cargo-serial.sh <cargo arguments...>" >&2
    exit 64
fi

source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)"
factory_config="$source_root/tools/aphrody/config/build-factory.json"
cargo_command="${1#+}"
if [[ "$1" == +* ]]; then cargo_command="${2:-}"; fi
help_only=false
for arg in "$@"; do
    if [[ "$arg" == --help || "$arg" == -h ]]; then help_only=true; fi
done
case "$cargo_command" in
    build|b|check|c|test|t|clippy|rustdoc|doc|d|bench|run|r|install|rustc|nextest|xwin|zigbuild)
        # Cloud environments (Claude Code, APHRODY_CLOUD, CI, GitHub Actions, Codespaces, containers)
        # are themselves build hosts: they never route to the factory.
        # Both declared factory hosts run Cargo locally under their factory locks.
        is_cloud=false
        if [[ "${CLAUDE_CODE_REMOTE:-}" == true || "${APHRODY_CLOUD:-0}" == 1 || "${CI:-}" == true || "${GITHUB_ACTIONS:-}" == true || "${CODESPACES:-}" == true || -n "${GITPOD_WORKSPACE_ID:-}" || "${CLOUD_SHELL:-}" == true || -f /.dockerenv || "${CONTAINER:-}" == true ]]; then
            is_cloud=true
        fi
        if [[ "$help_only" == false && -f "$factory_config" && "${APHRODY_BUILD_HOST:-}" != vps && "${APHRODY_BUILD_HOST:-}" != dbfr && "${APHRODY_LOCAL_CARGO:-0}" != 1 && "$is_cloud" == false ]]; then
            # The Workspace build-factory owner interprets the factory contract.
            factory_route="$(bun "$source_root/packages/bun-workspace/src/automation/build-factory.ts" status --route)"
            if [[ "$factory_route" == factory ]]; then
                echo "Heavy Cargo never runs in WSL. Exact worktree state: bun scripts/aphrody/build/rust/vps-cargo.ts run -- <arguments>; pushed main revision: aphrody-ops build-factory run --repo aphrody --revision <full-sha> -- scripts/aphrody/build/rust/cargo-serial.sh <arguments>." >&2
                echo "APHRODY_LOCAL_CARGO=1 is only for an explicitly selected scoped diagnostic." >&2
                exit 64
            fi
        fi
        ;;
esac
# Only compilation is serialized; fetch, metadata and lockfile commands rely on Cargo's own package-cache lock.
case "$cargo_command" in
    build|b|check|c|test|t|clippy|rustdoc|doc|d|bench|run|r|install|rustc|nextest|xwin|zigbuild) ;;
    *) exec cargo "$@" ;;
esac

# A resource marker is a routing hint, never proof of ownership. The owner checks
# the actual kernel FLOCK and process ancestry before reusing the heavy lease.
if [[ "$help_only" == false && -f "$factory_config" && ( "${APHRODY_BUILD_HOST:-}" == vps || -n "${APHRODY_FACTORY_RESOURCE:-}" ) ]]; then
    resource_owner="$source_root/packages/bun-workspace/src/automation/build-factory-cleanup.ts"
    if ! bun "$resource_owner" --held "$factory_config"; then
        if [[ "${APHRODY_BUILD_HOST:-}" != vps ]]; then
            echo "Factory resource marker has no inherited heavy lock" >&2
            exit 64
        fi
        exec bun "$resource_owner" "$factory_config" bash "$source_root/scripts/aphrody/build/rust/cargo-serial.sh" "$@"
    fi
fi

# This is the execution host's affinity, never the controller's or a different host's budget.
available_cpus="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)"
if [[ ! "$available_cpus" =~ ^[1-9][0-9]*$ ]]; then
    echo "Cannot determine the executing host's available CPUs" >&2
    exit 64
fi
default_jobs=4
if ((available_cpus < default_jobs)); then default_jobs="$available_cpus"; fi
jobs="${APHRODY_CARGO_JOBS:-$default_jobs}"
if [[ "$jobs" == auto ]]; then
    # Respect the host affinity and the owner's four-compiler limit per factory lane.
    # Keep the factory lease and shared Cargo lock; concurrent owners retain them.
    jobs="$default_jobs"
elif [[ ! "$jobs" =~ ^[1-4]$ ]]; then
    echo "APHRODY_CARGO_JOBS must be an integer from 1 through 4, or auto (at most four available CPUs)" >&2
    exit 64
fi
if ((jobs > available_cpus)); then
    echo "Cargo jobs exceed the executing host's available CPUs" >&2
    exit 64
fi

for arg in "$@"; do
    case "$arg" in
        -j*|--jobs|--jobs=*)
            echo "Do not override Cargo job count; set APHRODY_CARGO_JOBS=1..4 or auto instead" >&2
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
# Prewarm immediately before every Cargo invocation, including inherited leases:
# the shared daemon may have timed out during a preceding Bun job. Compiler requests
# retain the client's job TMPDIR; only persistent server startup metadata is sanitized.
if [[ "$help_only" == false && -n "${APHRODY_FACTORY_RESOURCE:-}" && ( "${RUSTC_WRAPPER:-}" == sccache || "${RUSTC_WRAPPER:-}" == */sccache ) ]]; then
    bun "$source_root/packages/bun-workspace/src/automation/build-factory-cleanup.ts" --sccache "$factory_config" "$(command -v "$RUSTC_WRAPPER")"
fi
# sccache refuses every compile while CARGO_INCREMENTAL is set. APHRODY_CARGO_INCREMENTAL=1 unsets it instead
# of forcing 0: the profile default then keeps edit loops incremental for workspace members and sccache still
# caches dependencies. Factories and CI keep the non-incremental default.
incremental=(CARGO_INCREMENTAL=0)
if [[ "${APHRODY_CARGO_INCREMENTAL:-0}" == 1 ]]; then incremental=(-u CARGO_INCREMENTAL); fi
if ! command -v flock >/dev/null 2>&1; then
    # Git Bash on Windows ships neither flock nor nice: Cargo's own build-directory lock serializes.
    echo "[cargo-serial] flock unavailable; running cargo with jobs=$jobs under Cargo's own lock" >&2
    exec env "${incremental[@]}" CARGO_BUILD_JOBS="$jobs" CARGO_TERM_COLOR=never cargo "$@"
fi
echo "[cargo-serial] waiting for $lock_file (jobs=$jobs, timeout=${wait_seconds}s)" >&2
# Keep ownership in flock itself. A spawned sccache daemon must not inherit
# the descriptor and hold the build lock after Cargo has exited.
exec flock --exclusive --close --timeout "$wait_seconds" "$lock_file" \
    nice -n 10 env "${incremental[@]}" \
        CARGO_BUILD_JOBS="$jobs" \
        CARGO_TERM_COLOR=never \
        cargo "$@"
