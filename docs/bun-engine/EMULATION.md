# Bun Engine native engine sources

`crates/` is the unique root for native runtime, rendering, emulation, SDK,
firmware, compatibility, GPU and reverse-engineering source owners.

The checked-in gitlinks are executable upstream implementations, not placeholder
interfaces. The engine catalog binds each console to an exact source revision.
`libnds`, `libogc` and `open-agb-firm` provide the open SDK/firmware toolchain;
the Rust and C/C++ emulators consume homebrew and user-supplied test payloads.

The root build keeps one orchestration surface. Upstream projects that still
carry their own Cargo workspace are pinned under this root until their manifests
are normalized into the root Cargo graph; they are never represented by stubs.
