#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# install-packages.sh LIST...: install every package from the pinned repositories, fall back to an AUR
# build for packages the repositories lack, and record the rest in /usr/share/bun-os/missing-packages.txt.
set -euo pipefail
repo=() aur=()
for list in "$@"; do
  while read -r pkg; do
    [ -z "$pkg" ] || [ "${pkg:0:1}" = "#" ] && continue
    if pacman -Si "$pkg" >/dev/null 2>&1 || pacman -Sg "$pkg" >/dev/null 2>&1; then repo+=("$pkg"); else aur+=("$pkg"); fi
  done <"$list"
done
install -d /usr/share/bun-os
[ ${#repo[@]} -eq 0 ] || pacman -S --noconfirm --needed "${repo[@]}"
for pkg in "${aur[@]}"; do
  if timeout 1200 runuser -u builder -- bash -c "set -e; cd /tmp && rm -rf aur-$pkg && git clone -q --depth 1 https://aur.archlinux.org/$pkg.git aur-$pkg && cd aur-$pkg && test -f PKGBUILD && makepkg -s --noconfirm --needed --skippgpcheck" \
    && pacman -U --noconfirm --needed /tmp/aur-"$pkg"/*.pkg.tar.zst; then
    echo "$pkg" >>/usr/share/bun-os/aur-packages.txt
  else
    echo "$pkg" >>/usr/share/bun-os/missing-packages.txt
  fi
  rm -rf /tmp/aur-"$pkg"
done
touch /usr/share/bun-os/missing-packages.txt
