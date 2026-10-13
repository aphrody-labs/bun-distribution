# Material integration plan

- [x] Transfer the existing native token engine with preserved API and provenance.
- [x] Make libm3 consume that owner for colors, typography, shapes and breakpoints.
- [x] Align the portable COSMIC source pin and compile its Windows native adapter.
- [x] Compile no_std/std and execute the shared dynamic WASM ABI 2.
- [x] Publish the first native owner correction on os (ce47e503).
- [x] Transfer shared native components, accessibility, forms, focus and layout.
- [x] Expose those component models from libm3's std facade.
- [x] Resolve one token owner across direct and transitive registry dependencies.
- [x] Disable unrelated Cargo submodule acquisition and document explicit web bootstrap.
- [x] Consolidate Windows, GNOME, COSMIC and Chromium theme generators under
      the shared `aphrody-m3-os-themes` package owner; use one Rust theme export
      adapter from the M3 token workspace.
- [x] Migrate the Aphrody Rust consumers to the pinned Material revision; locked metadata and scoped native Windows consumer checks pass.
- [ ] Complete themed component coverage and cross-platform desktop qualification.
- [ ] Remove the remaining Aphrody source directory. Its crate is excluded from the Aphrody Cargo workspace and all checked consumers use this owner, but the duplicate directory remains physically present.
- [ ] Route web dynamic-color APIs through the qualified native binding.

## Consolidation gates

The libm3 std facade compiled for Windows MSVC, as did its no_std configuration
and COSMIC feature. Native Bun check, lint and fmt passed for the browser WASM
loader with ESNext/DOM libraries. The transferred component owner's native,
renderer-free and WASM checks passed before default Rustfmt normalization;
the final normalized source checks are recorded in the consolidation receipt.
No tests or GUI display qualification were run.

On 2026-10-13, the Aphrody root dependency and lock graph were pinned to this
Material revision. Native Windows `cargo metadata --locked` and `cargo check
--locked` passed for `aphrody-app`, `aphrody-bun`, `aphrody-identity`,
`aphrody-m3`, `aphrody-m3-reproduce` and `aphrody-svg`. Tests were not run.
The old Aphrody directory is excluded from workspace membership, but remains
on disk because its requested recursive removal was rejected by the host tool
policy. No crates.io publication was performed.
