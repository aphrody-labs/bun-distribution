<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody — current project memory

Updated 2026-10-03 by owner-requested direction change.

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
- First producer slice: ABI 1.3, `system.stats`, `bench.compute`,
  `process.supervise`, `http.probe`; SDK `@aphrody/runtime-sdk` 0.1.0.
  First Aphrody consumer is `packages/web/agent-browser/src/engine.ts`.
  Permanent SDK wiring and product qualification remain pending.

## Evidence state

The initial direction-change batch changed documentation only. Synchronization
on 2026-10-03 read clean Yolo HEAD `07419cffb4beeb0f104b33a75cb23ea4a1c06def`:
R0/R1, R2 consumer patch, D0 local installation and D2 server archive are recorded
as passing on Linux x64 by the producer. Independently rerun here:
`bun test test/runtime_sdk.test.ts test/runtime_release.test.ts`: 28 pass,
0 fail, 0 skipped, against precompiled artifacts; no Cargo or engine build run.
The packaged ABI 1.3 artifact records source `ad8d4e148e755b50d00c683c4df83296d68829c8`
with `dirty: true`, not a clean build of the observed HEAD. See [PLAN.md](PLAN.md)
section 14 for provenance, hashes, gate scope and producer links.
The current Yolo CLI also contains the Aphrody owner-CLI bridge, factory `ship`
and pre-push hook tooling; remote builds and hook activation were not verified here.

The R1 host is `bun:ffi` + `Bun.plugin` preload; the Bun fork was not modified.
Desktop/browser modules are reserved. The agent-browser patch was tested then
reverted; current Aphrody still uses `Bun.spawn` without an SDK dependency.
R2 removes supervision code, not the Obscura binary (R4). R7 belongs to Aphrody:
wire the pinned SDK archive and patch, qualify the package and downstream products.
D1 release/upgrade, R3/R4, D3/D4, JSC/V8 parity and R8 remain open. No build
reduction, measured gain, cross-platform qualification or product activation
is established by this synchronization. Existing imported code is an input,
not completion evidence.
The earlier Rust usage report is lexical navigation; it is not a complete resolved
Cargo graph, execution audit or proof of panic profiles. Recheck selected manifests
before implementation, without restarting a repository-wide audit by default.

## History and operating pointers

- [Exact former plan and instructions](docs/plans/runtime/history/README.md).
- [Repository rules](AGENTS.md); [producer plan](../yolo/PLAN.md).
- Preserve existing product obligations and evidence in the archive.
- Workspace/Infra owns orchestration and the configured build factory.
- Serialize Cargo, preserve shared caches, work on the current branch and protect
  concurrent changes. The separately owned aphrody-ui checkout needs a UI assignment.
- Keep private stores and domain memories separate. No secrets in this file.

This is a checked-in project memory. Provider memory databases and other agents'
private conversation stores are not rewritten or claimed synchronized by it.

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
