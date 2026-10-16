# Integration plan

## Unified product stabilization — 2026-10-16

- [x] Qualify the shared native Cargo admission adapter: 11 tests and 72
      assertions pass; root native type checking covers 327 files.
- [x] Report undeclared physical applications as well as packages. Two layout
      tests pass with 31 assertions; declaration gaps remain fatal.
- [x] Correct nine lint diagnostics in six first-party files, preserving worker
      startup, sparse arrays, host-script compatibility and Storage validation.
      Full native lint reports 4,292 warnings and zero errors across 7,969 files;
      the warning-denying product gate remains incomplete.
- [x] Admit 375 generated Windows packages into the root workspace and lock,
      retaining their payloads and licenses. All 375 resolve through local
      workspace links; offline frozen installation, native root/suite checks
      and ten contract tests pass. DLL execution was not qualified.
- [x] Admit RE through its existing two CLI and two library entries. Native
      entry checking covers 20 files, local exports resolve and offline frozen
      installation passes without changing existing dependency versions.
- [ ] Complete the six remaining physical Bun admissions. The current root
      has 557 members; UI migrations and the two upstream monorepo source
      owners require deliberate consumer and ownership qualification.
- [x] Reject obsolete reset-state setters and stale tournament-note requests,
      including reversed same-owner refreshes. Five tests and 25 assertions
      pass, with native checking on 61 files. Preserve the necessary dependency
      in `finally`; its remaining native memo-dependency warning is reproduced.
- [ ] Qualify native lock generation with the newer runtime. The installed
      runtime still fails two existing catalog resolutions. RE's two local
      workspace records were repaired without existing-record drift and then
      verified by native offline frozen installation; this is not a generator fix.
- [ ] Qualify Storage private-directory permissions on an admitted host. The
      existing suite passes 19 tests on Windows; one POSIX-mode privacy check
      fails closed. No real Storage migration was performed.
- [ ] Qualify native Infra and full product builds after the existing Android
      build releases its native processes. A free canonical mutex alone does
      not make overlapping compilation safe.

## Bun OS Infra and Workspace absorption — 2026-10-16

- Owner update: absorb and update Aphrody Infra and Workspace as Bun OS
  capabilities, superseding their earlier separate Aphrody ownership.
- [x] Move 263 tracked Infra configuration files into `infra/config`, updating
      source consumers and preserving host permissions and protected stores.
- [x] Merge 109 automation modules and 73 tests into `packages/bun-workspace`,
      migrating consumers, exports and the shared lock. Preserve Apache notices.
- [x] Add root `infra`, `ops` and Workspace automation dispatch and the native
      `bunos-infra` source target. Types pass on 339 files; targeted tests,
      metadata and the real frozen installation pass.
- [x] Remove obsolete product-layer splits from current documentation and
      source metadata; AI, Infra and Workspace belong to the same Bun OS product.
- [ ] Compile and qualify the new native Infra binary. The installed binary
      still identifies its previous build; the active Android build remains intact.
- [ ] Resolve remaining historical host-path declarations and full-product lint
      diagnostics. Native declaration emission needs the newer Bun source build.
- [ ] Retire the old generated Workspace installation. Automatic approval review
      rejected removal with `blocked by policy`; its 25 dependency files remain.

## IECODE absorption, RE merge and forge recovery — 2026-10-16

- All IECODE Rust crates (93 packages), Bun packages, apps and scripts are absorbed into the flat root `crates/`, `apps/` and `packages/` layout, one direct child per member, under the root nightly toolchain and Bun 1.4.4 native quality commands. `C:srciecode` is kept untouched until the owner retires it.
- Reverse engineering is merged into one capability: `packages/re` (Bun-native fork of morluto/rea, `aphrody-labs/rea`) and `crates/re` (Rust core `bun-re` folding `aphrody re`, `shenron-re`, `aphrody-nie-re`, `aphrody-nie-dump` and `aphrody-nie-steam`; features `nie`, `steam-emulator`, `steam-download`, CLI `bunre-steam`). Ghidra bumped to upstream, JDK and Android SDK/cmdline-tools installed and on the user PATH.
- `packages/kernel-client`, `packages/ovh` and `packages/paths` are inlined; the retired `bun-forge` Gitea (empty data, container stopped on vps) is no longer a source owner. Remaining `bun-forge` submodule URLs must move to GitHub or be inlined.
- [x] Repair the shared Bun lock for the existing `bun-arch-mcp`, `bun-blender`
      and `bun-loaders` members. Frozen offline installation with lifecycle
      scripts enabled passes on native Bun 1.4.4 revision `032dd109c`;
      `@aphrody/bun-types` 1.4.4 is installed. The previous duplicate-path error
      is not reproduced. This does not qualify complete setup or application builds.
