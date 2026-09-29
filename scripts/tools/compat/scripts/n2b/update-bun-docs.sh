#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ "$#" -gt 1 ]; then
  echo "usage: $(basename "$0") [branch-or-tag]" >&2
  exit 2
fi
args=(--root "$root")
if [ "$#" -eq 1 ]; then
  args+=(--ref "$1")
fi
exec aphrody-ops bun-upstream-docs "${args[@]}"
