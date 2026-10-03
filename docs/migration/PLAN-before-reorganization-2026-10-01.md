<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody monorepo extraction plan

## Third-party duplication cleanup — 2026-10-01

Removed 139 ignored, untracked dependency/build directories from the imported
Discord workspace and Drive source snapshot after checking each target against
Git's tracked files and ignore rules. `upstream/discord` fell from about 4.0 GiB
to 26 MiB; `crates/os/drive` fell from about 2.5 GiB to 23 MiB. All 2,232
tracked Discord files and 1,899 tracked Drive files remain. The remaining
upstream sources have no proven full-tree byte-identical replacement; their
provenance and active Cargo consumers are retained.

## Ignore rules — 2026-10-01

Reconciled the root ignore rules with imported Aphrody AI/UI/Web, Bun/Oxc and
Discord configurations. All 186 active Cargo member
target directories remain ignored; four tracked Rust source modules under
`src/target` are visible again. Thirteen tracked paths still match intended
local ignores (ten node_modules links, two Turbo logs and one Shenron
subtitle). `git diff --check` passes.

## Rust crate naming — 2026-10-01

The cross-monorepo convention for new Aphrody platform crates is recorded in
`docs/architecture/rust-crate-naming.md`. Existing Koharu product and
Obscura/Taffy vendor package IDs remain compatibility contracts. Aphrody's
active Cargo workspace metadata currently lists 186 packages: 152 `aphrody*`
packages, 25 Koharu packages, 8 Obscura packages, and Taffy.

Status: scaffold initialized 2026-09-29. The cross-repository authority is
`src/PLAN.md` is the legacy migration decision record;
this file is the active extraction authority and tracks this repository's extraction
and acceptance. Infra's `@aphrody/workspace` is the source of truth for generated
inventories and orchestration commands.

## IEVR ownership decision — 2026-09-30

All IEVR/NIE/IECODE-specific code is owned exclusively by `../iecode`.
No active game implementation, format parser, game data adapter, or NIE service
may remain in this Aphrody workspace. Confirmed duplicate Rust crates, the NIE
MCP relay and the IEVR inventory tool have been removed from this checkout.
Keep Aphrody libraries domain-neutral; record this rule above earlier extraction
notes that placed IEVR code in Aphrody.

## Target layout

- `crates/<domain>/<crate>`: all first-party Rust crates from Aphrody owners.
- `apps/<domain>/<app>` and `packages/<domain>/<package>`: all first-party Bun
  applications and packages, keeping public package names.
- `docs/<category>/<domain>`: canonical docs grouped by architecture, APIs,
  decisions, guides, operations, plans, products, reference, and research.
- `scripts/<category>`: audit, build, dev, migration, release, and tools.
- `upstream/`: pinned forks and upstream workspaces whose history/build roots
  remain independent.

Keep the original `rg` and Shenron checkouts in `src` until this plan and
`aphrody-py` meet every source-closure, compatibility, installed-workflow,
license, and rollback gate. Partial workspace integrations may proceed when
explicitly requested; they do not close these gates or authorize cutover.

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

- [x] Preserve the complete clean `aphrody-discord` HEAD `959abfab` below
      `packages/discord/source/repository`: all 2,232 tracked files, including
      apps, packages, docs, tools, root configuration, CI and lockfile, match
      source worktree SHA-256 values. See
      [`discord-complete-source-extraction.json`](discord-complete-source-extraction.json).
      The original workspace remains nested; root workspace integration and
      consumer cutover are still open.
- [x] Imported `@aphrody/messaging` from clean `aphrody-discord` HEAD
      `959abfab` into `packages/discord/aphrody-messaging` with file hashes in
      [`discord-messaging-extraction.json`](discord-messaging-extraction.json).
      Frozen Bun install, package typecheck, nine tests and build pass. A root
      Bun patch preserves REST cancellation behavior; standalone consumer
      qualification remains open because that patch is scoped to this root.
- [x] Created the local worktree at `<repo>` and initialized Git.
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
      [`source-map.json`](source-map.json) and
      [`submodule-inventory.json`](submodule-inventory.json) and
      [`nested-source-map.json`](nested-source-map.json).
- [x] Began docs extraction into categorized `docs/`; exact source duplicates
      share one target, source provenance remains in the map, and the generated
      index is [`IMPORTED-DOCS-INDEX.md`](IMPORTED-DOCS-INDEX.md).
      Existing target files and distinct path collisions are preserved and routed
      through explicit alternate paths.
