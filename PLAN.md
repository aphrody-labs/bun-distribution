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

## Integrated Craft fonts and shared quality — 2026-10-13

- [x] Integrate `craft-fonts` and its licensed assets into the Bun OS Cargo workspace; preserve the source repository and publish its `os` integration commit `f1bfd5fd75f24619cad085230c7290f17ee7821e`.
- [x] Route Cargo metadata/check through the bounded workspace process owner. Locked metadata resolves `craft-fonts` and `craft-fonts-tests`; `cargo check --locked` passes on native Windows.
- [x] Route `cargo fmt --all -- --check` through the same serialized native owner; root Rust formatting passes.
- [x] Align Bun OS quality script names with Bun Libraries: `typecheck`, `lint`, and `format:check`. Native `bun run check` passes on 91 files, lint, and format.
- [x] Document source ownership, asset provenance, license boundaries, and the optional font embedding contract.
- [ ] Keep Rust tests and the new font CI job out of this batch; tests were not requested or run.
## Still required for full consolidation

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

## Constraints

The workspace integration does not by itself qualify a distribution image,
desktop binary, native app, production deployment, or locked runtime build.
Preserve active Bun checkout/processes and protected stores. Keep each imported
license and notice with its source. Do not force-push.
