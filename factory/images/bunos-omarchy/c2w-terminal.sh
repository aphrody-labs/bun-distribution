#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# c2w target command; GUI conversion is deliberately not claimed or attempted.
set -euo pipefail
if [[ "${BUNOS_C2W_TERMINAL:-}" != 1 ]]; then
  echo 'This image target is reserved for container2wasm terminal conversion.' >&2
  exit 64
fi
exec "$@"