- Open: `bun lint` walks intentionally broken fixtures in `toolchains/bun`
  and needs an ignore; root quality and `setup.ts` PATH/shell setup remain
  to qualify; `toolchains/bun` stash holds an unrelated `bun.lock.rs` change.
- [x] Align source inventory with Android/IECODE absorption and the canonical
      `sources/` and `vendor/` mounts. Scoped native check (16 files), lint,
      formatting and eight invalid-mount rejection probes pass. Setup now
      qualifies the retired forge transport only when declared sources need it;
      complete setup and physical consolidation remain unqualified.
- [x] Add a read-only setup preflight and retain initialized source owners at
      different revisions before installation. A temporary-repository integration
      test verifies that the live revision and uncommitted file remain intact.
      The current runtime source differs from its pin, so full setup remains
      pending without moving the active Android build's checkout.

## MSYS2 vendor and Desktop integration — 2026-10-16

- [x] Move 29 physical MSYS2 source owners into flat `vendor/`, retaining 94
      contained dependencies, licenses, source HEADs and semantic Git indexes.
- [x] Register 66 unique vendor Git owners: 29 moved checkouts and 37 lazy
      Arch owners. Coalesce six shared owners and preserve all 45 reference pins
      separately from selected checkout revisions.
- [x] Preserve 12 active Bun Engine consumer views and rebind three incoming Git
      alternates; verify zero broken Git pointers or linked worktrees.
- [x] Publish the existing cym owner's source/runtime/workspace separation and
      pure plan/doctor contract. Add root `msys2 plan|doctor|lock` orchestration,
      native ABI boundaries and deterministic installed-metadata locks.
- [x] Apply the MSYS2 review fixes: optional pacman, guarded links/Home, strict
      package identity parsing and registry-scoped source inspection.
- [x] Install cym 1.0.0-8 through native pacman after archive identity/payload
      checks; verify zero altered files, help/plan, unchanged configuration and
      the other 99 installed packages.
- [ ] Retire eight obsolete source junctions. Automatic approval review rejected
      their removal with `blocked by policy`; the valid views remain in place.
      Twelve active Bun Engine consumer views and external Git stores stay required.
- [ ] Resolve the existing Linux recipe merge with its source owner; its ten
      unmerged paths and missing object alternate remain preserved. A bounded
      connectivity probe did not establish object completeness.
- [ ] Qualify native Desktop toolchains, graphics artifacts and activation;
      metadata inspection and a compiled CLI are separate from that release.

## Arch distribution assembly — 2026-10-16

- [x] Stop the previous runtime build and local migration loop before reassessment.
- [x] Assign three agents to CachyOS, ChimeraOS and Omarchy primary-source catalogs.
- [x] Inventory all custom recipes, package lists, build tools, SDK/library inputs,
      kernel sources, Rust manifests/locks and upstream licensing boundaries.
- [x] Provision and read back 45 pinned source references in 43 Aphrody Labs forks;
      preserve the existing Bun acceleration kernel and reuse existing source owners.
- [x] Make Arch/pacman the primary factory profile; retain Ubuntu as a distinct
      compatibility target. Separate server, COSMIC desktop and Gamescope gaming.
- [x] Connect source catalogs and the Arch source/resolve/rootfs/payload/image
      dependencies to the existing root CLI and factory graph.
- [x] Qualify signed archive resolution and offline exact-package server rootfs
      assembly on the admitted VPS Docker host: 137 packages from 2026-10-15,
      exact inventory and a 599900160-byte archive with hashes and receipts.
- [x] Reuse the owner's MSYS2 source/Home contexts through a native read-only
      inspector; repair seven stale CachyOS junctions while preserving dirty Git work.
- [ ] Build and qualify the selected kernel, complete desktop/gaming package
      closures, boot media, hardware support and data-preserving updates.
- [ ] Finish the existing Bun/Cargo member migration and frozen installation;
      the source catalogs and new forks do not complete those older gates.

## Selected source integration and flat layout — 2026-10-16

