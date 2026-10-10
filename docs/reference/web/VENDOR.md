<!-- SPDX-License-Identifier: Apache-2.0 -->
# Vendored and patched third-party code

Triage of 2026-09-25 (aphrody-infra PLAN item 25). Every entry states the upstream, the local
delta, and the decision (keep / drop / move).

## `crates/web/taffy` (not in repo) — keep

| Field | Value |
| --- | --- |
| Upstream | <https://github.com/DioxusLabs/taffy>, crates.io `taffy` |
| Vendored base | `taffy` 0.12.1 (normalized crates.io manifest); latest published: 0.12.2 |
| License | MIT (upstream `LICENSE` kept in the directory) |
| Applied by | `[patch.crates-io] taffy = { path = ... }` the root `Cargo.toml` (`taffy = { path = "crates/web/taffy" }` in `[workspace.dependencies]`); any other workspace root whose graph reaches `obscura-render` needs its own `[patch]` |
| Consumer | `crates/web/obscura-render` (`taffy = "0.12"`) |

Local source changes against crates.io 0.12.2 (`diff -r --strip-trailing-cr`, added/removed
lines): `compute/grid/alignment.rs` +506/-34, `compute/float.rs` +138/-85,
`compute/flexbox.rs` +107/-19, `compute/grid/mod.rs` +76/-2, `tree/cache.rs` +47/-4,
`compute/grid/types/grid_item.rs` +47/-11, `compute/block.rs` +33/-31, `style/mod.rs` +33/-0,
`tree/taffy_tree.rs` +25/-3, `style/alignment.rs` +14/-0, `compute/grid/track_sizing.rs` +12/-2,
`style/grid.rs` +6/-0. They implement browser-compatible behaviour Obscura's renderer relies on
(flex `normal` alignment resolving to `stretch`, grid alignment/track sizing, float layout,
block margin-collapsing metadata during intrinsic sizing, layout cache fixes).

Decision: **keep**. 0.12.2 upstreamed only the block margin-collapsing fix; the flex, grid,
float and cache changes are not published, so switching to crates.io would change Obscura's
layout output. Retire the patch once an upstream release contains these changes: delete the
directory, drop every `[patch.crates-io] taffy` entry (`rg "crates/web/taffy" Cargo.toml`), and re-run the obscura-render
tests plus the screenshot fixtures.