- [ ] Close documentation import: the latest 2026-09-29 guarded import maps 2,130
      local links and records 1,030 unresolved links with zero importer failures. The importer
      recognizes verified imported file targets, including the corrected `@aphrody/nie`
      package manifest; five more links resolve than in the prior report. The remaining
      sample includes code, assets, configuration, external worktrees and unimported
      references. Import and qualify those destinations before closing this gate.
      See [`IMPORTED-DOCS-LINK-REAUDIT.md`](IMPORTED-DOCS-LINK-REAUDIT.md).
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
      [`script-import.json`](script-import.json). This is not yet a
      runnable unified command surface: relative paths, dependencies, ownership
      and source-local package scripts still need qualification.
- [x] Start the Rust workspace and copy the first IEVR slice, 254 files from
      IECODE's `crates/ievr-data`, to `crates/iecode/ievr-data` byte-for-byte.
      [`ievr-iecode-extraction.json`](ievr-iecode-extraction.json)
      records source/origin heads, SHA comparison, license boundary and the
      successful target `cargo check --all-targets --locked --offline`.
- [x] Import the vital AI home crate and its two direct first-party dependencies
      (`aphrody-models`, `aphrody-config`) from clean `aphrody-ai` HEAD
      `3aa88791f49b963a00f073cb206677ea9d1957e1` into `crates/ai/`. All 75
      source files match SHA-256; package names and Apache-2.0 licensing are
      preserved. The root workspace and shared dependency features now resolve
      the imported closure; `cargo check --offline -p aphrody-agent-home` passes.
      See [`ai-agent-home-extraction.json`](ai-agent-home-extraction.json).
- [x] Import five dependency-light AI foundation crates (`aphrody-toolcall`,
      `aphrody-patch`, `aphrody-context`, `aphrody-prompts` and
      `aphrody-providers`) from the same clean source HEAD. All 19 tracked files
      match source SHA-256 and modes. Their manifests join the root workspace;
      one offline Cargo check covering all five passes. See
      [`ai-core-crates-extraction.json`](ai-core-crates-extraction.json).
- [x] Add the AI ownership catalog crate and Gemini CLI runtime adapter,
      `aphrody-ecosystem` and `aphrody-gemini-runtime`, from that same clean
      source HEAD. All 10 files match their source hashes and modes; an offline
      check of both workspace members passes. See
      [`ai-runtime-crates-extraction.json`](ai-runtime-crates-extraction.json).
- [x] Import the model and routing foundation (`aphrody-antigravity`,
      `aphrody-model-client`, `aphrody-model-antigravity`, `aphrody-llm-infra`,
      `aphrody-router`, `aphrody-mcp-oauth` and `aphrody-toolcall-repair`). All
      138 tracked files match source SHA-256 and file modes at the same clean
      `aphrody-ai` HEAD. The seven new workspace members pass one offline Cargo
      check. See
      [`ai-model-stack-extraction.json`](ai-model-stack-extraction.json).
- [x] Prioritize the rest of `aphrody-ai`: import all 62 Rust workspace crates
      plus the non-member `aphrody-sdk` crate into `crates/ai/`; 797 source
      files match the recorded hashes and modes. Offline Cargo metadata resolves
      all 63 imported packages. A workspace all-targets check was attempted but
      is blocked by 22 Taffy API errors in the external `aphrody-web` checkout;
      the CLI and FFI crates remain excluded under the UI ownership rule. The
      extraction record lists 32 remaining workspace dependencies that still
      resolve to sibling checkouts, so clean-clone closure is not complete.
      See [`ai-rust-workspace-extraction.json`](ai-rust-workspace-extraction.json).
- [x] Import AI Bun packages `@aphrody/doc-ai`, `@aphrody/google` and
      `@aphrody/xai`, plus their direct first-party dependency `@aphrody/x`;
      keep package provenance and source hashes in
      [`ai-bun-workspace-extraction.json`](ai-bun-workspace-extraction.json).
      Frozen Bun install, Turbo typecheck (8/8), and the Google package build
      passed. Tests were not run. Resolve remaining dependency/workspace closure
      before marking unified clean-clone integration complete.
- [x] Align the Aphrody and Shenron Bun AI surface on AI SDK `7.0.116` and
      provider spec `4.0.18`; remove unused SDK 6 provider/gateway packages from
      `@aphrody/doc-ai`. Frozen root install, all nine Shenron workspace
      typechecks, doc-ai typecheck/build, Google build, and the Shenron pipeline
      AI tests (120 pass, 4 skip) pass. Test paths that still assumed the old
      Shenron directory layout were corrected. This scoped alignment does not
      close other root dependency or Shenron portability gates.
- [x] Remove the unqualified IECODE Bun staging packages from the Aphrody
      workspace. The staged `@aphrody/nie` ABI did not match the current Rust
      provider, while game-loader/data/license parity remained open. Remove
      `packages/iecode/`, its workspace glob and lock entries; keep the generic
      `@aphrody/bun-test-dom` host independently. Preserve the historical source
      hashes in [`iecode-bun-extraction.json`](iecode-bun-extraction.json).
      The optional Ghidra string import now uses `GHIDRA_STRINGS_PATH`, and the
      happy-dom docs no longer claim a plugin re-export. Bun's JSONC parser sees
      no IECODE workspace or resolution records. Full lock regeneration remains
      open: Bun 1.4.2 `install --lockfile-only --ignore-scripts` exits unsuccessfully
      on unresolved root catalog entries, minimum-release-age blocks and a 404
      from the configured registry; no full-workspace install is claimed.
