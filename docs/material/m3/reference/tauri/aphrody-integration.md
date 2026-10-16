<!-- SPDX-License-Identifier: Apache-2.0 -->

# Tauri 3 integration

How `crates/ui/app` hosts the UI and reaches the rest of Aphrody. Protocol and target
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

- `packages/m3` provides the M3 component framework (`m3 build --tauri`) into
  `crates/ui/app/ui-dist` (`index.html`, `app.js`, `app.css`, `fonts/`); names are not hashed
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