- [x] Android is absorbed. Imported from
      `aphrody-labs/bun-engine-android` (MIT, sibling `android` checkout):
      `crates/android-native` (JNI + embedded Bun bridge), `apps/java-ffi`,
      `apps/bun-android` (former `apps/android` Compose app),
      `packages/android-pipeline`, `packages/android-web`. The
      `bun-engine` Android copies are older duplicates of these owners; the
      `rea` JADX provider stays in `packages/re`. `apps/java-latest`
      (non-Android Java smoke) and `docs-sync` were not imported.
- [x] `packages/bun-android`: `bun android build|install|run|exec|logcat|devices|doctor|ndk`
      (SDK/NDK/Gradle/JDK discovery, NDK install through sdkmanager, NDK
      Cargo linkers, MSVC host env), manifest and `android-asset:` loaders.
- [x] `bun build --compile --target=bun-android-arm64|bun-android-x64`
      parses as the existing `linux-*-android` (bionic, ELF `.bun` section)
      target in `toolchains/bun`.
- [ ] Publish Android base runtimes (`bun-linux-*-android` tarballs) and a
      `libbun.so` exporting `bun_main`; until then pass
      `--compile-executable-path` / `BUN_COMPILE_TARGET_TARBALL_URL` and
      `bun android build --libbun <abi>=<path>`.
- [ ] Repair the root Cargo resolution (serde_json pin conflict) so
      `bun android build` can build `android-native` inside the workspace.

- [x] Preserve the initial source integration checkpoint and the 85
      existing distribution pins and add the Aphrody source: 86 mounts,
      77 repository/revision identities and 76 gitlinks.
- [x] Add the relative checkout catalog and read-only `bun src/cli.ts workspace`
      inventory through the existing root CLI; connect catalog locations to
      the canonical source exporter and check Bun Libraries ancestry.
- [x] Preserve active sibling checkouts, the linked migration worktree, all
      ignored/protected inputs and existing nested workspace owners.
- [x] Fix formatter configuration selection for the installed native CLI:
      use `--config`; its `-c` flag means check-only.
- [x] Pass root native type checking (114 files), lint (104 files) and
      formatting; commit the existing first-party font workflow/press assets
      and the verified CADCraft/SDK source-owner updates.
- [x] Commit pending source work and run actual pulls with rebase in the
      available source owners; preserve generated/private inputs and live
      concurrent Bun edits. Keep migration work on its published branch.
- [x] Preserve the remaining Bun Libraries history through `ec9539815` after
      checking that its native quality/redirect changes already have root
      implementations; verify the history import leaves the root tree unchanged.
- [ ] Finish one flat product `crates/`, `packages/` and `apps/`, with consumers,
      inheritance and one root build graph migrated together. Current nested
      library/workspace imports remain migration work.
- [ ] Converge all product capabilities on canonical Bun OS owners;
      migrate mixed adapters and consumers without duplicate implementations.
- [ ] Complete physical source relocation after active consumers and protected
      local state have explicit migration paths. Source coverage alone does
      not qualify relocation, native builds or one Cargo/Bun workspace.

## Flat source batches — 2026-10-16

- [x] Preserve ArtCraft and Aphrody source ancestry before relocating packages.
- [x] Prepare 62 flat ArtCraft members and 17 Aphrody members, reusing three
      existing canonical packages and preserving imported notices.
- [x] Retire the six duplicated Craft leaves and their empty source workspace.
- [x] Qualify eleven root Aphrody contract packages and Proc with native Cargo.
- [x] Fix native workspace literal rewriting without an sd subprocess.
- [x] Restore Tauri's declared workspace boundary and qualify native metadata.
- [ ] Qualify the native Bun frozen catalog replay fix with a checkout build.
- [ ] Finish shared frozen installation, root quality and moved frontend gates.
- [ ] Retire remaining source copies after consumers and canonical owners pass.

## Delivered in this batch

- [x] Merge Bun OS and Bun Libraries histories into this checkout on branch `os`.
- [x] Preserve the 16 library repositories and Bun runtime as pinned submodules.
- [x] Consolidate OS, library, video, artifacts, and desktop JS packages under
      one root Bun workspace and one `bun.lock`.
- [x] Provide one `bun run setup` entry point for recursive submodule setup and
      frozen Bun installation.
- [x] Consolidate formatting configuration and root quality commands.
- [x] Replace the quality subprocess runner with direct Bun check/lint/fmt
      commands; expose native n2b without an external backend.
