# Bun plugins and binary loaders

`packages/bun-engine/src/plugins/consoles.ts` exposes one integrated `BunPlugin` per console family. Each plugin owns a virtual `bun-engine:<console>` module and publishes immutable capability metadata; implementations load through their declared owner.

`@aphrody/bun-loaders` is the single Bun.plugin owner for inspected files (C#, PowerShell, PE, APK, 3D, media and console binaries). Its console loader (`packages/bun-loaders/src/rom.ts`) turns `import rom from "./game.nes"` into a typed `BinaryImage` from `packages/bun-engine/src/formats`:

- detection by magic bytes, then structural heuristics (DOL, logo-less DS images, BIOS vector tables, DS firmware user settings), then the extension, then the signatures of `plugins/consoles/formats.json`, then Magika through `re`;
- parsed headers with checksum validation (iNES/NES 2.0, FDS, GB/GBC, GBA, DS/DSi with the native `bun-engine info`, N64 in z64/v64/n64 order with CIC and CRC1/CRC2, DOL, GameCube/Wii ISO, WBFS, WIA/RVZ, ELF, PS-X EXE, raw and cooked ISO9660 with `SYSTEM.CNF`, CUE, CHD, PBP, 3DS NCSD/NCCH, NSP, XCI, NRO, Mega Drive, BIOS and DS firmware named from `plugins/consoles/firmware.json`);
- sections with file offsets and load addresses, and lazy accessors: `read`, `sectionBytes`, `stream`, `digest`, `files` (NitroFS, GameCube FST, ISO9660 root, ExeFS, PFS0/HFS0) and `disasm`.

Disassembly routes to MAME `unidasm` (installed by `bep` under `usr/lib/mame`), LLVM `llvm-objdump`, Rizin `rz-asm` and a built-in 6502 decoder. Under `Bun.build` the loader inlines the JSON summary instead of the live object. Types for every extension live in `packages/bun-loaders/types/roms.d.ts`.

`packages/bun-engine/src/plugins/formats.ts` keeps one named loader id per format family for the standalone build; its console ids delegate to the same `@aphrody/bun-loaders` console loader, while Android packages and WebAssembly keep Bun's `file` loader.

`bun-engine formats <identify|header|sections|files|disasm|stream|compile>` exposes the same library, and `bun-engine formats compile` builds the `bun-engine-formats` single-file executable into `build/bin`.
