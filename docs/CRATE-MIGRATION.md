# Flat crate migration

The root owns the Cargo workspace, nightly, shared dependency versions and
outputs. Each migrated product crate lives at `crates/<package-name>` as a
pinned forge Git submodule, retaining its source history and license notices.

Inspect immutable manifests before choosing a migration batch:

```sh
bun scripts/crate-inventory.ts aphrody=../aphrody material=../material
```

The command reads tracked Git objects at each source revision, rather than
scanning generated directories or modifying active checkouts. Its report is
written to the ignored `.local/crate-inventory.json`. It records source pins,
package identities, dependency names, proposed destinations and collisions.
The source names and extra checkout paths are explicit arguments.

`crates` counts all tracked package manifests, including nested, vendored and
fixture packages. `declaredWorkspaceCrates` counts root manifests and explicit
root workspace members after exclusions; it is not Cargo metadata's complete
automatically included dependency closure. `remainingDeclared` identifies
unmigrated declared members. Unavailable submodules are reported explicitly.

Shared source copies and generic names such as `xtask` must be reconciled
before importing them into one Cargo namespace. A proposed path in the report
does not constitute migration or a new repository. Imported libraries retain
their existing workspace until consumers, manifests, assets, histories and
native gates have actually switched. The font, atomic and selected craft-libs
crates now implement this contract; later batches should extend this record.

## craft-libs batch

The five crates below are independent Git submodules and members of the single root Cargo
workspace. Their source history is split from `aphrody-labs/craft-libs` at
`e9546e191dd62f2bc1d61eca45dbdc2f1b3c1d8e`; each split commit's tree matches its source crate
directory. No nested Cargo workspace or lockfile is carried into a crate repository.

| Crate | Source prefix | Flat history SHA | Internal workspace edge |
|---|---|---|---|
| `craft-settings` | `crates/settings` | `e5398ed4c44cd1169b3e737dfb9e89f3d50b2228` | `craft-atomic` |
| `craft-cms` | `crates/cms` | `b7c8aa0852fcf1b63cbfcc7e1c3d29728a322397` | — |
| `craft-print` | `crates/print` | `af397671180b55681be312c549355562c2f6d931` | — |
| `craft-quit` | `crates/quit` | `deee19612f25d2627cc97b07a59760a9c26974bb` | — |
| `craft-ui` | `crates/ui` | `49c2c2265a72ea81525907d01310e73187e0a4d0` | — |

`LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE` and `ATTRIBUTION.md` are copied from the source
repository root into each crate repository. `craft-settings` also carries the settings policy
document; `craft-ui` carries its UI audit, docking, theme and visual-regression documents. ICC
profiles and the FOGRA39 test data remain with `craft-cms`.

The crate package version, edition and Rust version inherit from this root workspace. Each
manifest retains its upstream dual-license expression and source repository metadata. Dependency
versions are pinned once in `[workspace.dependencies]`, with package-specific feature additions
kept at each use site. `winprint` remains on the reviewed immutable Git revision because the
maintained fork preserves terminal error/cancellation reporting and bounds completion waits.

The source's `craftrules` URL could not be retrieved during migration, so no unavailable rules were
recreated. The available source `AGENTS.md` and `CLAUDE.md` lint policy is retained in the crate
manifests. Native Windows Clippy and test gates remain pending the root Cargo build window; metadata
and formatting qualification do not substitute for those gates.

## Dependency updates

Registry versions were checked against the crates.io API and Cargo registry on 2026-10-13. This
batch uses `dirs 7.0.0`, `toml_edit 0.25.17`, `tempfile 3.27.0`, `rayon 1.12.0`, `moxcms 0.9.1`,
`roxmltree 0.21.1`, `miniz_oxide 0.9.1`, `egui`/`egui_extras`/`egui_kittest 0.36.2`,
`serde_json 1.0.154`, `objc2 0.6.5`, `objc2-app-kit 0.3.2`, `dispatch2 0.3.1`, `muda 0.21.2`,
and `winsafe 0.0.29`. Shared `serde 1.0.229` and `image 0.25.10` retain the root versions.

