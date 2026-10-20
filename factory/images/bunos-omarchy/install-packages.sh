#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Installs only packages from the root factory's generated closure.
set -euo pipefail
repo=() missing=()
for list in "$@"; do
  while IFS= read -r pkg || [[ -n "$pkg" ]]; do
    [[ -z "$pkg" || "$pkg" == \#* ]] && continue
    if pacman -Si "$pkg" >/dev/null 2>&1; then repo+=("$pkg"); else missing+=("$pkg"); fi
  done <"$list"
done
if ((${#missing[@]})); then
  printf 'Refusing image: packages absent from configured signed repositories:\n' >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 20
fi
((${#repo[@]} == 0)) || pacman -S --noconfirm --needed "${repo[@]}"