- [x] Configure shared Cargo build and install destinations and ignore rules.
- [x] Preserve first-party attribution and imported licenses/notices.

## Material source ownership follow-up — 2026-10-13

- [x] Advance the exported Material pin to the current `os` owner revision and
      synchronize both M3 references to the single `aphrody-m3-os-themes` owner.
- [x] Resolve equivalent stale machine aliases to the selected workspace Bun
      checkout while preserving explicit per-build checkout configuration.
- [x] Validate the source graph through the distribution plan and run native
      Bun typecheck, lint and format gates.

## Runtime source preflight — 2026-10-13

- [x] Report the locked Bun revision, selected checkout revision, worktree
      cleanliness and build eligibility in the read-only distribution plan.
- [x] Use the shared bounded process owner for Git inspection; never infer a
      reproducible runtime build from a checkout path alone.

## Integrated Craft fonts and shared quality — 2026-10-13

- [x] Integrate `craft-fonts` and its licensed assets into the Bun OS Cargo workspace; preserve the source repository and publish its `os` integration commit `f1bfd5fd75f24619cad085230c7290f17ee7821e`.
- [x] Route Cargo metadata/check through the bounded workspace process owner. Locked metadata resolves `craft-fonts` and `craft-fonts-tests`; `cargo check --locked` passes on native Windows.
- [x] Route `cargo fmt --all -- --check` through the same serialized native owner; root Rust formatting passes.
- [x] Align Bun OS quality script names with Bun Libraries: `typecheck`, `lint`, and `format:check`. Native `bun run check` passes on 91 files, lint, and format.
- [x] Document source ownership, asset provenance, license boundaries, and the optional font embedding contract.
- [x] Qualify the font Git-submodule batch under the root nightly: 12 Rust
      tests and 4 workspace routing tests pass. A remote CI build remains
      unqualified until runner access and target runtime are wired.

## Still required for full consolidation

### CADCraft DXF owner — 2026-10-14

- [x] Split `cadcraft-dxf` from CADCraft's `crates/dxf` history, retain its
      license notices, publish its private forge `os` owner, and redirect the
      CADCraft consumer to the flat root crate.
- [x] Pass locked offline root metadata and `cadcraft-dxf` check, then pass the
      complete root Rust format check.
- [ ] Migrate the remaining 11 CADCraft workspace members.

### CADCraft DWG owner — 2026-10-14

- [x] Split `cadcraft-dwg`, preserve its history and MPL dependency notice,
      provision the private forge owner, and redirect CADCraft to the flat
      root crate.
- [x] Pass locked offline metadata, `cadcraft-dwg` check, and root Rust format.
- [ ] Migrate the remaining 10 CADCraft workspace members.

### CADCraft font owner — 2026-10-14

- [x] Split `cadcraft-fonts`, preserve source history and licenses, publish the
      private forge owner, and redirect CADCraft to the flat root crate.
- [x] Align its `skrifa` features with source defaults and root version 0.48;
      locked offline metadata, crate check, and root Rust format pass.
- [ ] Migrate the remaining 9 CADCraft workspace members.

### CADCraft renderer and IO owners — 2026-10-14

- [x] Split `cadcraft-render` and `cadcraft-io` from their CADCraft histories,
      preserve source notices, provision private forge owners, and redirect the
      consumer workspace to the flat root crates.
- [x] Pass locked offline CADCraft metadata, `cadcraft-io` root check, and the
      complete root Rust format check. Tests were not run.
- [ ] Migrate the remaining 7 declared CADCraft workspace members; `xtask`
      remains a separate name-collision decision.

### CADCraft engine owner — 2026-10-14

- [x] Split `cadcraft-engine` with history and notices, provision its private
      forge owner, and redirect CADCraft to the root crate.
- [x] Pin `rstar` 0.12.2 in the root dependency table; locked offline metadata,
      `cadcraft-engine` check, and complete Rust format check pass.
- [ ] Migrate the remaining 6 declared CADCraft workspace members; `xtask`
      remains a separate name-collision decision.

### CADCraft MCP owner — 2026-10-14

- [x] Split and publish `cadcraft-mcp` with its source history and notices;
      redirect CADCraft to the root owner and remove its unused `cadcraft-io`
      dependency.
- [x] Pass locked offline CADCraft metadata, `cadcraft-mcp` root check, and the
      complete root Rust format check.
