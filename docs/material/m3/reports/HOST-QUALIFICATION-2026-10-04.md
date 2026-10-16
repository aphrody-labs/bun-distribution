<!-- SPDX-License-Identifier: Apache-2.0 -->
# M3 host qualification — 2026-10-04

This receipt qualifies the existing local showcase web artifact and installed Bun
bindings. No native host was built, installed or started by this audit. The
[host plan](../plans/design/M3-MULTI-HOST-PLAN.md) and
[framework guide](../guides/FRAMEWORK.md) retain their separate delivery bars.
Checks ran through Aphrody's native MCP on Linux with Bun 1.4.2.

## Verified artifact and behavior

The existing `apps/m3-showcase/dist/m3-bun.manifest.json` identifies
`m3-showcase` 3.3.3, Bun 1.4.2, full minification and build
`ad124607012eb510`. All **629** declared files matched their recorded byte size
and SHA-256; the directory holds 630 files including the manifest, totaling
16,727,616 bytes. The manifest SHA-256 is
`044f9b04f9274ed47b512831094ae16f4486239250dc12c7e9600aa4f79af2c3`;
`index.html` hashes to
`7550d33ca008819a9bd9f16977f4f18bdae193c8fd81309c3eb79524d2cb83ea`.
These hashes identify existing output; they do not establish a clean committed
source revision or a packaged native installation.

The existing production fixture at `http://127.0.0.1:3312` answers
`/healthz` as `m3-showcase` 3.3.3. The declared Chromium contract passed
**28/28** checks with Chromium 153.0.8010.12. It checked all 15 destinations,
native links, skip-link focus, persistent light/dark and layout preferences,
TV keyboard navigation, forms, local explorer/reader actions, generated design
output, and the labelled AG-UI fixture's Stop behavior. External requests were
blocked throughout; no console errors, failed HTTP responses or external
requests occurred. The owned JSON receipt is
`.coord/runs/m3-prod/desktop-r3-browser-contract.json` in the enclosing Aphrody
checkout. Browser context and browser cleanup ran in the owner's `finally`
block. The existing server was preserved.

The allowlisted production font route returned a real WOFF2 signature:
`/api/m3/fonts/GoogleSansCode-latin.woff2`, 92,852 bytes beginning `wOF2`.
The showcase ships its Google Sans Flex font locally. The scoped asset gate
for `apps/m3-showcase` and `packages/app-ui` returned zero findings. This
establishes loading without external network assets while the local API is
available; packaged offline startup and installed-host shutdown remain open.

## Scoped checks and a test-environment defect

| Gate | Result | Scope |
| --- | --- | --- |
| `bun run native status --json` | Pass | Installed `@aphrody/bun` 3.3.0 library loads through Yolo's SDK loader and exports `bun_rs_version`. |
| `bun test scripts/native.test.ts` | 9 pass | Library resolution, rejected invalid candidates, linkage and actual export availability. |
| `bun test ./packages/m3/test/native.test.ts` | 3 pass, no skips | Actual `m3Css` FFI generates a dark scheme and a theme stylesheet in a temporary Bun build. |
| `bun scripts/check-assets.ts --json apps/m3-showcase packages/app-ui` | Zero errors | Source references and declared assets. |
| `bun run test` in `apps/m3-showcase` | 19 pass, 1 fail | Font body assertion under the package's global DOM preload. |
| `bun run test:dom` in `apps/m3-showcase` | 3 pass | D-pad visibility, modal focus and disposal. |
| Existing browser-contract script against port 3312 | 28 pass | Real Chromium interactions with external requests blocked. |

The declared showcase test fails at `test/runtime-api.test.ts:98): the body
begins `[obj` rather than `wOF2`. Its `bunfig.toml` globally preloads
happy-dom, which replaces `Response`; that implementation stringifies
`Bun.file(...)`. The production endpoint serves valid font bytes. The package
already runs unit tests followed by a separate DOM command with an explicit
preload. Removing the global `[test]` preload is the bounded proposed fix.
The file belongs to an active concurrent source batch and was preserved.

A first test invocation from the framework root matched the `test-dom`
directory without loading its DOM environment; its three environment errors
are superseded only for that invocation by the correctly scoped DOM gate.
The declared package font failure remains open until its owner applies and
qualifies the fix.

Native Nushell HTTP failed even on loopback with
`tls crypto provider not found`; bounded curl requests supplied HTTP evidence.
The installed Aphrody browser snapshot refused the private loopback address
under its network policy. Its restriction was preserved. The Chromium result
does not establish Obscura engine parity.

## Installed-host limits

The inspected local `target/debug` and `target/release` paths contain neither
`aphrody-m3-showcase` nor `aphrody-app`. No showcase sidecar directory,
native bundle, generated Android/iOS project, installed M3 executable, desktop
entry or Debian package was found in the scoped locations. Exact-title native
window enumeration returned zero M3 showcase windows. An existing
`aphrody-app-handler.desktop` points to the absent
`target/debug/aphrody-app`; that registration is not an installed application.

Canonical `packages/app-ui` exists and is excluded from the M3 root workspace.
Its parent `crates/ui/app/ui-dist` contains previously built HTML, JavaScript,
CSS and fonts. This source and output inventory supplies no current product
startup, protected Chat/Files/Models behavior, accessibility or release proof.
No product conversation, persistent store or application screen was inspected.

The existing showcase owner plans select the parent
`crates/ui/m3-showcase`, pinned Tauri CLI 3.0.0-alpha.4, Wry and the serialized
Cargo runner. Desktop native build requests route through Workspace's factory.
Its wrap configuration starts a desktop Bun sidecar; the Rust guard kills and
waits on its direct child, but installed process-tree cleanup was not exercised.
The inspected factory receipt prepared VPS sources at parent revision
`d06d00738a8f26857d8c057609a182a1e81e9994`; the inspected FFI build log was
empty. Source preparation supplies no native artifact evidence.

Android diagnostics report missing SDK/NDK and the canonical mobile API adapter;
`adb` is unavailable here. iOS requires macOS/Xcode and that API adapter.
Both mobile commands reject treating a desktop Bun sidecar as a mobile host.
No mobile installation or lifecycle qualification is inferred from the
retained mobile entry point or responsive showcase layouts.

Remaining host gates require the owning integrator: factory build and strict
Rust checks, a revision-pinned bundle and install, actual offline startup,
permissions, cancellation and process cleanup, and platform interaction and
accessibility checks. No Cargo, dependency installation, deployment or native
activation ran in this audit.
