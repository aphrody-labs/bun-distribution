# Build log

## Qualified

- Bun NDS intake parses `testt.nds` read-only and reports title `INAZUMA11`, code `BEBF`, maker `01`, ARM9 and ARM7 regions.
- Tinke INAZUMA11 transforms were ported from the Aphrody fork to .NET 10 NativeAOT and exposed through a stable C ABI consumed by `bun:ffi`.
- NativeAOT DLL build and Bun FFI round-trip tests pass on Windows x64.
- `bun-engine-nds` is the canonical bounded NDS header and native-tool contract crate.

## Remaining gates

- The modern IECODE Dust core, utilities and proc-macros are absorbed under `crates/nds`; its unified Rust CLI validates `testt.nds`. Rendering/execution frontends remain to migrate.
- JDK 25 is installed and auto-discovered. Ghidra dependencies bootstrap successfully, but the 12.3 DEV build currently omits the `:Doclets` Gradle project during configuration; NTRGhidra also targets at most Ghidra 12.0.4.
- Install devkitPro/libnds tools before building homebrew fixtures.
- A playable Windows/Web replica still requires observed screens, interaction traces, rendering, audio and parity tests.
