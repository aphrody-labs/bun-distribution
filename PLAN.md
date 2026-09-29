<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody monorepo extraction plan

Status: scaffold initialized 2026-09-29. The cross-repository authority is
[`src/PLAN.md`](../src/PLAN.md); this file tracks this repository's extraction
and acceptance. Infra's `@aphrody/workspace` is the source of truth for generated
inventories and orchestration commands.

## Target layout

- `crates/<domain>/<crate>`: all first-party Rust crates from Aphrody owners.
- `apps/<domain>/<app>` and `packages/<domain>/<package>`: all first-party Bun
  applications and packages, keeping public package names.
- `docs/<category>/<domain>`: canonical docs grouped by architecture, APIs,
  decisions, guides, operations, plans, products, reference, and research.
- `scripts/<category>`: audit, build, dev, migration, release, and tools.
- `upstream/`: pinned forks and upstream workspaces whose history/build roots
  remain independent.

`rg` and `shenron` remain in `src` until this plan and `aphrody-py` meet every
source-closure, compatibility, installed-workflow, license, and rollback gate.

## Extraction gates

- [ ] Generate a recursive source map covering each repository HEAD, staged and
      unstaged state, tracked/untracked files, manifests, docs, scripts, apps,
      packages, crates, licenses, submodules and upstream pins.
- [ ] Freeze the category and domain map; identify exact and semantic document
      duplicates. Deduplicate byte-identical docs with an alias map; choose one
      authoritative source for overlapping content and preserve provenance.
- [ ] Import docs with all local links and anchors remapped; retain source
      checkouts and histories until consuming plans/builds use the new paths.
- [ ] Import scripts by category, with Infra `@aphrody/workspace` dispatching
      checks and operations for both monorepos.
- [ ] Import all first-party crates into the root Cargo workspace and all Bun
      apps/packages into the root Bun workspace. Keep upstream forks isolated.
- [ ] Build source and consumer maps; resolve duplicate implementations,
      manifest/path/license conflicts and ABI boundaries before removing old copies.
- [ ] Prove clean-clone workflows, release packaging and rollback before declaring
      this monorepo stable or moving `rg`/`shenron`.

## Current state

- [x] Created the local worktree at `/home/aphro/aphrody` and initialized Git.
- [x] Recorded a local extraction baseline at `d406f11` with the root manifests,
      staged first-party code, Infra catalogs, six service scripts and migration
      evidence. A fresh local clone passed frozen offline Bun install,
      `@aphrody/workspace` typecheck, all 52 Infra Rust library tests, and
      `aphrody-infra validate` (23 services, 25 routes). The clone does not yet
      contain the imported documentation corpus or general script import, and
      the repository has no remote for a push. Its pipeline check reports all
      85 steps missing sibling repositories; this is evidence that the
      transitional pipeline still needs the consumer cutover.
- [x] Added Infra `@aphrody/workspace` inventory, docs-import and script-import
      operations. The 2026-09-29 current inventory saw 19 direct worktrees, 77,859 tracked and
      untracked paths, and 7,040 documentation candidates; 6,538 documents are
      indexed with 202 byte-identical aliases. It separately reports missing
      checkouts. A later read-only pass records Gitlink metadata recursively through
      the permitted initialized checkouts, including nested pins and current heads;
      a linked nested map now records 9,583 file paths and SHA-256 hashes across
      seven initialized checkouts, including 213 manifests or lockfiles. It parsed
      192 Cargo, Bun/Node, Python and pnpm manifests without parse failures and
      found 11 declared workspaces. Of 164 workspace member patterns, 163 resolve
      to a matching manifest; `codex-rs/Cargo.toml` still declares absent
      `utils/cache`. Dependency closure remains open. The scan records the
      IECODE revision at that time; its current HEAD is rechecked in the focused
      extraction records. See
      [`source-map.json`](docs/migration/source-map.json) and
      [`submodule-inventory.json`](docs/migration/submodule-inventory.json) and
      [`nested-source-map.json`](docs/migration/nested-source-map.json).
- [x] Began docs extraction into categorized `docs/`; exact source duplicates
      share one target, source provenance remains in the map, and the generated
      index is [`IMPORTED-DOCS-INDEX.md`](docs/migration/IMPORTED-DOCS-INDEX.md).
      Existing target files and distinct path collisions are preserved and routed
      through explicit alternate paths.
