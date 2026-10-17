# BEP package manager

`bep` (**Bun Engine Packages**) is the multi-console package manager. It works like `bun install`:
dependencies are declared in `package.json`, resolved into a lockfile, and installed from a store.

| Package | Source | Pinned by |
| --- | --- | --- |
| core | the console catalog (`packages/bun-engine/plugins/consoles/manifest.json`) | its gitlink commit |
| firmware | a dump the user imports | SHA-256 in the content-addressed store |
| rom | a game image the user imports | SHA-256 in the content-addressed store |

```sh
bep init                                   # adds "bunEngine" to package.json
bep add dust melonds                       # cores from the catalog
bep add firmware nintendo-ds-dsi bios7.bin # user-supplied dumps only
bep add rom nintendo-ds-dsi game.nds mygame
bep install --frozen-lockfile              # CI: fail if bep.lock would change
bep install --sources                      # also check out the pinned core sources
bep ls | bep why melonds | bep info nintendo-ds-dsi | bep search psx
bep outdated | bep update melonds          # compare/move pins against each fork head
bep cache | bep cache prune                # store paths; drop images no lock references
bep run nds mygame                         # locked names resolve to store files
bep consoles | bep firmware:list
bep bun install                            # Bun's own npm package manager
```

`package.json`:

```json
{
  "bunEngine": {
    "cores": ["dust"],
    "firmware": { "nintendo-ds-dsi": ["<sha256>"] },
    "roms": { "mygame": { "console": "nintendo-ds-dsi", "sha256": "<sha256>" } }
  }
}
```

`bep.lock` records each core's console, commit, sources, license and firmware policy, and each
image's store manifest. The store defaults to `%LOCALAPPDATA%\Aphrody\bun-engine` (`firmware/`,
`roms/`); `BUN_ENGINE_FIRMWARE_STORE` overrides the firmware root. No firmware, BIOS or game is
ever downloaded or packaged.

`bep run` and `bun-engine run` start the native engine from `BUN_ENGINE_NATIVE`,
`/usr/lib/bun-engine/bun-engine` (Arch package) or a workspace build, and build it otherwise.

## Frontend

`bun-engine frontend` is the single entry point for playing: it serves `web/app` through
`Bun.serve` (the same server as `bun-engine web`) and opens it as an app window in the installed
Edge or Chrome (`--no-window` serves only, `--screenshot <png>` renders it headless through
`Bun.WebView`). The UI is keyboard and gamepad navigable (spatial focus; A launch, B back,
X favorite, Y check, LB/RB tabs, Start sets the focused route as the system default).

| Screen | Content |
| --- | --- |
| Library | systems from `plugins/consoles/systems.json`, then games with libretro-database metadata and launch routes |
| BIOS | native machine firmware (free OpenBIOS, Normmatt GBA BIOS), `bep bios` MD5 report for installed cores, the firmware store |
| Installer | `bep add bin`, `bep add libretro`, `bep update`, `bep remove`, `bep install`, mirror index and probe, as background jobs |
| Sources | the bep project, the ROM store, the free ROM packs (`bep roms`) and user folders |

The library lives in `usr/var/lib/bep/library.db` (bun:sqlite). A scan reads the bep project
(`BEP_PROJECT`, default `usr/var/lib/bep/library`), the content-addressed ROM store, the free ROM
packs and every added folder (a `<system>/` directory as on Recalbox, or an unambiguous
extension), hashes each file (CRC32, MD5, plus the headerless CRC for iNES) and matches it against
the No-Intro, Redump and homebrew DATs of `vendor/libretro-database`, checked out sparse when
missing. Unchanged files keep their hashes.

Each system routes a game to the native machine (`bun-engine run <machine>`, with the BIOS from
the firmware store), then to the bep-installed release emulator (`usr/lib/<id>`), then to RetroArch
with a libretro core (`usr/lib/libretro`; BIOS files matching core-info MD5s are linked into
`usr/share/bun-engine/system`). A per-system default and a per-game override are stored in the
library database.

```sh
bun-engine library scan | systems | games [system] | routes <system> | sources
bun-engine library add <dir> [system] | default <system> <route|->
bun-engine library launch <id|file> [--system s] [--route r] [--check] [--frames N]
bun-engine library check [system...]   # one bounded run per available route
```

`--check` runs a route bounded: native machines headless for `--frames` frames, release emulators
with their help/version arguments, RetroArch with `--max-frames`.
