#!/usr/bin/env bash
set -euo pipefail
root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$root_dir/script/common/frontend_preflight.sh"
frontend_preflight "$root_dir/frontend"
cd "$root_dir/frontend"
frontend_bun_install
export VITE_ENVIRONMENT_TYPE="${VITE_ENVIRONMENT_TYPE:-production}"
exec bun run dev
