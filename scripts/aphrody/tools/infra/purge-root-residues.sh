#!/usr/bin/env bash
# Inventory by default. Permanently delete only explicit files checked for service references.
# Usage: bash purge-root-residues.sh [--root DIRECTORY]
#        bash purge-root-residues.sh --root DIRECTORY --delete FILE [FILE ...]
# --delete creates no backup and cannot be undone by this script.
# FILE arguments are basenames directly inside DIRECTORY, never recursive paths.
set -euo pipefail
umask 077
self_name=${BASH_SOURCE[0]##*/}
root=/home/ubuntu
if [[ ${1:-} == --root ]]; then
  [[ $# -ge 2 ]] || { echo 'Missing directory' >&2; exit 2; }
  root=$(realpath -e -- "$2")
  shift 2
fi
[[ -d $root ]] || exit 2
candidate() {
  case "$1" in
    *.log|*.log.[0-9]*|*.sh|*.py|*.mjs|*.exit) return 0 ;;
    *) return 1 ;;
  esac
}
if [[ $# == 0 ]]; then
  printf 'Candidates only; residual status requires dependency review: %s\n' "$root"
  while IFS= read -r -d '' path; do
    name=${path##*/}
    [[ $name != .* && $name != "$self_name" && $name != nettoyer-residus.sh ]] || continue
    candidate "$name" || continue
    printf '%q\t%s bytes\n' "$name" "$(stat -c %s -- "$path")"
  done < <(find "$root" -mindepth 1 -maxdepth 1 -type f -print0)
  exit 0
fi
[[ $1 == --delete && $# -gt 1 ]] || { echo 'Expected --delete FILE ...' >&2; exit 2; }
shift
command -v lsof >/dev/null || { echo 'lsof required' >&2; exit 2; }
sudo -n lsof -v >/dev/null 2>&1 || { echo 'Cannot inspect open files' >&2; exit 2; }
declare -A seen=()
for name in "$@"; do
  [[ $name != */* && $name != .* && $name != "$self_name" && $name != nettoyer-residus.sh ]] || exit 2
  candidate "$name" || { echo 'Unsupported file type' >&2; exit 2; }
  [[ -z ${seen[$name]:-} ]] || { echo 'Duplicate target' >&2; exit 2; }
  seen[$name]=1
  path=$root/$name
  [[ -f $path && ! -L $path ]] || { echo 'Expected regular file' >&2; exit 2; }
  # Requires sudo visibility to detect files opened by other service accounts.
  status=0
  sudo -n lsof -t -- "$path" >/dev/null 2>&1 || status=$?
  if [[ $status == 0 ]]; then
    printf 'Open file, refusing: %q\n' "$path" >&2
    exit 2
  fi
  [[ $status == 1 ]] || { echo 'Open-file inspection failed' >&2; exit 2; }
done
for name in "$@"; do
  rm -- "$root/$name"
  [[ ! -e $root/$name ]] || { echo 'Deletion failed' >&2; exit 2; }
  printf 'Deleted permanently: %q\n' "$name"
done
