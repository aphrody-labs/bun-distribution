#!/bin/bash
# SPDX-License-Identifier: MIT
# Run on the VPS Docker host: ./assemble.sh [workdir]. Needs the bunos-disk:local image (build.sh).
set -euo pipefail
W=${1:-/home/ubuntu/bun-os-disk/work}; mkdir -p "$W"
here=$(cd "$(dirname "$0")" && pwd)
timeout 2400 docker run --rm -v "$W:/work" -v "$here/assemble-inner.sh:/assemble-inner.sh:ro" bunos-disk:local /assemble-inner.sh
sha256sum "$W/${IMG:-bunos-disk.img}"
