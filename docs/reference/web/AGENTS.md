<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-web: agent rules

Obscura, browser/extraction engines, BXC, X clients and the web origin.

Follow the [workspace rules](../workspace/AGENTS.md) and the user's global agent policy.
**NHITL:** execute authorized work without approval prompts or interactive questions;
choose routine details autonomously and report actual blockers. These local rules
add repository constraints, not a separate approval workflow.

## Local constraints

- No Cargo or Bun dependency on AI. Use the OS/Contracts/Compat dependencies
  declared by manifests; UI canvas execution is a process boundary.
- Crate paths and public APIs are consumed by siblings: migrate/check consumers
  when changing them. Infra owns public routes, services and deployments.
- Record Obscura changes in `crates/aphrody-obscura/OBSCURA-UPSTREAM.txt`.
  Do not edit `apps/bxc/vendor/` (not in repo); BXC work also follows its local `AGENTS.md`.
- Commit `bun.lock` with manifest changes. Use nextest for process-global-state
  tests; keep environment-dependent skips explicit.

## Validation

Documentation-only changes need links/anchors and `git diff --check`; use the
repository documentation generator where required. For implementation/release
work, run focused checks first, then the applicable owner gates below with
`RUSTC_WRAPPER=` and the pinned toolchain. Record unrun or failing checks.

```sh
cargo check  --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run --workspace    # required: tests mutate process-wide env
cargo test --workspace --doc
cargo deny check
bun install --frozen-lockfile && bun run typecheck && bun run test
git diff --check
```

Layout and entry points: [README](../../products/web/README.md). Reuse the
[ecosystem inventory](../../ecosystem/ECOSYSTEM.md) before adding code.

## Automatisation transversale

Le contrôle des workspaces BXC est fourni par `yolo ops workspace-layout` via `apps/bxc` (not in repo). Conserver cette entrée locale lors de toute évolution du module central.