- [x] Integrate IECODE's current `iecode-ffi` C ABI and its nine-crate Rust
      library closure into `crates/iecode/` from source HEAD
      `8fdab4b96014f70972c2855878cab49510ffe876` (including its 10 recorded dirty
      source paths). `cargo check -p iecode-ffi --locked --offline` passes.
      Package adjustments, file hashes and checks are in
      [`iecode-ffi-rust-extraction.json`](iecode-ffi-rust-extraction.json).
- [ ] Qualify the native ABI with Bun and .NET consumers. No IECODE Bun wrapper
      is currently staged in Aphrody. Reintroduce one only after it matches the
      Rust `iecode_*` contract and passes schema, data, license and consumer
      parity checks. Keep game-data loaders inactive until then.
- [x] Inventory current NIE MCP and Bun plugin contracts in
      [`NIE-MCP-API-INVENTORY.md`](NIE-MCP-API-INVENTORY.md): NIE's
      source router has 67 tools (48 `cli_*` adapters and 19 compatibility tools),
      MCP stdio transport, and a separate optional loopback explorer WebSocket.
      Its exact schema, bounds, side effects, and the FFI incompatibility are
      recorded from current heads.
- [ ] Keep the existing single configured `aphrody-mcp` endpoint. The full AI
      MCP crate and its recorded AI dependency closure are now in the root Cargo
      workspace; `cargo check --offline -p aphrody-mcp` passes with the default
      `dragonball` feature. Keep `nie` optional and disabled by default until
      NIE is a source member of this monorepo. The stdio transport has been
      extracted to the library-only `aphrody-mcp-nie-bridge` package, behind the
      opt-in `nie` feature, and passes its protocol, 67-name passthrough,
      schema-preservation, JSON-RPC error, timeout, bounded-frame and
      child-restart fixtures. Source DTO schemas are mirrored and tested with
      the source RMCP schema generator, including strict unknown-field rules.
      The existing client config and a spawned default Aphrody process now
      pass the single-endpoint initialize/tools-list smoke check with Shenron
      active and no `nie.*` tools. The default live-client check verifies all
      37 exact `dragonball.*` names and object schemas; the `toolbox` build and
      default router check cover the same names and annotations. A subprocess
      test verifies the 2026-07-28 stateless `server/discover` plus `tools/list`
      lifecycle against the full Shenron catalog, while a unit test covers
      modern/legacy request routing. Real NIE child-runtime and explorer UI
      qualification remain open. See
      [`APHRODY-MCP-EXTRACTION-READINESS.md`](APHRODY-MCP-EXTRACTION-READINESS.md).
      On 2026-09-30, `cargo test --locked -p aphrody-mcp -p
      aphrody-mcp-nie-bridge` passed before modern protocol qualification (97
      MCP unit tests, 4 client tests, and 5 bridge tests; 1 network-dependent
      browser test ignored). After the dual lifecycle change,
      `cargo test --offline --locked -p aphrody-mcp` passed (98 unit tests, 5
      client tests; 1 network-dependent browser test ignored), as did MCP
      Clippy with `-D warnings`. Default-off
      and explicit `--features nie` router checks both pass. The `@aphrody/bun`
      TypeScript 7 typecheck and `cargo clippy --locked -p aphrody-mcp -p
      aphrody-mcp-nie-bridge --all-targets --no-deps -- -D warnings` also pass.
      The opt-in `toolbox` tranche passes independently: `cargo test --locked
      -p aphrody-mcp --features toolbox` passes 148 unit tests (1
      network-dependent browser test ignored) and 5 client tests; toolbox
      Clippy with
      `-D warnings` and `cargo build --locked -p aphrody-mcp --features
      toolbox` also pass. Its initial lint exposed an undeclared RAG ORT cfg;
      the new `rag-ort` feature forwards `aphrody-rag/ort` and is included by
      `toolbox`. NIE remains excluded from that aggregate.
- [x] Integrate all ten Contracts crates in the root Cargo workspace. Nine crates
      were copied from clean source HEAD `4a22afb12b086573e6890e49a3bfbde7a96380ea`;
      package versions are retained under target workspace metadata. The six
      Contracts paths into `src` are gone. File-level hashes, target manifest
      adjustments, and consumer/clean-clone limits are in
      [`contracts-rust-extraction.json`](contracts-rust-extraction.json).
