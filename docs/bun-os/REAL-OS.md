<!-- SPDX-License-Identifier: MIT -->
# Bun OS as a real bootable OS: audit and first disk image (2026-10-22)

Goal: a disk image that boots into the Bun Engine library as a gamescope session, plus an Omarchy-style
Hyprland desktop, at the level of Omarchy, Bazzite and CachyOS. This file records what exists, what was
built and booted on the VPS, and what is missing. Evidence is a repository path or a VPS observation;
"declared" (catalog, plan, package list) is not "built".

## What builds today

- `bun factory/images/build.ts plan bunos-gaming --target bootable` reports the `bootable` target as blocked:
  "No explicit kernel composition is selected or qualified" (`factory/images/bunos-gaming/Containerfile`,
  `factory/usr/manifest.json` `kernelSelection.state = blocked`). The `bun factory image ...` form from the
  task does not exist in the VPS checkout (it is behind origin/os) or in this one (`factory arch image` is
  rejected); `factory/images/build.ts` is the working entry.
- VPS (`ssh vps`): no `bunos-gaming` image, no rootfs tar, nothing under `bun-os-usr` except a package cache.
  The only Arch rootfs is `bunos-omarchy:imported-rootfs` (official Try-Omarchy 4.0.4 guest rootfs: 678 packages,
  Hyprland 0.56.2, uwsm, NetworkManager, quickshell, Arch kernel 7.2.9, no initramfs, no gamescope, no Bun).
- Host tools: qemu 11.0.3, mkfs.btrfs/ext4/vfat, sfdisk, docker. Missing: OVMF (taken from the `edk2-ovmf` pacman
  package inside a container), guestfish, genimage, systemd-repart, mtools and bootctl (both used from the
  container image). `/dev/kvm` is `root:kvm 0660` and the `ubuntu` user is not in `kvm`, so QEMU runs with TCG.

## Feature matrix

`have` = present and exercised in the image or the repository; `partial` = declared, packaged elsewhere or
only the plumbing exists; `missing` = no implementation (an upstream catalog entry alone is `missing`).

| # | Feature | Omarchy / Bazzite / CachyOS | Bun OS today | Evidence |
| - | --- | --- | --- | --- |
| 1 | Arch base, pacman/libalpm | Arch (all but Bazzite: Fedora atomic) | have | `factory/arch/pacman.ts`, `factory/usr/manifest.json`; the disk image runs pacman |
| 2 | CachyOS repositories | CachyOS | partial | declared in `factory/usr/manifest.json`; not enabled in the disk image (Arch + Omarchy repos only) |
| 3 | Optimised kernel `linux-cachyos` | CachyOS, Bazzite (own kernel) | missing | `bootable.packages` is an inert list; `factory/arch/cachyos/integration.json` pins 7.2.11 sources only; image boots Arch `linux` 7.2.9 |
| 4 | sched-ext (scx), BORE | CachyOS | missing | no scx package or service anywhere under `factory/`; BORE appears only in the CachyOS kernel catalog |
| 5 | x86-64-v3/v4 package builds | CachyOS | missing | no v3/v4 repository configured; VPS Mesa notes mention `-march=haswell` only |
| 6 | Hyprland desktop | Omarchy | have | Hyprland 0.56.2, uwsm, quickshell in the image; session file `bunos-desktop.desktop` |
| 7 | Omarchy defaults, menus, themes | Omarchy | partial | `/usr/share/omarchy` (444 `bin` scripts incl. `omarchy-menu*`, 21 themes) present; per-user config seeded by first boot; Omarchy installer migrations and `limine-snapper` not wired |
| 8 | gamescope session without a display manager, return to desktop | Bazzite, ChimeraOS | partial | `factory/bunos/pkgbuilds/bun-engine/bunos-gamescope-session`; `bunos-session.service` + `bunos-session switch desktop|gaming` in `factory/images/bunos-disk/` (this change) |
| 9 | Bun Engine library as the session client | Steam Big Picture equivalent | partial | `packages/bun-engine/src/frontend/cli.ts`; bundled with Bun in the image, served on loopback; needs a Chromium kiosk window under gamescope |
| 10 | Steam, Proton, Heroic, Lutris, umu | Bazzite, CachyOS gaming meta | partial | `factory/images/bunos-gaming/gaming.packages`; never installed in any built rootfs |
| 11 | Handheld support: hhd, InputPlumber, TDP | Bazzite, ChimeraOS | missing | `inputplumber` only in `factory/arch/chimeraos/catalog.json`; `hhd` only named in `docs/bun-os/BAZZITE-FORKS.md` |
| 12 | Controller udev rules | Bazzite, CachyOS (`game-devices-udev`) | missing | no `steam-devices`/`game-devices-udev` in any package list |
| 13 | Decky-like plugin loader | Bazzite | missing | named in `BAZZITE-FORKS.md` only |
| 14 | Atomic or rollback updates | Bazzite (ostree), Omarchy (snapper + limine) | partial | btrfs `@`, `@home`, `@snapshots` layout and `snapper` installed in the image; no snapshot-on-update, no boot-menu rollback. Verity `/usr` design: `factory/usr/boot/repart.d` (not used) |
| 15 | First-boot setup | Bazzite (yafti), Omarchy installer | partial | `bunos-firstboot.service` (hostname, home seed); no wizard, locale, user or network prompt |
| 16 | GPU drivers: AMD/Intel Mesa, NVIDIA, supergfxctl | all three | partial | Mesa + `vulkan-swrast`/`vulkan-virtio` in the image; NVIDIA and `supergfxctl` only listed in `gaming.packages` |
| 17 | Flatpak | Bazzite | missing | only in upstream catalogs (`factory/arch/omarchy/catalog.json`) |
| 18 | Distrobox | Bazzite | missing | only in `factory/arch/chimeraos/catalog.json` |
| 19 | Installer ISO / live media | all three | missing | no archiso profile; the disk image is a raw dd-able disk |
| 20 | Update channel | all three | missing | local `[bunos]` repo is built in containers and never published |
| 21 | UEFI boot loader with boot menu | CachyOS (limine/grub), Omarchy (limine) | have | systemd-boot, 3 entries (gaming, desktop, rescue) in the image ESP |
| 22 | Serial console | n/a | have | `console=ttyS0,115200`, console getty on ttyS0 (root, empty password, dev only) |
| 23 | Network | all | have | NetworkManager + systemd-resolved enabled in the image |
| 24 | Bootable disk-image builder | n/a | have | `factory/images/bunos-disk/` (rootless container, no loop device) |

