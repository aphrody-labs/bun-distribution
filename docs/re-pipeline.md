# RE pipeline: acquire to verify

Cross-OS, BIOS and firmware reverse-engineering pipeline. Owners: `crates/re` (Rust core, feature
`pipeline`, default on) and `packages/re/src/pipeline` (Bun CLI, MCP tools, local API).

```
acquire -> identify -> unpack -> analyze -> lift -> decompile -> rebuild -> verify
```

Every stage emits a typed `StageReport` (`ok | partial | unavailable | skipped | failed`) inside one
`PipelineReport` written to `<out>/report.json`. A stage with no runnable adapter reports `unavailable`
and lists candidate adapters; it never fabricates output.

## Contract

- Rust: `crates/re/src/pipeline/contract.rs` (serde), IR in `ir.rs`.
- JSON Schemas (draft 2020-12): `crates/re/schema/*.json`, regenerated with
  `bunre pipeline schema crates/re/schema` or `re pipeline schema <dir>`.
- TypeScript mirror: `packages/re/src/pipeline/contract.ts`.

## Adapters

`registry.rs` defines the `StageAdapter` trait. Existing Bun OS owners plug in as typed adapters
referenced by id or command (never copied): steamcmd and nie-steam (acquire); 7z, UEFIExtract,
binwalk, unblob, nie-formats (unpack); rea, nie-re, ntr-ghidra, wii-disasm, bun-engine-nds (analyze);
ghidra-decompiler (decompile); factory-linux/arch, msvc-windows, android-native, libnds, libogc
(rebuild); nie-emu, dolphin, ares, mame, retroarch, qemu and others (verify). `re pipeline adapters`
shows live status: `ready`, `registered` (installed, needs `--external`) or `unavailable` with reason.

Built-in end-to-end adapters: fs-acquire, sniff-identify, zip-apk-unpack, triage, x86-lift,
aarch64-lift, emit-c, emit-rust, clang-c, rustc-lib, lift-verify, the console recompilation chain
armv4t-lift, r3000a-lift, 6502-lift, emit-console-rust, cargo-recompile and recompile-verify, plus the
optional Ghidra headless adapter (`GHIDRA_INSTALL_DIR`, `--external`).

## Lift and rebuild

`goblin` loads PE and ELF (x86, x86_64); `iced-x86` decodes. Recursive descent from entry, exports and
symbols builds an IR (`lift/ir.json`) of blocks and typed ops. `emit-c` writes a C runtime plus
`lifted.c` (guest memory arena, one function per lifted function, goto labels, flag macros);
`emit-rust` writes `lifted.rs` for PE inputs. `clang-c` compiles and links the C; `rustc-lib`
compiles the Rust. `lift-verify` checks IR coverage, image round trip, that the C compiles and links,
that the Rust compiles, and with `--trace` runs the rebuilt program.

## Static recompilation of console images

`bunre recompile <image> --target exe|wasm --out DIR` (`re recompile`, `bun-engine recompile`, MCP
`re_recompile`) runs the same pipeline with a recompilation request:

- **lift** - `lift_armv4t.rs` (Game Boy Advance cartridge plus the BIOS vectors, ARM and Thumb,
  constant tracking for `bx`/`mov pc` targets), `lift_mips.rs` (PlayStation BIOS at `0xBFC00000` and
  the PS-EXE text, delay slots, entry guard for RAM code) and `lift_6502.rs` (fixed iNES PRG banks,
  bank guard) lower each instruction to guest semantics (`sem.rs`, `IrOp::Guest`): temporaries,
  guest registers and flags named by the module `Abi` (`machine`, `flags`, `isas`), bus loads and
  stores with access kinds, and runtime helper calls. Untranslated instructions become `Fallback`.
- **decompile** - `emit_guest.rs` writes a Cargo crate (`DIR/crate`): one Rust function per block
  over `bun_engine::recomp::<machine>::Rt`, a `lookup` table, a headless `main.rs` and `recomp_*`
  WebAssembly exports. The runtimes live in `crates/bun-engine-core/src/recomp` and link the device
  models of RustBoyAdvance-NG, StarPSX and TetaNES through small runner hooks in those cores.
- **rebuild** - Cargo through the serialized wrapper (`BUNRE_CARGO` overrides) for the host or
  `wasm32-unknown-unknown`; artifacts are copied to `DIR/bin`.
- **verify** - the build runs translated and interpreter-only (`--interp`, wasm under Bun) and
  `bun-engine run` runs the original image; frame buffers and console output must be identical, and
  `translated-code-ran` reports the instructions executed by translated code.

Translated code is a drop-in replacement for interpreter steps: it performs the same bus accesses
(instruction fetches, dummy reads, sequential/non-sequential kinds) and yields to the core loop at
scheduler deadlines, frame ends and I/O stores, so device timing is unchanged. Addresses without a
block, indirect targets and code copied to RAM run in the interpreter (hybrid recompilation).

## CLI and MCP

```
re pipeline <input> --target <os|bios|firmware> [--out DIR] [--external] [--trace] [--db]
re pipeline adapters [--stage S]
re pipeline schema <dir>
```

The CLI drives `bunre pipeline` (`BUNRE_BIN`, else the newest `bunre` of `target/` and the Cargo
slots `target/slot-N/`, or PATH); `re recompile` drives `bunre recompile` and `re bin` drives
`bunre pipeline triage` (the analyze-stage triage alone). The full `re` command surface and its proof
runs are in [`re/REA-MATRIX.md`](re/REA-MATRIX.md).
`--db` records runs in a `bun:sqlite` analysis database. The `re` MCP server serves `re_pipeline_run`,
`re_pipeline_adapters`, `re_recompile`, the engine, formats, binary, Replica, Ghidra, Magika and Steam
tools beside the rea toolkit. `serve.ts` exposes a loopback
`Bun.serve` API.

## Limits (honest)

- Built-in lifters: x86/x86_64 and AArch64 (PE/ELF), ARMv4T (GBA), MIPS R3000A (PlayStation) and 6502
  (NES); PPC and others need Ghidra or an owner adapter.
- Console recompilation translates code reachable statically from the image; the PlayStation
  kernel copied to RAM, NES switchable banks and indirect-only code run in the core interpreter.
- Flags are partially modelled; OF after shifts is undefined. Unsupported instructions are kept as
  `unlifted` and trap at run time.
- Indirect jumps and jump tables go through a dispatcher and trap when unresolved.
- Guest memory is a flat arena at the preferred image base; no relocation or OS loader emulation.
- Imports are stubs that trap; system calls are not emulated.
- Ghidra and the external c