<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-native: agent rules

Rust host topology, clock and CUDA probes.

Follow the [workspace rules](../workspace/AGENTS.md) and the user's global agent policy.
**NHITL:** execute authorized work without approval prompts or interactive questions;
choose routine details autonomously and report actual blockers. These local rules
add repository constraints, not a separate approval workflow.

## Local constraints

- No sibling dependencies. Preserve consumer APIs or migrate their owners explicitly.
- Inference belongs to its application owners, not this probe crate.
- Hardware values come from real probes; document unavailable values.
- Document every unsafe invariant and preserve platform fallbacks.

## Validation

Documentation-only changes need links/anchors and `git diff --check`; use the
repository documentation generator where required. For implementation/release
work, run focused checks first, then the applicable owner gates below with
`RUSTC_WRAPPER=` and the pinned toolchain. Record unrun or failing checks.

```sh
cargo fmt --all --check
cargo check --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo deny check
git diff --check
```

Layout and entry points: [README](../../products/native/README.md). Reuse the
[ecosystem inventory](../../ecosystem/ECOSYSTEM.md) before adding code.
