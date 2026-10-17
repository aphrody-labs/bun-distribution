# Console firmware and file formats

Research snapshot from 2026-10-17. Two machine-readable files hold the data:

- `packages/bun-engine/plugins/consoles/firmware.json`: BIOS, firmware and key files
  for 23 console families. Each entry records the file name, size, CRC32/MD5/SHA-1
  where they are documented publicly, the region, what the file does and whether
  the emulator needs it. Free replacements are listed with their license, upstream
  URL and vendoring state.
- `packages/bun-engine/plugins/consoles/formats.json`: 79 ROM, disc, container,
  executable, save, texture and archive formats. Each format has its magic bytes,
  a short header layout, the in-repo owner that handles it and the upstream spec.
  The `freeRoms` section lists 45 freely redistributable test and homebrew suites.

Neither file contains or links to proprietary payloads. Users bring their own
hardware dumps through `bep firmware:import` (see [PACKAGE-MANAGER.md](PACKAGE-MANAGER.md)).
The hashes identify those dumps. They come from libretro-database `System.dat` at
`f206bf65`, MAME `mdconsole.cpp` (32X) and the xemu docs (MCPX).

This research extends existing work instead of replacing it:
[CONSOLE-PROVENANCE.md](CONSOLE-PROVENANCE.md) (payload policy),
[CONSOLE-PLUGINS.md](CONSOLE-PLUGINS.md) (`firmwarePolicy`),
[RUST-EMULATORS.md](RUST-EMULATORS.md) (pinned owners),
`packages/iecode-docs/emulation/MULTICONSOLE-RUST-MIGRATION.md` (3DS inputs, `IECODE_GC_IPL_HLE`),
`packages/iecode-docs/nie/CONSOLE-PIPELINE.md` (external container tools),
`packages/iecode-docs/nie/FORMATS.md` (Level-5/CRI formats), `packages/iecode-docs/ruzu/quickstart.md`
(Switch keys) and the `ds-reverse`, `3ds-reverse` and `switch-reverse` RE skills.

## Free replacements

| Console           | Replacement                                                    | License                    | State                                                                                                       |
| ----------------- | -------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| GBA               | Normmatt BIOS                                                  | GPL-2.0+ lineage (ReGBA)   | in tree, `vendor/rustboyadvance-ng/core/benches/roms/normatt_gba_bios.bin`, the default in `machine/gba.rs` |
| GB/GBC            | Bootix DMG, SameBoy CGB                                        | CC0-1.0, MIT               | in tree, `vendor/retroboy/src/bios.rs`                                                                      |
| DS                | Dust HLE BIOS and default firmware                             | GPL-3.0                    | in tree, `crates/aphrody-dust-core/src/cpu/hle_bios`, `spi/firmware`                                        |
| N64               | PIF/CIC HLE                                                    | GPL-3.0                    | in tree, `vendor/gopher64`                                                                                  |
| Switch            | Synthesized system archives (fonts, Mii, NG words, time zones) | GPL-2.0+/GPL-3.0+          | in tree, `crates/ruzu-core/src/file_sys/system_archive`                                                     |
| DS                | melonDS FreeBIOS                                               | BSD-2-Clause               | pinned, `vendor/melonds`, not checked out                                                                   |
| GC/Wii            | Dolphin DSP IROM/COEF, Droid Sans IPL fonts, HLE BS2/IOS       | GPL-2.0+, Apache-2.0       | pinned, `vendor/dolphin`, not checked out                                                                   |
| 3DS               | citra_system_archives (shared font, NG word list)              | GPL-3.0                    | pinned, `vendor/azahar`, not checked out                                                                    |
| 3DS-GBA           | open_agb_firm                                                  | GPL-3.0                    | pinned, `vendor/open-agb-firm`, not checked out                                                             |
| FDS               | OpenDiskSysROM / FreeDiskSysROM                                | LGPL-3.0                   | upstream only                                                                                               |
| GBA               | Cult-of-GBA BIOS, mGBA hle-bios                                | MIT, MPL-2.0               | upstream only                                                                                               |
| PS1               | PCSX-Redux OpenBIOS, PCSX-ReARMed HLE                          | MIT, GPL-2.0               | upstream only                                                                                               |
| PS2               | Play! HLE BIOS (fps2bios is unlicensed and incomplete)         | BSD-2-Clause               | upstream only                                                                                               |
| PSP / PS4 / Wii U | PPSSPP, shadPS4 and Cemu HLE                                   | GPL-2.0+, GPL-2.0, MPL-2.0 | upstream only                                                                                               |
| Dreamcast         | Flycast reios                                                  | GPL-2.0                    | upstream only                                                                                               |
| Saturn            | Yabause/Kronos HLE BIOS (partial)                              | GPL-2.0+                   | upstream only                                                                                               |
| Xbox              | xemu HDD image, Cromwell (Linux only)                          | xemu, GPL-2.0              | upstream only                                                                                               |

