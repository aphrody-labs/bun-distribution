# Aphrody extensions to the Bevy fork

This tree is the Aphrody-owned overlay on the full Bevy fork. Upstream Bevy
crates remain under `crates/`; Aphrody extensions live here so upstream updates
can be reviewed without copying or renaming engine internals.

The fork's `main` follows upstream development. The
`aphrody/stable-0.19.1` branch starts at upstream tag `v0.19.1` and is the
tested development baseline. `aphrody-engine-host` is the first functional
extension: it drives a Bevy application manually with no window, renderer,
wall-clock loop or default plugins. It is a game-engine host, **not** a console
emulator or replacement for IECODE's console-specific hardware cores.

IECODE is the integration sandbox. Rust code moves from IECODE to the
appropriate Aphrody repository only after its API, tests, provenance and
cross-platform gates are stable; the game-engine extensions belong here.
Neither official Nintendo SDK material nor Valve/Epic partner SDKs are stored
in this public fork. Future licensed adapters remain separate until the
applicable agreements and distribution permissions are in place.
The [graphics alignment record](../../../../../reference/iecode/engine/bevy/aphrody/DEPENDENCY-ALIGNMENT.md) owns the current
`wgpu` compatibility boundary with Aphrody UI and the emulator forks.

Narrow gate:

```sh
cargo test -p aphrody-engine-host
cargo clippy -p aphrody-engine-host --all-targets --no-deps -- -D warnings
cargo check -p aphrody-engine-host --target wasm32-unknown-unknown
cargo fmt -p aphrody-engine-host --check
rustfmt --config-path aphrody/rustfmt.toml --check aphrody/engine-host/src/lib.rs
```

Upstream Bevy ignores `Cargo.lock`, so this fork follows that policy. `--no-deps`
keeps the narrow Clippy gate on Aphrody code: Bevy 0.19.1's `bevy_app`
currently trips new Rust 1.98 Clippy diagnostics in its own panic handler.
On 2026-09-29 the host passed 2 native unit tests, the narrow Clippy and
format gates, and a `wasm32-unknown-unknown` compile check. Browser runtime
execution and WebGPU rendering have not been tested by this gate.
