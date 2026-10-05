#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Publishes the release assets of the build host as the GitHub release <tag> with gh, the same way the `publish`
# job of .github/workflows/release.yml does (GitHub Actions are not available to the repository). Called by
# ship_remote.sh only when the built commit is the v<VERSION> tag and main contains it (D17: releases from main).
# usage: publish_remote.sh <tag> <release-dir>
set -euo pipefail
tag=$1; dir=$2
slug=$(git remote get-url origin | sed -E 's#^(https://github\.com/|git@[^:]+:)##; s#\.git$##')
# a release needs write access: the owner identity's token when it is logged in on the host (see ship_unit.sh)
token=$(gh auth token --user "${YOLO_GH_USER:-aphrody-dev}" 2>/dev/null || true)
[ -z "$token" ] || export GH_TOKEN="$token"
if gh release view "$tag" -R "$slug" >/dev/null 2>&1; then
  gh release upload "$tag" "$dir"/* -R "$slug" --clobber # assets of an existing release are replaced
else
  gh release create "$tag" "$dir"/* -R "$slug" --title "yolo $tag" --generate-notes --verify-tag
fi
gh release view "$tag" -R "$slug" --json tagName,url,assets \
  --jq '"\(.tagName) \(.url)\n  \([.assets[].name] | join("\n  "))"'
