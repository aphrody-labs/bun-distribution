# Azahar community tooling

`bun-engine 3ds patches|addons|homebrew` manage community content against the isolated Azahar user
directory (`usr/etc/3ds/azahar-user`, override with `AZAHAR_USER_DIR`; see [CIA.md](CIA.md)). The
code is `packages/bun-engine/src/ctr/community.ts`, the pinned catalog
`packages/bun-engine/plugins/3ds/community.json`.

Nothing is downloaded by these commands, and no keys, firmware, ROM content or assets are
committed. Sources are either already vendored here or pointers in documentation.

## User directory layout Azahar reads

| Path under the user directory | Content |
| --- | --- |
| `sysdata/` | `keys.txt`, `seeddb.bin` (owner supplied, see CIA.md) |
| `load/mods/<TID>/exefs/code.ips`, `code.bps` | Code patch applied to `.code` at load (also `load/mods/<TID>/code.ips`) |
| `load/mods/<TID>/romfs/<path>` | RomFS file replacement; `<path>.ips` or `<path>.bps` patches the original file |
| `load/mods/<TID>/exheader.bin` | ExHeader override |
| `load/textures/<TID>/` | Custom texture pack (files named by texture hash) |
| `cheats/<TID>.txt` | Gateway-format cheats: `[Name]` followed by `AAAAAAAA BBBBBBBB` lines |
| `sdmc/3ds/<name>/<name>.3dsx` | Homebrew started from the Homebrew Launcher |
| `scripts/` | Add-on scripts |

`<TID>` is the 16 hex digit title id in upper case. Luma-style `luma/titles/<TID>/code.ips` is also
honoured by Azahar.

## Commands

```text
bun-engine 3ds patches list [tid]
bun-engine 3ds patches apply <tid> <file> [--romfs <path>] [--force|--append]
bun-engine 3ds addons list
bun-engine 3ds addons install <id> [--force]
bun-engine 3ds homebrew build [dir]
bun-engine 3ds homebrew install <app.3dsx>
bun-engine 3ds homebrew run <app.3dsx|.cia> [--azahar] [engine args]
```

* `patches apply` classifies the file by content (IPS `PATCH`, BPS `BPS1`, or a Gateway cheat file)
  and places it in the right path. IPS and BPS go to `exefs/code.*`, or with `--romfs a/b.bin` to
  `romfs/a/b.bin.ips`. An existing file is never overwritten without `--force`; cheat files can be
  merged with `--append`. Every placement is recorded with its SHA-256 in
  `community.lock.json` inside the user directory.
* `addons install` copies a catalogued add-on only when the vendored source still matches the
  SHA-256 pinned in `community.json`. The first add-on is `azahar-rpc`, the Python client for the
  Azahar RPC server (`vendor/azahar/dist/scripting/AzaharRPC.py`).
* `homebrew build` runs `make` with `DEVKITPRO`/`DEVKITARM` set (`/opt/devkitpro` on the VPS, or the
  `DEVKITPRO` environment variable). The default project is the starter in
  `packages/iecode-cpp/homebrew/3ds`; any directory with a devkitARM Makefile works. `run` starts
  the image in Zakuro through `bun-engine run 3ds` (headless, 60 frames by default), or in the
  Azahar frontend with `--azahar` (`AZAHAR` or the one installed under `usr/lib/azahar`).

## Absorbed sources

Pinned submodules, forked under `aphrody-labs` with upstream licences intact:

| Submodule | Upstream | Role |
| --- | --- | --- |
| `vendor/3ds-hbmenu` | devkitPro/3ds-hbmenu | Homebrew Launcher menu |
| `vendor/checkpoint` | BernardoGiordano/Checkpoint | Save management |
| `vendor/fbi` | Steveice10/FBI (archived) | Title manager |

Already present: `vendor/libctru`, `vendor/citro3d`, `vendor/citro2d`, `vendor/ctru-rs`,
`vendor/cargo-3ds`, `vendor/calico`.

Pointers only, never vendored: GodMode9 (https://github.com/d0k3/GodMode9) dumps and decrypts on
a console you own. Public cheat databases found on GitHub carry no licence, so none is absorbed;
write or supply cheat files yourself and place them with `patches apply`.
