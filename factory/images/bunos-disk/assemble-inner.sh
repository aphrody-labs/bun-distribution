#!/bin/bash
# SPDX-License-Identifier: MIT
# Runs inside the bunos-disk container (root, no --privileged): copies its own root filesystem into a
# btrfs image with an @ / @home / @snapshots layout, builds the vfat ESP with Limine, and joins both
# into a GPT disk image. Only regular files under /work are written; no loop device is used.
set -euo pipefail
W=/work; IMG=${IMG:-bunos-disk.img}; ESP_MIB=2048; ROOT_MIB=${ROOT_MIB:-24576}
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
echo "== ESP (Limine, ESP mounted on /boot as in Omarchy and CachyOS)"
E=$W/esp
install -d $E/EFI/BOOT
# Limine UEFI binary from the limine package; the kernel and initramfs sit at the ESP root, which is
# /boot at run time, so pacman hooks (mkinitcpio / limine-mkinitcpio-hook) update what Limine boots.
cp usr/share/limine/BOOTX64.EFI $E/EFI/BOOT/BOOTX64.EFI
for f in boot/vmlinuz-* boot/initramfs-*.img; do [ -e "$f" ] && cp "$f" "$E/"; done
KERNEL=$(cd boot && ls vmlinuz-* | grep -v fallback | head -n1); KERNEL=${KERNEL#vmlinuz-}
rm -rf boot/*
CMD="root=LABEL=bunos-root rootflags=subvol=@ rw console=tty0 console=ttyS0,115200 loglevel=4 systemd.show_status=1"
# Bootstrap configuration only. On first boot bunos-boot-setup runs the upstream limine-install and
# limine-mkinitcpio, after which limine-entry-tool owns /boot/limine.conf (entries per kernel and snapshot).
cat >$E/limine.conf <<L
timeout: 3
default_entry: 1
interface_branding: Bun OS
verbose: yes
serial: yes

/Bun OS ($KERNEL)
    protocol: linux
    path: boot():/vmlinuz-$KERNEL
    cmdline: $CMD
    module_path: boot():/initramfs-$KERNEL.img

/Bun OS desktop (Omarchy Hyprland)
    protocol: linux
    path: boot():/vmlinuz-$KERNEL
    cmdline: $CMD bunos.session=desktop
    module_path: boot():/initramfs-$KERNEL.img

/Bun OS rescue shell
    protocol: linux
    path: boot():/vmlinuz-$KERNEL
    cmdline: $CMD systemd.unit=rescue.target
    module_path: boot():/initramfs-$KERNEL.img
L
cd $W
truncate -s ${ESP_MIB}M esp.img
mkfs.vfat -F32 -n BUNOS-ESP esp.img >/dev/null
mcopy -s -i esp.img esp/* ::
echo "== btrfs"
truncate -s ${ROOT_MIB}M root.img
mkfs.btrfs -q -f -L bunos-root --compress zstd:3 --shrink -r top --subvol rw:@ --subvol rw:@home --subvol rw:@snapshots root.img
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
