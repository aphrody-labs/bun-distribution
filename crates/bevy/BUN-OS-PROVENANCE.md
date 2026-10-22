# Bevy in Bun OS: provenance

Bevy is absorbed into the Bun OS workspace with its full history. It is no longer a crates.io
dependency or a submodule: the Bevy crates are root Cargo workspace members built from this tree.

| Item | Value |
| --- | --- |
| Upstream | https://github.com/bevyengine/bevy |
| Tag | `v0.20.0` (Release 0.20.0, wgpu 30) |
| Upstream commit | `b3bdd75becaffe9a16677cf5bae5bd6d198f052b` |
| Fork | https://source.aphrody.app/aphrody-dev/bevy (full upstream import, branch `bun-os` at `v0.20.0`) |
| Rewritten tip | `b476e646b56e3ec4d3da8cc8d5f913e9bb76f91e` (upstream commit after the path rewrite) |
| History | 12251 commits, rewritten with `git filter-repo --prune-empty never --prune-degenerate never` |

Every upstream commit is kept (none pruned), with original authors, dates and messages; only paths
change. Bun OS commits are merged on top.

## Path mapping

| Upstream | Bun OS |
| --- | --- |
| `crates/<bevy_*>` | `crates/<bevy_*>` (no name collision with existing Bun OS crates) |
| root package and repository files (`Cargo.toml`, `src/`, `assets/`, `examples/`, `tests/`, `tests-integration/`, `benches/`, `errors/`, `constants/`, `docs-rs/`, `.cargo/`, `README.md`, `CREDITS.md`, `LICENSE-*`, `clippy.toml`, `rustfmt.toml`, `deny.toml`, `typos.toml`, `.gitattributes`, `.gitignore`) | `crates/bevy/` |
| `docs/` | `docs/bevy/` |
| `docs-template/` | `docs/bevy/docs-template/` |
| `_release-content/` | `docs/bevy/release-content/` |
| `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md` | `docs/bevy/` |
| `tools/` | `tools/bevy/` |
| `.github/` | dropped (GitHub Actions and templates; Bun OS CI runs on the forge) |

Historical paths follow the same rules, so `git log --follow` works across the rename.

## Workspace integration

- Bevy's `[workspace]` is removed from `crates/bevy/Cargo.toml`; its members are root members
  (`crates/bevy`, `crates/bevy_*`, the three `compile_fail` suites, `crates/bevy/benches`,
  `crates/bevy/errors`, the example crates, `tools/bevy/ci` and the flat tool crates `crates/build-*`, `crates/example-showcase`, `crates/export-content`). `crates/bevy/tests-integration`,
  `crates/bevy/examples/mobile/android_basic` and `crates/bevy_color/crates/gen_tests` stay
  outside the workspace, as upstream.
- Bevy's `[workspace.lints]` are written per crate, combined with the root lints at the stricter
  level (`unsafe_op_in_unsafe_fn`, `unused_must_use`, `todo`, `unimplemented`, `dbg_macro` deny).
  Crates that upstream left unlinted keep an empty `[lints]` table.
- Profiles: `stress-test` and `dev.package.bevy_mobile_example` move to the root; the root
  `wasm-release` profile is kept over Bevy's.
- Paths that crossed the old repository root are rewritten: `../bevy_*` siblings,
  `crates/bevy/src/lib.rs` docs from `docs/bevy/cargo_features.md`, `constants` in the
  wgsl-analyzer metadata, `crates/compile_fail_utils`, and the tool inputs under
  `docs/bevy/`. Tools that read the umbrella manifest run from `crates/bevy`.
- The root `[workspace.dependencies]` pins `bevy`, `bevy_*`, `iecode-bevy-*` point at these
  path crates (version 0.20.0); `wgpu` stays unified at 30.

## Licenses

Bevy is dual-licensed MIT OR Apache-2.0. `crates/bevy/LICENSE-MIT`, `crates/bevy/LICENSE-APACHE`,
`crates/bevy/CREDITS.md` and every per-crate license notice and asset credit are kept unchanged.
