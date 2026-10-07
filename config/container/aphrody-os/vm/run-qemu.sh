#!/usr/bin/env bash
# Boot the image. Pass "shell" to get an interactive bunsh instead of the self-test.
ROOT=$(cd "$(dirname "$0")" && pwd)
EXTRA=""
[ "${1:-}" = shell ] && EXTRA="aphrody.shell"
ACCEL=tcg
[ -w /dev/kvm ] && ACCEL=kvm
exec qemu-system-x86_64 -accel "$ACCEL" -cpu max -m 1024 -smp 2 -nographic -no-reboot \
	-kernel "$ROOT/out/bzImage" -initrd "$ROOT/out/initramfs.cpio.gz" \
	-device virtio-rng-pci \
	-append "console=ttyS0 rdinit=/sbin/init panic=-1 $EXTRA"
