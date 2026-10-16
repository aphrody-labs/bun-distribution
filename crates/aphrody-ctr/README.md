# IECODE CTR pure logic

`aphrody-ctr` owns portable Nintendo 3DS PICA command encoding, decoding and
byte-masked register updates. It has no external dependencies, allocation,
unsafe code or platform service imports and supports native and WASM consumers.
This is a device-level building block, not a bootable 3DS emulator.

`shader::Binary` reads bounded little-endian DVLB/DVLP/DVLE SHBIN views without
alignment assumptions or allocations. It validates shared code/operand ranges
and each executable's constant/output/uniform/symbol tables. Operand descriptors
retain all eight bytes (libctru uploads the low word). Entry-point validity,
instruction decoding, label tables, uniform name resolution and shader execution
are not implemented by this loader. Output-map generation matches pinned
libctru handling of sparse component masks, repeated registers and unknown
attributes, while rejecting register IDs outside the seven output slots before
mutation. A native C differential test covers 1,344 output-map cases against
the exact pinned `DVLE_GenerateOutmap` function.

`processor::CommandProcessor` applies ordered masked writes to a checked 0x300-word
register bank in bounded scheduler quanta, retaining its position inside packets.
Each write is forwarded with its previous and current value to a side-effect
callback, including repeated values and zero byte masks. Rendering, shader upload,
interrupts and command-buffer jumps must be implemented by the device owner.
The first `GPUREG_FINALIZE` write terminates execution with `Finalized`; subsequent
commands (including SDK alignment padding) are ignored, as documented by
[3DBrew](https://www.3dbrew.org/wiki/GPU/Internal_Registers#GPUREG_FINALIZE).
The zero-filled bank is raw storage, not a hardware reset-state claim.
`gpu::finalize_commands` appends libctru-compatible finalization strobes and
16-byte alignment with atomic capacity checking.

The encoder follows the pinned libctru `GPUCMD_HEADER`, `GPUCMD_AddInternal`
and `GPUCMD_Add` algorithms, including 256-parameter splitting and padding.
Bounds checks precede writes, including padding; undersized output is unchanged.
An empty parameter slice emits one zero, corresponding to libctru's zero-filled
parameter mode, without its null-pointer arithmetic. The decoder accepts the
documented 16-bit command ID field; SDK header construction retains libctru's
10-bit ID mask. Raw register writes still require device-specific side effects.

Sources inspected on 2026-09-30:

- [3dbrew GPU internal registers](https://www.3dbrew.org/wiki/GPU/Internal_Registers),
  command header, masking and the three-parameter example.
- [3dbrew SHBIN](https://www.3dbrew.org/wiki/SHBIN), DVLB/DVLP/DVLE table layouts,
  cross-checked against retained `source/gpu/shbin.c` and `include/3ds/gpu/shbin.h`.
- Exact pinned command and shader excerpts with source URLs and hashes:
  [test fixture provenance](tests/fixtures/README.md).
- [GBATEK 3DS reference](https://www.problemkaputt.de/gbatek.htm#3dsreference)
  was requested but could not be fetched from this environment. No claim here
  relies on unseen GBATEK content.

libctru is distributed under the zlib license; the preserved notice and exact test reference excerpts
are under `tests/fixtures`, pinned to revision `36fe1ada5b7ebe53ba4decda36d764a55f8fefb6`. This crate is a Rust adaptation of its command
and shader output-map logic with checked slice interfaces and a register stream decoder.
