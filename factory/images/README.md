# Bun OS container images

`bun factory image plan|fetch|build|status <name> [--target T] [--host HOST] [--job ID]`

Pins (versions and sha256) live in `manifest.json`; `fetch` downloads and verifies them into
`~/.local/share/bun-os/sources` (outside the repository). Containerfiles re-verify every download with
`ADD --checksum`. `build` stages the context on the Linux Docker host from the manifest (`vps`), starts a
bounded `nohup timeout` build and returns a job id; `status` reports tags, sizes and rootfs artifacts.
Images are tagged on that host only and never pushed.

| Image          | Targets                                                                | Content                                                                                                                                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bunos-gaming` | `gaming` (image), `emulation` (image), `bootable` (image + rootfs tar) | Arch, CachyOS repositories, Omarchy (Hyprland/Wayland), Steam, steamcmd, Proton-CachyOS/GE, Wine-staging, DXVK, VKD3D-Proton, Vulkan + lib32, gamescope, gamemode, MangoHud, Lutris, Heroic, umu-launcher, NVIDIA userspace and container toolkit, solaar, piper/libratbag, logiops, asusctl, supergfxctl, rog-control-center, Bun |
| `bunos-alpine` | `runtime` (Bun.serve), `edge` (compiled cache/CDN proxy)               | Alpine + musl Bun, tini, non-root UID 10001, healthcheck, no package manager, amd64/arm64                                                                                                                                                                                                                                          |
| `bunos-ubuntu` | `desktop` (image), `bootable` (image + rootfs tar)                     | Ubuntu 26.10 base, GNOME, COSMIC (packages available in the archive), Bun, mainline 7.3 kernel in `bootable`                                                                                                                                                                                                                       |

`bunos-gaming` reuses the `/usr` factory (`factory/usr/manifest.json`, gaming composition): its generated
`pacman.conf` and package set, plus the Omarchy stable repository and key. Packages missing from the
repositories are built from the AUR; any remaining gaps are listed in `/usr/share/bun-os/missing-packages.txt`.

## Kernel and drivers

A container shares the host kernel. `linux-cachyos`, the NVIDIA kernel modules, `supergfxctl`/`asusctl`
daemons and the mainline Ubuntu kernel only take effect in the `bootable` rootfs (installed to a disk or
turned into an image by the `/usr` factory) or on the host itself. In a container, NVIDIA needs the host
driver plus `nvidia-container-toolkit` (`--gpus all`), and input devices need `--device` passthrough.
