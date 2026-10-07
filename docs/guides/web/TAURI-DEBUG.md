<!-- SPDX-License-Identifier: Apache-2.0 -->

# Debugging and testing Tauri 3 apps with aphrody-web

Status 2026-10-05 (one desktop runtime, CEF: [plan](../../plans/tauri-cef/PLAN.md)). Survey 2026-10-01, comparison and fork pins:
[`docs/research/web/tauri-debugging-survey-2026-10-01.md`](../../research/web/tauri-debugging-survey-2026-10-01.md).
Registry of pins and patches: the `debuggers` block of
[`config/tauri-upstream.json`](../../../config/tauri-upstream.json).

## What was built, and what was not verified

| Piece                                   | Where                                                                                     | State                                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Pinned upstream forks                   | `.cache/upstream/mcp-server-tauri` (not in repo) (generated or machine-local artifact; presence depends on the build host) (checkout); tauri-plugin-webdriver and victauri are read live (`aphrody git upstream read <id> <path>`) | One checkout (Cargo path dependency); the others are catalogue entries ([UPSTREAMS.md](../../reference/infra/UPSTREAMS.md)). GitHub forks under `aphrody-code`; nothing pushed.                                          |
| Patch set over the hypothesi bridge     | `patches/tauri-plugin-mcp-bridge-0.13.0-tauri3.patch` (11 files), applied to `.cache/upstream/mcp-server-tauri/packages/tauri-plugin-mcp-bridge` (not in repo) (generated or machine-local artifact; presence depends on the build host) | Applies to the pristine pin and reproduces the working tree. **Not compiled or run** after patching.        |
| Feature-gated host plugin               | `crates/ui/tauri-wrap` (`aphrody_tauri_wrap::debug`, feature `debug-bridge`)              | **Not compiled.** Registered in `config/tauri-apps.json`; `bun run tauri:apps:check` passes.                                   |
| Bun client                              | `@aphrody/agent-browser/tauri` (`listTauriApps`, `TauriBridge`)                           | 6 tests pass against a fake bridge; the DOM snapshot script runs in the aphrody-web engine on a fixture page.                 |
| App wiring                              | `crates/ui/model-view` (not in repo) feature `debug-bridge`                                             | **Not compiled.** Window launch under X11 was seen with a build that predates the plugin (see below).                          |

Note (2026-10-04): the model-view Tauri app now lives in `aphrody-labs/nie-ui` (`apps/tauri/model-view` (not in repo), submodule `m3/packages/nie-ui` (not in repo)).

No Tauri window has been driven through the debug channel yet. `aphrody-model-view` (built before
this change, on the former wry runtime) opened under `GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1`: `xwininfo -root -tree`
listed `"aphrody model"` 400x400 and the process printed only the libEGL DRI3 warning. Nothing came
back through a debug channel, so the window is not "verified" in the sense of the verification rule.

## Which runtime can do what

| Route                                                      | How                                                                                                                   | Notes                                                                                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CDP (`tauri-runtime-cef`, the one desktop runtime)         | `RemoteDebugging::Port{..}` or `Pipe`; `aphrody-app` opens a loopback port only when `APHRODY_CEF_REMOTE_DEBUGGING_PORT` is set; attach `WebCdpPage` or Playwright `connectOverCDP` directly. | Full protocol (DOM, Accessibility, Network, Runtime). No plugin needed. The port has no authentication and every local process can reach it: an opt-in of the launcher, never a production default. |
| `aphrody_tauri_wrap::debug` bridge (debug builds)           | Loopback WebSocket with a per-process token; `@aphrody/agent-browser/tauri`.                                          | DOM, accessibility tree (role/name script), eval, console buffer, IPC trace. The screenshot is `Page.captureScreenshot` through `WebviewCefExt` (`crates/ui/tauri-plugin-mcp-bridge/src/screenshot/cef.rs`), on every platform. |

