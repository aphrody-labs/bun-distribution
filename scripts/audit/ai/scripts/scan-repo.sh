#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Compatibility entry point for the shared repository health audit.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STALE='crates/gui|crates/google_os|crates/bun_ffi|crates/aphrody-wasm|crates/mrx-(core|detect|audit|watch|cli)|vendor/coreutils|vendor/util-linux|packaging/install\.(sh|ps1)|docs/posts/|docs/ievr/|docs/launch/|docs/extensions/|docs/adr/'
args=(repository-health --root "$ROOT" --stale "$STALE")
if [ "${FAIL_ON_LINKS:-0}" = "1" ]; then args+=(--fail-on-links); fi
exec yolo ops "${args[@]}"
