# Integration plan

## Delivered in this batch

- [x] Merge Bun OS and Bun Libraries histories into this checkout on branch `os`.
- [x] Preserve the 16 library repositories and Bun runtime as pinned submodules.
- [x] Consolidate OS, library, video, artifacts, and desktop JS packages under
      one root Bun workspace and one `bun.lock`.
- [x] Provide one `bun run setup` entry point for recursive submodule setup and
      frozen Bun installation.
- [x] Consolidate formatting configuration and root quality commands.
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

### Cargo source-owner inventory — 2026-10-14

- [x] Rebuild the manifest inventory from the 41 declared pinned source owners at
      `31d1dbddf81017c2899eec24e24639c727153cd4`: 857 Cargo packages, of which
      556 are declared members across the owner workspaces, 25 have flat root
      Git owners, and 531 remain in nested owners. All source checkouts were
      available for inspection.
- [ ] Resolve the 12 package-name collisions before flattening nested members;
      collisions include already extracted Craft crates and repeated workspace
      utility names such as `xtask` and `app`.
- [ ] Migrate remaining package owners in batches: pin each source crate directly
      under `crates/<package-name>`, preserve license/history, redirect consumers
      to the root workspace dependency, then update Cargo metadata/lock and run
      the serialized native target check for that batch.
- [ ] Use `.local/crate-inventory.json` as the refreshed local inventory receipt;
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
