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

## Not forked

- `ublue-os/config` and `ublue-os/nvidia`: archived upstream.
- `bazzite-org/kernel-bazzite` (named in the build files): not found under `bazzite-org` or
  `ublue-os`; private, removed or renamed. Re-check before building a kernel.
- Runtime upstreams fetched at build or install time (`hhd`, `decky-loader`, `LACT`, `MangoHud`,
  `topgrade`, `distrobox`, `Flatseal`, `xone`, `RyzenAdj`, `extest`, and similar) and COPR
  repositories (`sentry/kernel-fsync`, `ublue-os/bazzite`, `ublue-os/staging`, ...): third-party
  projects that the image downloads, not sources it builds. Fork one only when patching it.

## Next

The forks still point at upstream: `.gitmodules` of the `bazzite` fork and the `ghcr.io/ublue-os/*`
image references in its Containerfile have not been rewritten, and no image was built (builds run
on the VPS only). Rewriting them is a separate, deliberate change.
