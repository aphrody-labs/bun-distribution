# Bun OS workspace

This checkout is the unified Aphrody/Bun product workspace. Read `GOAL.md`,
`PLAN.md`, `MEMORY.md` and `START-HERE.md` before changes. Preserve concurrent
work, repository history, first-party attribution, and every imported license
and notice. Product documentation is in English; replies follow the owner's
language.

Use Bun 1.4.4 and native Bun APIs for JavaScript and TypeScript. Use the native
quality commands in `package.json`; use Rust's serialized wrapper for Cargo.
Do not start WSL on the workstation. Resolve paths from this checkout or
explicit configuration, never a hard-coded workstation path.

The root owns product assembly, shared setup, workspace configuration and
release coordination. Capability source remains in managed Git submodules
until its history can be migrated without data loss. Keep one root Bun
workspace and shared install/build/cache locations. Do not claim a single Cargo
workspace while imported crates still belong to nested workspaces; migrate
their manifests and references in controlled batches before removing those
boundaries. Keep upstream license notices intact.

The owner's current contract is flat Git submodules for every product Rust
crate in `crates/<package-name>`, inherited from one root Cargo workspace and
nightly toolchain. Provision declared forge repositories and access through
the Aphrody Infra owner, with credentials in protected secret stores. The
font crates implement this contract; remaining owners require real migration.

Preserve protected `.local` stores, credentials, sessions, databases, model
weights and concurrent work. Bound long commands and serialize native builds.
Use Cloudflare MCP for account/domain mutations. Do not add or run tests unless
the owner requests them; explicit end-to-end qualification requests authorize
the relevant gates.

Commit owned paths as `aphrody-dev <contact@aphrody.com>`, without co-authors.
Fetch and verify ancestry before pushing. Never force-push.