- [x] Integrate the complete OS Rust workspace (24 crates), Shell workspace
      (4 crates), and Compat workspace (13 crates) from clean source revisions.
      Excluded OS `drive` and `third_party` trees remain outside these copies.
      Their package identities are retained, the Oxc dependencies use the
      Compat-pinned fork revision, and Cargo no longer points to source checkouts
      for Contracts/OS/Shell/Compat. Locked offline metadata resolves 143 members
      and 1,521 packages; all 51 packages across those five domains pass locked
      offline `cargo check` individually and scoped formatting. Hashes, source revisions,
      explicit manifest/formatter adjustments and remaining gates are recorded in
      [`native-rust-extraction.json`](native-rust-extraction.json).
- [x] Integrate the 25-crate Koharu Rust workspace from clean source HEAD
      `83ab7fde8d4d73c84f4e1746fc79ce3fa0a4486b`. Original `0.83.5` package
      metadata and MIT/Apache notices are preserved; Cargo metadata resolves 169
      workspace members. The focused library check is blocked by the host's
      missing `fontconfig.pc`; tests are not run. Provenance and remaining gates:
      [`koharu-rust-extraction.json`](koharu-rust-extraction.json).
      Two source Cargo paths remain (UI x2); clean-clone and consumer parity are open.
- [ ] Import all remaining first-party crates, apps and packages into valid
      Cargo/Bun root workspaces; resolve package/catalog versions, path dependencies,
      license and upstream-submodule boundaries before claiming a unified build.
- [x] Audit IECODE Rust import boundaries and dependency/license evidence in
      [`IECODE-RUST-READINESS.md`](IECODE-RUST-READINESS.md). The
      smallest compile-qualified candidate is `iecode-geom`, but its source has no
      explicit crate SPDX/license metadata, so no new Rust source was copied from
      that report. `iecode-core`/`iecode-ffi` pull a broad crate graph; the native
      emulator artifact also has GPL-family obligations. Resolve the per-file
      rights and workspace metadata before selecting the next import.
- [ ] Inventory nested submodules/workspaces recursively and classify every
      declared source that is not on disk (`bevy`, `dust`, `emu.nintendo.wii.gecko`)
      before claiming source closure. RG and Shenron now have partial workspace
      integrations; their source-closure gates remain open.
      The 2026-09-29 Gitlink pass found 23 links: 11 match their index pins, 7
      checkout heads differ from their index pins, 3 lack `.gitmodules` declarations,
      1 nested checkout is uninitialized, and 1 (`aphrody-ui`) is reserved for its
      designated agent and was not inspected. The three named candidate roots are
      absent from disk and have no Gitlink in the inspected roots; their origin pins
      and workspace closure remain unresolved. The nested file map covers all
      initialized non-UI Gitlinks but does not close the absent `utils/cache`
      member, the uninitialized checkout or the delegated UI inventory.
- [x] Stage Infra's `@aphrody/workspace` at
      `packages/infra/workspace` without its dependency cache. The new
      Bun root uses an isolated install policy and one lock; TypeScript 7
      typecheck, 11 package tests and IECODE doctor (11 Rust, 5 Bun) pass.
      The API-dependent AST scanner now imports `@typescript/typescript6` 6.0.2
      beside compiler TypeScript 7.0.2; frozen install, typecheck, oxlint, oxfmt
      and a real scanner invocation passed on 2026-09-29. Provenance and the
      dirty-source caveat are in
      [`INFRA-WORKSPACE-IMPORT.md`](INFRA-WORKSPACE-IMPORT.md).
- [x] Add the Shenron facade to `@aphrody/workspace`; route its package checks,
      script audit, service catalog, dev environment and plan-only deployment
      through Aphrody and Infra. Import 483 source-hashed Shenron scripts under
      `scripts/tools/shenron`; qualify the same workspaces and compatible root
      dependency catalog. Package typechecks, migration audit and Infra service
      catalog pass. The UI/runtime/dependency convergence roadmap and remaining
      script portability checks are in
      [`APHRODY-ROADMAP.md`](../plans/shenron/APHRODY-ROADMAP.md). This does
      not close the clean-clone or release gates.
- [ ] Qualify the copied Infra package from a clean clone and migrate its
      remaining callers before removing the transitional `src/aphrody-infra`
      source. This is part of the full `src/` exit gate, not a new release owner.
- [x] Stage six first-party Infra Rust crates and their contracts client in
      `crates/infra/` and `crates/contracts/`. The new CLI bridge invokes their
      binary, and locked offline check, Clippy and formatting pass. Provenance,
      current Rust test result, and remaining cutover gates are in
      [`INFRA-RUST-IMPORT.md`](INFRA-RUST-IMPORT.md).
