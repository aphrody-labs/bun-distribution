# Retained aphrody-emu-utils source

Source-only import of `https://github.com/kelpsyberry/aphrody-emu-utils` at revision
`fff4bcd769b2fd1b452d79aad7d7741589e64c0a`, from the existing Cargo Git checkout.
The source, procedural macros, build script and package metadata are retained.
The nested upstream workspace is removed to use the IECODE root workspace.

Local compatibility adaptation removes obsolete `LaneCount` and
`SupportedLaneCount` imports and bounds from portable SIMD savestate code.
Modern Rust portable SIMD encodes lane validity directly in `Simd`; lane-wise
save/load order is unchanged. The now-stable `new_zeroed_alloc` feature gate is
removed. The package still requires unstable Rust features.

Upstream provides no license file or Cargo license declaration in this revision.
This retains an existing unlicensed dependency for development research; no
license grant or distribution/release clearance is claimed or invented.