## Compliance finding

`vendor/jgenesis/backend/s32x-core/src/` contains `sh2_master_boot_rom.bin`,
`sh2_slave_boot_rom.bin` and `m68k_vectors.bin`, which `bootrom.rs` embeds with
`include_bytes!`. Their SHA-1 hashes are `1e5b0b24`, `4103668c` and `dbebd76a`. These
match MAME's retail `32x_m_bios.bin`, `32x_s_bios.bin` and `32x_g_bios.bin`, so they
are proprietary Sega boot ROMs that upstream jgenesis ships. This conflicts with the
non-redistribution rule. Resolve it before any jgenesis publication gate, either by
stripping these files from the fork or by loading the ROMs from the user's
`bep firmware` store.

## Gaps

Consoles without a usable free BIOS or firmware:

- DSi (BIOS, firmware, NAND)
- 64DD IPL
- Sega CD
- 32X: only the proprietary bytes above exist
- Saturn: HLE is partial
- PS3 and Vita: firmware PUP required
- Xbox: MCPX ROM and a kernel that can boot games
- PC Engine CD (System Card)
- SNES ST018: no HLE exists

Runtime gaps:

- `aphrody-wii-runtime` zero-fills the DSP IROM and COEF buffers. The fix is to wire in
  Dolphin's free DSP ROM.
- `starpsx` needs a retail BIOS. OpenBIOS would remove that requirement.

Formats with no in-repo parser (`status: none`; 35 formats):

- 3DS: CIA, ExeFS and RomFS are handled only by external tools. 3DSX, SMDH and CTR
  assets have no parser.
- DS: Nitro archives (NARC, SDAT, NCGR, NSBMD) are handled only by external tools.
- GC/Wii: WBFS (extension only), CISO, GCZ, TGC, WAD and saves. WIA is detected but
  not decoded, because `rvz.rs` accepts RVZ only.
- Wii U: everything (WUD/WUX, WUA/WUHB, NUS, GTX).
- PlayStation family: ECM, CSO/ZSO, the PS2 memory card, ROMDIR, PBP (extension only),
  SFO, PKG, SELF, EDAT/PUP and PS4 PKG/SELF.
- Xbox: XISO, XBE and XPR. XEX (Xbox 360) is listed for reference.
- Sega: the Saturn disc, Dreamcast GDI/CDI/IP.BIN and VMU.
- NES: UNIF and NSF. FDS has an extension only; TetaNES names mapper 20 but has no
  disk path.
- Audio: SPC, GBS and PSF.

Identification holes:

- `binary.rs` probes ISO 9660 only at 0x8001, 0x8801 and 0x9001. It misses raw
  2352-byte images, which have the volume descriptor at 0x9319 (MODE2) or 0x9311 (MODE1).
- `rom.ts` and `re` do not sniff SNES, PS-X EXE (`rom.ts` only), CHD, PBP, PKG or XBE.
- `packages/bun-loaders/src/rom.ts` imports `bun-engine/src/pipeline/nds-replica.ts`,
  which does not exist in this checkout.

Test ROMs: the only suites in tree are TetaNES's (NES) and jsmolka gba-tests
(`vendor/rustboyadvance-ng/external/gba-tests`). These suites are MIT-licensed and
are candidates for `roms.json`: mooneye, the acid2 tests, `c-sp/game-boy-test-roms`,
`mgba-emu/suite`, `JaCzekanski/ps1-tests`, `n64-systemtest` and the SingleStepTests
CPU vectors.
