# Goal

Deliver one Bun OS product workspace from `C:\\src`, unifying Bun OS and Bun
Libraries package/setup/build/install ownership while preserving source
histories, active concurrent work, and all applicable license notices.

The root Bun workspace, setup command, dependency install, formatter, shared
`node_modules`, Cargo `target`, build output, and install destination must have
one canonical owner. Move source ownership only when imports, manifests,
consumers, and gates are updated together. A single Cargo workspace is complete
only when all included Rust packages belong to it; nested workspace boundaries
must be migrated deliberately rather than hidden by documentation.

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
