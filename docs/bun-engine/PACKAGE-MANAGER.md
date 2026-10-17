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
