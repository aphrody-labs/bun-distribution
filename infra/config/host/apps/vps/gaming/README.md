# VPS gaming host

`setup.sh` turns the VPS into a Steam/Epic host streamed to the workstation with Steam Remote
Play over the `wg1` mesh (VPS `10.200.77.1`, workstation `10.200.77.4`; `aphrody-wg-mesh-all`
already allows the whole mesh, including the Remote Play discovery and stream ports
27031-27037). Run it as `ubuntu` on the VPS; it is idempotent and pins every version at the top.

| Layer | Owner on the VPS |
| --- | --- |
| Games volume | `/games`: sparse 180 GiB loop image on `sda` (`/var/lib/aphrody-games/games.img`), ext4 with casefold (`chattr +F` on `SteamLibrary`, `heroic`, `prefixes`), `noatime,lazytime`. `sda` reads ~2.1 GB/s against ~15 MB/s for the btrfs pool on `sdb`/`sdc` that holds `/home`. |
| Steam | Ubuntu `steam-installer`; library `/games/SteamLibrary` |
| Proton | Valve Proton (installed by Steam) and `GE-Proton` in `/games/tools/compatibilitytools.d` (`STEAM_EXTRA_COMPAT_TOOLS_PATHS`) |
| Anti-cheat | Proton EasyAntiCheat runtime (Steam app 1826330) and BattlEye runtime (1161040) in `/games/tools/runtimes`, exported as `PROTON_EAC_RUNTIME` / `PROTON_BATTLEYE_RUNTIME` |
| Direct3D | DXVK (D3D8-11) in `/opt/dxvk/current`, vkd3d-proton (D3D12) in `/opt/vkd3d-proton/current`; Proton ships its own copies |
| Vulkan | Mesa lavapipe (the VPS has no GPU: KVM, Cirrus VGA) and the LunarG Vulkan SDK in `/opt/vulkan-sdk/current` (`/etc/profile.d/vulkan-sdk.sh`) |
| Epic | Heroic with its bundled `legendary` (`/usr/local/bin/legendary`, games in `/games/heroic`), the Epic Games Launcher in the Proton prefix `/games/prefixes/epic`, umu-launcher for Proton outside Steam |
| Session | gamescope headless running Steam Big Picture: user unit `bun-os-gamescope.service` (not enabled while another Steam client runs under `ubuntu`) |

Compositor choice: gamescope is the Wayland compositor Steam itself drives (SteamOS gaming mode),
with a headless backend and PipeWire capture for Remote Play. The Rust compositors of Bun OS
(`cosmic-comp` on Smithay, COSMIC Desktop composition) need a DRM device or a parent display and
have no headless backend, so they stay the desktop session on GPU hosts.

Rendering is CPU-only (llvmpipe/lavapipe on 12 Haswell cores): 2D, indie and older 3D titles run;
modern D3D12 titles will not reach playable frame rates. Remote Play encodes in software (x264).

## Manual steps (accounts)

Logins are typed by the owner only:

- Steam: connect to the VPS desktop (`aphrody infra remote` viewer, Xvfb `:99`) and sign in, or
  approve the QR code with the Steam mobile app. Then add `/games/SteamLibrary` as the default
  library (Settings > Storage).
- Epic: `legendary auth` prints the login URL; paste the returned `authorizationCode` with
  `legendary auth --code <code>`. Heroic shares the same session. `legendary eos-overlay install`
  then installs the Epic Online Services overlay.
- Remote Play: sign in to the same Steam account on the workstation; the VPS appears under
  Steam > Settings > Remote Play. Enable "Allow direct connection (IP sharing)" on both clients if
  the LAN broadcast over `wg1` is not discovered.
