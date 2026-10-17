#!/usr/bin/env bash
# fetch-git.sh <url> <commit> <dir>: shallow-fetch exactly <commit> and verify the checkout.
set -euo pipefail
url="$1" commit="$2" dir="$3"
git init -q "$dir"
git -C "$dir" fetch -q --depth 1 "$url" "$commit"
git -C "$dir" checkout -q FETCH_HEAD
actual="$(git -C "$dir" rev-parse HEAD)"
if [ "$actual" != "$commit" ]; then
  echo "fetch-git: $url resolved to $actual, expected $commit" >&2
  exit 1
fi
rm -rf "$dir/.git"
