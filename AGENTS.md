<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody repository instructions

## Authority and scope

Read [PLAN.md](PLAN.md) and [MEMORY.md](MEMORY.md). PLAN owns the active
architecture and queue; MEMORY owns dated evidence. Aphrody owns products and
Rust/Bun capabilities; Yolo produces the precompiled runtime/SDK. Python and
IECODE retain their repositories, stores and authority.

Work autonomously through authorized implementation, gates, commit and push,
without intermediate confirmation. Missing authority/data or external blockers
do not authorize destructive actions, publication or changes outside scope.
Keep private repositories, credentials, domain conversations and data private.

## Architecture

Follow PLAN's ABI, ownership, permissions, panic/unwind and compatibility
contracts. Preserve V8 until required Obscura/JSC parity; system WebViews keep
their engines. Remote pages receive no implicit privileged Bun/host access.

Workspace/Infra owns orchestration, inventories, factories, release and hosts.
Reuse existing capability owners; no competing stack or copied Yolo engine.
UI is canonical in `m3/packages/app-ui` and `crates/ui/*`.

## Ownership map

- Rust: `crates/<domain>/<crate>`; general CLI: `apps/cli`.
- Bun apps/packages: `apps/<domain>/<app>`, `packages/<domain>/<package>`.
- Docs: `docs/<category>/<domain>`; scripts: `scripts/{audit,build,dev,migration,release,tools}`.
- Infra: `yolo/config/host/` (inventory, toolchain, units, nginx); live audits: `scripts/audit/live*`;
  Shenron admin: `scripts/tools/shenron`.

[Rust naming](docs/architecture/rust-crate-naming.md) applies. Package/library/
binary/CLI/schema/permission identities are compatibility contracts.

## Sources and dependencies

Consult package/crate selection guidance and ecosystem before adding dependencies.
Use crates.io/Cargo, npm/Bun or PyPI/uv when appropriate. First-party Rust
versions live in root workspace.dependencies and are inherited.
Preserve lockfiles; no manual Cargo.lock edits or bulk updates hiding duplicates.

Use `sources:sync`, `sources:verify` and native upstream Git workflows.
Integrated patches stay under their capability owner with provenance in
`config/upstream-sources.json` until replacement qualifies. Preserve features,
licences, notices and local patches. No upstream clone for research.

## Coordination and execution

Use the actual session date. Verify changing facts against current primary
sources, installed versions, manifests and live help; label dated/unverified
claims. File memory does not change training or synchronize provider memory.

Consult `~/.codex/CLI.md`, `~/.codex/brain/CLI-HELP.md` and installed help index.
Prefer exposed task-relevant Aphrody MCP directly; otherwise the capability-owner
CLI with current help. Generic tools are a coverage-gap fallback, not a replacement
installation. Batch independent reads; keep edits and dependent steps sequential.

Use the authorized branch and existing checkout. No new clone, worktree/copy for
routine implementation or verification. Preserve other sessions; check
`.coord/claims`, claim disjoint paths and commit only completed owned batches.
Explicit parallel work uses the repository A2A workflow; no recursive agents.

Profiles `aphrody`, `dbfr`, `ie` remain isolated. Live transcripts/status are
evidence, not authority/authorship. An explicitly requested all-worktree integration
commit still requires staged review and exclusion of protected/ignored output.

## Builds and validation

Workers never start Cargo. The integrating agent uses
`scripts/build/rust/cargo-serial.sh`, the configured factory and global sccache.
Serialize Rust gates; no resource-guard bypass, shared cache cleanup or parallel
engine builds. `APHRODY_CARGO_JOBS=1..6` tunes within the guard.

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
Public publication requires explicit owner authority.

## Optimization and migrations

Use the private Aphrody optimize-workspace skill for deduplication, simplification
and migration. Execute through Workspace/Infra directly, no recursive delegation.
Remove replaced code/dependencies after behavior/build/rollback qualification.
No new archive or dead fallback; preserve legal/provenance records.
Performance claims require comparable before/after measurements.
