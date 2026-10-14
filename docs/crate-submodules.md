# Product crate ownership

Product crates live directly in `crates/<package-name>` as pinned Git
submodules. Each manifest inherits the parent workspace via `workspace =
"../.."`; no child workspace or toolchain is created. Crate repositories
are source components of Bun OS and require the parent checkout to compile.

The root owns Cargo and Bun lockfiles, shared dependency versions, the nightly
toolchain, `build/rust`, `target`, `node_modules`, and `install`. Use `just setup`,
`just check`, and `just test`. Setup initializes direct submodules without
recursively fetching unrelated upstream asset repositories.

The root currently contains 28 flat crate owners, including the four CADCraft
foundation crates: `cadcraft-color`, `cadcraft-geom`, `cadcraft-doc` and
`cadcraft-constraints`. Every crate tracks its forge `os` branch. The CADCraft
consumer workspace resolves 14 edges to these root owners in version 1.4.4;
its other 12 members still require migration. Source histories, licenses and
notices remain with each component. Licensed font assets remain in `fonts/`.

Forge access uses `bun-forge` through the private VPS transport. Aphrody Infra
owns provisioned repositories and machine identities; private credentials
remain in protected workstation or host secret stores, outside Git.
