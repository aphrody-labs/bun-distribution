#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
source_dir=$1
output_dir=$2
jobs=$3
mkdir -p "$output_dir"
if [[ ! -f "$output_dir/.config" ]]; then cp "$source_dir/Microsoft/config-wsl" "$output_dir/.config"; fi
make -C "$source_dir" O="$output_dir" olddefconfig
make -C "$source_dir" O="$output_dir" -j"$jobs"
make -C "$source_dir" O="$output_dir" INSTALL_MOD_PATH="$output_dir/modules" modules_install
make -C "$source_dir" O="$output_dir" headers_install INSTALL_HDR_PATH="$output_dir/headers"
mkdir -p "$output_dir/perf-build"
make -C "$source_dir/tools/perf" O="$output_dir/perf-build/" -j"$jobs" NO_JEVENTS=1 NO_JVMTI=1 NO_LIBTRACEEVENT=1 install DESTDIR="$output_dir/perf" prefix=/
kernel_release=$(make -s -C "$source_dir" O="$output_dir" kernelrelease)
# Upstream refuses to overwrite an existing VHDX; construct a new image atomically.
image_dir=$(mktemp -d "$output_dir/.vhdx.XXXXXX")
trap 'rm -rf "$image_dir"' EXIT
bash "$source_dir/Microsoft/scripts/gen_artifacts_vhdx.sh" "$output_dir/modules" "$output_dir/headers" "$output_dir/perf" "$kernel_release" "$image_dir/modules.vhdx"
mv "$image_dir/modules.vhdx" "$output_dir/modules.vhdx"
