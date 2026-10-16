<!-- SPDX-License-Identifier: Apache-2.0 -->
# Cargo workspace notes

Policy notes for the Rust workspace. The current build contract — toolchain
pin, sibling layout, gates — is in the [root README](../README.md#build-and-test);
where a page below disagrees with it (for example a nightly toolchain, a
`.cargo/config.toml` alias such as `cargo ci-offline`, or sccache), the README
wins: those pages predate the category-repository split and the retirement of
the monolith's `.cargo/config.toml`.

| Page | Content |
| --- | --- |
| [`PROFILES.md`](../../../reference/ai/cargo/PROFILES.md) | Cargo profiles (`dev`, `release`, `release-fast`, `dist`, `min`, ...). |
| [`LINTS.md`](../../../reference/ai/cargo/LINTS.md) | `[workspace.lints]` policy and per-crate opt-ins. |
| [`SUPPLY_CHAIN.md`](../../../reference/ai/cargo/SUPPLY_CHAIN.md), [`SECURITY-DEEP.md`](../../../research/ai/cargo/SECURITY-DEEP.md) | cargo-deny, advisories, supply-chain hardening. |
| [`FFI_POLICY.md`](../../../reference/ai/cargo/FFI_POLICY.md) | Rust / C / C++ / Bun FFI rules. |
| [`CROSS_PLATFORM.md`](../../../reference/ai/cargo/CROSS_PLATFORM.md), [`ANDROID_TARGET.md`](../../../reference/ai/cargo/ANDROID_TARGET.md) | Cross-compilation targets. |
| [`DEV-ENV.md`](../../../reference/ai/cargo/DEV-ENV.md) | Developer environment and `PATH`. |
| [`PUBLISH-LADDER.md`](../../../reference/ai/cargo/PUBLISH-LADDER.md) | crates.io publication runbook. |
| [`SKILLS.md`](../../../reference/ai/cargo/SKILLS.md) | Agent skills inventory and format. |
| [`CHROMIUM_ANDROID_PATTERNS.md`](../../../reference/ai/cargo/CHROMIUM_ANDROID_PATTERNS.md), [`GOOGLE_MODE.md`](../../../reference/ai/cargo/GOOGLE_MODE.md), [`MIGRATION.md`](../../../reference/ai/cargo/MIGRATION.md) | Adopted Google/Chromium practices and the C++ to Rust migration method (dated). |
