# CachyOS suite

Bun Engine pins one CachyOS-based Linux gaming suite:

| Owner                                   | Canonical path                          | Upstream branch |
| --------------------------------------- | --------------------------------------- | --------------- |
| `aphrody-labs/linux-cachyos`            | `src/kernel/linux`                      | `master`        |
| `aphrody-labs/kernel-patches`           | `src/kernel/patches`                    | `master`        |
| `aphrody-labs/proton-cachyos`           | `src/compat/proton`                     | `cachyos_main`  |
| `aphrody-labs/wine-cachyos`             | `src/compat/wine`                       | `proton_9.0`    |
| `aphrody-labs/chwd`                     | `src/platform/chwd`                     | `master`        |
| `aphrody-labs/pkg-manage-util`          | `src/platform/pkg-manage-util`          | `develop`       |
| `aphrody-labs/open-gpu-kernel-modules`  | `src/drivers/nvidia-open`               | `560-cachyos`   |
| `aphrody-labs/steamos-nvidia-installer` | `src/platform/steamos-nvidia-installer` | `main`          |
| `aphrody-labs/wiki`                     | `docs/vendor/cachyos`                   | `next`          |

The kernel source replaces the former generic Linux fork. The patch repository
is its versioned patch owner. Proton-CachyOS replaces the generic Proton layer
and composes its Wine, DXVK and vkd3d-proton dependencies. Wine-CachyOS is kept
as the source owner used for direct Wine work; it is not a second runtime
selected beside Proton.

CHWD owns Rust-based Linux hardware detection and driver profile selection. The
package management utility owns pacman package cloning and clean chroot builds.
The CachyOS NVIDIA fork replaces the generic NVIDIA gitlink and remains paired
with the matching user-space driver and GSP firmware release.
The SteamOS NVIDIA installer owns recovery-image assembly and driver persistence
across SteamOS A/B updates. Its privileged Linux image build remains isolated
from the Bun Engine runtime and must run only against an explicit recovery image.
The pinned CachyOS wiki is the suite's operational documentation source; Bun
Engine links to it instead of duplicating its hardware and system guidance.

All owners are shallow gitlinks. Their upstream build systems stay intact;
the root Bun workspace owns orchestration, provenance and qualification. Kernel,
Proton and Wine production builds require a qualified native Linux or container
host and are not claimed by the native Windows source gates.
