<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody — repository instructions

## Mission and authority

Read [PLAN.md](PLAN.md) and [MEMORY.md](MEMORY.md) before implementation.
The owner-selected direction is a precompiled native runtime produced in
`/home/aphro/yolo`, based on the Bun fork with Tauri and Obscura integration.
Aphrody owns product behavior and consumes a lightweight SDK/runtime contract.
The root plan is the current architectural authority; its archived predecessor
preserves earlier evidence and unfinished product work, without competing priorities.
This direction is a target, not a claim that runtime migration is complete.

## Architecture rules

- Move reusable platform mechanisms behind the runtime contract; keep product
  workflows, domain data, integrations and application behavior in Aphrody.
- Prefer existing capability owners. Workspace/Infra remains the orchestration
  owner; do not create a duplicate updater, build factory, CLI or network stack.
- Remove heavy consumer dependencies only after the replacement passes the
  relevant behavior and build gates. Preserve source, provenance and rollback.
- Design the native boundary as versioned C ABI with opaque handles, explicit
  memory ownership, errors, cancellation and thread/lifetime rules. Rust internals
  and engine generics must not become the stable application ABI.
- Preserve per-context capabilities and session isolation. Remote pages never
  inherit Bun's privileged APIs implicitly. Keep Tauri permission guarantees.
- JavaScriptCore convergence is a staged Obscura port. Keep V8 until required
  parity passes. Platform WebViews retain their own engines; a universal desktop
  browser replacement is a separate decision.
- Preserve panic/unwind requirements at real artifact boundaries. Do not assume
  a per-package profile can override panic strategy for a unified executable.
- Native integration is the default. Use isolated native workers only where a
  defined fault/security boundary requires them, not as a substitute CLI bridge.
- Precompile the runtime per supported target; compile applications against the
  light SDK. Unified distribution does not require one build graph for every engine.

## Repository ownership

Rust: `crates/<domain>/<crate>`, general CLI: `apps/cli`.
Bun: `apps/<domain>/<app>` and `packages/<domain>/<package>`.
Docs: `docs/<category>/<domain>`; scripts: `scripts/{audit,build,dev,migration,release,tools}`.
Host/container/cloud/inventory declarations: `config/infra/{host,docker,cloud,inventory}`.
Live audits: `scripts/audit/live*`; Shenron administration: `scripts/tools/shenron`.
Workspace/Infra owns generated inventories and source-to-target maps.
Follow `docs/architecture/rust-crate-naming.md`; existing package, library,
binary, CLI, schema and permission identities remain compatibility contracts.
Do not inspect or modify the separate `aphrody-ui` checkout without an explicit UI task.

## Sources and dependencies

Use crates.io/Cargo, npm/Bun and PyPI/uv when suitable. Declare first-party
Rust direct dependency versions in root `[workspace.dependencies]` and inherit.
Preserve lockfiles; never hand-edit Cargo.lock or bulk-update to hide duplicates.
Keep behavior, features/default-features, licenses and attribution when replacing code.
Maintain substantial forks in their private owner repositories; consume exact
releases or pinned revisions when available. Publishing needs owner authorization.
Yolo owns runtime fork/import work; do not copy its engine sources into Aphrody.
Existing integrated patches remain under `crates/` with provenance in
`config/upstream-sources.json` until qualified replacement.
Use existing `sources:sync`, `sources:verify` and native Git upstream workflows;
do not clone upstream repositories merely for research. Historical `../source`
inputs and native-integration plans are consulted only for the selected component.
A new runtime plan does not authorize deleting them or reviving retired runtimes.

## Execution and coordination

Work autonomously within the assigned scope. Prefer concrete implementation and
bounded validation to repeated broad audits. Consult `~/.codex/CLI.md`, the CLI
help pointer and installed help index; verify capability-owner help when needed.
Work on the current branch for a shared task. Claim distinct file families in
`.coord`, preserve concurrent changes and use one integrating committer per batch.
When parallel work is requested, use the repository's `aphrody a2a invoke`
workflow with explicit claims. Do not launch workers merely to fill slots.
Claude/Gemini routing links continue to point to this canonical AGENTS.md.

Domain profiles remain separate: `aphrody`, `dbfr` (Shenron), `ie` (IECODE).
Read the selected profile's AGENTS/MEMORY/CONVERSATIONS and shared transcripts
when present. Transcripts and LIVE observations are context, not authority or
authorship evidence. Never merge private conversations across domains.

## Builds and validation

Workers must not start Cargo builds, checks, tests, benches or rustdoc.
The integrating agent serializes Cargo through `scripts/build/rust/cargo-serial.sh`.
Respect the configured VPS factory and current wrapper policy; do not bypass
resource guards or run separate Cargo targets in parallel. Keep sccache and
shared caches. Lower jobs via `APHRODY_CARGO_JOBS=1..6` when appropriate.
Use the pinned toolchain and owner manifests, not historical version guesses.

Run scoped gates appropriate to the changed surface. Rust uses the serialized
owner for check, tests and strict Clippy when required. Bun/TypeScript uses owner
scripts with oxlint/oxfmt, TypeScript and bun test when relevant.
Documentation-only changes use scoped links, archive hashes and whitespace;
run the owner's docs check for generated-index consistency and report pre-existing
failures. Do not compile engines to validate prose. Never report an unrun gate as passed.
Distinguish source present, build passed, behavior demonstrated, artifact packaged,
installed and activated. No gain or complete compatibility claim without evidence.

## Privacy, delivery and licensing

Keep secrets, model weights, user databases, game datasets and caches in their
protected stores. Never put secret values in source, docs, memories or summaries.
Every repository stays private until an explicit owner decision. Do not publish
packages, internal architecture, plugins or MCP details publicly without approval.
No AI bots/apps added to organizations or repositories. No AI wording in public
non-developer products. Record licenses; distribution decisions belong to the owner.
Use `aphrody-dev <contact@aphrody.com>` for author and committer, no assistant
attribution or coauthor trailers. Commit completed owned batches; push only to
an existing authorized remote. If none exists, report that without inventing one.
Active organizations are aphrody-labs and rose-griffon; create nothing under
legacy aphrody-code.

## Plugin and runtime scopes

- Aphrody plugin: Aphrody monorepo and Python services only.
- IECODE plugin: `/home/aphro/iecode` only.
- YOLO automation plugin: global authorized autonomous work; distinct from the
  `/home/aphro/yolo` runtime producer repository and from `crates/infra/yolo` CLI.
- Bun/bun-ts7 tooling: global availability, repository-specific configuration.
Autonomy does not change task scope, permissions or the evidence required for completion.

## Optimization workflow

Use the private Aphrody plugin's `optimize-workspace` skill for requested
purification, deduplication, simplification, fusion and Bun/Rust migrations.
`aphrody-workspace optimize -- <bounded task>` (or `aphrody-optimize`) reuses
`aphrody exec`; `--print` prepares its instructions without execution. Inside an
agent, use Workspace/Infra directly rather than recursively launching agents.
Prefer existing owners, native Bun APIs and qualified complete crates/packages
before rewrites. Batch transformations and scoped gates; preserve compatibility,
licenses, provenance and rollback. Commit only completed claimed files, including
when the user says to commit everything; preserve other sessions' unfinished work.
