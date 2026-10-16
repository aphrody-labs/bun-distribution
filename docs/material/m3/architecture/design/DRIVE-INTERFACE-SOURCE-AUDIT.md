<!-- SPDX-License-Identifier: Apache-2.0 -->
# Drive interface source audit

Snapshot of `drive/packages/interface/src` (FSL-1.1-ALv2 archive) against the active
`packages/app-ui/src` (not in repo). Per-file SHA-256 and byte counts are in
[`drive-interface-source-hashes.json`](./drive-interface-source-hashes.json).

| Same relative path | Files | FSL bytes | app-ui bytes |
| --- | ---: | ---: | ---: |
| Byte-identical | 203 | 895,318 | 895,318 |
| Divergent | 40 | 283,449 | 299,998 |
| FSL archive only | 32 | 197,135 | — |
| app-ui only | 48 | — | 383,523 |
| **Tree total** | **275 / 291** | **1,375,902** | **1,578,839** |

Identical means same relative path and SHA-256. No cross-path duplicates were found. The archive
contains no `package.json` or build configuration and is excluded by the root Bun workspace
patterns. No active in-repository manifest depends on `@aphrody/drive`; the desktop Tauri host
builds `@aphrody/app-ui`, and optional `@aphrody/drive-web` depends on the same package. Active
app-ui imports `@aphrody/drive-client` for Drive contracts and data behavior. The legacy source
imports are not workspace consumers.

## Deduplication decision

Keep `packages/app-ui` (not in repo) as the single maintained UI implementation. Keep the FSL tree as a
non-buildable archive and use its README as the pointer to app-ui and the Drive migration notes.
The 203 matching files identify substantial overlap, but byte identity does not establish the
license terms for replacing or deleting the corresponding FSL copies. The 40 divergent and 32
FSL-only paths also retain upstream code/history. Do not remove or relocate FSL source until a
path-level license review confirms the permitted treatment and preserves required notices and
provenance. This audit is a technical inventory, not a legal conclusion.

The SHA-256 manifest is a snapshot; regenerate it after edits to either source tree.
