#!/bin/bash
# SPDX-License-Identifier: MIT
# bunos-cachyos-repo: enable the CachyOS repositories exactly as upstream cachyos-repo.sh does
# (factory/upstream/cachyos-repo, GPL-2.0-or-later), without its interactive prompts, hard-coded
# package versions or in-place rewrite of the host: trust the CachyOS signing key, install
# cachyos-keyring, the mirrorlists and CachyOS's pacman (needed for the x86_64_v3 architecture),
# then let upstream's install-repo.awk (or install-v4-repo.awk) insert cachyos-v3, cachyos-core-v3,
# cachyos-extra-v3 and cachyos before [core]. Packages stay signed: pacman SigLevel is untouched.
set -euo pipefail
KEY=F3B607488DB35A47
base=https://mirror.cachyos.org/repo/x86_64/cachyos
awk_dir=${CACHYOS_AWK_DIR:-/usr/share/bun-os/cachyos-repo}
pacman-key --init >/dev/null 2>&1 || true
pacman-key --populate archlinux >/dev/null 2>&1 || true
pacman-key --recv-keys "$KEY" --keyserver keyserver.ubuntu.com
pacman-key --lsign-key "$KEY"
# Newest build of each bootstrap package from the mirror directory listing.
latest() { curl -fsS "$base/" | grep -oE "href=\"$1-[0-9][^\"]*\.pkg\.tar\.zst\"" | sed 's/^href="//; s/"$//' | sort -V | tail -n1; }
pkgs=()
for n in cachyos-keyring cachyos-mirrorlist cachyos-v3-mirrorlist cachyos-v4-mirrorlist pacman; do
  f=$(latest "$n"); [ -n "$f" ] || { echo "no $n on $base" >&2; exit 1; }
  pkgs+=("$base/$f")
done
pacman --disable-sandbox -U --noconfirm "${pkgs[@]}"
# The image targets the x86-64-v3 baseline (cachyos-v3 repositories) so it is reproducible whatever the
# builder CPU is; upstream would pick v4/znver4 from the builder, which would tie the image to it.
/lib/ld-linux-x86-64.so.2 --help | grep -q "x86-64-v3 (supported, searched)" \
  || echo "warning: builder CPU lacks x86-64-v3; package install scripts may fail" >&2
script=$awk_dir/install-repo.awk
cp /etc/pacman.conf /tmp/pacman.conf.cachyos
gawk -i inplace -f "$script" /tmp/pacman.conf.cachyos
install -m 0644 /etc/pacman.conf /etc/pacman.conf.bunos-orig
install -m 0644 /tmp/pacman.conf.cachyos /etc/pacman.conf
# linux-cachyos replaces the stock kernel; do not pin it out.
sed -i '/^IgnorePkg *= *linux$/d' /etc/pacman.conf
grep -E '^\[|^Architecture' /etc/pacman.conf
