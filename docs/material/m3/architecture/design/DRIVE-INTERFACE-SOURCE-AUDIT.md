<!-- SPDX-License-Identifier: Apache-2.0 -->
# Drive interface source audit

The active Files surface is `packages/app-ui/src` in this repository. Its reusable M3 file
components are `packages/m3-explorer`, its daemon contract is `packages/drive-client`, and the
desktop host reaches the separately supervised `sd-daemon` through `crates/aphrody-drive`.

On 2026-10-20 the complete 287-file `packages/interface` tree was restored from
[SpaceDrive commit `4d41a379`](https://github.com/spacedriveapp/spacedrive/tree/4d41a379f612e23ac43a66ffd67df52ca77f57d4/packages/interface)
to [`../../reference/drive/packages/interface`](../../reference/drive/packages/interface), with
its upstream `LICENSE`, `NOTICE`, and a commit pointer. The tree remains below `docs/`, outside
the Bun and Cargo workspaces; the active UI continues to use the integrated M3/App UI owners.
This restored source archive is not evidence of feature or runtime parity.

The comparison below and [`drive-interface-source-hashes.json`](./drive-interface-source-hashes.json)
are the historical 2026-09-29 comparison of the earlier interface snapshot. They are not a hash
comparison of the newly restored `4d41a379` source against today's `packages/app-ui`.

| Same relative path | Files | FSL bytes | app-ui bytes |
| --- | ---: | ---: | ---: |
| Byte-identical | 203 | 895,318 | 895,318 |
| Divergent | 40 | 283,449 | 299,998 |
| FSL archive only | 32 | 197,135 | — |
| app-ui only | 48 | — | 383,523 |
| **Tree total** | **275 / 291** | **1,375,902** | **1,578,839** |

Identical means same relative path and SHA-256 for that historical snapshot. At the time, the
archived source had no active package-manifest consumer. The restored upstream package manifest
declares Apache-2.0; the imported daemon tree retains its separate FSL-1.1-ALv2 terms. Keep the
exact upstream license and notice files beside the recovered source. Active `packages/app-ui`
imports `@aphrody/drive-client` for Drive contracts and data behavior and `@aphrody/m3-explorer`
for shared M3 file controls.

## Deduplication decision

Keep `packages/app-ui` as the single maintained UI implementation. Keep the recovered upstream
tree as a non-workspace reference snapshot and use its README and `UPSTREAM.txt` as provenance
pointers to App UI and the Drive migration notes.
The 203 matching files identify substantial overlap, but byte identity does not establish the
license terms for replacing or deleting the corresponding FSL copies. The 40 divergent and 32
FSL-only paths also retain upstream code/history. Do not remove or relocate FSL source until a
path-level license review confirms the permitted treatment and preserves required notices and
provenance. This audit is a technical inventory, not a legal conclusion.

The SHA-256 manifest is a snapshot; regenerate it after edits to either source tree.
