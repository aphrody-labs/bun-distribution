<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-contracts: agent rules

Neutral protocol types, schemas, A2A, app-server and kernel client contracts.

Follow the [workspace rules](../workspace/AGENTS.md) and the user's global agent policy.
**NHITL:** execute authorized work without approval prompts or interactive questions;
choose routine details autonomously and report actual blockers. These local rules
add repository constraints, not a separate approval workflow.

## Local constraints

- No sibling path dependencies. Enforce the boundary with
  `yolo ops cargo-boundaries --root .`; UI and implementation code stay with consumers.
- Make wire changes additive or version them with their changelog and consumer migration.
  Workspace dependency/feature changes affect sibling consumers too.
- Keep A2A, agent-proto and app-protocol wasm32-safe. Keep `aphrody-a2a-slimrpc`
  excluded until its upstream blocker and all gates are resolved.
- Infra owns peer/service registries. Never set `A2A_PB_REGEN` while publishing.

## Validation

Documentation-only changes need links/anchors and `git diff --check`; use the
repository documentation generator where required. For implementation/release
work, run focused checks first, then the applicable owner gates below with
`RUSTC_WRAPPER=` and the pinned toolchain. Record unrun or failing checks.

```sh
export RUSTC_WRAPPER=            # sccache is not used
cargo check  --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test   --workspace         # or cargo nextest run --workspace + cargo test --doc
cargo fmt    --check             # not `--all`: that also formats path dependencies
cargo deny   check
yolo ops cargo-boundaries --root .
cargo check --target wasm32-unknown-unknown -p aphrody-a2a -p aphrody-agent-proto -p aphrody-app-protocol
git diff --check
```

Layout and entry points: [README](../../products/contracts/README.md). Reuse the
[ecosystem inventory](../../ecosystem/ECOSYSTEM.md) before adding code.

## Automatisation transversale

`just boundaries` délègue la vérification Cargo à `yolo ops cargo-boundaries`. Conserver cette entrée locale lors de toute évolution du module central.
