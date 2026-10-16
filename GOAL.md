# Goal

Deliver one Bun OS product workspace from `C:\\src`, unifying Bun OS and Bun
Libraries package/setup/build/install ownership while preserving source
histories, active concurrent work, and all applicable license notices.

The owner's selected integration scope includes Bun Libraries, Aphrody, Android
and IECODE, following the 2026-10-16 overrides recorded in PLAN.md. Shenron
remains outside absorption. Existing Bun runtime,
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

Aphrody retains exactly two capability layers: AI (models, agents, memory,
A2A and MCP) and infrastructure (hosts, deployment, services, pipelines and
cloud). Other capabilities move to their Bun/Bun Libraries owners with their
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

Every product Rust crate is a pinned Git submodule directly under
`crates/<package-name>`, sharing the root Cargo workspace, version, dependency
table and nightly toolchain. The root owns `build`, `target`, `node_modules`
and `install`. Aphrody Infra provisions declared forge repositories and
machine identities idempotently; credentials remain in protected secret stores.

Self-host every Aphrody Labs source repository through the existing Infra and
forge owners. Preserve upstream histories, branch identities, public/private
visibility, and protected stores. The canonical source portal is
`https://source.aphrody.app`, backed by the existing forge server and API.
Qualify standalone product binaries, server routes, and one orchestration
owner separately from source mirror and configuration delivery. Mirror jobs
must be resumable and admitted against actual host capacity.
