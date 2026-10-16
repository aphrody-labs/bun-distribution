---
name: arch-linux
description: Administer and package for Arch Linux, CachyOS and Omarchy (pacman, AUR, makepkg/PKGBUILD, namcap, archinstall, systemd/journal, Hyprland). Use for any Arch-family system question, package lookup, PKGBUILD authoring or review, or service troubleshooting.
---

# Arch Linux, CachyOS and Omarchy

Ground every answer in the Arch Wiki or the Omarchy manual. The `bun-arch-mcp`
MCP server provides the tools below; cite the page title you used.

## Lookup order

1. `arch_wiki_search` / `omarchy_manual_search`, then `docs_read` on the best hit.
2. Official packages: `arch_package_search`; AUR: `aur_search`, `aur_info`,
   `aur_pkgbuild`. Read an AUR PKGBUILD before recommending it.
3. Live state (local Arch or `ARCH_MCP_HOST`): `pacman_query`, `systemd_query`,
   `hyprctl_query`. These are read-only; propose mutating commands to the user
   instead of running them.

## pacman

- Full upgrades only: `pacman -Syu`; never `pacman -Sy <pkg>` (partial upgrade).
- Ownership `-Qo FILE`, file search `-F`, orphans `-Qdtq`, foreign `-Qm`,
  integrity `-Qkk`. Package caches: `paccache -rk2` (pacman-contrib).
- Handle `.pacnew`/`.pacsave` with `pacdiff`. Read archlinux.org news before
  upgrades requiring manual intervention.
- CachyOS adds `cachyos*` repositories (x86-64-v3/v4 builds) and `linux-cachyos`
  kernels; keep `cachyos-keyring` and `cachyos-mirrorlist` installed.

## PKGBUILD and makepkg

- Required: `pkgname pkgver pkgrel arch license` (SPDX identifiers), `pkgdesc`,
  `url`, checksums for every `source` entry (`updpkgsums`).
- Build as a regular user with `makepkg -si`; never use `sudo` in a PKGBUILD.
  Quote `"$srcdir"` and `"$pkgdir"`; install into `"$pkgdir"` only.
- Generate `.SRCINFO` with `makepkg --printsrcinfo > .SRCINFO` before AUR pushes.
- Verify with `pkgbuild_lint` (static checks plus `namcap`), then
  `namcap *.pkg.tar.zst`; build clean with `extra-x86_64-build` (devtools).

## systemd

- Diagnose with `systemctl status UNIT`, `systemctl --failed`,
  `journalctl -u UNIT -b -p warning`. User units: `--user`.
- Overrides go in `systemctl edit UNIT` drop-ins, never in `/usr/lib/systemd`.

## Omarchy and Hyprland

- Omarchy ships its configs under `~/.local/share/omarchy` and user overrides
  in `~/.config/hypr`, `~/.config/waybar`; change user files, not the shared tree.
- Use the `omarchy-*` commands (theme, update, refresh) described in the manual.
- Inspect the compositor with `hyprctl_query` (`clients`, `monitors`,
  `configerrors`); reload with `hyprctl reload` after config edits.

## archinstall

- `archinstall --config user_configuration.json --creds user_credentials.json`
  for reproducible installs; keep credentials files out of version control.
