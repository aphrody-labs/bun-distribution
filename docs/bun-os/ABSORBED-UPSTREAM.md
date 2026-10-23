<!-- SPDX-License-Identifier: MIT -->
# Upstream work absorbed into the Bun OS image (2026-10-23)

Owner direction: use the best of what exists instead of rewriting it. This file records, per component, what
the Bun OS images (`factory/images/bunos-disk`, `bunos-gaming`) now take from upstream, and what they leave.
Versions are what `pacman -Sp` resolved on the VPS on 2026-10-23 against the live CachyOS (`cachyos-v3`,
`cachyos-core-v3`, `cachyos-extra-v3`, `cachyos`) and Arch (`core`, `extra`, `multilib`) repositories; they move.
Files copied verbatim, with licenses and blob-level provenance, are listed in `factory/upstream/PROVENANCE.md`.

"Packaged" means installed from a signed pacman repository (nothing copied into this repository). "Verbatim"
means a byte-identical copy under `factory/upstream/`.

| Component | Upstream repo | Commit / version | License | What we took | What we did NOT take |
| --- | --- | --- | --- | --- | --- |
| CachyOS repositories | CachyOS `cachyos-repo.tar.xz` (mirror.cachyos.org) | tarball sha256 `a1e3a74bdd12...2c6afdc` (full value in PROVENANCE.md) | GPL-2.0-or-later | Verbatim `install-repo.awk` (inserts `cachyos-v3`, `cachyos-core-v3`, `cachyos-extra-v3`, `cachyos` before `[core]`); signing key `F3B607488DB35A47`, `cachyos-keyring`, the mirrorlists and CachyOS `pacman` (needed for the `x86_64_v3` architecture), installed the way upstream's script does | `cachyos-repo.sh` itself (interactive, pinned to old package versions, rewrites the host `/etc/pacman.conf`): replaced by a short non-interactive script, `factory/images/bunos-disk/cachyos-repo.sh`, that runs the same steps. The v4 and znver4 awk files: the image targets the x86-64-v3 baseline so it does not depend on the builder CPU |
| Kernel `linux-cachyos` (+ headers, nvidia-open) | `CachyOS/linux-cachyos` (`vendor/linux-cachyos`) | packaged: `linux-cachyos` 7.3.0-3 (v3 build; plain `cachyos` repo has 7.2.7-1) | GPL-2.0-only | Packaged kernel in `bootable.packages`; stock Arch `linux` and `linux-headers` removed from the disk image | Building the kernel from `vendor/cachyos-linux` / `cachyos-kernel-patches` ourselves (the future "own kernel" path). The factory's `kernelSelection` for the verity `/usr` image stays `blocked` until a boot receipt exists |
| sched-ext | `sched-ext/scx`, `sched-ext/scx-loader` | packaged: `scx-scheds` 1.1.4-1, `scx-tools` 1.1.3-1 | GPL-2.0-only | Packages; `scx_loader.service` enabled; `/etc/scx_loader/config.toml` (4 lines) selects `scx_lavd` + Gaming mode | `scx_manager` GUI, per-scheduler flag tuning |
| `cachyos-settings` | `CachyOS/CachyOS-Settings` | packaged: 1:1.4.1-1 | GPL (CachyOS) | Package: sysctl, zram-generator, ananicy-cpp rules, IO-scheduler and audio udev rules, THP tmpfiles | `game-performance` and DLSS swapper helpers (installed, not configured) |
| Handheld Daemon | `hhd-dev/hhd` | packaged: `hhd` 4.1.12-1 | LGPL-2.1-or-later | Package with its own `83-hhd.rules`, hwdb and units. `hhd@` stays disabled | Auto-enabling: hhd and InputPlumber both grab the input devices, so drop-ins make the units conflict (`overlay/etc/systemd/system/*/10-bunos.conf`) and InputPlumber is the enabled one. Which one is better per device is not decided |
| InputPlumber | `ShadowBlip/InputPlumber` (`vendor/inputplumber`) | packaged: 0.83.0-1.1 (cachyos-extra-v3) / 0.83.0-1 (extra) | GPL-3.0-only | Package with capability maps, udev autostart rules, D-Bus policy; `inputplumber.service` enabled | Writing our own capability maps |
| steamos-manager | Valve `steamos-manager` via the CachyOS repo | packaged: 26.4.1-2 | MIT | Package (TDP, GPU clock, brightness D-Bus API with per-device TOMLs) | `jupiter-hw-support`, `steamos-powerbuttond` and the `cachyos-handheld` meta (they pull KDE `plasma-login-manager` and SteamOS-only session units) |
| ChimeraOS `gamescope-session-plus` | `ChimeraOS/gamescope-session` | `73d2da84ace7` (verbatim) | MIT | Wrapper `gamescope-session-plus`, the user unit, `export-gpu`, `device-quirks` (handheld panel and orientation table), all verbatim. Bun OS adds only `sessions.d/bunos` (`CLIENTCMD="bun-engine frontend --session"`); the disk image's `bunos-gamescope-session` is now `exec gamescope-session-plus bunos`, replacing the hand-copied environment block | `gamescope-session-steam`, the Steam session definition (Steam is optional here), `50-disable-explicit-sync.lua`, ChimeraOS `chimera` and `frzr` (see below) |
| ChimeraOS FRZR / deployer | `ChimeraOS/frzr`, `ChimeraOS/chimeraos` | `vendor/frzr`, `vendor/chimeraos` | MIT | Nothing | FRZR atomic updater: not installed, not enabled, per `factory/arch/chimeraos/README.md` (needs per-file review and an owner decision) |
| ChimeraOS device quirks | `ChimeraOS/device-quirks` | `vendor/chimeraos-device-quirks` | MIT | The `device-quirks` fragment that gamescope-session-plus already sources | modprobe, sysctl, EDID and firmware files (per-device review pending) |
| Bazzite udev, sysctl | `ublue-os/bazzite` | `9becf925258b` (verbatim) | Apache-2.0 | sysctl `60-kernel` (split lock), `70-gaming` (`vm.max_map_count`), `75-networking` (BBR), `80-inotify`; udev `40-backlights`, `50-ally-x-controller` (ROG Ally X wake-up), `99-steamcontroller-wakeup` | `30-steamdeck.rules` (makes GPU/TDP sysfs world-writable; `jupiter-hw-support` covers the Deck), `99-powertargets.rules` and `50-wifi-sleep.rules` (need Bazzite-only units), `80-gpu-reset.rules` (restarts `sddm`), `60-schedulers.rules` (duplicates `cachyos-settings`), `65-memory.conf` (needs Bazzite's zram setup), `99-cec-bluetooth.rules`, `15-proton-nice.conf` (lives in `/etc/security/rules.d`, which pam_limits does not read, so it is inert), every polkit rule (they reference Bazzite `/usr/libexec` helpers). The Fedora/ostree build, `ujust` framework, yafti |
| Bazzite `ujust` recipes | `ublue-os/bazzite` `system_files/*/ublue-os/just/*.just` | `9becf925258b` | Apache-2.0 | Only the capabilities that map to pacman packages: Waydroid (`waydroid`), Distrobox (`distrobox`), Sunshine (`sunshine`) and Flatpak (`flatpak`) are in `gaming.packages` | The recipe files: they call `rpm-ostree`, `bootc`, Fedora COPR and ublue helper scripts that do not exist on Arch. A Bun OS justfile (`just` is in `extra`) is not written |
| Gaming stack | CachyOS `cachyos-gaming-meta`, `cachyos-gaming-applications`; Valve Steam; Heroic; Lutris; MangoHud; umu | packaged: metas 1:1.0.0-9 and 1.0.0-4, `steam` 1.0.0.87-3, `proton-cachyos-slr` 11.0.20261015-1, `wine-cachyos-opt`, `gamescope` 3.16.25-1 (cachyos) or 3.16.31-1 (extra), `heroic-games-launcher` 2.22.4-1, `lutris` 0.5.22-3, `umu-launcher`, `mangohud` 0.8.4 | Steam: Steam subscriber agreement (not redistributed by us); others GPL-3.0, MIT, BSD, LGPL | The two CachyOS metas (32-bit library closure, Proton, Wine, umu, protontricks, Heroic, Lutris, Goverlay, Faugus), lib32 Mesa/Vulkan for radeon and intel, lib32 NVIDIA userspace | AUR-only packages the old list named: `steamcmd`, `proton-ge-custom-bin`, `dxvk-bin`, `vkd3d-proton-bin`, `logiops` (DXVK and vkd3d-proton ship inside Proton). `supergfxctl` exists only in the Omarchy repo, so it is installed in the disk image and removed from the container list |
| Boot loader + kernel hooks | `limine-bootloader/limine`; `limine-entry-tool` (package `limine-mkinitcpio-hook`, gitlab.com/Zesko/limine-entry-tool), the loader Omarchy and CachyOS use | packaged: `limine` 12.9.3-2, `limine-mkinitcpio-hook` 1.40.0-1 | BSD-2-Clause; GPL-3.0 | Replaces the custom systemd-boot copy step. The ESP is `/boot`, kernels sit at the ESP root, and the package's pacman hooks (`80-limine-efi-deploy`, `limine-mkinitcpio-install/remove`) keep entries following kernel installs. Omarchy's `omarchy-defaults.conf`, `omarchy-uki.conf` and `default.conf` are verbatim; `zz-bunos.conf` overrides OS name, log level and boot order | systemd-boot/`kernel-install` (no snapshot menu exists for it), Secure Boot enrolment, and Omarchy's UKI mode: `omarchy-uki.conf` is kept in `factory/upstream` but not installed, because the UKI build (`ukify`) failed in the first boot test |
| Snapshots and rollback | `snapper`, `wesbarnett/snap-pac`, `limine-snapper-sync` (gitlab.com/Zesko) | packaged: 0.13.2-1.1, 3.0.1-3, 1.32.1-1 | GPL-2.0-only; GPL; GPL3 | Omarchy's `install/config/snapper.sh` and `default/snapper/root` verbatim (5 numbered snapshots, no timeline); `snap-pac` snapshots every pacman transaction; `limine-snapper-sync.service` adds one Limine entry per snapshot; layout is the existing `@`, `@home`, `@snapshots` | `grub-btrfs` (no GRUB here), `btrfs-assistant` GUI, Omarchy's `omarchy-refresh-limine` and snapshot front ends |
| Installer | `archinstall` (archlinux/archinstall) | packaged: `archinstall` 4.5-1 | GPL-3.0-only | `archinstall` as the installer engine: `factory/images/bunos-disk/installer/archinstall-bunos.json` (Limine, NetworkManager, snapper) parses with archinstall 4.5's own `ArchConfig.from_config`; one chroot step (`installer/bunos-installer-post`) adds the CachyOS repos and the package lists | A Bun OS installer UI. CachyOS Calamares (`cachyos-calamares-qt6` is not in the repositories) and the Omarchy installer (needs its own `omarchy-pkgs` repo and `install/*` tree) were not adopted: both assume their own disk layout. No installer ISO (archiso) is built |
| Omarchy desktop base | `omacom/omarchy` | Try-Omarchy 4.0.4 rootfs (unchanged) | MIT | Base rootfs, `/usr/share/omarchy` | Omarchy installer migrations |

## Update channel: how the `[bunos]` repository would be published

Nothing is published by this change; this is the procedure.

1. Build packages from `factory/bunos/pkgbuilds/*` in a clean Arch container (`factory/usr/builder.sh` does this and
   runs `repo-add -q bunos.db.tar.zst *.pkg.tar.zst`).
2. Sign every package and the database with a dedicated Bun OS release key (`gpg --detach-sign`, `repo-add --sign`);
   keep the private key in the protected secret store, never in Git.
3. Upload `bunos.db`, `bunos.files` and the packages to an HTTPS origin so that
   `https://<host>/bunos/os/x86_64/` serves them (`Server = https://<host>/$repo/os/$arch`).
4. Ship the public key as a `bunos-keyring` package inside the repository (`pacman-key --populate bunos`) and add to
   the image's `pacman.conf`, before `[core]`:

   ```
   [bunos]
   SigLevel = Required DatabaseOptional
   Server = https://<host>/$repo/os/$arch
   ```

5. Clients then follow Arch's own rolling update: `pacman -Syu`, with `snap-pac` taking the pre and post snapshots and
   `limine-snapper-sync` adding the rollback entry. Omarchy and CachyOS update the same way; no image re-flash.
6. The local `[bunos]` repo used in container builds (`COPY bunos-repo/`) stays unsigned and local.
