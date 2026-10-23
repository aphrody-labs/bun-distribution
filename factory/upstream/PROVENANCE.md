<!-- SPDX-License-Identifier: MIT -->

# Upstream files taken verbatim

Everything below this directory is a byte-identical copy of a file in an upstream project, kept with that
project's license text next to it. Nothing here is edited; Bun OS-specific behaviour lives in
`factory/images/bunos-disk/overlay/` (drop-ins and overrides) so these files can be refreshed by copying again.
Compare with `git hash-object --no-filters FILE` against the blob id in the upstream repository.
Each file was reviewed before import; the reasons are in `docs/bun-os/ABSORBED-UPSTREAM.md`.

Sources are the `aphrody-labs` forks. For every file the fork blob id equals the blob id in the upstream
repository's default branch at import time (checked 2026-10-23 with `gh api .../contents/PATH`).

| Directory                      | Upstream                                                                                                                                                       | Fork commit                                  | License                                      | Files (upstream path -> here)                                                                                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cachyos-repo/`                | CachyOS `cachyos-repo.tar.xz` from `https://mirror.cachyos.org/cachyos-repo.tar.xz`, sha256 `a1e3a74bdd12c10ac7317079e3e8c8e7d5557d818e4d4021364005a336b6afdc` | n/a (mirror tarball, no commit id published) | GPL-2.0-or-later (`LICENSE`, file headers)   | `cachyos-repo/install-repo.awk`, `cachyos-repo/LICENSE`                                                                                                                                                                                             |
| `omarchy/`                     | `omacom/omarchy` (fork `aphrody-labs/omarchy`, branch `quattro`)                                                                                               | `51bfd1dbaa1b5f790e19623faf2745945d40c796`   | MIT, (c) David Heinemeier Hansson            | `etc/limine-entry-tool.d/omarchy-defaults.conf`, `etc/limine-entry-tool.d/omarchy-uki.conf`, `default/limine/default.conf`, `default/snapper/root`, `install/config/snapper.sh`, `LICENSE` (same paths)                                             |
| `bazzite/`                     | `ublue-os/bazzite` (fork `aphrody-labs/bazzite`, branch `main`)                                                                                                | `9becf925258b15d70e0faa7d0e3e3a2a42daacf7`   | Apache-2.0                                   | see the table below, `LICENSE`                                                                                                                                                                                                                      |
| `chimeraos-gamescope-session/` | `ChimeraOS/gamescope-session` (fork `aphrody-labs/chimeraos-gamescope-session`, branch `main`)                                                                 | `73d2da84ace7f41006a0f85bd2fdb19ef593a464`   | MIT, (c) 2020-2023 Joaquin Ignacio Aramendia | `usr/bin/gamescope-session-plus`, `usr/bin/export-gpu`, `usr/lib/systemd/user/gamescope-session-plus@.service`, `usr/share/gamescope-session-plus/gamescope-session-plus`, `usr/share/gamescope-session-plus/device-quirks`, `LICENSE` (same paths) |

Bazzite files (upstream path under `system_files/` -> here):

| Upstream                                                           | Here                                                           |
| ------------------------------------------------------------------ | -------------------------------------------------------------- |
| `desktop/shared/usr/lib/sysctl.d/60-kernel.conf`                   | `bazzite/usr/lib/sysctl.d/60-kernel.conf`                      |
| `desktop/shared/usr/lib/sysctl.d/70-gaming.conf`                   | `bazzite/usr/lib/sysctl.d/70-gaming.conf`                      |
| `desktop/shared/usr/lib/sysctl.d/75-networking.conf`               | `bazzite/usr/lib/sysctl.d/75-networking.conf`                  |
| `desktop/shared/usr/lib/sysctl.d/80-inotify.conf`                  | `bazzite/usr/lib/sysctl.d/80-inotify.conf`                     |
| `deck/shared/usr/lib/udev/rules.d/40-backlights.rules`             | `bazzite/usr/lib/udev/rules.d/40-backlights.rules`             |
| `deck/shared/usr/lib/udev/rules.d/50-ally-x-controller.rules`      | `bazzite/usr/lib/udev/rules.d/50-ally-x-controller.rules`      |
| `deck/shared/usr/lib/udev/rules.d/99-steamcontroller-wakeup.rules` | `bazzite/usr/lib/udev/rules.d/99-steamcontroller-wakeup.rules` |

Not files but packages: hhd, InputPlumber, steamos-manager, scx-scheds, scx-tools, cachyos-settings, limine,
limine-mkinitcpio-hook, limine-snapper-sync, snap-pac, snapper, linux-cachyos and the CachyOS gaming metas are
installed from the signed CachyOS and Arch repositories (see `docs/bun-os/ABSORBED-UPSTREAM.md`); their own
udev rules, hwdb, D-Bus policies and units come with them and are not copied here.

ChimeraOS FRZR (atomic deployer) is not imported and not enabled: see `factory/arch/chimeraos/README.md`.
