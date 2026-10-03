#!/usr/bin/env bash
set -Eeuo pipefail

usage='usage: build-aphrody-discord-release.sh DISCORD_REPO RELEASES_DIR'
[[ $# == 2 ]] || { echo "$usage" >&2; exit 2; }
repo="$(realpath -e -- "$1")"
releases="$(realpath -m -- "$2")"
commit="$(git -C "$repo" rev-parse --verify HEAD)"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'source is not pinned to a full commit' >&2; exit 2; }
[[ -z "$(git -C "$repo" status --porcelain)" ]] || { echo 'refusing a dirty Discord source tree' >&2; exit 2; }
[[ -f "$repo/bun.lock" || -f "$repo/bun.lockb" ]] || { echo 'Discord source has no Bun lockfile' >&2; exit 2; }
dest="$releases/$commit"
if [[ -e "$dest" ]]; then
  echo "release already exists: $dest" >&2
  exit 2
fi
mkdir -p "$releases"
stage="$(mktemp -d "$releases/.building-$commit.XXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
cd "$repo"
bun build apps/carbon-example/src/index.ts --target=bun --outfile "$stage/server.js"
# Constant fields plus the commit validated above as 40 hex digits: no JSON escaping needed.
printf '{\n  "schemaVersion": 1,\n  "repository": "aphrody-discord",\n  "commit": "%s",\n  "entry": "server.js"\n}\n' \
  "$commit" > "$stage/release.json"
(cd "$stage" && sha256sum server.js release.json > SHA256SUMS)
chmod 0644 "$stage"/*
mv -- "$stage" "$dest"
trap - EXIT
printf '%s\n' "$dest"
