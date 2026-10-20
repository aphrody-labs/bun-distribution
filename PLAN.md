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

1. Generate and maintain one machine-readable ownership inventory for apps,
   packages, crates, submodules and external source boundaries. Derive manifest
   parity from that inventory instead of copying member counts into prose.
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
- `vendor/recalbox` remains declared without a Git pin. Resolve its source
  contract before initialization; do not invent a revision or report the full
  source graph as available. Restored source pins still need initialization.
- The container payload does not yet stage the distribution CLI and its complete
  workspace dependency graph. Runtime and upstream source staging alone do not
  establish a complete product image.

## Delivery rules

- Preserve concurrent changes, protected stores, source history and notices.
- Do not infer product admission or migration from a directory or manifest
  entry alone.
- Do not claim a build, test, deployment, binary or release without current
  evidence from its owning system.
- Commit only owned paths, fetch before a normal push, verify ancestry, and
  never force-push.
