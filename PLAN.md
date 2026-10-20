# Current integration plan

This file tracks work that remains. Historical test results and dated execution
logs do not define the current state; use Git history for prior batches.

## Verified architecture

- This repository owns Bun OS distribution assembly, its root Bun workspace,
  package catalog, factory and release coordination. These are repository
  ownership boundaries, not claims that all declared compositions or release
  artifacts have been built or qualified.
- The Bun runtime implementation remains with its canonical runtime owner.
- Product source is organized under `apps/`, `crates/` and `packages/`.
  Upstream projects and independently owned code retain their source boundaries
  and licenses.
- Rose Griffon application source belongs to `aphrody-labs/rosegriffon`.
  Bun OS no longer contains its application/package copies; the integration
  state is documented in `docs/ROSEGRIFFON.md`.
- The root Cargo workspace is not yet the sole Rust workspace. For example,
  `apps/aphrody-drive` and `packages/bun-tauri` declare nested workspaces, and
  the root manifest excludes them. Do not report Cargo consolidation complete.
- The product direction is Arch Linux with pacman/libalpm. Server, COSMIC
  Desktop and Gamescope Gaming remain distinct compositions; Alpine and Ubuntu
  are compatibility targets in the checked-in product configuration. The
  distribution manifest currently labels qualification as `development`.

## Remaining work

1. Maintain the machine-readable `componentInventory` returned by
   `inspectWorkspaceManifests` for app/package/crate manifests, pinned
   submodules and vendor roots. It records source/repository pins, workspace
   owners, targets when declared, and explicit qualification/migration states.
   Its present scope follows root-declared submodules and initialized manifest
   trees; nested submodule declarations and uninitialized source manifests still
   need coverage. Keep counts derived from this inventory rather than prose.
   Regenerate `docs/aphrody/ecosystem/` only when both owner checkouts are
   available and complete; the available Aphrody checkout is missing, so the
   generator's zero-entry result is not a valid replacement for its current
   committed inventory.
2. Migrate Rust owners into the root Cargo workspace in bounded batches. Before
   each migration, verify dependency consumers, nested workspace behavior,
   submodule history, licenses, build ownership and qualification.
3. Audit every vendor against pins, build definitions and consumers. Remove a
   vendor only when the source is demonstrably unused or replaced by a verified
   package, documentation reference or prebuilt artifact.
4. Reconcile generated inventories, lockfiles and source references after each
   ownership change. Keep production service contracts until a replacement
   artifact and deployment have been qualified. Regenerate `Cargo.lock` with
   the serialized Cargo owner: its removed `aphrody-rg-server` package stanza
   remains stale because Cargo metadata could not be qualified from this host.
5. Run native build and qualification gates on the VPS after the relevant
   source batch is complete. Record actual command output and distinguish
   source validation from artifact, deployment and release qualification.

## Pending source and qualification gates

- The root manifest explicitly preserves the independent `vendor/rea` version.
  The workspace inspector requires its declared name, version and Git pin;
  all other product packages retain the shared version contract. This source
  correction still requires VPS qualification before reporting Cargo inspection
  as passing.
- Declared root submodules now have Git pins, including the Recalbox revision
  read from its upstream repository. Pins still need initialization and source
  qualification; declarations alone do not make the source graph available.
- Product payload preparation, independent CLI discovery qualification and
  receipt-bound Docker staging are implemented in the root factory graph.
  Qualification requires a complete product source closure, a matching runtime
  pin, prepared package archives/sidecars (including the generated
  `@aphrody/cli-wasm` glue, module and provenance files) and a frozen installed
  dependency tree. The product sidecar contract now admits only the exact
  generated WASM paths owned by that declared package. The WASM staging receipt
  also points to its current source file. Neither path has been built or run on
  the VPS yet.
- Product discovery proves CLI command targets, and a separate CLI-WASM gate
  verifies module initialization and pure-command help. The root `mcp` command
  dispatches Bun's native MCP server; it does not package or qualify the
  Rust `aphrody-mcp` server. The CLI-WASM artifacts are mandatory in the frozen
  payload; qualification executes WASM initialization and pure-command help.
  FFI artifacts and their release manifest are now mandatory payload inputs, and
  qualification loads the library and checks each exported ABI. These gates
  still need VPS execution. MCP protocol initialization/tool listing and plugin
  resources need receipt-bound gates before claiming complete product
  qualification. The Alpine/Ubuntu/gaming image owners also need integration
  with the frozen product receipt.
- The source-only audit of all 92 uninitialized root submodules found zero
  proven removals: 24 have implementation/manifest consumers and 67 retain
  catalog/owner contracts. Material Design Icons has a concrete packaging gap:
  its package loads assets from `vendor/` but excludes those assets from its
  published file set. Migrate and qualify the assets, license and consumers
  before considering retirement of that vendor.

## Delivery rules

- Preserve concurrent changes, protected stores, source history and notices.
- Do not infer product admission or migration from a directory or manifest
  entry alone.
- Do not claim a build, test, deployment, binary or release without current
  evidence from its owning system.
- Commit only owned paths, fetch before a normal push, verify ancestry, and
  never force-push.