There is no WebDriver: `tauri-driver` only proxied `WebKitWebDriver` and `msedgedriver` and set
`TAURI_WEBVIEW_AUTOMATION`, which only the retired wry runtime read; it was removed with wry, tao and the GTK 3 stack
(decision 21). The WebKitGTK, WebView2 and WKWebView debugging routes of the 2026-10-01 survey no longer apply.

The bridge needs no capability or permission in the host app: scripts run through
`eval_with_callback` with a polled result slot, and IPC calls are traced in a page-side buffer
(`window.__MCP_IPC_BUFFER__`). IPC tracing wraps `window.__TAURI__.core.invoke` and, when writable,
`__TAURI_INTERNALS__.invoke`; the first needs `app.withGlobalTauri = true`.

## Enabling the bridge in an app

The bridge is the `debug` module of `aphrody-tauri-wrap` (it was the separate `aphrody-tauri-debug`
crate). An app that only wants the bridge turns the crate's default features off, so the bundle
server and its HTTP stack (axum, reqwest, rustls, tokio) are not compiled:

```toml
# Cargo.toml of the app
[features]
debug-bridge = ["aphrody-tauri-wrap/debug-bridge"]
[dependencies]
aphrody-tauri-wrap = { workspace = true, default-features = false }
```

```rust
tauri::Builder::default()
    .runtime(tauri_runtime_cef::Cef::default())
    .plugin(aphrody_tauri_wrap::debug::init())   // empty plugin unless the feature, a debug build and APHRODY_TAURI_DEBUG=1 are all present
```

A project generated by `@aphrody/web-to-tauri` already depends on `aphrody-tauri-wrap` and gets the
`debug-bridge` feature and the `debug::init()` call (CEF is the only engine).

Run (on WSLg):

```bash
cargo build -p aphrody-model-view --features debug-bridge
GDK_BACKEND=x11 APHRODY_TAURI_DEBUG=1 \
  target/debug/aphrody-model-view /path/to/model.glb
```

Release builds never ship the bridge: without the feature `debug::init()` returns an empty plugin
and the crate links no bridge code; with the feature but `debug_assertions` off it is empty as well.

Security of the patched bridge: loopback only, ephemeral port, random 64-hex per-process token
(query `?token=` or `Authorization: Bearer`), `Host` must be a loopback name, `Origin` must be
absent or loopback (upstream issue #36), constant-time token comparison. The URL and token are in
`~/.aphrody/web/tauri-debug/<exe>-<pid>.json` (mode 0600, directory 0700;
`$APHRODY_HOME/web/tauri-debug` when set). Rust unit tests for the handshake rules live in
`websocket.rs` of the patched plugin (`security_tests`); they have not been run.

## Driving it from Bun

```ts
import { TauriBridge } from "@aphrody/agent-browser/tauri";

const { app, bridge } = await TauriBridge.connectToRunning("aphrody-model-view");
console.log(await bridge.listWindows());            // label, title, url, focused, visible
const snapshot = await bridge.domSnapshot();        // title, url, text, role/name tree with data-testid
await bridge.startIpcTrace();
await bridge.clickSelector("#reset");
console.log(await bridge.ipcEvents());              // command, args, result, error, duration_ms
console.log((await bridge.screenshot()).imageWidth);
bridge.close();
```

`waitFor({ selector, text })`, `fillSelector`, `consoleLogs`, `backendState`, `emit` and
`windowInfo` are also available. For CEF apps use the CDP client instead:
`WebCdpPage.connect("ws://127.0.0.1:4000/devtools/browser")` or `@aphrody/web-test`.

## Still open

- Compile and run `aphrody-tauri-wrap` with `--features debug-bridge`, then capture real output
  from a live window (this is the missing proof).
- The `aphrody_tauri_*` tools of `aphrody-mcp` still forward to the per-user kernel only; a backend that reads the discovery
  files would give MCP clients the bridge tools.
- The CEF screenshot backend (`Page.captureScreenshot`) is compiled on Linux only; mobile targets are dropped from the
  patched crate (`crate-type = ["rlib"]`) and the per-platform webview capture code was deleted with the wry runtime.
