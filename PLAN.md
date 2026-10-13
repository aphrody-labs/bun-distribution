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
- [ ] Finish source-consumer lock migration to the published Material revision.
- [ ] Complete themed component coverage and cross-platform desktop qualification.
- [ ] Retire the old source paths after publishing and migrating consumer pins.
- [ ] Route web dynamic-color APIs through the qualified native binding.

## Consolidation gates

The libm3 std facade compiled for Windows MSVC, as did its no_std configuration
and COSMIC feature. Native Bun check, lint and fmt passed for the browser WASM
loader with ESNext/DOM libraries. The transferred component owner's native,
renderer-free and WASM checks passed before default Rustfmt normalization;
the final normalized source checks are recorded in the consolidation receipt.
No tests or GUI display qualification were run.

Consumer migration remains open. An attempted Aphrody root migration timed
out while acquiring unrelated web submodules; its unqualified manifest changes
were reverted. Original consumer sources remain until a new root lock graph
and native consumer build qualify their retirement. The token crate was
packaged locally; no crates.io publication was performed.
