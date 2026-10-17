# Nintendo DS playable replica research

Scope: integrate the owner-supplied `testt.nds` as an external input to Bun
Engine, map its observable screens and flows, and run it through Dust on
Windows and Web. The ROM and extracted proprietary content are never committed.

## Sources

| Source | URL | Evidence |
| --- | --- | --- |
| User-owned fixture | `file:///C:/msys64/usr/bin/testt.nds` | Runtime input |
| Dust | [migration owner](../crates/nds) | DS execution, rendering and input |
| Ghidra/NTRGhidra | [local sources](../crates/ghidra) | ARM/NDS static analysis |
| libnds | [local SDK source](../crates/libnds) | Independent homebrew reference |
| Bun RE | [NDS owner](../crates/nds/src/lib.rs) | Format intake and tool ABI |

## Screens

| ID | Screen | Entry | Purpose | States |
| --- | --- | --- | --- | --- |
| S01 | Intake | `re replica nds PATH` | Validate and fingerprint the external ROM | valid, missing, invalid |
| S02 | System setup | Desktop/Web launcher | Select ROM and optional user-owned BIOS/firmware | direct boot, firmware boot, error |
| S03 | Dual display | Start | Render top and touch screens | loading, running, paused, stopped |
| S04 | Controls | Keyboard/touch/gamepad | Send DS buttons and stylus input | idle, pressed, touch, disconnected |
| S05 | Save tools | Runtime menu | Import/export save state | empty, loaded, exported, incompatible |
| S06 | RE evidence | Ghidra/Dust debug | Correlate static functions and runtime addresses | unavailable, mapped, breakpoint hit |

## Flows

- F01 Play on Windows: S01 -> S02 -> S03 -> S04 -> S05.
- F02 Play on Web: S01 -> S02 -> S03 -> S04 -> S05.
- F03 Recognize behavior: S01 -> S06 -> S03/S04 observations -> evidence ledger.
- F04 Compare SDK behavior: build an independent libnds fixture -> S06 -> record signatures.

## Inferred model

- `RomIdentity`: name, byte length, SHA-256; high confidence from S01.
- `CartridgeHeader`: title, codes, ARM9/ARM7 offsets and entries; high confidence.
- `ObservedScreen`: identifier, screenshot reference, entry action, exits; incomplete until runtime capture.
- `ObservedFlow`: ordered screens and inputs; incomplete until deterministic replay.
- `RuntimeEvidence`: frame, core, PC and stop reason; supported by Dust, not yet captured for this image.

## Current recognition

Dust identifies the image as a valid 268435456-byte Nintendo DS cartridge,
title `INAZUMA11`, code `BEBF`, maker `01`, with valid header and logo CRCs.
The detailed game screen and feature inventory remains runtime work; it will be
recorded from owner-driven execution rather than inferred from extracted assets.

## Exclusions

No ROM, keys, firmware, screenshots, extracted game assets or decompiled game
source are distributed. The playable surfaces load the owner's file at runtime.
