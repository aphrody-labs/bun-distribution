#!/bin/bash
# SPDX-License-Identifier: MIT
# run-qemu.sh DISK OVMF_DIR OUT_DIR [seconds]: UEFI boot with a serial socket ($OUT/serial.sock, log in serial.log),
# monitor socket and virtio-gpu. Use absolute paths. TCG when /dev/kvm is not accessible. Capture with:
#   echo "screendump $OUT/screen.ppm" | socat - UNIX-CONNECT:$OUT/monitor.sock
set -euo pipefail
DISK=$1; FW=$2; OUT=$3; SECS=${4:-600}
mkdir -p "$OUT"; cp -f "$FW/OVMF_VARS.4m.fd" "$OUT/vars.fd"
ACCEL=tcg; [ -r /dev/kvm ] && [ -w /dev/kvm ] && ACCEL=kvm
rm -f "$OUT/monitor.sock" "$OUT/serial.sock"
exec timeout "$SECS" qemu-system-x86_64 -machine q35,accel=$ACCEL -cpu max -smp 4 -m 4096 \
  -drive if=pflash,format=raw,readonly=on,file="$FW/OVMF_CODE.4m.fd" \
  -drive if=pflash,format=raw,file="$OUT/vars.fd" \
  -drive file="$DISK",format=raw,if=none,id=d0,snapshot=on -device virtio-blk-pci,drive=d0 \
  -netdev user,id=n0 -device virtio-net-pci,netdev=n0 \
  -device virtio-vga -display none -chardev socket,id=ser,path="$OUT/serial.sock",server=on,wait=off,logfile="$OUT/serial.log" -serial chardev:ser \
  -monitor unix:"$OUT/monitor.sock",server,nowait \
  -device qemu-xhci -device usb-kbd -device usb-tablet
