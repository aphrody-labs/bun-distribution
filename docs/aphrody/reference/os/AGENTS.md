<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-os: agent rules

Privileged user-space kernel, WinClean, jobs, process policy and system capabilities.

Follow the [workspace rules](../workspace/AGENTS.md) and the user's global agent policy.
**NHITL:** execute authorized work without approval prompts or interactive questions;
choose routine details autonomously and report actual blockers. These local rules
add repository constraints, not a separate approval workflow.

## Local constraints

- `aphrody-kernel` owns durable OS authority. Expose agent capabilities through
  `SystemSubsystem`; the shared contract lives in Contracts.
- No AI dependency. Higher-layer Web/UI capabilities run through supervised MCP
  plugins; avoid reverse Cargo edges and duplicate command surfaces.
- Windows administration uses WinClean through the kernel. Elevate only the
  required command; do not claim an installed driver/service without evidence.
- Enforce configured identity/policy and reject unsupported restrictions. Agent
  NHITL does not bypass authentication or manufacture sandbox support.
- Keep source/runtime inventories distinct. See [architecture](../../architecture/os/ARCHITECTURE.md)
  and [remaining production work](../../architecture/os/ARCHITECTURE-GAPS-STATUS.md).

## Validation

Documentation-only changes need links/anchors and `git diff --check`; use the
repository documentation generator where required. For implementation/release
work, run focused checks first, then the applicable owner gates below with
`RUSTC_WRAPPER=` and the pinned toolchain. Record unrun or failing checks.

```sh
export RUSTC_WRAPPER=                 # sccache is not used
cargo fmt --check
cargo check --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo deny check
bun install --frozen-lockfile && bun run typecheck
cargo build -p aphrody-kernel && bun run test
git diff --check
```

Layout and entry points: [README](../../products/os/README.md). Reuse the
[ecosystem inventory](../../ecosystem/ECOSYSTEM.md) before adding code.

## Automatisation transversale

`scripts/tools/os/scripts/fix-all.nu` conserve son entrée Nushell et délègue les liens, références, dépendances et contrôles au module `yolo ops workspace-repair`. Conserver cette entrée locale lors de toute évolution du module central.

`bun run check:runtimes` utilise `yolo ops runtime-versions` pour la gate Bun/uv.

`scripts/tools/os/scripts/strip-ai-trailers.nu` conserve la syntaxe historique et délègue à `yolo ops git-attribution`; son action reste limitée à la branche explicitement fournie.

`scripts/tools/os/scripts/repair-cargo-p.nu` est l’entrée compatible de `yolo ops cargo-package-repair`.
