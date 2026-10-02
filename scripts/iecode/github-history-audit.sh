#!/usr/bin/env bash
set -euo pipefail

# Moved from the IECODE repository; aphrody-infra owns cross-repository audits.
# IECODE_ROOT (default: personal IECODE checkout above the src workspace) is resolved for callers that write the
# report next to the IECODE ledger (docs/ABSORPTION-MATRIX.md).
iecode_root=${IECODE_ROOT:-$(dirname "$0")/../../../../iecode}
export IECODE_ROOT="$iecode_root"

# Read-only audit. Requires `gh auth login` with access to aphrody-code.
# It deliberately prints metadata and hashes only, never repository contents.
repos=(
  aphrody-code/nie aphrody-code/iecode-cpp aphrody-code/iecode
  aphrody-code/node-api-dotnet aphrody-code/winclean aphrody-code/winDS
  aphrody-code/ghidra-suite-plugin
  aphrody-code/dbxv2 rose-griffon/rg aphrody-code/vps
)

printf 'repository\tall_ref_commits\tbranches\ttags\treleases\tprs\n'
audit_root=$(mktemp -d "${TMPDIR:-/tmp}/iecode-history-audit.XXXXXX")
trap 'rm -rf "$audit_root"' EXIT
for repo in "${repos[@]}"; do
  slug=${repo//\//-}
  gh repo clone "$repo" "$audit_root/$slug" -- --quiet >/dev/null 2>&1
  commits=$(git -C "$audit_root/$slug" rev-list --all --count)
  branches=$(gh api --paginate "repos/$repo/branches?per_page=100" --jq '.[].name' | wc -l)
  tags=$(gh api --paginate "repos/$repo/tags?per_page=100" --jq '.[].name' | wc -l)
  releases=$(gh api --paginate "repos/$repo/releases?per_page=100" --jq '.[].tag_name' | wc -l)
  prs=$(gh api "repos/$repo/pulls?state=all&per_page=100" --jq 'length')
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$repo" "$commits" "$branches" "$tags" "$releases" "$prs"
done