- [x] Stage Infra's 32 tracked configuration/inventory files, 39 systemd files,
      and Rust toolchain pin at the target root. The
      [`infra-config-import.json`](infra-config-import.json)
      records source and target hashes, two explicit path remaps, endpoint
      classes, and nine files still referring to source checkouts. The importer
      rejects dirty sources and conflicting targets; an identical rerun copied
      no files. From the new root, `aphrody-infra validate` passes with 23
      services and 25 routes, and `service catalog` and `dev-env --local wsl`
      run successfully.
- [x] Stage the six clean tracked Infra scripts referenced by copied systemd
      units under categorized `scripts/` paths. The
      [`infra-scripts-import.json`](infra-scripts-import.json)
      records source HEAD and per-file SHA-256; an identical rerun copied no
      files. The configuration report now lists 18 checkout-path references by
      file and line: ten map to staged targets, while eight refer to the old
      checkout root. These scripts and unit paths remain unqualified for runtime
      cutover.
- [x] Preserve root license and notice blobs for the non-UI source roots.
      The [license import report](source-licenses-import.json)
      maps 16 pinned Git files to ten canonical copies and six exact-byte
      aliases, with blob IDs, source heads, worktree hashes and target hashes.
      Six worktree files differ in raw bytes only through verified Git checkout
      filters. IECODE has no root license file at its pinned revision; nested
      package licenses and the broader rights boundary remain open.
- [x] Commit 1,893 hash-verified documentation files from the 12 non-UI source
      roots whose pinned root license or notice is recorded. A target-side audit
      matched all 1,894 mapped document targets to their imported SHA-256 values;
      one target was already tracked as source license evidence. The
      [commit audit](DOCS-FIRST-PARTY-COMMIT.md) records the
      scope. The remaining owners and 1,030 unresolved local Markdown links keep
      the full documentation gate open.
- [x] Commit 2,275 hash-verified Bun documentation targets from pinned upstream
      HEAD `a2671046afbfc818fba21a4925f384b75dc8e109`. The imported Bun
      `LICENSE.md` is included. The
      [Bun docs audit](UPSTREAM-BUN-DOCS-COMMIT.md) records the
      zero-missing, zero-mismatch result; Bun's upstream fork remains a separate
      workspace and is not represented as imported code.
- [x] Verify the committed licensed-root and Bun documentation from a fresh
      clone of `4eaf8c4`: all 4,169 mapped targets are present and match their
      recorded imported SHA-256 values. This proves file integrity for these
      batches; it does not close the remaining docs, link, or workspace gates.
- [x] Commit 597 hash-verified Oxc documentation targets from pinned upstream
      HEAD `31d5266e150ff17af52f0c2fc798cc27dc9a5a59`, with its root LICENSE
      blob recorded in the source-license report. The
      [Oxc docs audit](UPSTREAM-OXC-DOCS-COMMIT.md) records zero
      missing files and zero hash mismatches. Oxc source remains an independent
      upstream workspace.
- [x] Verify the expanded documentation set from a fresh clone of `bb5fb65`:
      all 4,766 first-party, Bun and Oxc document targets and all 16 license
      source records are present with matching SHA-256 values.
- [ ] Complete Infra's consumer and pipeline cutover without the transitional
      checkout. The Rust library suite now passes 52/52 after its Git overview
      test was isolated in a temporary repository. `pipeline --stage check --json` reports 12
      errors: IECODE's configured workspace path is absent and NIE lacks four
      declared Bun scripts. Review 61 unverified FQDN occurrences and one
      compound host alias before production use. Review the nine files with
      checkout references in inventory/systemd before changing deployed paths,
      rerun all scoped gates
      against a clean clone, and close the pipeline errors.

## Consolidation checkpoint — 2026-09-29

- [x] Rebuilt the Infra-owned source inventory and documentation import reports
      from the current checkout state. The inventory covers 15 present roots and
      66,272 paths; it records source HEADs, dirty paths, hashes, workspace
      manifests, and missing roots. The guarded docs import copied 0 files,
      refreshed 0 targets, verified 6,012 identical documents, preserved 163
      exact-duplicate aliases, and reported 0 conflicts or import failures. It
      mapped 2,130 local Markdown links and leaves 1,030 unresolved. The latest
      reports are [`source-map.json`](source-map.json) and
      [`document-import.json`](document-import.json).
- [x] Marked 24 structured NIE game-data files as protected data in the Infra
      inventory module. They remain in their local protected paths, are excluded
      from document import/index generation, and are ignored by Git. Explanatory
      Markdown remains eligible for documentation import.
- [x] Regenerated the Infra ecosystem catalog from the active `~/src`
      checkouts: 10 repositories, 126 crates, 55 binaries, 59 Bun packages,
      5 Python packages, 49 CLI binaries, 443 CLI commands, 401 MCP registrations
      and 383 unique MCP names. The catalog check remains red: `aphrody-ai` and
      the UI-owned checkout cannot complete `cargo metadata` because sibling
      dependency paths are unavailable. `aphrody-ui` was not changed.
