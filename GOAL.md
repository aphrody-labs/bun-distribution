# Goal

This file describes the desired end state, not a statement that consolidation
has already been completed. Current implementation and migration evidence is
tracked in `PLAN.md` and the repository manifests.

Deliver one Bun OS product workspace from `C:\\src`, unifying Bun OS and Bun
Libraries package/setup/build/install ownership while preserving source
histories, active concurrent work, and all applicable license notices.

Unify the product capabilities in Bun OS, following the current owner direction
recorded in PLAN.md. Existing Bun runtime,
Material and compatibility distribution dependencies retain their pinned contracts.
The root catalog and source graph own discovery/export; physical relocation
and nested workspace migration remain separate gates.

The owner's expanded OS direction (2026-10-16) integrates the complete CachyOS,
ChimeraOS and Omarchy package/source catalogs, build tools, SDKs and libraries.
Pacman/libalpm replaces APT as the primary Linux distribution package manager.
Use one Arch factory and separate Server, COSMIC Desktop and Gamescope Gaming
compositions. Keep the optional Hyprland/Omarchy session distinct from COSMIC.
Fork upstream kernels and Rust source projects with their history, pins,
licenses and locks; imported projects are not automatically root Cargo members.
APT remains an explicitly separate portability qualification target.

Owner update (2026-10-16): absorb Aphrody Infra and Workspace into Bun OS Infra
and Workspace, including their implementations, catalogs, commands and consumers.
Bun OS integrates AI (models, agents, memory, A2A and MCP), infrastructure
(hosts, deployment, services, pipelines and cloud) and workspace orchestration.
Capabilities converge on their canonical implementations with their
history, licenses, consumers and gates. Source still awaiting that migration
must be reported as pending, not relabelled as already transferred.

The root Bun workspace, setup command, dependency install, formatter, shared
`node_modules`, Cargo `target`, build output, and install destination must have
one canonical owner. Move source ownership only when imports, manifests,
consumers, and gates are updated together. A single Cargo workspace is complete
only when all included Rust packages belong to it; nested workspace boundaries
must be migrated deliberately rather than hidden by documentation.

The owner requires exactly one product `crates/`, one `packages/` and one
`apps/`, directly under this root. Each product crate/package/application is
a direct child of its category. Merge the source and consumer graphs; nested
first-party category roots or workspace patterns are migration violations.
Independent upstream/toolchain sources keep their provenance boundaries and
must not be presented as migrated product members.

Keep the Bun runtime fork's active checkout and processes intact. Integrate it
through the selected workspace without resetting or relocating concurrent
work. Preserve imported license files and notices; the root license applies
only to first-party material.

Finish by qualifying the integrated setup and workspace, committing precise
owned paths on branch `os`, and pushing after verifying remote ancestry.

## Target crate and infrastructure contract

This is the target architecture; nested workspaces and crates not yet migrated
remain incomplete work. Each product Rust crate is to become a pinned Git
submodule directly under `crates/<package-name>`, sharing the root Cargo
workspace, version, dependency table and nightly toolchain. The root owns
`build`, `target`, `node_modules` and `install`. Bun OS Infra provisions
declared forge repositories and machine identities idempotently; credentials
remain in protected secret stores.

Self-host every Aphrody Labs source repository through the existing Infra and
forge owners. Preserve upstream histories, branch identities, public/private
visibility, and protected stores. The canonical source portal is
`https://source.aphrody.app`, backed by the existing forge server and API.
Qualify standalone product binaries, server routes, and one orchestration
owner separately from source mirror and configuration delivery. Mirror jobs
must be resumable and admitted against actual host capacity.
