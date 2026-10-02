<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-shell: agent rules

Embedded Nushell, PTY lifecycle, Rio VT state and the Ratatui agent surface.

Follow the [workspace rules](../workspace/AGENTS.md) and the user's global agent policy.
**NHITL:** execute authorized work without approval prompts or interactive questions;
choose routine details autonomously and report actual blockers. These local rules
add repository constraints, not a separate approval workflow.

## Local constraints

- The subsystem, agent protocol and kernel client contracts belong to Contracts;
  no AI dependency. Desktop presentation belongs to UI and infrastructure to Infra.
- Preserve public APIs used by OS/UI/AI. Keep PTY ownership in `portable-pty`;
  Rio VT parsing is not a complete desktop renderer.
- Serialize tests that mutate process-global state. Preserve Linux and Windows support.
- Root Cargo patches must also be declared by consumer workspaces that need them;
  record each patch and its retirement condition in `patches/`.
- A cold Nushell build is slow: wait for the existing process instead of relaunching it.

## Validation

Documentation-only changes need links/anchors and `git diff --check`; use the
repository documentation generator where required. For implementation/release
work, run focused checks first, then the applicable owner gates below through
the serialized Cargo wrapper and pinned toolchain. Keep the global `sccache`
wrapper. Record unrun or failing checks.

```sh
scripts/build/rust/cargo-serial.sh check  --workspace --all-targets
scripts/build/rust/cargo-serial.sh clippy --workspace --all-targets -- -D warnings
scripts/build/rust/cargo-serial.sh test   --workspace
cargo deny check
cargo +nightly-2026-05-17 fmt --check
git diff --check
```

Layout and entry points: [README](../../products/shell/README.md). Reuse the
[ecosystem inventory](../../ecosystem/ECOSYSTEM.md) before adding code.
