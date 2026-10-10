#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
# Unified wrapper delegating to cross-platform scripts/forensics/map-google-local.ts
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bun "$script_dir/map-google-local.ts" "$@"
