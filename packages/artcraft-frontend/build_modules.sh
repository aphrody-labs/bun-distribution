#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
bun install --frozen-lockfile --ignore-scripts
exec bun run build
