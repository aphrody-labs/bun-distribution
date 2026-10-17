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

## Steam client and downloads

- `steam.sh` restarts the VPS Steam client in `bun-os-gaming.slice` on Xvfb `:99` with `-silent`
  (the software-rendered client UI otherwise costs ~1.5 cores), unthrottled downloads,
  `steam_dev.cfg` (HTTP/1.1 chunk fetches, more CDN connections), no background Vulkan shader
  processing (pointless on llvmpipe), and Proton Experimental for every Windows title
  (`CompatToolMapping`, `STEAM_COMPAT` overrides per app id). It signs in through the session the
  client already holds; it never handles credentials. The library is `/games/SteamLibrary`
  (`~/.steam/steam/steamapps` links there).
- `lancache.sh` runs the Bun LAN cache (`packages/bun-steam/src/lancache.ts`): Steam sends depot
  chunks to `lancache.steamcontent.com` when it resolves to a private address, so the name is
  pinned to `10.255.77.77` and nft-redirected to the proxy on port 8099 (nginx owns `*:80`).
  Misses are fetched from Valve's CDN through public DNS and cached content-addressed under
  `/games/cache/steam-lancache`; `GET /_lancache/audit` (or `bun lancache.ts audit`) returns the
  JSON audit. Measured on a re-download of app 454650: 216/216 chunks served from cache on the
  second pass, 0 errors over 808 requests.