- [ ] Close documentation import: the 2026-09-29 guarded import now maps 2,272
      local links and records 1,292 unresolved links with zero failures. The importer
      recognizes verified imported file targets, including the corrected `@aphrody/nie`
      package manifest; five more links resolve than in the prior report. The remaining
      sample includes code, assets, configuration, external worktrees and unimported
      references. Import and qualify those destinations before closing this gate.
      See [`IMPORTED-DOCS-LINK-REAUDIT.md`](docs/migration/IMPORTED-DOCS-LINK-REAUDIT.md).
      The extraction source snapshot was clean at HEAD
      `550066b66181c4aeffb90b4067e8af742b0c112b`; IECODE later advanced
      to `8fdab4b96014f70972c2855878cab49510ffe876`. The current inventory
      records local IECODE changes, so recheck its status before any further import. The focused import
      records now carry their own source revision and per-file hashes. A recursive
      254-file SHA-256 comparison found no missing, extra or mismatched files in
      the copied data crate at that HEAD; two current IECODE worktree edits are
      outside that crate. See the refreshed extraction record.
- [x] Copy 454 hash-qualified scripts into categorized `scripts/` paths; exact
      source aliases and copy results are in
      [`script-import.json`](docs/migration/script-import.json). This is not yet a
      runnable unified command surface: relative paths, dependencies, ownership
      and source-local package scripts still need qualification.
- [x] Start the Rust workspace and copy the first IEVR slice, 254 files from
      IECODE's `crates/ievr-data`, to `crates/iecode/ievr-data` byte-for-byte.
      [`ievr-iecode-extraction.json`](docs/migration/ievr-iecode-extraction.json)
      records source/origin heads, SHA comparison, license boundary and the
      successful target `cargo check --all-targets --locked --offline`.
- [x] Stage IECODE's Bun packages and split its generic happy-dom host into
      `@aphrody/bun-test-dom`, retaining `@nie/plugin/happydom` as a compatibility
      export. `@aphrody/iecode-ffi`, `@aphrody/nie`, and `@nie/plugin` are private
      packages with TypeScript 7 typechecks. Provenance and source hashes are in
      [`iecode-bun-extraction.json`](docs/migration/iecode-bun-extraction.json).
- [ ] Complete the native integration: the current IECODE `crates/ffi` exports
      `iecode_*` symbols from target `iecode_ffi`; the older `@aphrody/nie` binding
      requests `nie_*` symbols from `libiecode` and is incompatible. The staged
      `@aphrody/iecode-ffi` wrapper matches the current symbol names, but its Rust
      provider has not joined this Cargo workspace. Keep game loaders inactive
      until the IEVR FFI/schema, data and license boundary are reconciled.
- [x] Inventory current NIE MCP and Bun plugin contracts in
      [`NIE-MCP-API-INVENTORY.md`](docs/migration/NIE-MCP-API-INVENTORY.md): NIE's
      source router has 67 tools (48 `cli_*` adapters and 19 compatibility tools),
      MCP stdio transport, and a separate optional loopback explorer WebSocket.
      Its exact schema, bounds, side effects, and the FFI incompatibility are
      recorded from current heads.
- [ ] Keep the existing single configured `aphrody-mcp` endpoint. The current
      source adapter exposes 21 public Aphrody tools, with dynamic discovery and
      dispatch for 67 child tools; this is not direct `tools/list` parity. The
      full binary-only MCP crate cannot be imported into this target without its
      AI workspace closure. First extract and qualify a library-only NIE stdio
      bridge, then migrate the endpoint without registering another server.
      Preserve schemas, errors, side-effect bounds and explorer lifecycle; use
      protocol fixtures before replacing the persistent `nie-mcp` child bridge.
      See [`APHRODY-MCP-EXTRACTION-READINESS.md`](docs/migration/APHRODY-MCP-EXTRACTION-READINESS.md).
- [ ] Import all remaining first-party crates, apps and packages into valid
      Cargo/Bun root workspaces; resolve package/catalog versions, path dependencies,
      license and upstream-submodule boundaries before claiming a unified build.
- [x] Audit IECODE Rust import boundaries and dependency/license evidence in
      [`IECODE-RUST-READINESS.md`](docs/migration/IECODE-RUST-READINESS.md). The
      smallest compile-qualified candidate is `iecode-geom`, but its source has no
      explicit crate SPDX/license metadata, so no new Rust source was copied from
      that report. `iecode-core`/`iecode-ffi` pull a broad crate graph; the native
      emulator artifact also has GPL-family obligations. Resolve the per-file
      rights and workspace metadata before selecting the next import.
- [ ] Inventory nested submodules/workspaces recursively and classify every
      declared source that is not on disk (`bevy`, `dust`, `emu.nintendo.wii.gecko`)
      before claiming source closure. `rg` and `shenron` are explicitly deferred.
      The 2026-09-29 Gitlink pass found 23 links: 11 match their index pins, 7
      checkout heads differ from their index pins, 3 lack `.gitmodules` declarations,
      1 nested checkout is uninitialized, and 1 (`aphrody-ui`) is reserved for its
      designated agent and was not inspected. The three named candidate roots are
      absent from disk and have no Gitlink in the inspected roots; their origin pins
      and workspace closure remain unresolved. The nested file map covers all
      initialized non-UI Gitlinks but does not close the absent `utils/cache`
      member, the uninitialized checkout or the delegated UI inventory.
