<!-- SPDX-License-Identifier: Apache-2.0 -->

# Tauri v2 integration

> **Status: historical (Tauri 2 context).** This page describes the Tauri 2 desktop host. The workspace now pins Tauri 3 alpha (`tauri =3.0.0-alpha.3`, default runtime `tauri-runtime-wry`, `tauri-runtime-cef` only for Koharu): see [the Tauri 3 upstream line](../../../operations/ui/tauri-upstream.md) and [`config/tauri-apps.json`](../../../../config/tauri-apps.json). Keep the content below as compatibility context until the desktop host is requalified under Tauri 3 (Verify). Paths such as `crates/aphrody-app` and `packages/app-ui` predate the layout migration: the host is `crates/ui/app`, and `@aphrody/app-ui` is not yet part of this workspace.

How `crates/aphrody-app` hosts the UI and reaches the rest of Aphrody. Protocol and target
surfaces: [`../GUI.md`](../GUI.md); desktop integration and pitfalls:
[`../DESKTOP-INTEGRATION.md`](../DESKTOP-INTEGRATION.md); plugin policy: [`plugins.md`](./plugins.md).

## Boundaries

- The desktop never links `aphrody-ai`. The agent runs out of process (`aphrody app-server`,
  stdio JSON-RPC) behind `src/broker.rs`; other AI features go through the `aphrody` CLI sidecar.
- The host registers the kernel's browser service, window inspection, systemd, capture, Drive and
  infrastructure subsystems for their owning clients. These services do not add browser, shell,
  PTY or terminal views to the public WebView. Drive uses the separate `sd-daemon` process.
- Bun is the frontend toolchain only (install, bundle, dev server), never the app backend.

## Frontend build

- `packages/app-ui` is the only frontend. `@aphrody/m3` builds it (`m3 build --tauri`) into
  `crates/aphrody-app/ui-dist` (`index.html`, `app.js`, `app.css`, `fonts/`); names are not hashed
  and scripts stay external modules for the `script-src 'self'` CSP.
- `tauri.conf.json`: `frontendDist = "ui-dist"`, `devUrl = http://localhost:1421`,
  `beforeDevCommand` / `beforeBuildCommand` run `bun run --filter @aphrody/app-ui dev|build`.
  `app.security.devCsp` allows the dev server's HMR socket; the release `csp` is strict.
- `ui-dist/` must exist before `tauri::generate_context!` compiles.
- Never force the Bun runtime on the orchestrating command (`bun --bun run tauri ...`), and make
  sure `bun` is on `PATH` for the shell Tauri spawns (`beforeBuildCommand` fails with exit 127
  otherwise).

## Runtime layout

`aphrody_runtime_layout` is the only resolver of desktop data directories: `profiles/`,
`assets/`, `binaries/` and `sqlite/` under Tauri's `app_data_dir`. `resource_dir` is read-only.
Nothing creates `.aphrody`, repository-local databases or ad-hoc sidecar directories, and existing
databases are migrated only explicitly, with checksums, never at startup.

## Webviews

- Linux: WebKitGTK 4.1 (GTK3), which lags Chromium on some `:has()` / container-query edges;
  verify components there, not only on WebView2.
- Windows: WebView2. macOS is best effort; mobile is out of scope.
- The GTK/WebKitGTK C libraries are LGPL but dynamically linked from the distro; the Rust
  bindings are MIT, so the Apache-2.0 binary stays clean.
