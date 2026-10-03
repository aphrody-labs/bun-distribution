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
- First proof: one native capability, one lightweight Aphrody consumer, no engine
  rebuild for application changes. Capability/API naming is not yet selected.

## Evidence state

The current task changes plans, instructions and memory only. No runtime phase,
build reduction, JSC port, artifact delivery or production activation is proven
by these documents. Existing imported code is an input, not completion evidence.
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
