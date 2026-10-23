<!-- SPDX-License-Identifier: Apache-2.0 -->
# Bazzite and its dependencies

Bazzite (`ublue-os/bazzite`, Fedora atomic, gaming) is forked into `aphrody-labs` as an external
pinned owner, like the other imported OS sources: nothing is merged into the Bun OS Arch factory
and upstream licenses and histories stay intact. The forks track the default branch only.

## Forked (2026-10-22)

| Fork | Upstream | Role |
| --- | --- | --- |
| `bazzite` | `ublue-os/bazzite` | the image: Containerfile, system files, ujust recipes |
| `main` | `ublue-os/main` | base image (`kinoite-main`) |
| `akmods` | `ublue-os/akmods` | kernel module images (akmods, akmods-extra, akmods-nvidia) |
| `brew` | `ublue-os/brew` | Homebrew layer copied into the image |
| `packages` | `ublue-os/packages` | COPR `ublue-os/packages` |
| `uupd` | `ublue-os/uupd` | update daemon |
| `yafti-gtk` | `ublue-os/yafti-gtk` | first-boot installer |
| `bazzite-firmware-nonfree` | `ublue-os/bazzite-firmware-nonfree` | `firmware` submodule |
| `bazzite-logomenu`, `bazzite-cariboublocker` | `ublue-os/...` | GNOME extension submodules |
| `toolboxes` | `ublue-os/toolboxes` | toolbox images |
| `blur-my-shell`, `compiz-windows-effect`, `compiz-alike-magic-lamp-effect`, `hotedge`, `restartto`, `gnome-shell-extension-appindicator`, `Burn-My-Windows`, `Desktop-Cube`, `gnome-shell-extension-caffeine`, `gnome-shell-extension-tdp-control`, `gnome-add-to-steam`, `bazaar-companion` | third-party | the other `.gitmodules` entries |

## Forked (2026-10-23): runtime upstreams

The projects the image downloads at build or install time, forked so Bun OS can patch and pin them:

| Fork | Upstream | Role |
| --- | --- | --- |
| `hhd`, `adjustor` | `hhd-dev/...` | Handheld Daemon: controller emulation, TDP |
| `decky-loader` | `SteamDeckHomebrew/decky-loader` | Steam Game Mode plugin loader |
| `LACT` | `ilya-zlobintsev/LACT` | GPU control |
| `MangoHud` | `flightlessmango/MangoHud` | performance overlay |
| `topgrade` | `topgrade-rs/topgrade` | updater front end |
| `distrobox` | `89luca89/distrobox` | containers |
| `Flatseal` | `tchx84/Flatseal` | Flatpak permissions |
| `xone` | `medusalix/xone` | Xbox controller driver |
| `RyzenAdj` | `FlyGoat/RyzenAdj` | AMD power limits |
| `extest` | `ublue-os/extest` | Steam Input X11 shim |

## Forked (2026-10-23): the kernel and gaming stack of the Open Gaming Collective

Bazzite no longer builds `kernel-bazzite`: its Containerfile installs the `ogc` kernel flavor
(`KERNEL_VERSION` 7.0.9-ogc3.2), whose RPMs `akmods/fetch-kernel.sh` copies from
`ghcr.io/opengamingcollective/kernel-packages-fedora`. The Open Gaming Collective sources are forked:

| Fork | Upstream | Role |
| --- | --- | --- |
| `ogc-linux` | `OpenGamingCollective/linux` | the kernel source |
| `kernel-packages`, `kernel-configurator` | `OpenGamingCollective/...` | kernel RPM packaging and configuration |
| `ogc-arch-packaging` | `OpenGamingCollective/ogc-arch-packaging` | the same stack packaged for Arch |
| `ogc-gamescope`, `gamescope-builds`, `gamescope-session`, `gamescope-session-steam`, `ScopeBuddy` | `OpenGamingCollective/...` | Gamescope and the Steam session |
| `mesa`, `wireplumber`, `uresourced-dmemcg` | `OpenGamingCollective/...` | graphics, audio and memory-cgroup patches |
| `steamos-manager`, `asusctl`, `cardwire`, `linux-cec`, `xonedo`, `plasma-applet-tdp-control` | `OpenGamingCollective/...` | handheld, laptop, HDMI-CEC, controller and TDP tools |

`ogc-gamescope` and `ogc-linux` carry the prefix because `aphrody-labs/gamescope` and `aphrody-labs/linux` already
fork other upstreams.

## Not forked

- `ublue-os/config` and `ublue-os/nvidia`: archived upstream.
- `bazzite-org/kernel-bazzite`: retired upstream (not found under `bazzite-org`, `ublue-os` or `hhd-dev`); the
  Open Gaming Collective kernel above replaces it.
- Open Gaming Collective organization repositories (`opengamingcollective.org`, `ogc-bot`, `ogc-vouch`,
  `organization-governance`) and the development branch fork `linux-unstable`.
- COPR repositories (`sentry/kernel-fsync`, `ublue-os/bazzite`, `ublue-os/staging`, ...): package repositories,
  not Git sources.

## Done and next

- The `.gitmodules` of the `bazzite` fork points at the `aphrody-labs` forks (15 entries, commit `9becf92`).
  The pinned submodule commits are the upstream ones and were not re-checked against each fork.
- Still upstream: the `ghcr.io/ublue-os/*` image references in the Containerfile (published upstream images; no
  Bun OS image exists yet) and the COPR repositories. No image was built (builds run on the VPS only).