- [x] Stage Infra's `@aphrody/workspace` at
      `packages/infra/aphrody-workspace` without its dependency cache. The new
      Bun root uses an isolated install policy and one lock; TypeScript 7
      typecheck, 11 package tests and IECODE doctor (11 Rust, 5 Bun) pass.
      The API-dependent AST scanner now imports `@typescript/typescript6` 6.0.2
      beside compiler TypeScript 7.0.2; frozen install, typecheck, oxlint, oxfmt
      and a real scanner invocation passed on 2026-09-29. Provenance and the
      dirty-source caveat are in
      [`INFRA-WORKSPACE-IMPORT.md`](docs/migration/INFRA-WORKSPACE-IMPORT.md).
- [ ] Qualify the copied Infra package from a clean clone and migrate its
      remaining callers before removing the transitional `src/aphrody-infra`
      source. This is part of the full `src/` exit gate, not a new release owner.
- [x] Stage six first-party Infra Rust crates and their contracts client in
      `crates/infra/` and `crates/contracts/`. The new CLI bridge invokes their
      binary, and locked offline check, Clippy and formatting pass. Provenance,
      current Rust test result, and remaining cutover gates are in
      [`INFRA-RUST-IMPORT.md`](docs/migration/INFRA-RUST-IMPORT.md).
- [x] Stage Infra's 32 tracked configuration/inventory files, 39 systemd files,
      and Rust toolchain pin at the target root. The
      [`infra-config-import.json`](docs/migration/infra-config-import.json)
      records source and target hashes, two explicit path remaps, endpoint
      classes, and nine files still referring to source checkouts. The importer
      rejects dirty sources and conflicting targets; an identical rerun copied
      no files. From the new root, `aphrody-infra validate` passes with 23
      services and 25 routes, and `service catalog` and `dev-env --local wsl`
      run successfully.
- [x] Stage the six clean tracked Infra scripts referenced by copied systemd
      units under categorized `scripts/` paths. The
      [`infra-scripts-import.json`](docs/migration/infra-scripts-import.json)
      records source HEAD and per-file SHA-256; an identical rerun copied no
      files. The configuration report now lists 18 checkout-path references by
      file and line: ten map to staged targets, while eight refer to the old
      checkout root. These scripts and unit paths remain unqualified for runtime
      cutover.
- [x] Preserve root license and notice blobs for the non-UI source roots.
      The [license import report](docs/migration/source-licenses-import.json)
      maps 16 pinned Git files to ten canonical copies and six exact-byte
      aliases, with blob IDs, source heads, worktree hashes and target hashes.
      Six worktree files differ in raw bytes only through verified Git checkout
      filters. IECODE has no root license file at its pinned revision; nested
      package licenses and the broader rights boundary remain open.
- [x] Commit 1,893 hash-verified documentation files from the 12 non-UI source
      roots whose pinned root license or notice is recorded. A target-side audit
      matched all 1,894 mapped document targets to their imported SHA-256 values;
      one target was already tracked as source license evidence. The
      [commit audit](docs/migration/DOCS-FIRST-PARTY-COMMIT.md) records the
      scope. The remaining owners and 1,292 unresolved local Markdown links keep
      the full documentation gate open.
- [x] Commit 2,275 hash-verified Bun documentation targets from pinned upstream
      HEAD `a2671046afbfc818fba21a4925f384b75dc8e109`. The imported Bun
      `LICENSE.md` is included. The
      [Bun docs audit](docs/migration/UPSTREAM-BUN-DOCS-COMMIT.md) records the
      zero-missing, zero-mismatch result; Bun's upstream fork remains a separate
      workspace and is not represented as imported code.
- [x] Verify the committed licensed-root and Bun documentation from a fresh
      clone of `4eaf8c4`: all 4,169 mapped targets are present and match their
      recorded imported SHA-256 values. This proves file integrity for these
      batches; it does not close the remaining docs, link, or workspace gates.
- [x] Commit 597 hash-verified Oxc documentation targets from pinned upstream
      HEAD `31d5266e150ff17af52f0c2fc798cc27dc9a5a59`, with its root LICENSE
      blob recorded in the source-license report. The
      [Oxc docs audit](docs/migration/UPSTREAM-OXC-DOCS-COMMIT.md) records zero
      missing files and zero hash mismatches. Oxc source remains an independent
      upstream workspace.
- [ ] Complete Infra's consumer and pipeline cutover without the transitional
      checkout. The Rust library suite now passes 52/52 after its Git overview
      test was isolated in a temporary repository. `pipeline --stage check --json` reports 12
      errors: IECODE's configured workspace path is absent and NIE lacks four
      declared Bun scripts. Review 61 unverified FQDN occurrences and one
      compound host alias before production use. Review the nine files with
      checkout references in inventory/systemd before changing deployed paths,
      rerun all scoped gates
      against a clean clone, and close the pipeline errors.