- [ ] Migrate the remaining 5 declared CADCraft workspace members; `xtask`
      remains a separate name-collision decision.

### CADCraft UI owner — 2026-10-14

- [x] Split `cadcraft-ui-egui` with its source history and license notices,
      redirect the CADCraft consumer, and preserve contributor metadata from
      the pinned source submodule.
- [x] Pass locked offline CADCraft metadata, the root crate check and root Rust
      formatting. A recursion-depth warning in `gpu.rs` remains.
- [ ] Migrate the remaining 4 declared CADCraft workspace members; `xtask`
      remains a separate name-collision decision.

### CADCraft CLI owner — 2026-10-14

- [x] Split `cadcraft-cli` with its complete app and test history, preserve
      source licenses/notices, provision a private owner, and redirect the
      CADCraft workspace to the root crate.
- [x] Pass locked offline source and root metadata, targeted CLI check, and
      root Rust formatting. Tests were not run.
- [ ] Migrate the remaining 3 declared CADCraft workspace members; `xtask`
      remains a separate name-collision decision.

### Cargo source-owner inventory — 2026-10-14

- [x] Refresh the ignored inventory at root revision
      `c0cfa5ecc0d898055be7d7e43384379b18f3a761`: 53 pinned sources, 856 Cargo
      packages, 555 declared workspace crates, 37 flat root Git owners, and
      518 remaining declared crates. All source checkouts were available.
- [ ] Resolve the 11 remaining package-name collisions before flattening nested members;
      collisions include already extracted Craft crates and repeated workspace
      utility names such as `xtask` and `app`.
- [ ] Migrate remaining package owners in batches: pin each source crate directly
      under `crates/<package-name>`, preserve license/history, redirect consumers
      to the root workspace dependency, then update Cargo metadata/lock and run
      the serialized native target check for that batch.
- [x] Use `.local/crate-inventory.json` as the refreshed local inventory receipt;
      its counts describe declared manifests and membership, not build or runtime
      qualification.

- [x] Integrate the four library SDK owners into flat root Bun packages;
      internal dependencies use `workspace:*`. Remove superseded artifact
      and video adapters after reference checks. Root quality passes on
      107 files; seven Bun packages share version 1.4.4 and one lockfile.
- [x] Preserve the complete imported Libraries SDK source history through
      `7b5816ac06631bdc6ff772fb1f52c4cd7e66e8e6` in the parent ancestry.
- [x] Compile and execute the Windows standalone product API server from
      `dc7b3b67d92c8e8d29567e63b1952617444a5ab8`. Health and authenticated
      status/apps return 200; anonymous source catalog returns 401. Its
      SHA-256 is `0aa964312f88242a5fc58ed441c15490c4c73e227894ec7aad93454d1e93cd34`.
      Linux service deployment remains a separate gate.
- [x] Inspect immutable Cargo source manifests and dependency identities,
      reporting collisions and declared workspace members before migration.

- [x] Convert the font pilot into two private, pinned Git submodules directly
      under `crates/`, preserving split histories, licenses and asset tests.
- [x] Pin the root nightly to `nightly-2026-09-15`; serialize jobs and route
      Cargo intermediate outputs to `build/rust`, artifacts to `target`.
- [ ] Apply the same per-crate Git ownership to all remaining product owners.
- [x] Extract `craft-atomic` with its source history and exact code licenses,
      pin its forge `os` revision, and inherit Rustix 1.1.5 from the root.
      Native Windows qualification passes: 18 tests, Clippy and formatting.
- [ ] Deliver idempotent forge identities/repositories and runner credentials
      through Aphrody Infra and protected secret stores.
- [x] Deliver the first Infra provisioning batch (`aphrody/main` `bae198e935`):
      distribution mirror and three private crate repositories, two successful
      applications, protected runner key and a dedicated secrets contract.
- [ ] Self-host all Aphrody Labs repositories: complete inventory 239,
      preserve 205 public and 34 private visibility states, admit mirror jobs
      against real host storage and qualify the canonical source portal.

- [ ] Migrate Rust crate manifests and workspace inheritance out of the 16
      nested library workspaces and the Bun runtime workspace into one root
      Cargo workspace. Until then, Cargo workspaces remain separate.
- [ ] Consolidate the runtime's vendored sources and native build outputs into
      root-owned directories after its build scripts support those locations.
