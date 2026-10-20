#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Run one serialized Cargo command using the pinned stable or moving nightly channel.
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
if (($# < 2)); then
  echo "usage: $0 stable|canary <cargo command and arguments...>" >&2
  exit 64
fi

channel="$1"
shift
case "$channel" in
  stable)
    toolchain="$(sed -nE 's/^channel[[:space:]]*=[[:space:]]*"([^"]+)"/\1/p' "$root/rust-toolchain.toml" | head -1)"
    [[ -n "$toolchain" ]] || { echo 'rust-toolchain.toml has no stable toolchain pin' >&2; exit 1; }
    ;;
  canary) toolchain=nightly ;;
  *) echo "unknown channel: $channel (expected stable or canary)" >&2; exit 64 ;;
esac

exec "$root/scripts/aphrody/build/rust/cargo-serial.sh" "+$toolchain" "$@"
