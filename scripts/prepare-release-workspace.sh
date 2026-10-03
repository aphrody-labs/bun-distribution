#!/usr/bin/env bash
set -Eeuo pipefail

# Prepare the clean superproject checkout consumed by
# build-aphrody-stack-release.sh: clone (or refresh) aphrody-src on a native
# Linux filesystem, check out one superproject commit and initialize every
# submodule at its recorded gitlink so sibling path dependencies resolve.
#
# Also supports current first-party monorepos without submodules.
# SOURCE is the superproject remote (git@github.com:aphrody-labs/aphrody.git),
# a local superproject checkout (e.g. /mnt/c/Users/aphro/src) or a `git bundle`
# file. For a local checkout, submodule objects are fetched from its sibling
# directories, so commits that are not pushed yet still resolve; otherwise the
# .gitmodules URLs are used. Never contacts the VPS.
usage='usage: prepare-release-workspace.sh SOURCE SUPERPROJECT_SHA [DEST]'
[[ $# -ge 2 && $# -le 3 ]] || { echo "$usage" >&2; exit 2; }
source_arg="$1"
sha="$2"
dest="${3:-$HOME/aphrody-release/aphrody-src}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'superproject SHA must be 40 hex digits' >&2; exit 2; }
[[ "$(uname -s)" = Linux ]] || { echo 'native Linux build host required' >&2; exit 2; }
command -v git >/dev/null || { echo 'missing git' >&2; exit 2; }
dest="$(realpath -m -- "$dest")"
# /mnt/* is the Windows drive (9p/drvfs) and ~/src holds the retired monolith.
case "$dest" in
  /mnt/*|"$HOME/src"|"$HOME/src/"*) echo "refusing $dest: use a dedicated directory on the Linux filesystem" >&2; exit 2 ;;
esac
mkdir -p -- "$(dirname -- "$dest")"
fstype="$(stat -f -c %T -- "$(dirname -- "$dest")")"
case "$fstype" in
  ext2/ext3|xfs|btrfs) ;;
  *) echo "refusing $dest: native Linux filesystem required (found $fstype)" >&2; exit 2 ;;
esac

local_source=''
if [[ -d "$source_arg" ]]; then
  local_source="$(realpath -e -- "$source_arg")"
  git -C "$local_source" rev-parse --is-inside-work-tree >/dev/null || { echo "$local_source is not a Git checkout" >&2; exit 2; }
fi

if [[ -d "$dest/.git" ]]; then
  [[ -z "$(git -C "$dest" status --porcelain --untracked-files=all)" ]] || {
    echo "$dest has local changes; refusing to reuse it" >&2; exit 2;
  }
  git -C "$dest" fetch --quiet -- "$source_arg" '+refs/heads/*:refs/remotes/source/*'
else
  [[ ! -e "$dest" ]] || { echo "$dest exists and is not a Git checkout" >&2; exit 2; }
  git clone --quiet --no-checkout -- "$source_arg" "$dest"
fi
git -C "$dest" cat-file -e "$sha^{commit}" 2>/dev/null || {
  echo "commit $sha is not reachable from $source_arg (commit and bump the superproject first)" >&2; exit 2;
}
git -C "$dest" -c advice.detachedHead=false checkout --quiet --detach "$sha"
git -C "$dest" submodule init --quiet
if [[ -n "$local_source" && -f "$local_source/.gitmodules" ]]; then
  while read -r key path; do
    name="${key#submodule.}"
    name="${name%.path}"
    [[ -e "$local_source/$path/.git" ]] || { echo "local source has no checkout for submodule $path" >&2; exit 2; }
    git -C "$dest" config "submodule.$name.url" "$local_source/$path"
  done < <(git -C "$dest" config -f .gitmodules --get-regexp '^submodule\..*\.path$')
fi
git -C "$dest" -c protocol.file.allow=always submodule update --init --checkout --quiet
[[ -z "$(git -C "$dest" status --porcelain --untracked-files=all)" ]] || {
  echo "$dest is not clean after checkout" >&2; exit 2;
}
if git -C "$dest" submodule status | grep -q '^[-+U]'; then
  git -C "$dest" submodule status >&2
  echo 'a submodule is missing or differs from its gitlink' >&2
  exit 2
fi
printf 'workspace=%s\nsuperproject=%s\n' "$dest" "$sha"
git -C "$dest" submodule status
