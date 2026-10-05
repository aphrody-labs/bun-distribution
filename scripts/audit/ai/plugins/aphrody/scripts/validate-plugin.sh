#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
plugin_store="${APHRODY_PLUGINS_ROOT:-$HOME/plugins}"
if [[ $# -gt 0 && "$1" != --* ]]; then plugin_store="$(dirname "$1")"; shift; fi
yolo_source="${APHRODY_MONOREPO:-$HOME/aphrody}/apps/yolo/cli/src/index.ts"
exec bun "$yolo_source" workspace plugins validate --store "$plugin_store" "$@"
