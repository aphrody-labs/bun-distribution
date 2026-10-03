#!/usr/bin/env bash
# Publish only the qualified portable IECODE crates through the existing Cargo owner.
# Usage: publish-rust-crates.sh [--plan|--dry-run]
# --plan prints commands without requiring credentials or producing build artifacts.
# --dry-run runs scoped gates and Cargo publication verification without uploading.
# Cargo resolves credentials through its normal provider/configuration chain.
set -euo pipefail

mode=publish
case "${1:-}" in
    '') ;;
    --plan) mode=plan ;;
    --dry-run) mode=dry-run ;;
    --help|-h)
        printf '%s\n' 'Usage: publish-rust-crates.sh [--plan|--dry-run]' \
            'IECODE_ROOT selects the producer checkout; default: sibling iecode.'
        exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 64 ;;
esac
if (($# > 1)); then
    printf '%s\n' 'Only one mode argument is supported.' >&2
    exit 64
fi

owner_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
iecode_root=$(cd -- "${IECODE_ROOT:-${owner_root}/../iecode}" && pwd)
cargo_owner="${owner_root}/scripts/build/rust/cargo-serial.sh"
workspace_manifest="${iecode_root}/Cargo.toml"
# Neither crate depends on the other. Keep foundations before their consumers;
# adding a package requires a separately qualified allowlist change.
crates=(aphrody-wii aphrody-aarch64)

for crate in "${crates[@]}"; do
    if [[ ! -f "${iecode_root}/crates/${crate}/Cargo.toml" ]]; then
        printf 'Missing qualified crate manifest: %s\n' "${crate}" >&2
        exit 2
    fi
done

run_cargo() {
    if [[ "$mode" == plan ]]; then
        printf '%q ' "$cargo_owner" "$@"
        printf '\n'
    else
        "$cargo_owner" "$@"
    fi
}

cd -- "$iecode_root"
if [[ "$mode" != plan ]]; then
    if [[ "$(git rev-parse --show-toplevel)" != "$iecode_root" ]]; then
        printf '%s\n' 'IECODE_ROOT must be the producer Git checkout root.' >&2
        exit 2
    fi
    if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
        printf '%s\n' 'Producer checkout is dirty; commit the qualified source before publication.' >&2
        exit 2
    fi
fi

packages=()
for crate in "${crates[@]}"; do packages+=(-p "$crate"); done
run_cargo check --manifest-path "$workspace_manifest" --locked --all-targets "${packages[@]}"
run_cargo test --manifest-path "$workspace_manifest" --locked "${packages[@]}"
run_cargo clippy --manifest-path "$workspace_manifest" --locked --all-targets "${packages[@]}" -- -D warnings
for crate in "${crates[@]}"; do
    arguments=(publish --manifest-path "${iecode_root}/crates/${crate}/Cargo.toml" --locked)
    if [[ "$mode" == dry-run || "$mode" == plan ]]; then arguments+=(--dry-run); fi
    printf 'Verifying/publishing %s (%s)\n' "$crate" "$mode"
    run_cargo "${arguments[@]}"
done
