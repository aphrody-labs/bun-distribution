<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
# Archived Drive interface source

This directory is a non-buildable source archive from Spacedrive's FSL-1.1-ALv2 interface.
The desktop and optional HTTP hosts both use [`packages/app-ui`](../../../../../packages/app-ui);
shared React components live in `packages/m3-*`, and Drive contracts and behavior live in
`drive/packages/ts-client`, `drive/core`, and `crates/aphrody-drive`.

The archived source is excluded from the root and Drive Bun workspaces. It has no package
manifest, exports, or build configuration. Its 40 divergent and 32 FSL-only paths remain for
provenance and product-code review. A path-level SHA-256 inventory records 203 same-path
byte-identical files; byte identity alone does not authorize removing FSL copies. See the
[source audit](../../../../architecture/design/DRIVE-INTERFACE-SOURCE-AUDIT.md) and
[hash inventory](../../../../architecture/design/drive-interface-source-hashes.json). Do not import from this
directory or restore it as a runnable application.

Ownership and migration gates: [`SPACEUI-SPACEDRIVE-MIGRATION.md`](../../../../architecture/design/SPACEUI-SPACEDRIVE-MIGRATION.md).
The applicable FSL-1.1-ALv2 terms are in [`drive/LICENSE`](../../../../../packages/canvas/vendor/LICENSE).
