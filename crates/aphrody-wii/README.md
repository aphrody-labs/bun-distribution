# Portable Wii execution slices

This dependency-free `no_std` library owns checked DOL loading and Broadway
branch transitions extracted from the retained Gecko Rust sources. It keeps
Gecko's GPL-3.0 license in `LICENSE`; these are modified extraction slices,
not relicensed upstream code. Source owners:

- `crates/emu/wii/image/src/dol.rs`: DOL header fields and section ordering.
- `crates/emu/wii/core/src/gekko/interpreter/branch.rs` and
  `gekko/condition.rs`: branch target, condition, CTR and LR semantics.
- `crates/emu/wii/LICENSE`: retained license text.

The retained interpreter branch handler calls this library. The active runtime
now lives in `crates/emu/wii/core`; `Wii::with_dol` validates cached MEM1/MEM2
sections and the text entrypoint before constructing devices. The browser
adapter uses that runtime and the retained GX renderer. The portable slice's
unit tests remain separate from full runtime and browser execution evidence.
DOL loading checks every range before copying into a supplied memory region.
Reserved `bcctr` counter options fail without mutation.

The source-generated test DOL contains only two encoded branch instructions;
no proprietary ROM, firmware or SDK binary is required. Tests also cover all
32 BO options against the retained branch-control cases, conditional CTR
wraparound, LR target alignment and checked transactional loading. The
`archive_adapter` integration test compiles the actual retained handler with
minimal caller fields; it verifies wiring, not archived-core boot.

The architectural reference is IBM's PowerPC User Instruction Set Architecture,
[Book I version 2.02](https://powerpc.dev/general/PPC_Vers202_Book1_public.pdf),
pages 24–25 (PDF pages 34–35), fetched on 2026-09-30. LR updates whenever LK
is set, including an untaken conditional branch. This deliberately corrects
the retained Gecko taken-only LR policy (also present in the current Dolphin
branch interpreter). Branch hints do not affect architectural state.

## Retained runtime integration

Pinned Chipi instruction specifications are present under
`crates/emu/wii/spec/gamecube`. Runtime, image, DFF, disassembler, debugger and
GX rendering are active root workspace members under `crates/emu/wii`.
The default runtime uses the existing interpreter; the archived native JIT
configuration remains outside the active browser package.

Three runtime integration tests exercise original Wii DOL loading and actual
Broadway execution. The browser gate verifies three frames through real WASM
and WebGPU. Its instruction fixture does not write graphics, so game fidelity,
retail disc boot and browser NAND persistence remain separate open work.
Current evidence and limitations are in
[`Gecko Web audit`](../../docs/gecko/WEB-UPSTREAM-AUDIT.md).
