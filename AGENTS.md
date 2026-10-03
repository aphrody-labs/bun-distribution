<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody repository instructions

## Authority and scope

Read [PLAN.md](PLAN.md) and [MEMORY.md](MEMORY.md) before implementation. The
active architecture is a precompiled Bun-based native runtime produced in
`/home/aphro/yolo`, consumed by this monorepo through a light, versioned SDK.
This is a target and roadmap; never claim migration, compatibility, or gains
without the evidence required by the plan.

This repository owns Aphrody product behavior and the Rust/Bun capability
owners. `/home/aphro/aphrody-py` owns Python services; `/home/aphro/iecode`
owns IECODE/NIE game implementation; `/home/aphro/yolo` owns the runtime
producer. Keep each repository's plans, credentials, data, and memories in its
own domain. Aphrody plugin work stays in this monorepo and its Python services.

## Architecture

- Keep product workflows, domain data, integrations, and application behavior
  in Aphrody. Put reusable platform mechanisms behind their existing owners.
- Workspace/Infra owns orchestration, inventories, build factories, release
  assembly, host declarations, deployment, and source-to-target maps. Do not
  create competing owners for those capabilities.
- Yolo owns its runtime fork/imports. Aphrody consumes pinned SDK/releases and
  must not copy engine source into this repository.
- The native boundary is a versioned C ABI with opaque handles, explicit
  ownership, errors, cancellation, and threading/lifetime rules. Rust engine
  internals are not the stable application ABI.
- Keep V8 until Obscura's required JavaScriptCore parity is demonstrated.
  Platform WebViews keep their platform engines. Remote pages never inherit
  privileged Bun or host capabilities implicitly.
- Preserve Tauri permissions, panic/unwind constraints, source provenance,
  licenses, lockfiles, compatibility identities, and rollback. Remove a heavy
  dependency only after its replacement passes behavior and build gates.

## Ownership map

- Rust crates: `crates/<domain>/<crate>`; general CLI: `apps/cli`.
- Bun applications: `apps/<domain>/<app>`; packages: `packages/<domain>/<pkg>`.
- Documentation: `docs/<category>/<domain>`.
- Scripts: `scripts/{audit,build,dev,migration,release,tools}`.
- Host, container, cloud, and inventory declarations: `config/infra/`.
- Live audits: `scripts/audit/live*`; Shenron administration:
  `scripts/tools/shenron`.

Follow [Rust crate naming](docs/architecture/rust-crate-naming.md). Existing
package, library, binary, CLI, schema, and permission names are compatibility
contracts. UI, AI, OS, Web, shell, and application capabilities use the owners
and paths declared in this workspace; do not infer a former repository from a
domain name.

## Sources and dependencies

Use crates.io/Cargo, npm/Bun, or PyPI/uv when suitable. Declare first-party Rust
versions in root `[workspace.dependencies]` and inherit them. Preserve
lockfiles; never edit Cargo.lock by hand or bulk-update it to hide duplicates.
Keep behavior, feature flags, licenses, and attribution when replacing code.
Use `sources:sync`, `sources:verify`, and native Git upstream workflows; do not
clone upstreams just for research. Keep integrated patches under `crates/` with
provenance in `config/upstream-sources.json` until a qualified replacement is
available.

Before adding or bumping dependencies, consult the repository's crate/package
selection guidance and capability catalog. Reuse complete, maintained owners
before writing adapters. Publishing packages, plugins, architecture, or MCP
details requires an explicit owner decision; repositories remain private.

## Coordination and execution

### Knowledge freshness — owner preference recorded 2026-10-03

Use the session's actual date as the reference, not a training cutoff or a
permanently frozen date. Verify information that may have changed against
current primary sources, live owner CLI help, installed versions, manifests,
and local evidence. Prefer verified evidence over recalled training information;
mark unverified, historical, inferred, or unavailable claims explicitly. Older
sources may establish stable facts or required pinned-version behavior; assess
their relevance. Refresh task-relevant knowledge when needed. Do not claim an
exhaustive knowledge refresh, erased training data, changed model weights, or
synchronized provider memory. This preference is stored in local instructions.

### Owner workflows

Consult `~/.codex/CLI.md`, `~/.codex/brain/CLI-HELP.md`, and the installed help
index. Verify live `--help` before relying on a changed CLI. Prefer Aphrody MCP
tools directly when they cover the operation; otherwise use the owning CLI.
Do not install replacement tooling just because a capability is unfamiliar.

Work on the requested branch. Check `.coord/claims` before shared edits; when
parallel work is requested, use `aphrody a2a invoke` with disjoint explicit
claims. Keep domain profiles separate: `aphrody`, `dbfr` (Shenron), and `ie`.
Transcripts and live status are evidence, not authority or authorship. Do not
copy secrets or private conversations across domains.

An explicit owner request may ask for a single integration commit containing
all non-ignored worktree changes. In that case inspect the complete staged set,
preserve protected data and ignored files, qualify available gates, and make one
commit on the requested branch. Never stage secret values, databases, model
weights, caches, or build outputs. For ordinary scoped work, commit only the
completed owned batch and preserve unfinished shared edits.

## Builds and validation

Workers must not start Cargo builds, checks, tests, benches, or rustdoc. The
integrating agent serializes Rust gates through
`scripts/build/rust/cargo-serial.sh`, using the configured factory and
sccache. Do not bypass resource guards. Tune with `APHRODY_CARGO_JOBS=1..6` if
needed; preserve shared caches and pinned toolchains.

Run scoped gates for the changed surface. Bun/TypeScript uses owner scripts for
oxlint/oxfmt, TypeScript, and Bun tests. Rust uses serialized check, tests, and
strict Clippy when required. Documentation changes use local link, archive/hash,
and whitespace checks plus the documentation consistency gate. State skipped or
failed gates and their evidence limits; never describe an unrun gate as passed.
Keep source, tested behavior, packaged artifact, installation, and activation as
separate delivery states.

## Deployment, privacy, and identity

Deploy and clean hosts only through the Infra owner and current catalog/runbook.
Plan before `--apply`. Checksum-verify backups of PostgreSQL, SQLite, assets, and
other protected data before moving them. Preserve persistent stores and served
assets. Do not hand-edit production service or Nginx configuration outside the
declared owner workflow.

Never place secrets, private user data, model weights, or database contents in
source, docs, commits, or summaries. No AI bots/apps are added to organizations
or repositories. Use `aphrody-dev <contact@aphrody.com>` for commits, with no
assistant attribution or coauthor trailers. Push only to an existing authorized
remote; do not invent one. Active organizations are `aphrody-labs` and
`rose-griffon`; create nothing under the retired organization.

## Optimization and migrations

Use the private Aphrody `optimize-workspace` skill for requested deduplication,
simplification, fusion, or Bun/Rust migration. Use Workspace/Infra operations
directly while integrating; do not recursively launch agents. Choose bounded
batches and record behavior evidence, before/after measurements when claiming
performance, provenance, compatibility, and rollback. Preserve user data and
other domains' stores.