- [x] Infra reports 56 declared root Bun workspace packages. Its layout check
      passes. The earlier domain-scoped audit saw 92 Cargo members, of which 8
      were integrated in the requested non-AI/non-Web perimeter. After the
      subsequent Contracts/OS/Compat/Shell consolidation, current
      `cargo metadata --no-deps` now sees 178 members. The non-AI/Web Rust
      perimeter includes 10 Contracts, 6 Infra, 24 OS, 13 Compat, 4 Shell, 1
      Native, 25 Koharu and 10 IECODE packages (93 total). The 64 AI and 21 Web
      members are outside this extraction tally.
- [ ] Make the Rust workspace self-contained and qualify a clean clone. The
      current root manifest has two paths into `~/src`, both UI crates
      reserved to the UI owner. Native, Compat/N2B, Koharu and IECODE's data/FFI
      Rust sources are now members. Infra's current source workspace has six
      members and all six are integrated. NIE engine crates, UI Rust, remaining
      IECODE Rust consumers, and end-to-end ABI parity are open. No Rust source
      was identified for Fut.
- [x] Import the four `@aphrody/n2b-*` Bun packages into `packages/compat/`
      and add their workspace records to the root manifest and lock. Their four
      scoped typechecks pass. Source hashes and target config adjustments are
      recorded in [`compat-bun-extraction.json`](compat-bun-extraction.json).
- [x] Import OS Bun clients `@aphrody/os` and `@aphrody-code/winclean` under
      `packages/os/` and register both in the root workspace and lock. Scoped
      typechecks are currently blocked by absent/broken package tool links in
      `node_modules`; source provenance and adaptations are in
      [`os-bun-extraction.json`](os-bun-extraction.json).
- [x] Import Koharu's SDK, bridge and documentation workspaces under
      `packages/koharu/`, with root workspace/catalog entries and source lock
      records. The bridge typecheck passes; SDK typecheck passes with temporary
      local links to its workspace and Tauri API dependencies. Hashes and path
      adaptations are in [`koharu-bun-extraction.json`](koharu-bun-extraction.json).
- [x] Import Fut's `@aphrody/fut` package under `packages/fut/fut/`. Its tracked
      session credential was excluded and ignored. Typecheck is blocked by the
      absent BXC peer and existing missing source modules; see
      [`fut-bun-extraction.json`](fut-bun-extraction.json).
- [x] Recount the live workspace against the attached migration audit:
      `cargo metadata --no-deps --format-version 1` reports 178 workspace
      members, and a path-dependency scan finds only two paths outside this
      checkout, both into UI-owned crates. The attachment's 92-member and
      30-path counts no longer describe this worktree. Source `aphrody-shell`
      HEAD `2a829cd7` has no Bun workspace or package manifests; its README
      confirms there is no Bun workspace to import.
- [ ] Complete the remaining Bun workspace migration for the same perimeter.
      UI/M3 is imported; NIE/IECODE application workspaces remain open.
      Reconcile Infra's remaining source manifests. Bun/Oxc sources are not
      present under `upstream/` (only Discord and simdutf-rio are); document
      references do not constitute a source import. Central N2B/Oxc FFI
      packaging remains a boundary to verify in the AI-owned domain.
- [x] The root repository has no Git remote, so the consolidated batch was
      committed locally as `004540e1`; it cannot be pushed from this checkout.
- [x] The initial Infra Bun audit found 150 manifest violations and repaired
      149. The remaining M3 config/preset gap was closed by importing the UI M3
      packages. The current root audit covers 81 first-party manifests and
      reports zero violations.
- [ ] Restore clean-clone dependency closure before claiming a unified build:
      the root Bun 1.4.2 frozen install now passes with `--ignore-scripts` after
      catalog repairs and retargeting the RG bot to `@aphrody/discordx`. The
      full `rg check all` still exits non-zero: formatting and typecheck gates
      fail, and the website build references the absent
      `scripts/next-build.sh`. `packages/rg/inagle` also cannot resolve the new
      `@aphrody/agent-browser/cdp` package in the current installed workspace.
      Repair these manifests, workspace links and gates before production use.
- [ ] Close repository documentation links: the Infra `docs-links` pass scanned
      5,940 Markdown documents and 8,880 links and reported 7,725 unresolved
      targets. This wider scan includes upstream documentation routes and source
      tree paths; use the per-link report to distinguish intentional upstream
      routes from missing local files. The docs overlap scan was not used to
      delete content; fixture similarity is not proof of duplicate documentation.
