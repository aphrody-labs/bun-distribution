# Qualification

Native Windows, 2026-10-13. Bun 1.4.4 fork revision
`2ae8fc65fba1d05c423a2433b1195835109942b6`; SDK commit
`939c835adf6479bc1014da3843cda4ae29851dbd`.

Passed:

- Fork creation and Git submodule initialization: 16 library sources plus SDK.
- Runtime version, revision, provenance and external Bun resolution.
- Native Bun check, lint and fmt for authored workspace, video and desktop code.
- Bun frontend/backend build: 16 capabilities in the Aphrody shell.
- Imported React frontend build: 33 artifacts using Bun, PostCSS and existing assets.
- Frozen Bun installs and source diff checks.
- Offline native Cargo metadata and lockfile generation: 526 packages.
- Rust source formatting and native wrapper output forwarding.
- Native video CLI release build: locked dependencies, one Cargo job, Windows MSVC.
- Video doctor, command discovery and description through the bounded adapter.
- Aggressive n2b across all 16 library inputs and the SDK, with reviewed rewrites.
- Imported frontend native Bun check: 1,479 files; strict lint and frozen install.
- Internal Rust n2b core, CLI and addon Cargo check on Windows; see [migration](migration.md).

Not qualified: other Rust engines, media decoding, rendering, export accuracy,
native Bun.Video, CEF windows, installers, provider access, signing and CI
execution. No tests were added or run. Upstream launcher specifications retain
their original frontend expectations.

The source migration covers JavaScript build and development tooling. Rust
engines remain native libraries. The imported historical shell remains Tauri v2;
the Aphrody shell uses our pinned Bun Tauri v3 fork.
