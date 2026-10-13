# Native Material 3 framework

The `aphrody-m3` crate owns accessibility, components, stateful controls, focus,
forms, icons, keyboard input, layout, motion, theme and host-neutral visual parts.
Its optional `native-render` feature maps those parts to the existing renderer.

The Rust implementation was transferred from the clean Aphrody owner and
normalized to upstream default rustfmt. Original input hashes and formatted
output hashes are retained.
[transfer-receipt.json](transfer-receipt.json) records the exact revision, Git
blobs, source hashes and verified registry dependencies. Package and library
identities, public APIs, original test sources and Apache-2.0 headers are retained.
The workspace's [Apache license](../../LICENSE-APACHE) applies.

The local `../m3-tokens` crate is the single design-token engine. The workspace
patch routes the published identity and renderer token dependencies to it.
Taffy and renderer registry Rust sources match their existing owner files.
Identity is consumed through its existing measured-seed API with fs/net disabled.

Native rendering remains enabled by default. Host-neutral and WASM consumers
select `default-features = false`; `wasm` is a target marker. COSMIC adapters
consume these controls and visual contracts instead of defining another framework.

Pre-format compilation evidence is recorded in the transfer receipt. Formatting
was checked without rebuilding during host recovery. Compilation alone
does not qualify a displayed GUI, renderer output, application behavior or
publication. Original source retirement follows the consumer owner handoff.