`roxmltree 0.21` changed `Node::attribute` to match local names, and added external-entity
resolution. `craft-print` only queries unqualified PrintTicket names, so no call-site adaptation is
needed. `miniz_oxide 0.9.1` is used as the latest stable release. Upstream issue
[#200](https://github.com/Frommi/miniz_oxide/issues/200) documents a conservative slow-copy choice
in a secondary decompression path; the fast bulk path is described as unaffected. This workload
has not yet been benchmarked on Windows, so its performance impact remains unmeasured.

The root lockfile still contains older *transitive* releases constrained by other upstream crates:
`image 0.25.10` uses `moxcms 0.8.1`, `png 0.17.16`/`0.18.1` use `miniz_oxide 0.8.9`,
`usvg 0.45.1` uses `roxmltree 0.20.0`, and older `objc2` ecosystem crates use `objc2 0.5.3`.
The five migrated crates declare the workspace versions above directly; this batch does not patch
those upstream semver ranges or claim that every transitive dependency in the full product lockfile
is on the same release.

## Independent Craft library batch

Four self-contained product crates were split from their immutable source pins into dedicated private Gitea repositories. The split commit tree was checked against the source crate-prefix tree. Root Cargo membership and shared dependency declarations are centralized separately; this batch does not edit root manifests or locks.

| Crate | Source pin and prefix | Split commit | Root dependency |
|---|---|---|---|
| `deckcraft-matroska` | DeckCraft `1660982e58ee48fd9f9bef6dc2620d78ada04613`, `crates/matroska` | `4fafa1e454df18f72baaf1f01fc0a00afc363a50` | none |
| `pdfcraft-compare` | PdfCraft `7437bde378f43856eada40af25b983812e615e8a`, `crates/compare` | `1e3fd4405fd3268b511ce738d1a55497fb3d399e` | none |
| `cadcraft-color` | CADCraft `00c7613f1af3c73f7157fa91d9fe2635c6f23c06`, `crates/color` | `28bf2b1c25926aca9f63abeeccc4e1b70e22a445` | root `serde` |
| `gridcraft-pdf` | GridCraft `84acf6293b1dc1fc09837524e035d674eb4d6741`, `crates/pdf` | `379d3266749b03ffd031b208d337612cfcc4504f` | none |

Each flat manifest points to the root workspace, inherits version 1.4.4, edition and Rust version, and declares the upstream `MIT OR Apache-2.0` expression locally because the distribution root is MIT. Package lint tables preserve the source workspace's effective Rust and Clippy rules; extra DeckCraft/CADCraft/GridCraft allowances are not added to the global workspace. Repository metadata points to each new canonical source. `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE` and `ATTRIBUTION.md` are copied byte-for-byte from the corresponding source pin. The Adobe AFM metrics permission and attribution comment remains intact in `gridcraft-pdf/src/metrics.rs`.

Root integration now includes all four crates in the twelve-member Cargo
workspace. Each crate has a shared path dependency declaration; only
`cadcraft-color` needs the existing root serde version. Locked metadata and
root formatting pass on native Windows. The full offline feature graph resolves
526 package identities against the unchanged 514-package vendor source snapshot.
Compilation, Clippy and tests remain pending the release owner's native window.

| Crate | Pinned forge `os` revision after root formatting |
|---|---|
| `deckcraft-matroska` | `0b81b6f11085ad571f6705bfbb940b48e1a2eeae` |
| `pdfcraft-compare` | `28ab78b38b9062f5cd47d6289a19b1262eb0ed74` |
| `cadcraft-color` | `c3734c8787556b2bac99de433af9ffab84555cdd` |
| `gridcraft-pdf` | `dd5f4656384ee36ebaf37a073f4d2e875d8b9c6f` |

Formatting commits preserve each original split history. The license/notice
files and Adobe permission comment remain byte-identical to their source pins.
