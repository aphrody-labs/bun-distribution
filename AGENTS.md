<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody repository instructions

## Authority and scope

Read [PLAN.md](PLAN.md) and [MEMORY.md](MEMORY.md). PLAN owns the active
architecture and queue; MEMORY owns dated evidence. Aphrody owns products and
Rust/Bun capabilities; Yolo produces the precompiled runtime/SDK. IECODE retains its
repository, store and authority. By owner directive of 2026-10-05 `py/` is fused into
Aphrody (single owner for the `aphrody-rust` binding: `crates/ai/rag-python`); the Python
runtime `vu` follows the Bun/Yolo precedent ([plan](docs/plans/vu/PLAN.md)).

Product positioning (owner directive of 2026-10-06): the runtimes (the Bun fork, `vu`, Yolo) are
the real Aphrody products. Aphrody AI is a backend serving the apps; M3 and app-ui are
frameworks, not products. Prioritise, document and release accordingly.

Work autonomously through authorized implementation, gates, commit and push,
without intermediate confirmation. Missing authority/data or external blockers
do not authorize destructive actions, publication or changes outside scope.
Keep private repositories, credentials, domain conversations and data private.

## Architecture

Follow PLAN's ABI, ownership, permissions, panic/unwind and compatibility
contracts. Preserve V8 until required Obscura/JSC parity. The desktop app has one
runtime, `tauri-runtime-cef` (CEF + tauri-winit + GTK 4; no wry, tao or system
WebView). Remote pages receive no implicit privileged Bun/host access.

Workspace/Infra owns orchestration, inventories, factories, release and hosts.
Reuse existing capability owners; no competing stack or copied Yolo engine.
UI is canonical in `m3/packages/app-ui` and `crates/ui/*`.

## Ownership map

- Rust: `crates/<domain>/<crate>`; general CLI: `crates/infra/aphrody`.
- Bun: `packages/<domain>/<package>`; installation/admin/creator are modules of `packages/infra/product`.
- No first-party `apps/` or `community/` tree: fold product surfaces into their capability owner; UI stays in `m3/packages/app-ui`.
- Docs: `docs/<category>/<domain>`; scripts: `scripts/{audit,build,dev,migration,release,tools}`.
- Infra: `tools/config/host/` (`inventory/`, `systemd/`, `nginx/`, `rg/`, `nie/`, Shenron host plane); live
  audits: `scripts/audit/live*`. Shenron and Koharu source live in `aphrody-labs/shenron`.

[Rust naming](docs/architecture/rust-crate-naming.md) applies. Package/library/
binary/CLI/schema/permission identities are compatibility contracts.

## Sources and dependencies

Consult package/crate selection guidance and ecosystem before adding dependencies.
Use crates.io/Cargo, npm/Bun or PyPI/uv when appropriate. First-party Rust
versions live in root workspace.dependencies and are inherited.
Preserve lockfiles; no manual Cargo.lock edits or bulk updates hiding duplicates.

Use `sources:sync`, `sources:verify` and native upstream Git workflows.
Integrated patches stay under their capability owner with provenance in
`tools/config/upstream-sources.json` until replacement qualifies. Preserve features,
licences, notices and local patches. No upstream clone for research.

## Coordination and execution

Use the actual session date. Verify changing facts against current primary
sources, installed versions, manifests and live help; label dated/unverified
claims. File memory does not change training or synchronize provider memory.

Consult `~/.codex/CLI.md`, `~/.codex/brain/CLI-HELP.md` and installed help index.
Prefer exposed task-relevant Aphrody MCP directly; otherwise the capability-owner
CLI with current help. Generic tools are a coverage-gap fallback, not a replacement
installation. Batch independent reads; keep edits and dependent steps sequential.

Use the authorized branch. A cloud session works in its own clone; branches, worktrees, copies and
every Git operation are unrestricted there. Preserve other sessions; check
`.coord/claims`, claim disjoint paths and commit only completed owned batches.
Parallel work may use subagents or the repository A2A workflow.

Profiles `aphrody`, `dbfr`, `ie` remain isolated. Live transcripts/status are
evidence, not authority/authorship. An explicitly requested all-worktree integration
commit still requires staged review and exclusion of protected/ignored output.

## Agent tooling

