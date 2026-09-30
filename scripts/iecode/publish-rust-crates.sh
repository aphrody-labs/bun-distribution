#!/usr/bin/env bash
# Publish the portable IECODE Rust crates to crates.io. Release authority lives in
# aphrody-infra; IECODE only owns the crate sources. Run `bun run release:check` in the
# IECODE checkout first; it performs the same packaging as a dry run.
set -euo pipefail

if [[ -z "${CARGO_REGISTRY_TOKEN:-}" ]]; then
	printf '%s\n' "CARGO_REGISTRY_TOKEN is required; run cargo login outside this agent session." >&2
	exit 2
fi

iecode_root=${IECODE_ROOT:-$(dirname "$0")/../../../../iecode}
iecode_root=$(cd -- "${iecode_root}" && pwd)

for manifest in "${iecode_root}"/crates/{emu,geom,re,sql,tasks,video}/Cargo.toml; do
	crate=$(basename "$(dirname "${manifest}")")
	printf 'publishing %s\n' "${crate}"
	cargo publish --manifest-path "${manifest}" --locked --allow-dirty
done
