<!-- SPDX-License-Identifier: Apache-2.0 -->

# Debugging and testing Tauri 3 apps with aphrody-web

Status 2026-10-01. Survey, comparison and fork pins:
[`docs/research/web/tauri-debugging-survey-2026-10-01.md`](../../research/web/tauri-debugging-survey-2026-10-01.md).
Registry of pins and patches: the `debuggers` block of
[`config/tauri-upstream.json`](../../../config/tauri-upstream.json).

## What was built, and what was not verified

| Piece                                   | Where                                                                                     | State                                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Pinned upstream forks                   | `.cache/upstream/mcp-server-tauri` (checkout); tauri-driver, tauri-plugin-webdriver and victauri are read live (`aphrody git upstream read <id> <path>`) | One checkout (Cargo path dependency); the others are catalogue entries ([UPSTREAMS.md](../../reference/infra/UPSTREAMS.md)). GitHub forks under `aphrody-code`; nothing pushed.                                          |
| Patch set over the hypothesi bridge     | `patches/tauri-plugin-mcp-bridge-0.13.0-tauri3.patch` (11 files), applied to `.cache/upstream/mcp-server-tauri/packages/tauri-plugin-mcp-bridge` | Applies to the pristine pin and reproduces the working tree. **Not compiled or run** after patching.        |
| Feature-gated host plugin               | `crates/ui/tauri-wrap` (`aphrody_tauri_wrap::debug`, feature `debug-bridge`)              | **Not compiled.** Registered in `config/tauri-apps.json`; `bun run tauri:apps:check` passes.                                   |
| Bun client                              | `@aphrody/agent-browser/tauri` (`listTauriApps`, `TauriBridge`)                           | 6 tests pass against a fake bridge; the DOM snapshot script runs in the aphrody-web engine on a fixture page.                 |
| App wiring                              | `crates/ui/model-view` (not in repo) feature `debug-bridge`                                             | **Not compiled.** Window launch under X11 was seen with a build that predates the plugin (see below).                          |

Note (2026-10-04): the model-view Tauri app now lives in `aphrody-labs/nie-ui` (`apps/tauri/model-view`, submodule `design/aphrody-m3/packages/nie-ui`).

No Tauri window has been driven through the debug channel yet. `aphrody-model-view` (built before
this change) opened under `GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1`: `xwininfo -root -tree`
listed `"aphrody model"` 400x400 and the process printed only the libEGL DRI3 warning. Nothing came
back through a debug channel, so the window is not "verified" in the sense of the verification rule.

## Which runtime can do what

| Runtime (Tauri 3)          | Route                                                                                                                  | Notes                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CEF (`tauri-runtime-cef`)  | CDP: `RemoteDebugging::Port{..}` (Koharu enables port 4000 in debug builds) or `Pipe`; attach `WebCdpPage` directly. | Full protocol (DOM, Accessibility, Network, Runtime). `tauri-driver` cannot drive CEF. No plugin needed.                                                                |
| wry on Linux (WebKitGTK)   | `aphrody_tauri_wrap::debug` bridge; or `tauri-driver` with `WebKitWebDriver` (not installed here).                           | No CDP. DOM, accessibility tree (role/name script), eval, console buffer, IPC trace and native snapshot screenshot through the bridge.                                  |
| wry on Windows (WebView2)  | Bridge (screenshot path patched blind), or CDP via `--remote-debugging-port` / `with_additional_browser_args`.        | WebView2 Runtime 150 ignores the env var and policy on elevated hosts (wry#1782): pass the argument through the API. Not reproduced here.                               |
| wry on macOS (WKWebView)   | Bridge (screenshot path patched blind); Safari Web Inspector.                                                          | No CDP, no Apple WebDriver for embedded WKWebView. Not compiled here.                                                                                                  |

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
    .runtime(tauri_runtime_wry::Wry::default())
    .plugin(aphrody_tauri_wrap::debug::init())   // empty plugin unless the feature, a debug build and APHRODY_TAURI_DEBUG=1 are all present
```

A project generated by `@aphrody/web-to-tauri` already depends on `aphrody-tauri-wrap` and gets the
`debug-bridge` feature and the `debug::init()` call (wry engine only).

Run (on WSLg):

```bash
cargo build -p aphrody-model-view --features debug-bridge
GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 APHRODY_TAURI_DEBUG=1 \
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
- A CDP facade over the bridge so `AgentBrowser` and `@aphrody/web-test` can attach to a WebKitGTK
  window unchanged; the bridge exposes JavaScript evaluation, so a shim for `Runtime.evaluate`,
  `Page.captureScreenshot` and DOM queries is feasible but was not written.
- `aphrody-tauri-mcp` still forwards to the per-user kernel only; a backend that reads the discovery
  files would give MCP clients the bridge tools.
- Windows and macOS code paths of the patch are unverified; mobile targets are dropped from the
  patched crate (`crate-type = ["rlib"]`).
- Evaluate `tauri-plugin-webdriver` for macOS and `tauri-driver` for E2E on Linux once
  `webkit2gtk-driver` is installed.