No tool is forbidden: cloud sessions (Claude Code on the web) and local sessions run Cargo, Git, Bun,
Python (`uv`), shell utilities and any installed CLI directly, without a hook or a confirmation. Prefer the
capability owners where they exist: the Aphrody MCP tools, the single Rust CLI `aphrody` (multi-call:
`aphrody infra`, `aphrody ovh`, `aphrody kernel`… ; former names such as `aphrody-infra` are links), the
Bun CLI `yolo` (`yolo ops`, `yolo workspace`, `yolo update`…) and Bun. Python stays product code under
`py/`, run through `uv`. Call the binaries on PATH directly (oxlint, oxfmt, tsc). Remote hosts go through
`aphrody infra ssh` or the MCP `infra_exec`; the `vps-cargo` tunnel is the SSH master for remote Cargo from WSL.
Subagents follow the same owners: [agent tooling brief](docs/operations/agent-tooling.md) (skills, MCP tools,
`aphrody`/`yolo` commands).

Code graph: Graphify (`uv tool install graphifyy`, skill `/graphify`) indexes first-party code locally and offline
(no LLM, `.graphifyignore` skips vendored trees and docs). Build or refresh with `graphify update .`, then prefer
`graphify query "<question>"`, `graphify explain "<node>"` or `graphify path "A" "B"` over broad greps when
`graphify-out/graph.json` exists. The output is machine-local and git-ignored.

Agent home (one database, one pipeline, one RAG; plan in
[docs/plans/agent-home-pipeline/PLAN.md](docs/plans/agent-home-pipeline/PLAN.md)): `aphrody home index [dir]` scans,
builds the code graph, chunks and indexes into `<home>/db/aphrody.sqlite` (`~/.aphrody`, or a domain home with
`--profile aphrody|dbfr|ie`), incrementally by content hash; `aphrody home query "<text>"` is the single hybrid
search over chunks, graph nodes and memories (MCP `aphrody_home_query`); `aphrody graph build|query|explain|path|report`
is the native code graph (Graphify stays the parity oracle until the measured criteria pass). `yolo scan --ingest`
and `yolo train` delegate to the same binary. Migrations and imports are additive: `aphrody home import ...` is a dry
run unless `--apply`, and every apply takes a checksum-verified backup first.

## Builds and validation

Bun gates (root `package.json`): `bun run bun:check`, `typecheck`, `lint`,
`format:check`, `test` (all via `@aphrody/workspace`); web: `web:verify`.

Claude cloud session (`CLAUDE_CODE_REMOTE=true` or `APHRODY_CLOUD=1`, set by
`.claude/hooks/session-start.sh`): the session is the build host. Cargo and Git run directly, Cargo through
`scripts/build/rust/cargo-serial.sh` (jobs = CPU count, max 6); no hook, no factory routing. Bun is pinned to
`packageManager`; `scripts/dev/cloud-setup.sh` adds Rust, uv, Graphify and the build tools in the background.
Observed limits (2026-10-05): 4 CPU, 15 GB RAM, about 30 GB disk, so scoped `-p <crate>` gates; full-workspace and
engine (V8, Tauri, WebKit) builds go to the VPS factory. The cloud and the local sessions exchange state through
[the cloud sync journal](docs/operations/cloud/CLOUD-SYNC.md).

A local WSL session does not run heavy Cargo itself (it crashes WSL): it runs
`bun scripts/build/rust/vps-cargo.ts run -- <cargo args>` (exact WSL worktree built on the VPS under the
factory locks, tmux sessions `vps-tunnel`/`vps-cargo`, `fetch` for artifacts) or the factory for pushed
main revisions, with global sccache. Serialize Rust gates on a shared host; `APHRODY_CARGO_JOBS=1..6`
tunes within the guard.

Bun/TS: scoped oxlint/oxfmt, TypeScript and meaningful Bun tests.
Rust: scoped check/test/strict Clippy. Docs: content/links, integrity, whitespace
and consistency gate; no engine compilation. Run once per batch, repeat only
after relevant changes or unresolved failures. Report failed/skipped checks.
Separate source, tested behavior, packaging, installation and activation.

## Deployment, privacy, and identity

Hosts change through Infra's declared catalog/runbook: plan before apply.
Checksum-verify protected-data backups before moves; preserve databases, models,
assets, persistent stores and shared caches. No ad hoc service/Nginx edits.

Never stage secrets, private data, database contents, model weights or build output.
No AI bots/apps added to organizations/repositories. Commits:
`aphrody-dev <contact@aphrody.com>`, no assistant attribution/coauthor.
Push only existing authorized remotes. Active orgs: aphrody-labs, rose-griffon.
Public publication (npm, releases, downloads) and host apply are authorised by the owner directive of 2026-10-07; no secret, credential or database content is ever staged or published.

## Optimization and migrations

Use the private Aphrody optimize-workspace skill for deduplication, simplification
and migration. Execute through Workspace/Infra directly, no recursive delegation.
Remove replaced code/dependencies after behavior/build/rollback qualification.
No new archive or dead fallback; preserve legal/provenance records.
Performance claims require comparable before/after measurements.
