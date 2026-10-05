#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Usage (root): build-wsl-distro.sh <output> <distribution> <suite> <mirror> <pkg,pkg,...> [name|url|suite|components|fingerprint ...]
# Assembles an Ubuntu root filesystem with the configured packages and signed extra repositories,
# then writes <output>/<distribution>.wsl and <output>/packages.txt. The rootfs carries no kernel.
set -euo pipefail
output_dir=$1
distribution=$2
suite=$3
mirror=$4
IFS=, read -r -a packages <<<"$5"
shift 5
repositories=("$@")
[[ $EUID -eq 0 ]] || { echo "build-wsl-distro.sh must run as root" >&2; exit 1; }
mkdir -p "$output_dir"
work=$(mktemp -d "$output_dir/.rootfs.XXXXXX")
rootfs=$work/rootfs
cleanup() {
  for mount in dev/pts dev sys proc; do mountpoint -q "$rootfs/$mount" && umount -l "$rootfs/$mount"; done
  rm -rf --one-file-system "$work"
}
trap cleanup EXIT

# Every Ubuntu suite uses the gutsy debootstrap script; older hosts lack newer suite names.
script=/usr/share/debootstrap/scripts/$suite
[[ -e $script ]] || script=/usr/share/debootstrap/scripts/gutsy
debootstrap --variant=minbase --components=main,universe --include=ca-certificates,gnupg "$suite" "$rootfs" "$mirror" "$script"

cat >"$rootfs/etc/apt/sources.list.d/ubuntu.sources" <<EOF
Types: deb
URIs: $mirror
Suites: $suite $suite-updates $suite-backports
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: https://security.ubuntu.com/ubuntu
Suites: $suite-security
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
: >"$rootfs/etc/apt/sources.list"

install -d -m 0755 "$rootfs/etc/apt/keyrings"
for spec in "${repositories[@]}"; do
  IFS='|' read -r name url repo_suite components fingerprint <<<"$spec"
  keyring=$rootfs/etc/apt/keyrings/$name.gpg
  curl -fsSL "https://keyserver.ubuntu.com/pks/lookup?op=get&options=mr&search=0x$fingerprint" | gpg --dearmor >"$keyring"
  # Refuse a keyring whose primary fingerprint differs from the pinned one.
  actual=$(gpg --show-keys --with-colons "$keyring" | while IFS=: read -r kind _ _ _ _ _ _ _ _ fpr _; do [[ $kind == fpr ]] && { echo "$fpr"; break; }; done)
  [[ ${actual^^} == "${fingerprint^^}" ]] || { echo "$name key fingerprint $actual != $fingerprint" >&2; exit 1; }
  chmod 0644 "$keyring"
  cat >"$rootfs/etc/apt/sources.list.d/$name.sources" <<EOF
Types: deb
URIs: $url
Suites: $repo_suite
Components: $components
Signed-By: /etc/apt/keyrings/$name.gpg
EOF
done

mount -t proc proc "$rootfs/proc"
mount -t sysfs sys "$rootfs/sys"
mount --bind /dev "$rootfs/dev"
mount --bind /dev/pts "$rootfs/dev/pts"
# No service starts inside the build chroot.
printf '#!/bin/sh\nexit 101\n' >"$rootfs/usr/sbin/policy-rc.d"
chmod 0755 "$rootfs/usr/sbin/policy-rc.d"
chroot "$rootfs" env DEBIAN_FRONTEND=noninteractive apt-get update
chroot "$rootfs" env DEBIAN_FRONTEND=noninteractive apt-get -y full-upgrade
chroot "$rootfs" env DEBIAN_FRONTEND=noninteractive apt-get -y install "${packages[@]}"
chroot "$rootfs" dpkg-query -W -f='${Package}=${Version}\n' >"$work/packages.txt"
chroot "$rootfs" apt-get clean
rm -f "$rootfs/usr/sbin/policy-rc.d"
rm -rf "$rootfs"/var/lib/apt/lists/* "$rootfs"/tmp/* "$rootfs"/var/tmp/*
: >"$rootfs/etc/machine-id"
for mount in dev/pts dev sys proc; do umount "$rootfs/$mount"; done

cat >"$rootfs/etc/wsl.conf" <<EOF
[boot]
systemd=true
EOF
cat >"$rootfs/etc/wsl-distribution.conf" <<EOF
[oobe]
defaultName = $distribution
EOF

tar -C "$rootfs" --numeric-owner --xattrs --acls -czf "$work/$distribution.wsl" .
mv "$work/packages.txt" "$output_dir/packages.txt"
mv "$work/$distribution.wsl" "$output_dir/$distribution.wsl"