Count: have 8, partial 10, missing 6 (24 rows). Rows 6, 21, 22, 23 and the boot path of row 24 are only
`have` where section "Boot result" says they were seen.

Five biggest gaps: (1) no selected/qualified kernel, so no `linux-cachyos`, scx or v3 builds; (2) no
handheld/controller layer (hhd/InputPlumber/udev rules/TDP); (3) no installer or update channel, the
local `[bunos]` repo is never published; (4) the gaming package set was never installed into a bootable
rootfs (Steam, Proton, Heroic, NVIDIA); (5) no snapshot-driven rollback and no hardware (GPU) boot
qualification of the gamescope session.

## Disk image

Pieces, all under `factory/images/bunos-disk/`:

- `Containerfile`: `FROM bunos-omarchy:imported-rootfs`; `pacman -Syu`; adds gamescope, xwayland, lavapipe,
  virtio Vulkan, btrfs-progs, dosfstools, snapper; bundles the Bun Engine CLI (`bun build`) with the VPS Bun;
  creates user `bunos`; enables the session units; removes the Try-Omarchy Windows-launcher units from the boot
  path; rebuilds the initramfs without `autodetect`.
- `assemble.sh` / `assemble-inner.sh`: runs in an unprivileged container: copies the rootfs into a btrfs image
  (`mkfs.btrfs --rootdir`, zstd, subvolumes `@`, `@home`, `@snapshots`), builds a 512 MiB vfat ESP with systemd-boot
  and the Arch kernel/initramfs, writes a GPT (`sfdisk`) and joins them. No sudo, no loop device.
- `run-qemu.sh`: OVMF + virtio-gpu + serial log + monitor socket for `screendump`.

Sessions: `bunos-session.service` (tty1, PAM login, `Restart=always`, replaces getty) runs
`bunos-session-select`, which starts `bunos-gamescope-session` (default) or `uwsm start Hyprland` according
to the boot entry (`bunos.session=` on the kernel command line) or `bunos-session switch`.

The empty root password on the serial console and the `bunos` NOPASSWD sudo rule are development-only and must be removed from a
release image. The packages are not signed by a Bun OS key and the rootfs is not an immutable lock.

## Boot result

Image: `/home/ubuntu/bun-os-disk/work/bunos-disk.img` on the VPS (not committed): 16645095424 bytes sparse
(about 3.5 GiB used; ESP 512 MiB + 15 GiB btrfs), sha256
`2a01553b7e5164157e3ecf95b418f9b2a765c994a245da7512ed32ea187d2f1c`. Booted with OVMF under QEMU TCG
(`run-qemu.sh`, image copied to tmpfs because the /home disk was saturated by other jobs).

Seen booting:

- OVMF starts systemd-boot with the three entries; kernel 7.2.9-arch1-1 and the initramfs mount the btrfs root
  (`@`, `@home`, `@snapshots` listed by `btrfs subvolume list`), the ESP mounts on `/boot`.
- systemd reaches `running` with no failed units; NetworkManager gets 10.0.2.15 by DHCP; a root login works on the
  serial console (empty password, development only).
- `bunos-session.service` starts as `bunos` and selects the gaming session. gamescope 3.16.31 starts, then fails with
  "vulkan: not a valid physical device" (it rejects llvmpipe), as expected without a GPU. After two quick failures the
  selector logs "falling back to the desktop session" and starts Hyprland through uwsm.
- Omarchy's Hyprland desktop runs on virtio-gpu with llvmpipe at 1280x800: see `real-os-desktop.png` (Omarchy bar with
  workspaces, clock, tray; empty workspace). Hyprland needed the 600 s `wayland-wm@` timeout drop-in under TCG.

Not seen or not working:

- The gamescope session and the Bun Engine library were never displayed: no GPU on the VPS, so only the unit start and the
  gamescope failure are verified. The Bun Engine frontend HTTP server was verified separately on the host only
  (HTTP 200), not inside the image.
- `bunos-session switch` was not exercised end to end; the desktop was not interacted with.
- KVM was unavailable (`ubuntu` is not in `kvm`); everything ran under TCG and is slow.
- Known defect: the ESP is mounted on `/boot` while the loader entries point at `/bunos/vmlinuz-linux`, so a pacman
  kernel update would not reach the boot entries. Also no growfs, no Secure Boot, no linux-cachyos.

## Next steps

1. Boot on a real GPU (KVM + virtio-gpu GL or a GPU host) to qualify gamescope and the Bun Engine library session; package
   `bun-engine` properly instead of the bundled CLI.
2. Select and qualify the CachyOS kernel (linux-cachyos, scx) and enable the CachyOS repositories in this image; fix the
   ESP/kernel update path (UKI or entries under `/boot`) and add snapper rollback entries.
3. Add the handheld layer (hhd/InputPlumber, controller udev rules, TDP), first-boot wizard, then an installer image and a
   published update channel.
