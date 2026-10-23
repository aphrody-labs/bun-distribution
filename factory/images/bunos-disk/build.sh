#!/bin/bash
# SPDX-License-Identifier: MIT
# Run on the VPS Docker host from a checkout (git archive export) of this repository:
#   factory/images/bunos-disk/build.sh BUN_BINARY BUN_ENGINE_DIR [tag]
# Stages the build context (this directory + factory/upstream + the package lists), then builds the
# rootfs image. BUN_BINARY is a linux-x64 bun, BUN_ENGINE_DIR the bundled Bun Engine CLI (cli.js).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../../.." && pwd)
bun=$1; be=$2; tag=${3:-bunos-disk:local}
ctx=${CTX:-$here/ctx}; rm -rf "$ctx"; mkdir -p "$ctx/packages"
cp -a "$here/Containerfile" "$here/cachyos-repo.sh" "$here/overlay" "$ctx/"
cp -a "$root/factory/upstream" "$ctx/upstream"
cp "$root/factory/images/bunos-gaming/install-packages.sh" "$ctx/"
cp "$root/factory/images/bunos-gaming/"{bootable,handheld,gaming}.packages "$ctx/packages/"
cp "$bun" "$ctx/bun"; cp -a "$be" "$ctx/be"
DOCKER_BUILDKIT=1 timeout 3000 docker build -f "$ctx/Containerfile" -t "$tag" "$ctx"
