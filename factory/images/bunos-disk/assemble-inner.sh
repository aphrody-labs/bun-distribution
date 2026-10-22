#!/bin/bash
# SPDX-License-Identifier: MIT
# Runs inside the bunos-disk container (root, no --privileged): copies its own root filesystem into a
# btrfs image with an @ / @home / @snapshots layout, builds the vfat ESP with systemd-boot, and joins both
# into a GPT disk image. Only regular files under /work are written; no loop device is used.
set -euo pipefail
W=/work; IMG=${IMG:-bunos-disk.img}; ESP_MIB=512; ROOT_MIB=${ROOT_MIB:-15360}
rm -rf $W/top $W/esp $W/esp.img $W/root.img $W/$IMG
mkdir -p $W/top/@ $W/top/@home $W/top/@snapshots $W/esp
echo "== copying rootfs"
tar -C / --one-file-system --exclude=./work -cpf - . | tar -C $W/top/@ -xpf -
cd $W/top/@
# Docker bind-mounts these into the container; restore the real image values.
echo bunos >etc/hostname
printf '127.0.0.1 localhost\n::1 localhost\n127.0.1.1 bunos\n' >etc/hosts
ln -sfn ../run/systemd/resolve/stub-resolv.conf etc/resolv.conf
rm -f etc/machine-id; : >etc/machine-id
mkdir -p proc sys dev run tmp mnt boot .snapshots
chmod 1777 tmp
# Home on its own subvolume: move the user's skeleton there.
mv home/* $W/top/@home/ 2>/dev/null || true
mkdir -p home
echo "== ESP"
E=$W/esp
install -d $E/EFI/BOOT $E/EFI/systemd $E/loader/entries $E/bunos
cp usr/lib/systemd/boot/efi/systemd-bootx64.efi $E/EFI/BOOT/BOOTX64.EFI
cp usr/lib/systemd/boot/efi/systemd-bootx64.efi $E/EFI/systemd/systemd-bootx64.efi
cp boot/vmlinuz-linux $E/bunos/vmlinuz-linux
cp boot/initramfs-linux.img $E/bunos/initramfs-linux.img
CMD="root=LABEL=bunos-root rootflags=subvol=@ rw console=tty0 console=ttyS0,115200 loglevel=4 systemd.show_status=1"
cat >$E/loader/loader.conf <<L
default bunos-gaming.conf
timeout 3
console-mode keep
editor yes
L
cat >$E/loader/entries/bunos-gaming.conf <<L
title   Bun OS Gaming (gamescope + Bun Engine)
linux   /bunos/vmlinuz-linux
initrd  /bunos/initramfs-linux.img
options $CMD bunos.session=gaming
L
cat >$E/loader/entries/bunos-desktop.conf <<L
title   Bun OS Desktop (Omarchy Hyprland)
linux   /bunos/vmlinuz-linux
initrd  /bunos/initramfs-linux.img
options $CMD bunos.session=desktop
L
cat >$E/loader/entries/bunos-rescue.conf <<L
title   Bun OS Rescue shell (no session)
linux   /bunos/vmlinuz-linux
initrd  /bunos/initramfs-linux.img
options $CMD systemd.unit=rescue.target
L
cd $W
truncate -s ${ESP_MIB}M esp.img
mkfs.vfat -F32 -n BUNOS-ESP esp.img >/dev/null
mcopy -s -i esp.img esp/* ::
echo "== btrfs"
truncate -s ${ROOT_MIB}M root.img
mkfs.btrfs -q -f -L bunos-root --compress zstd:3 -r top --subvol rw:@ --subvol rw:@home --subvol rw:@snapshots root.img
echo "== GPT"
truncate -s $((ESP_MIB+ROOT_MIB+2))M $IMG
sfdisk -q $IMG <<S
label: gpt
first-lba: 2048
start=2048, size=$((ESP_MIB*2048)), type=C12A7328-F81F-11D2-BA4B-00A0C93EC93B, name="ESP"
size=$((ROOT_MIB*2048)), type=4F68BCE3-E8CD-4DB1-96E7-FBCAF984B709, name="bunos-root"
S
dd if=esp.img of=$IMG bs=1M seek=1 conv=notrunc,sparse status=none
dd if=root.img of=$IMG bs=1M seek=$((1+ESP_MIB)) conv=notrunc,sparse status=none
rm -rf $W/top $W/esp $W/esp.img $W/root.img
ls -ls $W/$IMG
