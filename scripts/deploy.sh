#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Stable documented entry point; the implementation lives with AI tooling.
set -Eeuo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$script_dir/tools/ai/scripts/deploy.sh" "$@"
