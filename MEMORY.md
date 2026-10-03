<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody — current project memory

Reviewed 2026-10-03 against the current plan, manifests and consumer source.

## Knowledge freshness

Use the actual session date and verify changing facts against current primary
sources, installed owner help and source evidence. Historical records retain
their dates and gate scope. Age alone does not invalidate stable facts or pinned
contracts. This file is project knowledge, not a replacement for model training
or evidence of provider-memory synchronization. See [AGENTS.md](AGENTS.md).

## Durable decisions

- [PLAN.md](PLAN.md) is the active plan: a precompiled native runtime based on
  the Bun fork, integrating Tauri and Obscura, produced in `/home/aphro/yolo`.
- Aphrody keeps product logic and consumes a lightweight SDK. Reduce application
  rebuilds by taking heavy engines out of consumer dependency graphs.
- Stable native boundary: C ABI, explicit ownership, cancellation, threading,
  version/capability negotiation. An rlib is not the cross-version SDK contract.
- JavaScriptCore convergence for Obscura is a staged port; keep V8 until parity.
  Native desktop WebViews retain platform engines. No claim of one engine everywhere.
- Preserve panic/unwind requirements at actual artifact boundaries. Do not infer
  effective profiles from crate names, lexical scans or per-package overrides.
- Retire an old dependency only after behavior, consumer build and rollback pass.
- Current producer slice: ABI 1.4, `system.stats`, `bench.compute`,
  `process.supervise`, `http.probe`; SDK `@aphrody/runtime-sdk` 0.1.0.
  First Aphrody consumer is `packages/web/agent-browser/src/engine.ts`.
  Permanent engine wiring is delivered in commit `7b362f10d`: the current engine
  imports the SDK and its package declares it through the catalog. Broader
  application migration and product qualification remain open.

## Evidence state

Yolo commits `01300fb2f935` and `0ade1c71ccb5` ship lossless byte capture,
joined native workers, Unix process-group teardown after leader exit, SDK
lifetime guards and 32 slots in the SDK-owned shared supervisor. Linux x64
runtime behavior: 31 Rust tests, strict Clippy and 36 SDK/release tests pass.
Other native targets pass metadata checks only. No heavy engine build or
cross-platform execution is inferred.

Aphrody pins SDK 0.1.0 archive `5334dbe9` from clean producer
`0ade1c71ccb52bcc9d255188a252c28c5b789b48`. The Linux x64 runtime is rebuilt
and installed locally through the release owner with matching embedded revision.
`engine.ts` and `service.ts` use the SDK-owned shared supervisor; service
`Bun.spawn`, consumer runtime singleton and manual exit-kill fallback are removed.
One-shot calls preserve bytes, errors, stderr, timeout and abort with an explicit
64 MiB per-stream budget. Agent-browser passes 50 tests. Exact consumer and
downstream gate scope is in
[the receipt](docs/migration/runtime-web-consumer-2026-10-03.json).

R3/R4, full R7 product migration, five-target distribution, JSC parity and
measured gains remain open. The next implementation is reproducible SDK/runtime
acquisition for a clean consumer checkout; then desktop and headless adapters.
The production sprint is in PLAN section 16. No product activation is claimed.
The earlier Rust usage report is lexical navigation; it is not a complete resolved
Cargo graph, execution audit or proof of panic profiles. Recheck selected manifests
before implementation, without restarting a repository-wide audit by default.

## History and operating pointers

- [Exact former plan and instructions](docs/plans/runtime/history/README.md).
- [Repository rules](AGENTS.md); [producer plan](../yolo/PLAN.md).
- Preserve existing product obligations and evidence in the archive.
- Workspace/Infra owns orchestration and the configured build factory.
- Serialize Cargo, preserve shared caches, work on the current branch and protect
  concurrent changes. UI implementation follows the package and crate owners here.
- Keep private stores and domain memories separate. No secrets in this file.

This is a checked-in project memory. Provider memory databases and other agents'
private conversation stores are not rewritten or claimed synchronized by it.

## Current ownership and selected stack — 2026-10-03

- UI application source is canonical in `packages/ui/app-ui` and `crates/ui/*`.
- The owner-selected [October stack report](docs/reference/workspace/STACK-REPORT-2026-10.md)
  records Dioxus 0.7.x for Rust full-stack applications within Tauri/Wry permissions,
  React 19 and Material 3 web components for applicative UI, and preservation of
  existing hosts with Cloudflare at the edge. Runtime production remains in Yolo;
  Aphrody retains product behavior and the lightweight SDK contract.
- Selection does not prove migration, identical behavior across WebViews, current
  hosting prices, or future capacity costs. Verify those claims for the selected task.
- Native session synchronization and the passive live observer were delivered in
  `bb0cfd33f`. The ingestion owner checks the kernel domain before writing, keeps
  conversations in their selected protected store, and publishes metadata only.
  This source receipt does not establish complete autonomy or historical backfill.
- Installed `aphrody memory --help` advertises `migrate`; `aphrody rag` requires
  an unavailable `rag` feature in the observed CLI. The local Agent Home memory
  reconciler ingests seven directive documents, excluding `MEMORY.md`; its presence
  does not prove a project knowledge index is refreshed.

## Optimization workflow — 2026-10-03

The private Aphrody plugin owns `optimize-workspace` and its optimize command.
Workspace provides `optimize` / `aphrody-optimize` as a thin entry to the existing
`aphrody exec` agent, with a no-agent `--print` mode. It reuses code-edit and owner
capabilities rather than implementing another refactoring engine. Installed skill
links and branch delivery must be verified separately; this entry alone proves
neither runtime migration nor performance gains.

Qualification: Workspace TypeScript, scoped oxlint/oxfmt and three orchestration
tests passed. Skill validation passed; provider manager installation succeeded
for Codex, Claude and agy in project scope. Claude/agy native validation passed;
Codex has no native validator in the registry and used manager validation. Codex
cached skill and project links were verified. docs:check failed on stale generated
STATE/README/documentation and ecosystem indexes; these were not regenerated in
this batch. No live model-driven optimization or performance gain is claimed.