- [ ] Migrate the Bun runtime's nested aphrody-m3 source owner without changing
      its active checkout or concurrent work.
- [ ] Prove all library consumers resolve through the root Bun workspace and
      remove any redundant per-project install/build paths after verification.
- [ ] Run the unified setup and root quality gates; qualify desktop/native
      builds separately on their supported hosts.
- [ ] Commit the integrated batch and push branch `os` after remote ancestry
      verification.

## ArtCraft root Bun workspace — 2026-10-14

- [x] Register the ArtCraft frontend root and its 61 package manifests in the
      canonical Bun OS workspace. The generated root lock covers 1,287 package
      identities and passes a frozen-lockfile dry run.
- [x] Route ArtCraft install, development and build commands through the root
      Bun workspace and lockfile.
- [x] Align the dependency-free `api-enums` package with the root Bun formatter;
      its native check passes on 18 files, with lint and format checks green.
- [x] Complete the native Windows physical frozen install: 1,152 packages
      installed with lifecycle scripts disabled; the root lock hash remained
      `c7a89dc908a99c205c9ab5544e8b7b2532f2d3e388d5507931d654cfbba962a5`.
      The native ArtCraft compiler emitted 33 artifacts into root-owned
      `build/frontend/artcraft` using Bun 1.4.4 revision `4b8dee0bc`.
      Browser execution, desktop/native runtime and deployment remain unqualified.
- [x] Retire ArtCraft's tracked nested `bun.lock` and obsolete frontend tool
      configurations. Its `os` source pin uses the shared root dependency catalog.
- [ ] Migrate ArtCraft lint, formatting and typecheck into the unified native
      Bun quality gates without changing generated or imported assets blindly.
- [x] Replace direct external frontend checkers with `bun check`, `bun lint`
      and `bun fmt`; align 62 manifests to version 1.4.4. Native app checking
      passes on 1,479 files after React 19, Panels 4, Konva 10 and Tailwind 4
      consumer migrations. Frontend lint returns zero errors with existing
      warnings; complete formatting and legacy test migration remain pending.
- [x] Preserve imported ArtCraft workspace patterns when regenerating flat
      first-party manifests. Expand all 71 root members in the install audit.
- [x] Align ArtCraft dependency versions and retire its obsolete nested installs
      after checking committed source pins, the root lock and compiled artifacts.
      The full setup passes: 71 Bun members, 25 Cargo members, and no member
      `node_modules` after the shared install finalizer. Reinstallation recreates
      the redundant desktop file dependency; the setup finalizer removes that
      proven identical copy. Root metadata expands workspace globs correctly.

## Shared workspace owner — 2026-10-14

- [x] Retire the unused `@aphrody/bun-os-workspace` re-export facade after a
      source-reference audit; all product consumers already import
      `@aphrody/bun-workspace` directly.
- [x] Move the existing Cargo-routing tests under the canonical package and
      update the product build fingerprint to cover its implementation source.
- [x] Regenerate the root lock; frozen-lockfile dry run and root native quality
      gates pass after facade removal.
- [ ] Requalify the standalone product compiler. The existing tests were moved
      but not run.

## Soundcraft UI source owner — 2026-10-14

- [x] Migrate the Soundcraft consumer from the upstream `storytold/craft-libs`
      pin to the pinned `aphrody-labs/craft-libs` owner revision
      `e9546e191dd62f2bc1d61eca45dbdc2f1b3c1d8e`. The native Windows serialized
      `cargo check --locked -p soundcraft` passed against that source.
- [x] Push Soundcraft consumer commit `7e68f4ec0e3f9510d743604309bb3c92081f9db7`
      and Bun OS integration commit `e053c4e7b8bdfe286b4fd3337f8c8d467b1223e1`.
      The root module pin records the fork revision and retains the upstream
      baseline in `upstreamRevision`.
- [ ] Audit and migrate other consumers of the same UI capability in a
      separate batch; this pilot changes the Soundcraft consumer only.

## Development runtime and source doctor — 2026-10-14

- [x] Keep the installed Bun development-tool check distinct from target-specific
      runtime pins used by release and application artifact builders.
- [x] Report dirty pinned checkouts without treating concurrent owner changes as
      absent source; retain fatal results for missing or mismatched pins and
      incomplete package coverage.
- [x] Verify the doctor, root Bun-native quality gates, complete live source
      portal snapshot and Aphrody-owned domain/DNS parity. Code: `1e9df354c`.

