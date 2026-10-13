# Product crate ownership

Product crates live directly in `crates/<package-name>` as pinned Git
submodules. Each manifest inherits the parent workspace via `workspace =
"../.."`; no child workspace or toolchain is created. Crate repositories
are source components of Bun OS and require the parent checkout to compile.

The root owns Cargo and Bun lockfiles, shared dependency versions, the nightly
toolchain, `build/rust`, `target`, `node_modules`, and `install`. Use `just setup`,
`just check`, and `just test`. Setup initializes direct submodules without
recursively fetching unrelated upstream asset repositories.

The first migrated components are `craft-fonts` and `craft-fonts-tests`, on
their forge `os` branches. Their histories were split from the preserved font
import. Licenses remain in the font crate; licensed font assets remain in the
root `fonts/` directory. Other Rust owners remain migration work in progress.

Forge access uses `bun-forge` through the private VPS transport. Aphrody Infra
owns provisioned repositories and machine identities; private credentials
remain in protected workstation or host secret stores, outside Git.
