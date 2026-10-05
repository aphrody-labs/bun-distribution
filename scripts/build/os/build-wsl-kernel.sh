#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Usage: build-wsl-kernel.sh <source> <output> <jobs> <microsoft-wsl-tree> <gcc|rust>
# The Microsoft WSL kernel tree supplies the base configuration and the modules VHDX generator.
# `rust` builds with LLVM and requires CONFIG_RUST=y in the final configuration.
set -euo pipefail
source_dir=$1
output_dir=$2
jobs=$3
wsl_tree=$4
toolchain=$5
make_args=(-C "$source_dir" O="$output_dir")
[[ $toolchain == rust ]] && make_args+=(LLVM=1)
mkdir -p "$output_dir"
if [[ ! -f "$output_dir/.config" ]]; then cp "$wsl_tree/Microsoft/config-wsl" "$output_dir/.config"; fi
if [[ $toolchain == rust ]]; then
  make "${make_args[@]}" rustavailable
  # RUST requires GENDWARFKSYMS while MODVERSIONS is on; BTF needs pahole language exclusion.
  "$source_dir/scripts/config" --file "$output_dir/.config" --enable RUST --enable GENDWARFKSYMS
fi
make "${make_args[@]}" olddefconfig
if [[ $toolchain == rust && $'\n'$(<"$output_dir/.config")$'\n' != *$'\nCONFIG_RUST=y\n'* ]]; then
  echo "CONFIG_RUST was dropped by Kconfig; check rustc, bindgen, rust-src and pahole versions" >&2
  exit 1
fi
make "${make_args[@]}" -j"$jobs"
make "${make_args[@]}" INSTALL_MOD_PATH="$output_dir/modules" modules_install
make "${make_args[@]}" headers_install INSTALL_HDR_PATH="$output_dir/headers"
mkdir -p "$output_dir/perf-build"
make -C "$source_dir/tools/perf" O="$output_dir/perf-build/" -j"$jobs" NO_JEVENTS=1 NO_JVMTI=1 NO_LIBTRACEEVENT=1 install DESTDIR="$output_dir/perf" prefix=/
kernel_release=$(make -s "${make_args[@]}" kernelrelease)
# Upstream refuses to overwrite an existing VHDX; construct a new image atomically.
image_dir=$(mktemp -d "$output_dir/.vhdx.XXXXXX")
trap 'rm -rf "$image_dir"' EXIT
bash "$wsl_tree/Microsoft/scripts/gen_artifacts_vhdx.sh" "$output_dir/modules" "$output_dir/headers" "$output_dir/perf" "$kernel_release" "$image_dir/modules.vhdx"
mv "$image_dir/modules.vhdx" "$output_dir/modules.vhdx"
