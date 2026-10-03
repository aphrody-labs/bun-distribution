#!/usr/bin/env bash
# Prepare producer archives without checking out or installing into the live producer.
set -Eeuo pipefail
stage_root="$(realpath -- "${1:?usage: prepare-iecode-release.sh STAGE_ROOT [SOURCE_ROOT]}")"
producer_root="$(realpath -- "${2:-$stage_root/../iecode}")"
revision="$(bun "$stage_root/packages/infra/workspace/src/iecode-packages.ts" source \
  --config "$stage_root/config/sibling-checkouts.json" --field revision)"
git -C "$producer_root" cat-file -e "$revision^{commit}"
producer_stage="$(mktemp -d "${TMPDIR:-/tmp}/rg-iecode-source.XXXXXX")"
trap 'rm -rf -- "$producer_stage"' EXIT
git clone --quiet --shared --no-checkout "$producer_root" "$producer_stage"
git -C "$producer_stage" checkout --quiet --detach "$revision"
cd "$stage_root"
bun packages/infra/workspace/src/iecode-packages.ts prepare \
  --config config/sibling-checkouts.json --source "$producer_stage" \
  --destination .cache/iecode-packages --apply
