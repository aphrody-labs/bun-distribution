# Nintendo DS replica architecture

## Stack

- Intake/orchestration: native Bun CLI in `packages/bun-engine`.
- Core/runtime owner: `crates/nds`; the modern IECODE Dust core will replace the obsolete `crates/dust` tree.
- Windows: the shared WASM/WebGPU application packaged by Bun, or a thin `DsHost` adapter; the obsolete ImGui desktop is not retained.
- Web: the same Dust core through its WebAssembly worker frontend.
- Format tools: Tinke INAZUMA11 transforms as a .NET 10 NativeAOT shared library loaded by `bun:ffi`.
- Static analysis: Ghidra plus NTRGhidra from owned source trees.
- SDK reference: libnds source and a separately installed BlocksDS toolchain.
- Storage: local files only; no database or server is required.

## Data contracts

`NdsReplicaReport` is the pipeline boundary. It contains immutable input
identity, cartridge metadata, ARM9/ARM7 executable coordinates, owner readiness
and deterministic output paths. It never contains ROM bytes.

Runtime evidence is written beneath ignored `var/replica/`; distributable
Windows/Web builds live beneath ignored `build/replica/`. User inputs remain at
their explicitly supplied paths.

## Commands

| Command | Output | Flow |
| --- | --- | --- |
| `re replica nds ROM` | JSON intake report | F01 |
| `re replica init ROM [DIR]` | Atomic provenance/status artifacts | F01 |
| `bun run nds:tinke:build` | .NET 10 NativeAOT C ABI library | F02 |
| Dust desktop build/run | Windows executable loading external ROM | F01 |
| Dust Web build/server | Browser file-picker runtime | F02 |
| Ghidra headless + NTR loader | static function/export evidence | F03 |
| BlocksDS/libnds fixture build | known-symbol comparison image | F04 |

## Build order

1. S01 intake and tests.
2. Replace old Dust with the modern IECODE core under `crates/nds` and qualify its CLI.
3. Build and smoke the shared WebAssembly/WebGPU frontend, then package it for Windows.
4. Capture S02-S05 states and update recognition evidence.
5. Build Ghidra/NTRGhidra and libnds reference evidence for S06.

Current blockers are JDK 25 plus Ghidra/NTRGhidra version alignment, the absent
devkitPro toolchain, and the still-unmigrated modern Dust execution/rendering
core. Input metadata and Tinke FFI are already qualified without embedding ROM
content.
