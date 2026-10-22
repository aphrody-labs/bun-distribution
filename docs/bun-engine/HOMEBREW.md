# Open homebrew for the Bun Engine showcase

Only open-source or freeware homebrew and our own captures are used: no console firmware, ROM dump,
commercial game or console-maker UI. The homebrew binaries are not stored in Git; the screenshots
in [screens/](screens/README.md) are captures of their own interfaces. Licences were read from the
upstream repositories (GitHub licence API) and the bundled licence files on 2026-10-22.

| System | Homebrew | Version | Licence | Source | Captured |
| --- | --- | --- | --- | --- | --- |
| NDS | GodMode9i (file manager) | 3.10.0 | GPL-3.0 | https://github.com/DS-Homebrew/GodMode9i | yes, desmume |
| 3DS | FBI (title manager) | 2.6.1 | MIT | https://github.com/Steveice10/FBI (fork `vendor/fbi`) | yes, azahar |
| GameCube | Swiss (loader, built-in menu) | r2119 | GPL-2.0 | https://github.com/emukidid/swiss-gc | yes, dolphin (see patch below) |
| Wii | Snes9x GX (SNES emulator front end) | 5.0.4 | Snes9x licence (non-commercial), no SPDX id | https://github.com/dborth/snes9xgx | yes, dolphin; licence unverified |
| GBA | gba-tests `ppu/hello.gba` | master | MIT | https://github.com/jsmolka/gba-tests (`vendor/rustboyadvance-ng/external/gba-tests`) | yes, mgba |
| NES | Lan Master by Shiru | 1.1 | Freeware; the title screen reads "PD2011 Shiru", no licence file | https://shiru.untergrund.net/software.shtml (bundled in `vendor/tetanes`) | yes, nestopia |
| SNES | none | | | | no: no open SNES homebrew was fetched; the Wii capture shows Snes9x GX only |

Other open homebrew already catalogued in `packages/bun-engine/plugins/consoles/roms.json` and not
captured here: FBI.cia (MIT), nx-hbmenu (ISC, Switch), the other TetaNES bundled NES games
(freeware, per-game notes next to each ROM), the gba-tests suite (MIT).

## Caveats

- Snes9x GX has no SPDX licence on GitHub; Snes9x itself is non-commercial. Its screenshot also
  shows a drawn SNES console in the application theme whose artwork provenance was not checked.
  Drop `screens/wii-snes9xgx.png` if the project ever ships commercially.
- Lan Master is freeware without an explicit licence text. Only a screenshot is used, the ROM
  stays in the vendor tree and is not copied into the repository.
- Swiss r2119 needs the one-line Dolphin core patch in
  `patches/dolphin-si-set-game-id.patch` to leave its boot loop; the capture used that build.
- The GBA and NES systems also have libretro `.nes`/`.gba` test ROMs in the same vendor trees
  (blargg and others, mostly redistributable); they are not showcase material.
