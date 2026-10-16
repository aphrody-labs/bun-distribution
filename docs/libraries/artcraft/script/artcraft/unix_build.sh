#!/usr/bin/env bash
# This works on Linux and MacOS to build production Artcraft

set -euxo pipefail

echo "Building production Artcraft..."
echo ""

root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
frontend_path="${root_dir}/frontend"
rust_crate_path="${root_dir}/crates/desktop/artcraft"

# Build with the desktop app configuration.
config_path="${rust_crate_path}/tauri.conf.json"

pushd "${frontend_path}" || exit

source "${root_dir}/script/common/frontend_preflight.sh"
frontend_preflight "${frontend_path}"
frontend_bun_install

popd || exit

export TAURI_FRONTEND_PATH="${frontend_path}"
export TAURI_APP_PATH="${rust_crate_path}"

# NB: The "frontend dev" script sets "production" too, so this must only control the
# hostnames we use, not minification, etc.
export VITE_ENVIRONMENT_TYPE="production"
export SQLX_OFFLINE=true

# Tauri invokes the Bun production build declared in its configuration.
cargo tauri build --config "${config_path}"

echo "Done!"

date "+Finished on %A, %B %e - %H:%M:%S (local timezone)"