## Product/server and offline sources — 2026-10-13

- [x] Root Cargo owns twenty-five flat pinned crate submodules, shared direct
      dependencies, one nightly and one target/build/install configuration.
      Locked offline `cargo check --workspace --all-features` passed for the
      previous 24-member snapshot. Full build, new-crate tests and Clippy remain pending; see
      `docs/NATIVE-QUALIFICATION.md` for the observed launcher interruption.
- [x] Add the canonical Bun Jev owner with its history, nullable token usage,
      shared direct dependencies and optional client/server features. Its
      locked offline all-feature check passes; protected Aphrody adapters
      remain pending consumer migration.
- [x] Commit the root Cargo vendor snapshot: 543 dependency source packages,
      568 full-graph identities including twenty-five product crates. Locked offline
      metadata passes. Preserve exact source bytes and license notices.
- [ ] Qualify an offline native build before enabling vendor replacement in
      the active Cargo configuration. Runtime/vendor migrations remain open.
- [x] Add automatic standalone binary verification with fifteen HTTP checks.
      The Windows staging candidate from `f964e89b` passes with runtime
      `4b8dee0bc69d2c290111001f2249e63e1dc95b70`.
- [ ] Replace the installed binary and activate the Infra product service.
      Automatic approval review rejected both actions; deployment stays false.
      See `docs/PRODUCT-SERVER.md` for distinct candidate/installed identities.
- [x] Expose the same server, crate inventory and vendor tools through Just.
- [x] Qualify HTTPS on the canonical `source.aphrody.app` forge portal.
- [ ] Complete all 239 source mirrors, including private and archived owners,
      with full ref/visibility checks and actual storage reservations. DBFR
      remains reserved for production; temporary storage is not mirror capacity.

## Constraints

The workspace integration does not by itself qualify a distribution image,
desktop binary, native app, production deployment, or locked runtime build.
Preserve active Bun checkout/processes and protected stores. Keep each imported
license and notice with its source. Do not force-push.

## CADCraft foundations and shared forge owner — 2026-10-14

- [x] Split and publish geometry, document and constraints histories as flat forge submodules; retain licenses and notices, reuse the existing color owner.
- [x] Inherit the root version 1.4.4 and shared dependency versions, preserving serde rc and JSON float-roundtrip features.
- [x] Redirect 14 CADCraft consumer edges to the four root foundations and retire their 49 original tracked files after native root compilation and source metadata qualification.
- [x] Qualify locked offline native checks for the three new crates and color, root Rust formatting and native Bun quality.
- [x] Refresh vendor qualification for 28 root members, 571 locked packages and 543 external sources; increase bounded prepare/verify deadlines to 180 seconds.
- [x] Deliver one shared Bun execution owner through Aphrody Infra and provision each of the three private forge repositories with verified workstation and runner access.
- [ ] Migrate the remaining 12 CADCraft source members and qualify their complete application build.
- [ ] Qualify the full root product build before activating vendor source replacement.

- [x] Re-run complete frozen setup after releasing the shared native build mutex: 71 Bun members, 28 Cargo members, no nested installation; final vendor verification passes against the indexed source pins.

- [x] Qualify the complete 28-member root Rust build offline with all features and 28 hashed final artifacts; vendor verification revalidates the receipt inside the native owner.

## Cross-OS/BIOS/firmware RE pipeline — 2026-10-16

- [x] Typed stage contract (acquire, identify, unpack, analyze, lift, decompile, rebuild, verify) in `crates/re/src/pipeline` with JSON Schemas in `crates/re/schema` and a TypeScript mirror in `packages/re/src/pipeline`; see `docs/re-pipeline.md`.
- [x] Stage-adapter registry: existing owners (steamcmd, nie-*, wii, bun-engine-nds, ghidra-decompiler, factory, emulators) are referenced by id or command and report `ready`, `registered` or `unavailable`; none are duplicated.
- [x] Built-in end-to-end path: PE/ELF x86 lift (goblin, iced-x86) to IR, C and Rust emission, clang and rustc rebuild, verification by compiling the emitted code.
- [x] `bun re pipeline <input> --target <os|bios|firmware>`, MCP tools and a loopback API over the `bunre-pipeline` binary.
- [ ] Qualify Ghidra headless and the external adapters on a host that has them; add lifters for ARM, MIPS and PowerPC through the registry.
