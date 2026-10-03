#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
plugin_store="${APHRODY_PLUGINS_ROOT:-$HOME/plugins}"
if [[ $# -gt 0 && "$1" != --* ]]; then plugin_store="$(dirname "$1")"; shift; fi
if command -v aphrody-workspace >/dev/null 2>&1; then
  exec aphrody-workspace plugins validate --store "$plugin_store" "$@"
fi
workspace_source="${APHRODY_MONOREPO:-$HOME/aphrody}/packages/infra/workspace/src/cli.ts"
exec bun "$workspace_source" plugins validate --store "$plugin_store" "$@"
