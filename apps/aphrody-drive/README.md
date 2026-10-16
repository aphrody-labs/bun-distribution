<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->

# Drive backend migration workspace

This nested Cargo workspace contains the additive OS-owned copy of the
Spacedrive Drive backend. Its imported source is licensed under
[FSL-1.1-ALv2](LICENSE), separate from the Apache-2.0 Aphrody OS workspace.
The source snapshot comes from `../aphrody-ui/drive` at Aphrody UI commit
`0511c85ae556b888d349fcf9af275ed926d141d1`. The original project is
[`spacedriveapp/spacedrive`](https://github.com/spacedriveapp/spacedrive).
The import keeps its crate names, API, data layout, migrations, CLI, daemon,
native patches and bundled data-source adapters. The UI desktop build helper
prefers this daemon and falls back to its retained copy for standalone checkouts;
installed runtime and data parity remain unqualified.

## Boundaries

- `core/` owns Drive's operations, persistence, indexing, sync and `sd-daemon`.
- `crates/`, `crates/infra/aphrody/`, `xtask/`, `patches/` and `adapters/` stay beside core
  because core and CLI use them at build or runtime.
- The HTTP site belongs to `aphrody-web/crates/aphrody-site` and is absent here.
- The desktop/web UI and TypeScript client remain in `aphrody-ui` until their
  consumers are migrated against this backend.
- `sd-images` retains SVG rasterization using `resvg 0.47`, system fonts,
  dimensions and straight-alpha RGBA equivalent to the current
  `aphrody-svg::raster` call. This local adapter avoids an OS to UI Cargo edge;
  the four changed imported files and `svg_raster.rs` are the only backend
  source differences from the UI copy at import.

`cargo check --manifest-path drive/Cargo.toml -p sd-core --bin sd-daemon`
qualifies compilation. It does not prove data migration, service startup,
feature parity or a safe runtime cutover. Keep the retained UI source and
wire clients until those checks and runtime migration are completed.

## Known safety gap

[`crates/archive/src/safety.rs`](crates/archive/src/safety.rs) is a stub whose
batch screening returns score 0 and safe for every record. The archive engine
currently logs “safety screening model loaded (Prompt Guard 2 22M)” after
constructing that stub. The fallback in `engine.rs` can also mark unscreened
records safe. Therefore active prompt-injection screening is **not** proven
and must not be advertised as protection. Resolve this with the AI-owned
model service and an explicit contract before claiming that capability.

See the [OS architecture](../../docs/aphrody/architecture/os/ARCHITECTURE.md) for repository ownership.
