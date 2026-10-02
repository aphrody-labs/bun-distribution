# NIE native ABI extraction

The canonical `aphrody-ffi` dynamic library links the existing NIE World, VFS,
format, PRNG and simulation ABI through the private `nie-ffi` rlib. The unrelated
`iecode-ffi` pipeline/registry API remains a separate Rust owner; its functions
cannot substitute for `nie_world_*` or `nie_vfs_*`.

## Sources and ownership

[nie-native-rust-extraction.json](nie-native-rust-extraction.json) records each
source file's SHA256, original repository status, source HEAD and target owner.
The IECODE source snapshot was taken from HEAD
`45f0d1d64e270f7450b279353d1b912bfe219925` with untracked source owners, so the
individual hashes identify the imported implementation. Source paths are
historical snapshot locations; a concurrent source migration subsequently
renamed the NIE directories.

Seven NIE owners and the existing IECODE GPU backend were imported into
`crates/iecode/`. Existing `ievr-data`, `geom`, `video` and `emu` owners are reused
through workspace aliases instead of copied into competing crates. The CPU
raster and sprite-sheet owners were imported exclusively from the published
Cargo checkout `dfdf720eb9116064bd7229582d36490964e30415`; the original UI
working tree was not accessed.

IECODE owners retain the original commercial NIE license
and `publish = false`. The four reused owners' previously missing license fields
and public geom/video/emu flags were corrected without implementation changes.
Both UI owners retain their Apache-2.0 notices and copied
source LICENSE. The aggregate is private. The license of each implementation
continues to apply inside the combined artifact.

## Qualified partial profile

The complete `nie-ffi` owner enables `wiki` by default and requires the authentic
Wiki manifests. The aggregate's workspace dependency uses
`default-features = false`, retaining the real World/VFS/formats implementation
without the unqualified Wiki resource closure. Core `data` also remains disabled
in this profile. This is a partial migration, not full game or Wiki parity.

`nie_wiki_available()` reports false in this profile. `nie_wiki_json_out` remains
exported and returns the original error representation `NieBytes { null, 0, 0 }`
when unavailable. It does not fabricate a successful empty Wiki result. A
complete profile still compiles the original Wiki implementation and fails
explicitly if required resources are absent.

All historical C ABI names, POD structures, error sentinels and destructor
ownership remain with `nie-ffi`. A `NieWorld` handle must be released once with
`nie_world_free`; a `NieBytes` buffer must be released once with
`nie_bytes_free` or `nie_bytes_free_fields`. Neither is compatible with the
N2B, Oxc or Aphrody string destructors. The library must remain loaded while
native handles and buffers are live. Null/empty releases retain their original
no-op behavior. Snapshot buffers remain independently owned after the call.

The Rust layout qualification checks `NiePlayer` size 20/alignment 4 with team at
offset 16 and role at 17, `NieBall` size 24/alignment 4, `NieCacheStats` size 24, and
`NieBytes` as three pointer-sized fields. These are the existing Python ctypes
contracts.

## Adaptations

- `nie-ffi` builds as an rlib named `iecode`; the aggregate reexports its public
  C ABI and alone owns the dynamic artifact.
- Wiki random-team selection uses the pinned rand 0.10 `RngExt::random_range`
  API. `SmallRng` no longer requires the removed `small_rng` feature.
- Wiki requests unsigned SQLite fields through rusqlite 0.40's official
  `fallible_uint` feature; conversions continue to reject out-of-range values.
- The GPU owner uses official wgpu 30 `TextureFormat::is_srgb`, optional vertex
  buffer layouts, default adapter-limit policy and checked mapped-buffer access.
  Native backend features and WGSL remain enabled in the shared backend owner.
- Constant-size chunk loops use Rust 1.98 array chunks while preserving trailing
  byte handling, including the CRC remainder. The authentic tracked 8,337-byte
  OC event-script fixture is retained inside its test owner with its source hash.
- VM-dependent Lua tests/examples declare their existing `vm` requirement; the
  complete VM profile is qualified separately from the pure bytecode profile.

## Open resource and runtime gates

No authentic copies of these nine embedded resources were found in the
authorized IECODE, target, Compat or Oxc trees:

| Owner/profile | Missing resource |
| --- | --- |
| core `data` | formations-full.json |
| core `data` | skills-cutin.json |
| core `data` | skills-cutin-served.json |
| Wiki | menu-gallery-manifest.json |
| Wiki | item-enrichment.json |
| Wiki | item-image-manifest.json |
| Wiki | menu-asset-manifest.json |
| Wiki | emblem-crc-map.json |
| Wiki | character-face-manifest.json |

The full Wiki/core-data gates remain open. No empty replacement datasets were
introduced. Real-game VFS, glyph and typed menu corpus tests remain unqualified
without their authentic game input. Physical GPU execution, cross-platform
artifact parity and release qualification remain separate gates. Eight GPU
tests executed successfully on the Vulkan llvmpipe CPU adapter (Mesa 25.2.8,
LLVM 20.1.2), covering triangle/line rendering and CPU/GPU framing. That is
software Vulkan evidence, not physical GPU or original game-asset parity.

## Reproducible native checks

```sh
cargo check --locked -p nie-ffi --no-default-features
cargo test --locked -p nie-ffi --no-default-features --lib -- \
  --skip font_render_text_a_real --skip menu_setting_typed_corpus_real
cargo check --locked -p nie-render3d -p nie-runtime -p nie-lua \
  -p aphrody-gpu-backend --all-targets
cargo clippy --locked -p nie-ffi --no-default-features --all-targets \
  --no-deps -- -D warnings
cargo build --locked -p aphrody-ffi
cargo test --locked -p nie-render3d --features gpu --lib gpu::tests -- --nocapture
```

The partial ABI suite passes 14 tests with 2 real-game tests explicitly filtered.
The eight-owner library harness passes 845 tests, with 2 pre-existing ignored
tests; conditional source game-data early returns do not establish game parity.
The complete Lua VM library harness passes 136 tests with 1 pre-existing ignored
test. Scoped all-target Clippy passes for these owners, the complete Lua VM,
the optional GPU renderer and the aggregate.

The installed Python engine qualification passes the unchanged 16 tests with
zero skips and validates all 30 consumer symbols and ctypes layouts. Its
retained proof
links the copied binary hash to this extraction manifest. The aggregate build,
symbol audit and artifact digest are recorded in the JSON manifest; an imported
source file alone does not prove them. The artifact was built from a concurrent
worktree snapshot, so a clean release source-to-binary attestation remains open.
