# Qualification

Native Windows, 2026-10-13. Bun 1.4.4 fork revision
`2ae8fc65fba1d05c423a2433b1195835109942b6`; SDK commit
`c209b95eb0dcc964745f4684f127abb83cbe2697`.

Passed:

- Fork creation and Git submodule initialization: 16 library sources plus SDK.
- Runtime version, revision, provenance and external Bun resolution.
- TypeScript native compiler, oxlint and oxfmt for authored workspace/desktop code.
- Bun frontend/backend build: 16 capabilities in the Aphrody shell.
- Imported React frontend build: 33 artifacts using Bun, PostCSS and existing assets.
- Frozen Bun installs and source diff checks.
- Offline native Cargo metadata and lockfile generation: 526 packages.
- Rust source formatting and native wrapper output forwarding.

Not qualified: Rust engine compilation, headless CLI execution, native CEF
windows, installers, provider access, signing and CI execution. No tests were
added or run. Existing upstream launcher tests still expect Vite/HMR; their
test configurations retain required dependencies.

The source migration covers JavaScript build and development tooling. Rust
engines remain native libraries. The imported historical shell remains Tauri v2;
the Aphrody shell uses our pinned Bun Tauri v3 fork.
