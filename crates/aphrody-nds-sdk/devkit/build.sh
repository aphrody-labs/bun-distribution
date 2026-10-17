#!/usr/bin/env bash
# Build DS and 3DS homebrew with the toolchains installed on the build host, then optionally
# boot it headless in the SDK.
#
#   build.sh nds-c    <homebrew-dir> <out.nds>    BlocksDS Makefile project (rom_arm9)
#   build.sh nds-rust <project-dir>  <out.nds>    no_std Rust ARM9 project (see templates/nds-rust)
#   build.sh 3ds-c    <homebrew-dir> <out.3dsx>   devkitPro Makefile project
#   build.sh 3ds-rust <project-dir>  <out.3dsx>   ctru-rs project through cargo-3ds
#   build.sh run      <image> [frames]            headless boot with nds-sdk (hash, lit pixels)
#
# Toolchains (installed outside the repository, never copied into it):
#   BlocksDS     BLOCKSDS=/opt/blocksds/core, WONDERFUL_TOOLCHAIN=/opt/wonderful
#                (Wonderful pacman: toolchain-gcc-arm-none-eabi, blocksds-toolchain)
#   devkitPro    DEVKITPRO=/opt/devkitpro (devkitARM, libctru, 3dstools; from the devkitpro/devkitarm
#                image when pkg.devkitpro.org refuses the host)
#   cargo-3ds    CARGO_3DS (built from vendor/cargo-3ds), nightly Rust with rust-src
# Builds run in a temporary directory so no artefact lands in the source tree.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
export BLOCKSDS="${BLOCKSDS:-/opt/blocksds/core}"
export WONDERFUL_TOOLCHAIN="${WONDERFUL_TOOLCHAIN:-/opt/wonderful}"
export DEVKITPRO="${DEVKITPRO:-/opt/devkitpro}"
export DEVKITARM="${DEVKITARM:-$DEVKITPRO/devkitARM}"
nds_sdk="${NDS_SDK:-$repo/target/release/nds-sdk}"
toolchain="${RUST_NIGHTLY:-$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$repo/rust-toolchain.toml")}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cmd="${1:?usage: build.sh nds-c|nds-rust|3ds-c|3ds-rust|run ...}"
shift

case "$cmd" in
  nds-c)
    src="$(cd "$1" && pwd)"; out="$(realpath -m "$2")"
    # The BlocksDS Makefile builds in ./build and writes ./<NAME>.nds: stage a copy.
    mkdir -p "$tmp/homebrew"
    cp -r "$src" "$tmp/homebrew/project"
    [ -d "$src/../common" ] && cp -r "$src/../common" "$tmp/homebrew/common"
    make -C "$tmp/homebrew/project" -j"$(nproc)" >&2
    cp "$tmp/homebrew/project/"*.nds "$out"
    ;;
  nds-rust)
    proj="$(cd "$1" && pwd)"; out="$(realpath -m "$2")"
    export PATH="$WONDERFUL_TOOLCHAIN/toolchain/gcc-arm-none-eabi/bin:$PATH"
    export CARGO_TARGET_DIR="$tmp/target"
    (cd "$proj" && cargo "+$toolchain" build --release >&2)
    elf="$(find "$tmp/target/armv5te-nintendo-ds/release" -maxdepth 1 -type f ! -name '*.d' ! -name '*.rlib' | head -n1)"
    "$BLOCKSDS/tools/ndstool/ndstool" -c "$out" \
      -7 "$BLOCKSDS/sys/arm7/main_core/arm7_minimal.elf" -9 "$elf" \
      -b "$BLOCKSDS/sys/icon.gif" "Rust homebrew;Aphrody NDS SDK" >&2
    ;;
  3ds-c)
    src="$(cd "$1" && pwd)"; out="$(realpath -m "$2")"
    export PATH="$DEVKITARM/bin:$DEVKITPRO/tools/bin:$PATH"
    mkdir -p "$tmp/homebrew"
    cp -r "$src" "$tmp/homebrew/project"
    [ -d "$src/../common" ] && cp -r "$src/../common" "$tmp/homebrew/common"
    make -C "$tmp/homebrew/project" >&2
    cp "$tmp/homebrew/project/build/"*.3dsx "$out"
    ;;
  3ds-rust)
    proj="$(cd "$1" && pwd)"; out="$(realpath -m "$2")"
    export PATH="$DEVKITARM/bin:$DEVKITPRO/tools/bin:$PATH"
    export RUSTUP_TOOLCHAIN="$toolchain" CARGO_TARGET_DIR="$tmp/target"
    (cd "$proj" && "${CARGO_3DS:?set CARGO_3DS to the cargo-3ds binary}" 3ds build --release >&2)
    cp "$(find "$tmp/target/armv6k-nintendo-3ds/release" -maxdepth 2 -name '*.3dsx' | head -n1)" "$out"
    ;;
  run)
    "$nds_sdk" run "$1" --frames "${2:-300}" --every "${2:-300}" --no-save --data "$tmp/data"
    ;;
  *)
    echo "unknown command: $cmd" >&2
    exit 2
    ;;
esac
