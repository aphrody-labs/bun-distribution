# Rust emulator catalog

Snapshot researched from the upstream GitHub repositories on 2026-10-14. Activity
means the latest upstream commit visible on that date; it is not a compatibility or
accuracy certification. Every selected source is implemented primarily in Rust and
is pinned as an isolated submodule to the exact commit below.

## Selected owners

| Consoles | Owner | Activity | License | Exact pin | Selection |
| --- | --- | --- | --- | --- | --- |
| NES | [TetaNES](https://github.com/lukexor/tetanes) | 2026-09-07 | MIT OR Apache-2.0 | [`a0a6b17f8ba9c5ee451453fb2409753fd06e5a31`](https://github.com/lukexor/tetanes/commit/a0a6b17f8ba9c5ee451453fb2409753fd06e5a31) | Active cross-platform NES owner using wgpu. |
| Game Boy | [RetroBoy](https://github.com/smparsons/retroboy) | 2026-03-02 | Apache-2.0 | [`edf90d9fb192372a657a18d44f5c9841805fa554`](https://github.com/smparsons/retroboy/commit/edf90d9fb192372a657a18d44f5c9841805fa554) | Established Rust Game Boy owner. |
| Game Boy Advance | [RustBoyAdvance-NG](https://github.com/michelhe/rustboyadvance-ng) | 2026-08-27 | MIT | [`1d7ff23a6adb42d803ebd393c3d27d94e4fea15e`](https://github.com/michelhe/rustboyadvance-ng/commit/1d7ff23a6adb42d803ebd393c3d27d94e4fea15e) | Active emulator and debugger. |
| Nintendo DS | [dust](https://github.com/kelpsyberry/dust) | 2025-12-17 | GPL-3.0 | [`76d79f25e4ea3ce355c4ac868f5ac9a233e64b89`](https://github.com/kelpsyberry/dust/commit/76d79f25e4ea3ce355c4ac868f5ac9a233e64b89) | Accuracy/debugging-oriented desktop and web emulator; copyleft-isolated. |
| Nintendo 64 | [Gopher64](https://github.com/gopher64/gopher64) | 2026-10-13 | GPL-3.0 | [`9b312ea60d1db87e85964c2a4c6fe5dae1540609`](https://github.com/gopher64/gopher64/commit/9b312ea60d1db87e85964c2a4c6fe5dae1540609) | Active high-compatibility N64 owner; copyleft-isolated. |
| Nintendo 3DS | [Zakuro](https://github.com/fearkov/zakuro) | 2026-10-14 | MIT | [`0ce36eeb64adf8969c5d94bc907ccb68b9e73f35`](https://github.com/fearkov/zakuro/commit/0ce36eeb64adf8969c5d94bc907ccb68b9e73f35) | Active AOT-based project; early-stage research owner. |
| NES, SNES, Game Boy/Color, Game Boy Advance, Sega Genesis/Mega Drive, Sega CD, Sega 32X, Master System, Game Gear | [jgenesis](https://github.com/jsgroth/jgenesis) | 2026-10-13 | GPL-3.0 | [`9fcfd9c9495ae6a65c3a9354599665d3bf62a047`](https://github.com/jsgroth/jgenesis/commit/9fcfd9c9495ae6a65c3a9354599665d3bf62a047) | Active multi-console owner; copyleft-isolated. |
| PlayStation | [StarPSX](https://github.com/kaezrr/starpsx) | 2026-09-05 | GPL-3.0 | [`e8551eedac6d15a4ed7b7fb123c70f97217d1ed4`](https://github.com/kaezrr/starpsx/commit/e8551eedac6d15a4ed7b7fb123c70f97217d1ed4) | Active cross-platform PS1 owner; copyleft-isolated. |

The submodule remotes point to `aphrody-labs` forks. The upstream links above remain
the provenance authority and the gitlink pins make source drift explicit.

## Existing local owners and gaps

| Console | Status |
| --- | --- |
| GameCube / Wii | Local `aphrody-wii` and `aphrody-wii-image` crates provide bounded loaders and execution primitives, not a complete emulator. |
| Nintendo Switch | Local `aphrody-switch` and `aphrody-aarch64` provide CPU/texture primitives, not a complete emulator. No mature full Rust owner was selected. |
| Switch 2 | Oboromi is pinned at `vendor/oboromi` for research; its upstream describes it as a proof of concept. |
| Switch | Nexium (homebrew) is pinned at `vendor/nexium`. |
| GameCube / Wii | gecko is pinned at `vendor/gecko`; its interpreter is retained in `aphrody-wii-runtime`. |
| Atari 2600, Dreamcast, PSP, Xbox | Current Rust candidates were too early, inactive, or lacked clear licensing/coverage evidence for a preferred owner. They can be re-evaluated from upstream rather than absorbed speculatively. |

## Distribution boundary

- Submodules are research source inputs only; none is a dependency of `native/` or
  `plugins/emulation/Cargo.toml`.
- Preserve each upstream copyright and license file when producing any artifact.
- A publication gate must resolve license composition, source-offer and notice duties.
- Users supply only payloads they are legally permitted to use; the catalog ships none.