- [ ] Reinventory the missing source checkouts: `~/src/aphrody-web`
      and `~/src/aphrody-discord` are absent as reported by the user;
      `~/src/rg`, `~/src/shenron`, `bevy`, `dust`, and
      `emu.nintendo.wii.gecko` are also absent. Their source closures, licenses,
      consumer mappings, and clean-clone parity remain open.
- [ ] Keep the consolidated agent work transitional until the gates above pass.
      Targeted agent reports cover native Web/MCP, Google cookies/search, browser
      CDP, and RG scraping work; the root Bun frozen install passes, but the Rust boundary,
      documentation-link, and RG quality gates have not passed.

## M3 extraction checkpoint — 2026-09-29

- [x] Import the Aphrody UI M3 Bun family and Rust M3 stack into the monorepo,
      scoped to 18 M3 packages and seven crates. `@aphrody/canvas` was included
      as a direct dependency of `@aphrody/material-web`; the SVG and render crates
      are dependency closure for the Bun FFI crate. The existing `@aphrody/bun`
      package was merged while keeping its `./web` entry point. Source HEAD,
      per-file source/target hashes, explicit adaptations, license and exclusions
      are recorded in [`ui-m3-extraction.json`](ui-m3-extraction.json).
      The source checkout remains intact.
- [x] Register `crates/ui/*`, move the root `aphrody-m3-tokens` dependency off
      `~/src`, and link M3 Bun packages to the local token/config
      packages. Cargo metadata passes offline with the lockfile held fixed after
      recording 49 new locked packages. The M3 token package now extends the
      imported `@aphrody/m3-config` preset.
- [x] Register the M3 Bun packages and their dependency-closure packages in the
      root Bun workspace, correct DiscordX to `@aphrody/discordx`, align recent
      catalog entries with the three-day release-age policy, and regenerate
      `bun.lock`. A frozen root install passes and the Infra Bun audit reports
      zero violations across 81 manifests. M3 package tests and builds remain
      unrun; clean-clone qualification remains open.

## Production qualification checkpoint — 2026-09-30

- [x] Restore N2B's original report baselines, Node input fixture and Contracts
      schemas with source revisions and byte hashes in
      [`n2b-test-resource-extraction.json`](n2b-test-resource-extraction.json).
      The CLI contract suite now runs entirely from this checkout: 20 tests
      pass, including JSON/JSONL/SARIF/Markdown and schema validation.
- [x] Import the repository A2A manifest and correct its migrated test path.
      All 27 `aphrody-a2a-coord` tests and scoped strict Clippy pass after
      correcting inherited lint errors. Provenance is recorded in
      [`contracts-agent-manifest-extraction.json`](contracts-agent-manifest-extraction.json).
- [x] Remove the Koharu protocol generator's dependency on the nonstandard
      compile-time `CARGO_WORKSPACE_DIR`; its default resolves the imported
      bridge package, with `KOHARU_PROTOCOL_OUT` as an explicit output override.
      The workspace all-targets locked offline Cargo check passes after these
      resource/path repairs. This does not prove clean-clone closure: external
      UI dependencies and the app-server console placeholder remain open.
- [x] Correct RG's migrated typecheck commands, website aliases, inherited
      source root, linter paths and Next tracing/build-script paths. Build
      verification now requires a successful Next exit plus fresh build ID and
      standalone server; four subprocess regression tests pass. The broader
      RG typecheck still fails on application/dependency errors, including the
      agent-browser CDP binary-message type. Full RG build and quality gates
      remain open.
- [x] Correct Infra's generated docs index directory and Markdown destination
      parser in both the authoritative owner and imported dispatcher. Owner
      commit `fb4bf582` is pushed; TypeScript 7, scoped Oxc and all 21 target
      dispatcher tests pass. The actual links audit falls from 7,700 to 1,896
      unresolved targets; 216 index entries still point to absent IECODE
      destinations. The new `consolidation docs-index` reports these gaps and
      fails qualification rather than hiding them. Anchor and exclusion
      coverage remain open.
- [x] Repair Bun docs discovery at its Rust owner and install a source-pinned,
      hash-verified corpus in the user data directory. The source fix is pushed
      as Compat commit `17851d9`; all 12 resolver/search tests, strict Clippy
      and check pass. The rebuilt release passed native CLI and isolated stdio
      MCP smokes; the configured live Codex tool now returns Bun documentation
      after reloading only its kernel child. Evidence is recorded in
      [`native-mcp-cli-qualification.json`](native-mcp-cli-qualification.json).
- [x] Qualify and activate the Linux native kernel/provider release on this host.
      Source corrections cover MCP pagination/annotations/reply IDs, Infra
      path resolution and runtime TOML parsing; kernel tests and release build
      have passed at the kernel scope and the validated release is active, with
      the previous binary retained for rollback. Final full transitive strict
      Clippy and all 78 kernel/CLI tests now pass. The configured root thread
      uses kernel PID 717194 and provider PID 717217; installed and loaded
      SHA256 hashes agree. Original Bun docs and native Web language calls
      succeed after activation. Cross-platform and wider production closure
      remain open.

