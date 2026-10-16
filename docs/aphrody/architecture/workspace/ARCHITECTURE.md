<!-- SPDX-License-Identifier: Apache-2.0 -->
# Workspace architecture

This is the active Rust + Bun monorepo at `<repo>`.
The root [plan](../../PLAN.md) defines qualification order and remaining
acceptance gates. [Repository rules](../../AGENTS.md) define placement,
ownership and migration safety. Source presence does not establish runtime,
packaging or deployment readiness.

The previous superproject architecture is retained as an unmodified
historical snapshot.
Its sibling-checkout paths and deployment statements describe the earlier
layout; they are not current checkout instructions.

## Active roots and workspaces

`py/` owns Python application sources; native Python runtime and binding
infrastructure belong to Bun. `../iecode` owns game-domain implementation.
The sibling Material checkout owns the M3 framework, `libm3`, tokens, shared
controls and `@aphrody/app-ui`. Aphrody consumes its pinned crate and package
interfaces. Aphrody retains product-specific UI and host integration in its
app-specific `crates/ui` modules and `packages/infra/product`. The local `m3/`
directory is not a Git submodule or framework source owner; it currently
contains one generated Bun catalog file. [M3 location](M3-LOCATION.md) defines
this boundary.

The root [Cargo manifest](../../Cargo.toml) and
[Bun manifest](../../package.json) define active members. Explicit exclusions
and nested manifests are not qualified workspace members merely because they
exist on disk. Upstream forks retain pinned revisions and their own workspace
history under `upstream/`.

## Capability owners

| Owner | Source and responsibility |
| --- | --- |
| Contracts | `crates/contracts`: neutral wire types, schemas, A2A and app-server contracts |
| Native | `crates/native`: native compute foundations and bridge contracts |
| Compat and Bun | `crates/compat`, `packages/compat` (not in repo), `packages/engine`: compatibility engines and runtime clients |
| Interop | [Rust FFI](../../../../crates/aphrody-ffi), [Bun native adapter](../../../../packages/aphrody-bun): shared library boundary |
| CLI | [crates/infra/aphrody](../../../../crates/aphrody): argument handling, configuration and invocation of owner libraries |
| OS and Shell | `crates/os`, `packages/os`, `crates/shell`: system capabilities, kernel, process supervision, jobs and shell facilities |
| Infra | `crates/infra`, [workspace orchestrator](../../../../packages/workspace): inventories, topology, qualification and operations |
| Aphrody UI | `crates/ui/app`, `crates/ui/drive`, `crates/ui/identity`, `crates/ui/render`, `packages/infra/product`: product presentation and host integration |
| Material UI | sibling Material checkout: M3, `libm3`, tokens, shared controls and `@aphrody/app-ui`; consumed through pinned interfaces |
| AI and Web | `crates/ai`, `packages/ai`, `crates/web`, `packages/web`: model clients, inference, RAG and web capabilities |
| Koharu and Discord | Domain libraries; applications own startup, credentials and product behavior |
| RG and Shenron | `iecode/packages/rg`, `iecode/apps/rg`, `shenron:packages`, `shenron:apps`: domain rules, application contracts and product consumers |

New Rust package placement follows the
[crate naming rules](../rust-crate-naming.md). Existing public crate/package
names, APIs, CLI arguments and schemas remain compatibility contracts when
folders move. Reusable behavior belongs to one library owner; application
entry points retain configuration and startup.

## Boundaries to qualify

Contracts must remain pure; operational networking, process and timeout behavior
belongs to operational owners. The [app protocol](../../../crates/contracts/app-protocol)
defines vocabulary, while implemented handlers and recorded scenarios establish
supported behavior. A2A and app-server are separate protocols.

The FFI must consume library logic rather than depend on the CLI application.
Native discovery, loading, lifetime and ABI/version behavior need one owner.
Installed production services must not compile implicitly or depend on a
`target` directory. The plan tracks Linux/Windows and development-mode proof.

Browser component imports must stay free of native Bun bindings and server
startup effects. Deterministic RAG calculations belong to the Rust core;
Python is an adapter to that owner. Application rules and shared registries
belong to domain packages rather than site entry points. These are required
boundaries, with outstanding implementation and verification in the root plan.

OS owns durable jobs and process resources. Infra owns placement and deployment
policy. Long operations expose a handle, bounded progress, cancellation and an
authoritative terminal state; a planned adapter is not proof of a delivered
runtime path. Native buffers must be released by their owning allocator and
respect runtime threading and lifetime rules.

## Infrastructure, data and provenance

Infra configuration is canonical: [services](../../../../infra/config/service-catalog.json),
[topology](../../../../infra/config/production-topology.json),
`tools/config/host/nginx/routes.json` and
[local AI](../../../../tools/aphrody/config/local-ai.json). Current release records and live
probes establish deployed state; manifests and historical catalogues do not.
Migration tools may intentionally read legacy archives, while active service
configuration must use active roots and installed runtime paths.

Applications retain authentication contracts, database schemas and migrations.
Infra owns placement, backup and recovery. Secrets, game datasets, model weights,
caches, generated binaries and user databases remain in protected stores.
Do not erase a source checkout before mapped consumers pass from a clean clone.

Preserve licenses, upstream notices and source-to-target evidence. The root
Apache-2.0 license does not relicense imported source, fonts, models or assets.
Packaging copies need consumer and license verification before deduplication.

## Qualification and product delivery

Qualification proceeds from contracts/native/compat, through interop and CLI,
OS/shell/Infra, UI and AI/Web, then RG and other consumers, to Shenron as the
final product gate. The [generated pipeline](../../../../infra/config/pipeline.json)
records declared commands; actual exit codes, logs and coverage establish
passing gates. Missing qualification scripts need real checks.

The root plan requires owner checks, real FFI tests, browser import/build
qualification, RAG parity, application smoke tests and assembled Shenron
validation. A production deployment is a separate operation. Record scope and
limits with every result; document edits alone do not qualify the runtime.
