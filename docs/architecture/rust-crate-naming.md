<!-- SPDX-License-Identifier: Apache-2.0 -->

# Rust crate naming across Aphrody and IECODE

New Aphrody platform packages use the Cargo package namespace `aphrody-` in
both monorepos. Name a package `aphrody-<domain>-<capability>` when a domain has
multiple crates: `aphrody-web-crawl` belongs to Aphrody and
`aphrody-nie-formats` belongs to IECODE. A domain facade can use
`aphrody-<domain>` (`aphrody-web`); a shared capability can use
`aphrody-<capability>` (`aphrody-gpu-backend`). The established CLI package
`aphrody` is the root-name exception.

Use short English capability names and avoid repeating `aphrody` in the
suffix. For new owned crates, the last directory component matches the Cargo
package name. Aphrody crates live under `crates/<domain>/<package>`; NIE crates
live under IECODE's `crates/nie/aphrody-nie-<capability>`.

Cargo package names are canonical. Rust library targets normally use the same
name with underscores. Keep a legacy `[lib]` or `[[bin]]` name explicitly if
existing imports or user commands rely on it. Local dependencies select the
canonical package through the owning workspace; aliases are for deliberate
source compatibility only.

Migration does not rename a published or imported package on sight. The imported
Obscura/Taffy packages retain their upstream names. The Koharu ML base became
`crates/ml` with `aphrody-*` packages on 2026-10-05, because crates.io holds older
`koharu-*` releases under the upstream names; its library targets follow
(`aphrody_llama`, ...). A consumer that keeps `koharu_*` paths aliases the dependency
(`koharu-llama = { package = "aphrody-llama", version = "0.83.5" }`). IECODE's active
Bevy, wgpu, Naga and Dust fork packages already use `aphrody-` package identities
across their local graphs while preserving upstream Rust library target names. Other
vendor source keeps its upstream identity and provenance until a complete, measured
graph migration is needed.
