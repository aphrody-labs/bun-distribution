<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-ai: agent rules

AI runtime, models, RAG, OCR/voice, training, CLI and app-server.

Follow the [workspace rules](../workspace/AGENTS.md) and the user's global agent policy.
**NHITL:** execute authorized work without approval prompts or interactive questions;
choose routine details autonomously and report actual blockers. These local rules
add repository constraints, not a separate approval workflow.

## Local constraints

- Keep CLI/MCP/FFI adapters thin over reusable libraries. Hosts reach AI through
  `aphrody app-server` over stdio JSON-RPC; siblings never link back to AI.
- Contracts owns wire types; OS owns jobs/processes; Infra owns destinations.
  Use relative sibling dependencies and check affected consumers when APIs change.
- Read [PITFALLS](./PITFALLS.md) before changing runtime/toolchain boundaries.
  Commit `Cargo.lock` only when resolved against the siblings' pushed revisions.
- Check touched opt-in features explicitly. Python work follows [py/AGENTS.md](./py/AGENTS.md).
- Documentation work follows [the pipeline](./DOCUMENTATION-PIPELINE.md), including
  `aphrody-summary` regeneration; never edit generated mirrors by hand.

<a id="3-honest-delivery"></a>

## Validation

`bun run scan` remains a compatible entry point for `yolo ops repository-health`.

Documentation-only changes need links/anchors and `git diff --check`; use the
repository documentation generator where required. For implementation/release
work, run `bun run verify:release` for the central deterministic release gate, then the applicable owner gates below with
`RUSTC_WRAPPER=` and the pinned toolchain. Record unrun or failing checks.

```sh
cargo check  --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo test   --workspace
cargo deny check
aphrody summary -- --check
bun install --frozen-lockfile && bun run typecheck && bun run test
git diff --check
```

Layout and entry points: [README](../../products/ai/README.md). Reuse the
[ecosystem inventory](../../ecosystem/ECOSYSTEM.md) before adding code.

## Automatisation transversale

`bun run ecosystem:check`, `bun run ecosystem:sync` et `bun run runtime:check` délèguent à `yolo ops` du paquet `@aphrody/workspace`. Conserver cette entrée locale lors de toute évolution du module central.

`bun run agents:sync` actualise le contexte agent depuis `~/src` avec `yolo ops agent-home`.
`bun run plugins:sync` centralise la synchronisation du plugin Aphrody via `yolo ops agent-plugin-sync`.