- [x] Fix two proven forensic edge cases at the Rust owner: empty entropy input
      and a UTF-16 run ending at EOF. The target kernel/RE suite passes 225
      tests and doctests, with three credential/live-application tests ignored.
      Capture, execution-policy and event crates pass 30 checks; Compat and
      Systemd pass seven tests and scoped strict Clippy.
- [x] Make Infra production gates discover every declared Bun member and run
      actual package scripts plus locked Rust checks, tests and release builds.
      Missing or placeholder scripts are reported as qualification gaps. All
      30 Infra/RG build regressions pass; the real plan reports 81 packages,
      224 commands and 190 coverage gaps. Full gate execution remains open.

- [x] Repair native Infra maintenance/quality repository selection and YOLO
      resource discovery at the owner and target. All 21 tests, strict Clippy,
      check and builds pass. Actual native commands now resolve this workspace
      and the imported plugin without overrides. Owner commit `88faaf76` is
      pushed; 112 required plugin resources retain hashes and licenses in
      [`yolo-resources-extraction.json`](yolo-resources-extraction.json).
- [x] Remove attempts to launch the retired BXC executable from native Web
      tool discovery and calls. The MCP catalog uses six existing Rust owners,
      the CLI resolves `aphrody-web`, and prompts refer to available tools.
      Scoped MCP tests pass 12/12, client tests 18/18 and bridge tests 56/56,
      with strict Clippy. Unmapped historical registry aliases remain explicit
      gaps; no legacy executable is reintroduced. The rebuilt provider is
      active on the configured root thread: 159 unique tools and a successful
      original native Web call returning 195 supported languages.

## Unified native UI bridge — 2026-09-30

- [x] Link the existing M3/SVG/render ABI into `aphrody-ffi` and keep
      `aphrody-bun` as an internal rlib. All 22 historical UI C symbols are
      exported by the aggregate. CLI, Web, Manga, Shenron and M3 package
      subpaths now use one lazy handle and typed registry; imports work
      without a native artifact. Dynamic allocator TLS fixes the Bun dlopen
      failure after combining these surfaces. Scoped Rust tests pass 61/61,
      Bun handle/import tests 2/2, and UI/CLI contract smokes, typecheck and
      strict Clippy pass. See [evidence](unified-ui-ffi.json).
      N2B/Oxc/fork consumers, portable package/release manifests, runtime
      unload lifecycle and cross-platform/product gates remain open.
- [x] Migrate Spacedrive non-UI backend, server, and UI bridge. `crates/os/drive` (1,899 files) and `crates/web/drive-server` (9 files) are FSL-1.1-ALv2 and excluded from the root `Cargo.toml`. `crates/ui/drive` (28 files) is an FSL-1.1-ALv2 Tauri plugin. Apache-2.0 root crates are not relicensed. See [`drive-rust-extraction.json`](drive-rust-extraction.json) for source commit 0511c85 and file counts. Repository manifests remain valid.

## Rust crate, GPU and window ownership — 2026-09-30

- [x] Compare active Rust workspace ownership with imported upstream references. The workspace has one direct `wgpu` version (30.0.1) and one shared initialization/policy crate; `aphrody-render` still has its own context path, so backend convergence is incomplete. No active Cargo member owns a Bevy/winit/SDL window; Bevy remains the documented NIE host choice while the emulator core stays headless. Recorded current boundaries and remaining actions in [`rust-crate-gpu-window-ownership.md`](../architecture/rust-crate-gpu-window-ownership.md).
- [ ] Route `aphrody-render` GPU context creation through the shared backend while preserving its injected-device API; relocate the backend out of the IECODE namespace after consumer mapping.
- [ ] Decide package renames only after preserving upstream-compatible identities and enumerating Cargo selectors/downstream use. The workspace currently contains IECODE/NIE/Koharu/Obscura package names without `aphrody-` prefixes.
- [x] Move `aphrody-logo` and `aphrody-identity` into `crates/ui/`, recable their former AI/UI workspace consumers, and remove them from the former UI workspace. The NIE UI token crate belongs to IECODE: transferred it to `iecode/crates/nie/aphrody-nie-ui` with the `aphrody-nie-*` package prefix and local `aphrody-nie-formats` owner. Recabled the IECODE workspace's Aphrody RE/UI dependencies to the canonical monorepo and routed its removed Bevy root-facade paths through the prefixed internal facade alias. Aphrody locked metadata, `aphrody-web` check, Aphrody CLI check, logo tests, and no-deps metadata for IECODE and the former AI/UI workspaces pass. The focused NIE compile remains blocked by the existing `rand/small_rng` feature conflict in `aphrody-nie-wiki`.
