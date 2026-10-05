#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Wrapper for the shared Aphrody Tauri controller.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec yolo ops tauri --root "$repo_root" "$@"
