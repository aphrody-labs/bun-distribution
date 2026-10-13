#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Current Linux factory artifact: bounded native gates, embedded CLI and deployment acceptance.
# Called by Workspace build-factory under the shared heavy lock on a clean pinned checkout.
set -euo pipefail
factory_yolo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$factory_yolo_root"
factory_yolo_sha=$(git rev-parse HEAD)
factory_yolo_wrapper=${YOLO_CARGO_WRAPPER:-/home/ubuntu/aphrody/scripts/build/rust/cargo-serial.sh}
test -x "$factory_yolo_wrapper" || { echo "Missing declared Cargo owner wrapper" >&2; exit 2; }

bun install --frozen-lockfile
./scripts/dev/cli/aphrody verify --only whitespace,typecheck,lint,fmt-check,rust-fmt,docs --json
"$factory_yolo_wrapper" check --locked -p yolo-runtime -p yolo-core
"$factory_yolo_wrapper" test --locked -p yolo-runtime -p yolo-core
"$factory_yolo_wrapper" clippy --locked -p yolo-runtime -p yolo-core --all-targets -- -D warnings
"$factory_yolo_wrapper" build --locked --profile runtime -p aphrody-ffi --features browser,tooling
YOLO_CARGO_WRAPPER="$factory_yolo_wrapper" just yolo::qualify-tooling
export YOLO_TOOLING_LIB="$factory_yolo_root/target/runtime/libaphrody_ffi.so"
bun scripts/release/runtime_artifact.ts
bun test --timeout 30000 test/
bun scripts/release/release.ts --out "dist/release/$factory_yolo_sha"
factory_yolo_version=$(cat packages/engine/yolo/VERSION)
factory_yolo_release="dist/release/$factory_yolo_sha/$factory_yolo_version"
factory_yolo_previous=${YOLO_PREVIOUS_RUNTIME_ARTIFACT:-}
bash scripts/release/smoke_remote.sh "$factory_yolo_release" ${factory_yolo_previous:+"$factory_yolo_previous"}
printf 'Qualified Linux factory artifact: %s (%s)\n' "$factory_yolo_release" "$factory_yolo_sha"
