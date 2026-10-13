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
- Shared process, hash, provenance, discovery and app identity consolidation.
- Source coverage: 423 Cargo packages, 11,528 Rust files, 1,659 TypeScript files;
  every declared workspace member and explicit target is present.
- App factory and standalone artifact source: native check on 59 authored files.
- Cloudflare MCP created 14 app records and Git/deployment records.
- Shared R2 assets: 17 entries, 16 unique objects, 41,682,420 bytes; immutable
  manifest SHA-256 and custom-domain HTTPS response verified.
- Existing bucket CORS retains its origins and accepts the 14 app domains.

Aphrody Video is built for Linux x64: 196,211,384 bytes. Its embedded native
engine version, payload integrity, startup from a source-free working directory
and 701 command descriptions are qualified. The artifact digest and target pins
are recorded in `infra/releases/video-linux-x64.json`.

The control plane has authenticated Git/Komodo administration, connected
Periphery, an online runner and HTTPS on both domains; see
[control plane](control-plane.md). Gitea run 5 passed its seven source checks;
all 18 Git mirrors are complete. App activation retains its own qualification.
The Windows app compile was cancelled at the disk floor
before producing an executable.

Generation reuses the existing Rust router. Its Linux x64 native check and release
build passed; the 19,181,336-byte engine exposes 14 methods. Version, doctor,
model discovery and an offline image draft passed without provider credentials.
Paid generation and other targets remain unqualified.

The Linux Generation standalone is 173,388,472 bytes. Compiled doctor, canonical
artifact verification, native version/discovery and offline draft passed from a
source-free working directory. Its receipt is
`infra/releases/generation-linux-x64.json`.

Canonical Infra app activation is published as Rust source. Formatting passes;
its VPS Cargo gate stops before compilation because the sibling Bun checkout
lacks `packages/web/rust/Cargo.toml`. The installed CLI is unchanged and app
ingress remains staged. The source's readiness probe is not live-qualified.

Not qualified: remaining Rust engines, media decoding, rendering, export accuracy,
native Bun.Video, CEF windows, installers, provider access and signing.
No tests were added or run. Upstream launcher specifications retain
their original frontend expectations.

The source migration covers JavaScript build and development tooling. Rust
engines remain native libraries. The imported historical shell remains Tauri v2;
the Aphrody shell uses our pinned Bun Tauri v3 fork.
