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
  `bunre-pipeline schema crates/re/schema` or `bun re pipeline schema <dir>`.
- TypeScript mirror: `packages/re/src/pipeline/contract.ts`.

## Adapters

`registry.rs` defines the `StageAdapter` trait. Existing Bun OS owners plug in as typed adapters
referenced by id or command (never copied): steamcmd and nie-steam (acquire); 7z, UEFIExtract,
binwalk, unblob, nie-formats (unpack); rea, nie-re, ntr-ghidra, wii-disasm, bun-engine-nds (analyze);
ghidra-decompiler (decompile); factory-linux/arch, msvc-windows, android-native, libnds, libogc
(rebuild); nie-emu, dolphin, ares, mame, retroarch, qemu and others (verify). `bun re pipeline adapters`
shows live status: `ready`, `registered` (installed, needs `--external`) or `unavailable` with reason.

Built-in end-to-end adapters: fs-acquire, sniff-identify, zip-apk-unpack, triage, x86-lift, emit-c,
emit-rust, clang-c, rustc-lib, lift-verify, plus the optional Ghidra headless adapter
(`GHIDRA_INSTALL_DIR`, `--external`).

## Lift and rebuild

`goblin` loads PE and ELF (x86, x86_64); `iced-x86` decodes. Recursive descent from entry, exports and
symbols builds an IR (`lift/ir.json`) of blocks and typed ops. `emit-c` writes a C runtime plus
`lifted.c` (guest memory arena, one function per lifted function, goto labels, flag macros);
`emit-rust` writes `lifted.rs` for PE inputs. `clang-c` compiles and links the C; `rustc-lib`
compiles the Rust. `lift-verify` checks IR coverage, image round trip, that the C compiles and links,
that the Rust compiles, and with `--trace` runs the rebuilt program.

## CLI and MCP

```
bun re pipeline <input> --target <os|bios|firmware> [--out DIR] [--external] [--trace] [--db]
bun re pipeline adapters [--stage S]
bun re pipeline schema <dir>
```

The CLI drives the `bunre-pipeline` binary (`BUNRE_PIPELINE_BIN`, `target/{release,debug}`, or PATH).
`--db` records runs in a `bun:sqlite` analysis database. `mcp.ts` exports `re_pipeline_run` and
`re_pipeline_adapters`; register with `registerPipelineTools(...)`. `serve.ts` exposes a loopback
`Bun.serve` API.

## Limits (honest)

- Only the x86/x86_64 lifter is built in; ARM, MIPS, PPC and others need Ghidra or an owner adapter.
- Flags are partially modelled; OF after shifts is undefined. Unsupported instructions are kept as
  `unlifted` and trap at run time.
- Indirect jumps and jump tables go through a dispatcher and trap when unresolved.
- Guest memory is a flat arena at the preferred image base; no relocation or OS loader emulation.
- Imports are stubs that trap; system calls are not emulated.
- Ghidra and the external command adapters are registered but unverified on this workstation.
- BIOS and firmware images are identified and unpacked (external tools) but not lifted unless the
  payload is x86.
