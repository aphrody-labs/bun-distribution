<!-- SPDX-License-Identifier: Apache-2.0 -->

# Migration records

`@aphrody/workspace` in `aphrody-infra` owns generation of source maps,
classification, duplicate reports, and import manifests. Each record identifies
its observed source revision and dirty state. No record is a delivery or parity
claim.

The first code-slice record is
[`ievr-iecode-extraction.json`](ievr-iecode-extraction.json). It covers only
IECODE's pure Rust IEVR data crate. The Bun native binding, generic Bun plugin
host, game-format plugin adapter, and `aphrody-mcp` integration are separate
surfaces with distinct ownership and validation requirements.

The IECODE Bun staging record is
[`iecode-bun-extraction.json`](iecode-bun-extraction.json). It records the
current FFI wrapper, the older incompatible NIE binding, the staged plugin,
and the extracted generic happy-dom preload. Typechecking is not native ABI or
MCP parity.

The source Rust boundary audit is
[`IECODE-RUST-READINESS.md`](IECODE-RUST-READINESS.md); the current NIE server
and plugin contract audit is
[`NIE-MCP-API-INVENTORY.md`](NIE-MCP-API-INVENTORY.md). The imported-document
link re-audit is
[`IMPORTED-DOCS-LINK-REAUDIT.md`](IMPORTED-DOCS-LINK-REAUDIT.md).
