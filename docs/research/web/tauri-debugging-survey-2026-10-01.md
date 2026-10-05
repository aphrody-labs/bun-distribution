<!-- docs-links: external-paths — backtick paths in this document name files of the tauri-apps upstream repositories, not of this checkout. -->
# Tauri debugging, MCP and browser-control tools: survey and fork decision

Survey date: 2026-10-01. Scope: what `aphrody-web` can use to debug and test
Tauri apps (this repository's Tauri line is `3.0.0-alpha.3`, wry runtime by
default, CEF for koharu; see [`config/tauri-upstream.json`](../../../config/tauri-upstream.json)).

All numbers below come from `gh api`, `gh search`, the crates.io API and the npm
registry on 2026-10-01, or from reading the source of the pinned trees. Nothing
was run against a live Tauri window: this host is Linux/WSL, has no Windows or
macOS webview, and has no `WebKitWebDriver` binary (see "What was not verified").

## Decision in five lines

1. Tauri 3 readiness is rare. Of everything surveyed, only four things have shipped Tauri 3 alphas:
   `tauri-driver` 3.0.0-alpha.1 (official), `tauri-plugin-automation`
   3.0.0-alpha.2 and `tauri-plugin-devtools` 3.0.0-alpha.0 (both CrabNebula), and
   the CEF runtime's own DevTools hooks (`tauri-runtime-cef` 3.0.0-alpha.4).
   Every third-party MCP, Playwright and WebDriver plugin found is Tauri 2 only.
2. **Primary debugger**: the webview's own protocol where it exists (CDP on CEF
   and WebView2, no plugin needed), plus the official `tauri-driver` W3C
   WebDriver for wry apps on Linux and Windows. Fork pinned: `tauri-apps/tauri`
   (crate `crates/tauri-driver`, branch `v3`).
3. **MCP bridge**: `hypothesi/mcp-server-tauri` (MIT, 312 stars, most complete
   tool surface, already the naming reference for `aphrody-tauri-mcp`). It is
   Tauri 2 only and unauthenticated by default, so it is a patch base, not a
   drop-in. Fork pinned.
4. **Secondary**: `Choochmeque/tauri-plugin-webdriver` (in-process W3C WebDriver,
   the way to run WebDriver clients on macOS) and `4DA-Systems/Victauri`
   (Apache-2.0, Rust, embedded rmcp server with the strongest hardening; young).
   Both pinned and forked.
5. Not forked: `crabnebula-dev/devtools` (mixed MIT/Apache and PolyForm
   Noncommercial licensing), `tauri-plugin-automation` (no public source repo,
   needs a proprietary prebuilt library), `P3GLEG/tauri-plugin-mcp` (no
   license), `tauri-remote-ui` (AGPL-3.0).

## Method

- Discovery: `gh search repos` for about 30 queries ("tauri mcp", "tauri-plugin-mcp",
  "mcp-server-tauri", "tauri webdriver", "tauri playwright", "tauri devtools",
  "tauri automation plugin", "tauri cdp", "tauri-specta", and variants), plus
  `gh repo list tauri-apps` and `gh repo list crabnebula-dev`.
- Release facts: `curl https://crates.io/api/v1/crates/<name>` with a
  User-Agent, `curl https://registry.npmjs.org/<pkg>`, `gh api repos/<r>/releases`.
- Tauri version support: the `tauri` dependency in each `Cargo.toml` (default
  branch and every branch), crates.io versions, and `gh search issues` for
  "tauri 3", "tauri v3", "3.0.0-alpha", "CEF" in each repo.
- Source read: crates.io tarballs of `tauri-driver` 3.0.0-alpha.1,
  `tauri-plugin-automation` 3.0.0-alpha.2, `tauri-plugin-devtools` 3.0.0-alpha.0,
  `tauri-plugin-mcp-bridge` 0.13.0; `tauri` 3.0.0-alpha.3, `tauri-runtime-wry`
  3.0.0-alpha.3, `wry` 0.57.0, `tauri-runtime-cef` 3.0.0-alpha.4 from the local
  cargo registry; and the four pinned trees under `upstream/`.
- Runtime claims: crate source and official docs; `strings` on the installed
  `libwebkit2gtk-4.1.so.0.21.10` (WebKitGTK 2.52.6).

## Comparison table

"Tauri 2/3" is what the dependency requirement or published crate says, not a
claim that it was run. Stars are repository stars. "Last commit" is the newest
commit on the branch named; where the branch was not checked it is the push date.

| Candidate | Stars | Last commit | License (SPDX) | Latest | Tauri 2 / 3 | Capabilities | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `tauri-driver` (`tauri-apps/tauri`, `crates/tauri-driver`) | 111510 (repo) | 2026-09-30 (`v3`) | Apache-2.0 OR MIT | crate 3.0.0-alpha.1 (2026-09-26); 2.1.0 per its CHANGELOG | yes / yes (alpha, README "pre-alpha") | W3C WebDriver proxy to WebKitWebDriver (Linux) and msedgedriver (Windows): find, click, type, executeScript, screenshot, computed role/label, cookies. No console/network. No macOS. wry runtime only | Primary (E2E layer), forked + pinned |
| `tauri-plugin-automation` (CrabNebula, source repo not public) | n/a | crate 2026-09-21 | Apache-2.0 OR MIT (crate) | 3.0.0-alpha.2 (0.2.0 for Tauri 2) | yes / yes (wry and CEF) | In-app half of CrabNebula's WebDriver: dlopens a prebuilt library from `AUTOMATION_LIBRARY_PATH`; messages EvalScript, window handle/rect/min/max/fullscreen/close | Not forkable, proprietary backend; watch only |
| `crabnebula-dev/devtools` (`tauri-plugin-devtools`) | 427 | 2026-09-29 | crates MIT OR Apache-2.0; web client PolyForm-Noncommercial-1.0.0 (GitHub: NOASSERTION) | crate 3.0.0-alpha.0; 2.2.2 stable | yes / yes (`crates/v3`) | gRPC (tonic) services: tracing spans/events/logs, raw Tauri config, metrics, versions, app metadata, and a source listing that reads files from the working directory or app assets (`server.rs`); web UI. No DOM, no eval, no screenshot | Not forked (license); use the crate for tracing only |
| `hypothesi/mcp-server-tauri` + `tauri-plugin-mcp-bridge` | 312 | 2026-08-28 | MIT | v0.13.0 (2026-08-28); crate 315719 downloads | yes / **no** (`tauri = "2"`) | DOM snapshot with ARIA roles/names, find/interact/wait/keyboard, JS eval, native screenshot, console buffer, IPC monitor, backend/window state, window resize, script injection, element picker. No network log, no CDP | MCP bridge, forked + pinned, patch base |
| `Choochmeque/tauri-plugin-webdriver` | 38 | 2026-09-23 | MIT | crate 0.2.3 (2026-09-01) | yes (2.10.0) / no | In-process W3C WebDriver (axum, 127.0.0.1:4445), 47 endpoints, macOS/Windows/Linux/Android/iOS native APIs, no external driver, no CDP | Secondary, forked + pinned |
| `Choochmeque/tauri-webdriver` (CLI) | 11 | 2026-09-03 | MIT | crate 0.2.0 | yes / no | CLI companion of the plugin | Reference only |
| `4DA-Systems/Victauri` | 5 | 2026-09-30 | Apache-2.0 | v0.9.0 (2026-09-30) | yes / no | Embedded rmcp+axum MCP server (35 tools): DOM, click/type, IPC log and invoke, backend state, SQLite query, screenshot, a11y audit, recording; token auth on by default, loopback only, whole server under `cfg(debug_assertions)` | Secondary (design reference), forked + pinned |
| `dickwu/tauri-connector` | 3 | 2026-09-13 | MIT | v0.16.0 | yes / no | WS bridge plus embedded MCP, native screenshots, workflows, bounded IPC capture | Not forked (tiny, young) |
| `srsholmes/tauri-playwright` | 40 | 2026-06-20 | MIT | crate 0.4.1 | yes / no | Playwright API over a socket bridge (`tauri` mode), headless Chromium with mocked IPC (`browser` mode), WebView2 CDP (`cdp` mode) | Not forked; idea reference for the Playwright-compatible runner |
| `webdriverio/desktop-mobile` (`@wdio/tauri-service`, `tauri-plugin-wdio*`) | 17 | 2026-09-23 | MIT; crates MIT OR Apache-2.0 | 1.4.0 (2026-09-06) | yes (`tauri-plugin = "2.0"`) / no | WDIO service with `embedded`, `external` (tauri-driver) and `crabnebula` providers on all three desktop OSes | Not forked; useful runner |
| `danielraffel/tauri-webdriver` | 30 | 2026-02-17 | Apache-2.0 (README: MIT OR Apache-2.0) | crates 0.x | yes / no | macOS WebDriver plugin + `tauri-wd` CLI; stale since February | Not forked |
| `Radek44/mcp-tauri-automation` | 7 | 2026-09-12 | MIT | 2.0.0-rc.1 | via wdio embedded driver / no | stdio MCP over an embedded WebDriver or `tauri-driver`; macOS smoke only | Not forked |
| `johunsang/tauri-dev-screen-cli` | 30 | 2026-05-16 | MIT | n/a | via hypothesi bridge / no | Node CLI client of the hypothesi WebSocket (ports 9223-9322) | Not forked |
| `P3GLEG/tauri-plugin-mcp` | 109 | 2026-07-17 | **none** | v0.3.1 | yes (2.11) / no | Screenshot, DOM, input; open issue "Linux: MCP server hijacks mouse cursor" | Skipped: no license |
| `DraviaVemal/tauri-remote-ui` | 33 | pushed 2026-07-05 | AGPL-3.0-only | crate 1.1.1 | yes / no | Remote UI in a browser | Skipped: AGPL |
| `moinsen-dev/tauri-plugin-mcp`, `Lumither/tauri-mcp`, `bayshores/tauri-plugin-mcp-bridge`, `DaveDev42/tauri-plugin-mcp` | 1-4 | 2025-10 to 2026-07 | NOASSERTION or none | n/a | yes / no | Small MCP plugins | Skipped: unclear license, tiny |
| `dirvine/tauri-mcp`, `vdavid/tauri-mcp`, `delorenj/tauri-mcp-server` | 0-33 | 2025-07 to 2026-02 | MIT / Apache-2.0 | n/a | yes / no | Older MCP servers; vdavid's README says it was abandoned for hypothesi | Skipped: stale |
| `8beeeaaat/tauri-plugin-debug-tools` | 2 | 2026-02-21 | MIT | crate 0.1.4 | yes / no | WebView state, console ring buffer, snapshots | Skipped: tiny |
| `specta-rs/tauri-specta` | 803 | 2026-07-26 | MIT | n/a | yes / koharu fork only | Typed command/event bindings, not an inspector (no event-inspector tool found) | Not a debugger |
| `moeru-ai/airi` `tauri-plugin-mcp` 0.8.0-alpha.4 | 49897 (repo) | 2026-10-01 | MIT | 0.8.0-alpha.4 | n/a | An MCP client plugin for apps, not a debugging tool | Out of scope |

## Capability matrix by tool

From README and source of the pinned or downloaded versions; nothing here was
exercised. "page JS" means done by script injected through `eval`, so it is
synthetic (events are not `isTrusted`).

| Capability | CDP (CEF, WebView2) | `tauri-driver` | hypothesi bridge + server | `tauri-plugin-webdriver` | Victauri | `tauri-plugin-devtools` |
| --- | --- | --- | --- | --- | --- | --- |
| DOM snapshot | yes (`DOM`, `DOMSnapshot`) | W3C page source and element finding | yes, `dom-snapshot.js` | yes, `document.rs` source, element handlers | yes (DOM snapshots) | no |
| A11y tree | yes (`Accessibility`) | per-element computed role/label only where the native driver supports it | yes, `aria-api` computed role and name | per-element `computedrole` / `computedlabel`; no tree | yes (accessibility audit) | no |
| Screenshot | yes | W3C screenshot | native on Linux/Windows/macOS/iOS/Android, `html2canvas` fallback | native, `screenshot.rs` per OS | yes (Windows, macOS, Linux X11) | no |
| Click / type | yes (`Input`) | W3C actions | page JS (`interact.js`, keyboard events) | W3C actions, `actions.rs` | page JS; trusted OS input on Windows only | no |
| JS eval | yes | W3C execute script | yes (`execute_js`) | yes (`script.rs`) | yes (`eval_js`) | no |
| Console logs | yes | no | yes, buffered from page start | none found | yes (`logs` tool) | Rust-side tracing only |
| Network logs | yes | no | no | none found | yes (`logs` tool source `network`) | no |
| IPC tracing | no (Tauri-level) | no | yes (`ipc_monitor`, wraps `__TAURI__.core.invoke`) | no | yes (IPC log, ghost commands) | not verified |
| State inspection | no | no | yes (`get_backend_state`, window info) | window rect only | yes (backend state, SQLite) | yes (raw config, metrics, versions, metadata) |
| CDP endpoint | yes | no (msedgedriver uses one on Windows) | no | no | no | no |

Details that matter and are easy to miss:

- `tauri-driver` sets `TAURI_WEBVIEW_AUTOMATION=true` for the native driver. In
  `tauri-runtime-wry` 3.0.0-alpha.3 that variable is read at `src/lib.rs:5005`;
  `tauri-runtime-cef` 3.0.0-alpha.4 contains no reference to it. So
  `tauri-driver` does not drive CEF apps (koharu).
- `tauri-plugin-automation` is the in-app half of "CrabNebula Webdriver for
  Tauri". The crate changelog links `github.com/crabnebula-dev/webdriver`, which
  does not resolve for an authenticated `gh` call. The plugin only forwards JSON
  messages to a library loaded with `libloading` from the path in
  `AUTOMATION_LIBRARY_PATH`; that library ships as platform binaries in the npm
  package `@crabnebula/test-runner-backend` 0.3.0 (labelled MIT on npm, no source
  repository field). The `@wdio/tauri-service` README states the CrabNebula
  provider "requires a subscription (CN_API_KEY for macOS)".
- `tauri-plugin-devtools` registers a global tracing subscriber and its README
  documents a startup panic when another logger is initialised; koharu uses
  `tauri-plugin-log`, so it must stay debug-only and mutually exclusive.
- `hypothesi/mcp-server-tauri` has 19 open issues/PRs. Two matter: #36
  "Unauthenticated control WebSocket has no Origin check -> Cross-Site WebSocket
  Hijacking" (open) and #47 "parameterized invoke loses args" (open, bridge
  0.13.0).

## Release-build safety

What each option exposes and what keeps it out of a shipped build, from the
source of the pinned or downloaded versions:

| Option | Listener | Gate in release builds | Evidence |
| --- | --- | --- | --- |
| `tauri-driver` | none in the app; the driver listens on 4444 and the native driver on 4445 on the test machine | No app-side plugin to leave out, **but** `tauri-runtime-wry` reads `TAURI_WEBVIEW_AUTOMATION=true` in every build profile and then enables the WebKitGTK automation context for the first webview context (`src/lib.rs:5005-5030`, no `cfg`). Anyone who controls the environment of a shipped Linux wry app can put it in automation mode | source read |
| `tauri-plugin-automation` | none; dlopens `AUTOMATION_LIBRARY_PATH` | README: "DO NOT include the automation plugin for production builds", gate with `cfg(debug_assertions)` or a feature. At setup it adds a capability granting `automation:default` (only the `resolve` command) to every window for local pages and remote `http://*` / `https://*`, before it looks at the environment variable | source read |
| `tauri-plugin-devtools` | gRPC (tonic) on `127.0.0.1:3033` on desktop (any free port when busy), `0.0.0.0` on iOS/Android; installs a global tracing subscriber; its sources service returns file bytes from the working directory | README: `#[cfg(debug_assertions)]` | source read |
| hypothesi bridge | WebSocket on `0.0.0.0:9223-9322`, no token, no Origin check | None in the plugin; the README asks the app to wrap `.plugin(...)` in `#[cfg(debug_assertions)]`. Upstream issue #36 is open | source read |
| `tauri-plugin-webdriver` | HTTP on `127.0.0.1:4445` (`TAURI_WEBDRIVER_PORT`), all interfaces on Android; no token or Origin check found | README: never in production; `cfg(debug_assertions)` or a Cargo feature | source read |
| Victauri | axum + rmcp on `127.0.0.1:7373`, Bearer token generated by default and written to a per-user discovery directory | `init()` returns a no-op plugin unless `debug_assertions`; the README says to also make the dependency optional behind a feature to keep the code out of the binary | source read |
| CEF `RemoteDebugging` | `Disabled` by default; `Pipe` reachable only by the parent; `Port` has no authentication | Default `Disabled` also pins `devtools.remote_debugging.allowed` off; release builds ignore Chromium command-line switches unless the app opts in; koharu enables `Port{4000}` only under `cfg(debug_assertions)` | source read |

## Runtime-by-runtime capability matrix

What can be done to a Tauri webview with no third-party plugin, per runtime.
"Yes" means documented in the cited source; the last column says what was
actually checked here.

| Runtime | CDP endpoint | DOM / a11y | Screenshot | Eval | Console | Network | Checked here |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CEF (`tauri-runtime-cef` 3.0.0-alpha.4, `cef` 152.3.0) | Yes. `Cef::remote_debugging(RemoteDebugging::{Disabled, Port{port, allowed_origins}, Pipe})`; default `Disabled`, which also pins `devtools.remote_debugging.allowed` off. `Pipe` is reachable only by the launching process; `Port` has no authentication, accepts `localhost` plus `allowed_origins`, port 1024-65535 | Yes, CDP `DOM`, `DOMSnapshot`, `Accessibility` | Yes, `Page.captureScreenshot` | Yes, `Runtime.evaluate` and `eval_with_callback` | Yes, `Runtime`/`Log` events | Yes, `Network` events | Source read. In-process path also exists: `WebviewCefExt::send_dev_tools_message` and `on_dev_tools_protocol` (message ids from `allocate_devtools_message_id`). Release builds ignore Chromium command-line switches unless the app opts in. koharu already enables `Port{4000}` under `cfg(debug_assertions)` in `koharu-app/src/app.rs` (`crates/koharu/koharu-app/src/app.rs`, not in repo). Not launched |
| WebView2 (wry 0.57, Windows) | Yes, via `--remote-debugging-port` in `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` ([Microsoft: WebDriver, `--remote-debugging-port`](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver); [Microsoft: CDP in WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/chromium-devtools-protocol)) or wry's `WebviewBuilderExtWindows::with_additional_browser_args` (which replaces wry's default args). **WebView2 Runtime 150 ignores the env var, HKCU policy and command-line switch when the host process is elevated**; only HKLM policy and API-supplied arguments are honoured (tauri-apps/wry#1782 open; the proposed wry fix #1783 was closed unmerged; MicrosoftEdge/WebView2Feedback#5645) | Yes via CDP | Yes, CDP, or `CapturePreview` through `with_webview` | Yes | Yes | Yes | Docs fetched (HTTP 200), wry source read (`src/webview2/mod.rs` builds the args), issue text read. Not run: no Windows host. The existing procedure in [DESKTOP-INTEGRATION.md](../../../m3/docs/reference/DESKTOP-INTEGRATION.md) uses the env var, so it can silently stop working on elevated CI runners with Runtime 150 or newer |
| WebKitGTK (wry 0.57 on Linux, 2.52.6 here) | **No CDP.** `WEBKIT_INSPECTOR_SERVER` and `WEBKIT_INSPECTOR_HTTP_SERVER` exist (WebKit's own remote inspector, not CDP, protocol not exercised here; strings present in `libwebkit2gtk-4.1.so.0.21.10`); `MiniBrowser` is installed beside the library. Automation via `WebKitWebDriver` and `webkit_web_context_set_automation_allowed` (wry sets it when `TAURI_WEBVIEW_AUTOMATION=true`; one automation context per process) | DOM via JS or WebKitWebDriver; no a11y tree API without in-page code | Yes, `WebView::snapshot` (bindings `webkit2gtk` 2.0.2) | Yes, `evaluate_javascript`, wry `eval_with_callback` | Partial: `enable-write-console-messages-to-stdout` setting, or an injected console wrapper | Partial: `resource-load-started` signal (request level, no bodies or timings) | `strings` confirmed the two inspector variables; bindings read. `WebKitWebDriver` is not installed on this host (Ubuntu package `webkit2gtk-driver`). Not run |
| WKWebView (wry 0.57, macOS) | **No CDP.** Safari Web Inspector only: wry calls `setInspectable(true)` when devtools are enabled (debug builds or the `devtools` feature), macOS 13.3+ ([Apple](https://developer.apple.com/documentation/webkit/wkwebview/isinspectable)). Apple ships no WebDriver for embedded WKWebView; `tauri-driver`'s README lists macOS as "Todo" | DOM and a11y only through injected JS (hypothesi uses the `aria-api` bundle) | Yes, `takeSnapshot` (used by the hypothesi macOS path) | Yes, `evaluateJavaScript` | Injected wrapper only | Injected wrapper only | Source read only. Not run: no macOS host |

Consequences:

- CEF is the only runtime where CDP is first-class and identical on every OS
  (Tauri 3, `tauri-runtime-cef` 3.0.0-alpha.4), and `aphrody-web` already speaks CDP
  (`config/web.json` engine endpoint, [`packages/web/aphrody-web-test`](../../../packages/web/aphrody-web-test)).
  For koharu no bridge plugin is needed.
- Windows wry apps get CDP too, but the Runtime 150 elevated-host regression
  makes an API-passed argument (or the in-process DevTools call) the only
  reliable path on CI; an in-page bridge or an embedded WebDriver is immune.
- Linux and macOS wry apps have no CDP. They need an in-page bridge plus native
  snapshot calls (hypothesi family), an embedded WebDriver
  (`tauri-plugin-webdriver`), or `tauri-driver` with `WebKitWebDriver` (Linux
  only).

## Decision

### Primary debugger: runtime protocol first, `tauri-driver` for E2E

- CEF and WebView2: attach over CDP (`Pipe` where the debugger is a child
  process, loopback `Port` for development). No upstream repo is required.
- wry on Linux and Windows: `tauri-driver` (official, Tauri 3 alpha, Apache-2.0
  OR MIT, W3C WebDriver so any client works, including `webdriverio`). Its
  limits are real: no macOS, no CEF, Windows depends on `msedgedriver` over CDP
  and inherits the Runtime 150 elevated-host problem, no console/network.
- Fork + pin: `tauri-apps/tauri` crate `crates/tauri-driver` on branch `v3`.

### MCP bridge: `hypothesi/mcp-server-tauri`

Why: the widest tool set that fits an agent loop, MIT (compatible with this
Apache-2.0 repository when the notice is kept), active (v0.11.2 on 2026-05-20,
v0.12.0 on 2026-07-06, v0.13.0 on 2026-08-28), the largest user base of the Tauri MCP
projects found (312 stars, 41 forks, 315719 crate downloads), and it is the
revision [`tauri-mcp-parity.md`](../../../m3/docs/research/integrations/tauri-mcp-parity.md) already
uses as naming reference. Most of its logic is plain JavaScript sent through one
`execute_js` command, so a Rust MCP can reuse it.

Why it is only a patch base:

- Tauri 2 only. The bridge crate depends on `tauri = "2"` and no v3 work exists.
- Insecure defaults: WebSocket bound to `0.0.0.0`, no token, no Origin check
  (open issue #36), no release gate other than the host app's own `cfg`.
  This is why [`tauri-mcp.md`](../../../m3/docs/reference/integrations/tauri-mcp.md)
  records that the upstream checkout was removed and replaced by native kernel
  IPC.
- A Node.js MCP server (`@hypothesi/tauri-mcp-server`) in front of the plugin.
  This repository's MCP surface is Rust (`rmcp`).

### Secondary

- `Choochmeque/tauri-plugin-webdriver`: the W3C WebDriver implementation that
  runs inside the app on macOS, Windows and Linux (no external driver, no CDP),
  so existing WebDriver clients (WebdriverIO, Selenium, fantoccini) work on
  macOS, and, like the in-page bridges, it does not depend on a WebView2 debug
  port, so the Runtime 150 regression does not apply to it. MIT, 38 stars,
  active (commit 2026-09-23). Tauri 2 only.
- `4DA-Systems/Victauri`: Apache-2.0 (same license as this repository), Rust,
  rmcp, token auth on by default, loopback only, `cfg(debug_assertions)` gate,
  a DNS-rebinding Host check (`auth.rs`), 403 for browser-initiated
  `Sec-Fetch-Site: cross-site` requests and rate-limit buckets
  (`mcp/hardening.rs`), 35 tools including IPC log and SQLite inspection.
  Young (created 2026-04-25, 5 stars; branch names such as `claude/...` and
  `codex/...` suggest AI-assisted authorship). Use it as the design reference
  for the hardened transport, not as a dependency.

### Rejected, with reasons

| Candidate | Reason |
| --- | --- |
| `crabnebula-dev/devtools` | `LICENSE.md` says the instrumentation folders are Apache-2.0 OR MIT and "all other code is licensed under the PolyForm Noncommercial License 1.0.0"; the folders it names (`/plugin`, `/primitives`, `/server`, `/subscriber`) do not exist in the current layout, so the split is unclear. GitHub reports NOASSERTION. Published crates are `MIT OR Apache-2.0`; consume `tauri-plugin-devtools` 3.0.0-alpha.0 from crates.io if tracing telemetry is wanted. |
| `tauri-plugin-automation` | No public source repository to fork; needs a proprietary prebuilt library; macOS needs a CrabNebula subscription per the `@wdio/tauri-service` README. |
| `P3GLEG/tauri-plugin-mcp` | No license file and no GitHub license: no grant to copy or modify. |
| `DraviaVemal/tauri-remote-ui` | AGPL-3.0-only. |
| `moinsen-dev/tauri-plugin-mcp` | NOASSERTION license, stale since 2025-10-22. |

## Forks and pins

GitHub account used: `aphrody-code` (active, not switched). Forks were made with
`gh repo fork <owner/repo> --clone=false --fork-name <same-name>`. **Nothing was
pushed to any fork, no PR or issue was opened.** Local pins are plain trees (the
nested `.git` was removed after `git rev-parse HEAD`); no `node_modules` or
`target`; nothing under `upstream/` was added to a Cargo or Bun workspace.

| Local path | Upstream | Fork | Pinned commit | License | Files |
| --- | --- | --- | --- | --- | --- |
| `upstream/mcp-server-tauri` | `hypothesi/mcp-server-tauri` @ `main` | `https://github.com/aphrody-code/mcp-server-tauri` (created 2026-10-01) | `4451b2b1d1eb3a817674f60957e148224c24d3a8` (2026-08-28, "chore: version bump: v0.13.0") | MIT, `LICENSE` at root and in `packages/mcp-server`, `packages/tauri-plugin-mcp-bridge` (sha256 `35bb5aef...47fca3`) | 268 |
| `upstream/tauri-driver` | `tauri-apps/tauri` @ `v3`, subpath `crates/tauri-driver` | `https://github.com/aphrody-code/tauri` (pre-existing fork, not created or touched here) | `70541fe283b980712b1b3d1c75147cd5ad155310` (2026-09-30, "fix(tauri-runtime-cef): docs.rs build"; matches `upstream.tauri.observedCommit` in the registry) | Apache-2.0 OR MIT: `LICENSE-APACHE-2.0`, `LICENSE-MIT`, `LICENSE.spdx` | 10 |
| `upstream/tauri-plugin-webdriver` | `Choochmeque/tauri-plugin-webdriver` @ `main` | `https://github.com/aphrody-code/tauri-plugin-webdriver` (created 2026-10-01) | `007d18ece8fe5d27ec1ad4df483db3ebb5f55aca` (2026-09-23) | MIT, `LICENSE` (sha256 `921c963e...d93591`) | 194 |
| `upstream/victauri` | `4DA-Systems/Victauri` @ `main` | `https://github.com/aphrody-code/Victauri` (created 2026-10-01) | `bb17a652963a58e99df661e7d50e67517b6136ae` (2026-09-30) | Apache-2.0, `LICENSE` at root, in each crate and `editors/vscode` (sha256 `5930de35...b49a9d`) | 255 |

Notes for the maintainer of these pins:

- `tauri-driver` is a sparse checkout of one crate. In upstream its three
  license files are relative symlinks to the repository root; the checkout
  produced text files containing the path, so they were replaced by real copies
  of the root `LICENSE-APACHE-2.0`, `LICENSE-MIT` and `LICENSE.spdx`. Its
  `Cargo.toml` uses `[lints] workspace = true`, so building it needs either the
  upstream workspace root or the registry tarball `tauri-driver 3.0.0-alpha.1`.
  Use `cargo install tauri-driver --locked --version 3.0.0-alpha.1` rather than
  building the pin.
- Pins are registered in the `debuggers` block of
  [`config/tauri-upstream.json`](../../../config/tauri-upstream.json) with commit,
  tree hash, license files and the not-forked list. `tauri-sync.ts` validates
  only the keys it knows (`parseConfig`), so the extra block does not affect
  `bun run tauri:sync`.
- No `config/web-upstream.json` was created because `config/tauri-upstream.json`
  appeared before editing.
- `upstream/mcp-server-tauri` puts back a tree that
  [`tauri-mcp.md`](../../../m3/docs/reference/integrations/tauri-mcp.md) says was
  removed. It lives under `upstream/` as the repository rules require, is not
  wired into any build, and the unauthenticated listener is still not installed
  anywhere. That sentence in `tauri-mcp.md` is now stale and was left for its
  owner to update.

## License notes

- This repository is Apache-2.0. MIT and Apache-2.0 sources can be carried
  provided the notices stay (they do, unmodified, in the pins). Keep the MIT
  notice with any file derived from hypothesi or Choochmeque code; the existing
  copy for hypothesi is
  [`tauri-mcp-upstream.LICENSE`](../../../m3/docs/reference/integrations/tauri-mcp-upstream.LICENSE).
- Incompatible or unclear, not forked: PolyForm Noncommercial (devtools web
  client), AGPL-3.0-only (tauri-remote-ui), no license (P3GLEG, Lumither,
  bayshores, DaveDev42), NOASSERTION (moinsen-dev). `@crabnebula/test-runner-backend`
  is labelled MIT on npm but ships platform binaries without a source
  repository: do not vendor it.
- Never copy any of these trees into `crates/`; forks stay under `upstream/`.

## How `aphrody-tauri-mcp` relates

The standalone stdio adapter `crates/ui/tauri-mcp` (385 lines, `rmcp`, 16 tools; each tool forwarded
`tools/call` with a 30 second timeout to the per-user Aphrody kernel through
`aphrody_kernel::client::Client` and opened no port) was removed on 2026-10-05 by commit `df2249286`
(`aphrody-mcp` is the only Rust MCP server). Its tool list now lives only in
[`crates/ai/mcp/src/tauri_tools.rs`](../../../crates/ai/mcp/src/tauri_tools.rs)
under the `aphrody_tauri_` prefix. The webview work is done by `aphrody-app`
([`crates/ui/app/src/lib.rs`](../../../crates/ui/app/src/lib.rs)): reads and
interactions are generated JavaScript run through
`WebviewWindow::eval_with_callback` (`webview_eval`, line 474), and native
screenshots exist on Windows only.

Gap against the hypothesi tool set (from
[`tauri-mcp-parity.md`](../../../m3/docs/research/integrations/tauri-mcp-parity.md), confirmed by
reading the bridge): no IPC monitor, IPC invoke/emit, backend-state tool;
`read_logs` needs a page-side `__APHRODY_MCP_LOGS__` buffer; `manage_window` is
partial; no Linux or macOS native screenshot; no a11y tree (the upstream
`aria-api` bundle); no script registry. It only reaches windows owned by
`aphrody-app`, so koharu, `model-view` and external Tauri apps are out of reach.

Recommended relation: keep the kernel IPC path for `aphrody-app` (no port),
and add a separate opt-in debug plugin for every other Tauri app, built from the
hypothesi bridge patched as below, speaking to `aphrody-tauri-mcp` as a client.
[`config/web.json`](../../../config/web.json) already reserves exactly that
contract under `tauriDebug` (plugin `aphrody-tauri-wrap`, module `debug`, formerly `aphrody-tauri-debug`; Cargo feature
`debug-bridge`, `APHRODY_TAURI_DEBUG`, bind `127.0.0.1`, random per-process token
in a `0600` discovery file). The patched bridge should implement that contract
rather than upstream's defaults.

## Integration notes for aphrody

Everything here is from reading `upstream/mcp-server-tauri` at
`4451b2b1d1eb3a817674f60957e148224c24d3a8` against `tauri` 3.0.0-alpha.3,
`tauri-runtime-wry` 3.0.0-alpha.3, `wry` 0.57.0 and `tauri-runtime-cef`
3.0.0-alpha.4 (Tauri 3 changelog from `tauri-apps/tauri` branch `v3`,
`crates/tauri/CHANGELOG.md`).

### What the bridge is

Rust crate `tauri-plugin-mcp-bridge` (`packages/tauri-plugin-mcp-bridge`, about
4200 lines) plus Node package `@hypothesi/tauri-mcp-server`
(`packages/mcp-server`).

Transport (plugin side, `src/websocket.rs`, `src/config.rs`, `src/discovery.rs`):

- Plain `ws://` on `bind_address:port`, `tokio-tungstenite` 0.28. Defaults:
  `0.0.0.0`, port 9223, scanning up to 100 ports (`9223..9322`) for the first free
  one; no TLS, no authentication, no Origin or Host check. Env on the client:
  `MCP_BRIDGE_HOST`, `TAURI_DEV_HOST`, `MCP_BRIDGE_PORT`, `MCP_BRIDGE_CWD`.
- Text frames of JSON. Request: `{"id": "<string>", "command": "<name>", "args": {...}}`.
  Response: `{"id", "success": bool, "data" | "error", "windowContext":
  {"windowLabel", "totalWindows", "warning"}}`. A frame whose `id` matches no
  pending request is a broadcast event (`{"type": "element_picked" |
  "element_pointed", "payload": ...}`, forwarded from Tauri events
  `__element_picked` / `__element_pointed`). The client sends WebSocket pings.
- `command` values handled by `dispatch_command`: `invoke_tauri` (allowlist of
  `plugin:mcp-bridge|` `get_window_info`, `get_backend_state`, `start_ipc_monitor`,
  `stop_ipc_monitor`, `get_ipc_events`, `emit_event`), `list_windows`,
  `get_window_info`, `execute_js`, `capture_native_screenshot`
  (`format`, `quality`, `maxWidth`, `windowLabel`), `resize_window`,
  `set_window_state` (`focus`, `minimize`, `maximize`), `register_script`,
  `remove_script`, `clear_scripts`, `get_scripts`.
- The window is chosen by label, default `"main"`, with a warning when several
  windows exist.

Tauri commands exposed to the webview (`build.rs`, `permissions/default.toml`,
all under `plugin:mcp-bridge|`): `capture_native_screenshot`, `emit_event`,
`execute_command` (returns "not yet implemented"), `execute_js`,
`get_backend_state`, `get_ipc_events`, `get_window_info`, `list_windows`,
`report_ipc_event`, `request_script_injection`, `script_result`,
`start_ipc_monitor`, `stop_ipc_monitor`.

Injected JavaScript: `src/bridge.js` (682 lines) added with
`PluginBuilder::js_init_script`. It buffers `console.*` into
`window.__MCP_CONSOLE_LOGS__`, wraps `window.__TAURI__.core.invoke` for IPC
monitoring (replaces the whole `core` object because `invoke` is read-only), keeps
the element picker and re-injects registered scripts. This needs
`app.withGlobalTauri = true`; the option still exists in `tauri-utils`
3.0.0-alpha.2 (default `false`).

JS execution (`src/commands/execute_js.rs`): on macOS, `WKWebView
evaluateJavaScript` through `with_webview` (skipped for scripts containing
`await`, `async`, `.then(` or `Promise`). Elsewhere: `eval` of a wrapper that
calls `invoke('plugin:mcp-bridge|script_result', {execId, ...})` (fallback: emit
`__script_result`), matched to a pending `oneshot` by `exec_id`.

Native screenshots (`src/screenshot/*.rs`): Linux `webkit2gtk` `snapshot(Visible)`
then cairo PNG; Windows `ICoreWebView2::CapturePreview`; macOS
`WKWebView.takeSnapshot`; iOS and Android variants; then resize and JPEG/PNG
encode through the `image` crate.

Server side (Node): the tool schemas, session management and port scan live in
`packages/mcp-server/src`; the DOM snapshot, element finding, interaction,
wait-for and a11y logic are static scripts in
`packages/mcp-server/src/driver/scripts/` (`dom-snapshot.js`, `find-element.js`,
`interact.js`, `resolve-ref.js`, `wait-for.js`, `element-picker.js`, a bundled
`aria-api`) executed through `execute_js`. A Rust MCP can send those scripts
over the same WebSocket protocol and drop the Node server; they are MIT and the
notice must travel with them.

### Tauri 3 patch set

| # | File (upstream path) | Change | Source of the change |
| --- | --- | --- | --- |
| P1 | `Cargo.toml` | `tauri` and `tauri-plugin` from `"2"` to the workspace pins (`=3.0.0-alpha.3`, `=3.0.0-alpha.2`), `default-features = false`; `rust-version` 1.70 to 1.95; add optional `tauri-runtime-wry` and `tauri-runtime-cef` behind `wry` / `cef` features. | Tauri 3 selects the runtime at build time through the runtime crate; `tauri` has no `wry` or `cef` feature; MSRV 1.95 (changelog 3.0.0-alpha.0) |
| P2 | `Cargo.toml` platform tables | Align native crates with what wry 0.57 re-exports: `webview2-com` 0.38 to 0.39, `windows`/`windows-core` to the 0.62 line, `objc2` 0.5 to 0.6.4, `block2` 0.5 to 0.6, `objc2-foundation`, `objc2-app-kit` 0.2 to 0.3, `objc2-web-kit` 0.2 to 0.3.2, `webkit2gtk` to `=2.0.2` (`gio`/`cairo-rs` 0.18 already match gtk 0.18). Otherwise the types returned by `with_webview` do not unify with the plugin's. | `wry-0.57.0/Cargo.toml.orig` lines 52-70, 95-136 |
| P3 | `src/lib.rs:177` | `.js_init_script(include_str!("bridge.js").to_string())` to `.initialization_script(include_str!("bridge.js"))` (main frame only is enough; `initialization_script_on_all_frames` exists). | Renamed in 3.0.0-alpha.2 (#16036); `Plugin::initialization_script` now returns `InitializationScript` |
| P4 | `src/commands/execute_js.rs:83-85`, `src/utils.rs:18-19`, `src/screenshot/{linux:20-21, windows:25-28, macos:32-35, ios:30-35, android:24}.rs` | The `with_webview` closure receives `PlatformWebview<R>`, which derefs to the runtime's webview (`DynWebview` for the default `DynRuntime`). Call `webview.downcast_ref::<tauri_runtime_wry::Webview>()` first (works for concrete and erased runtimes), then `.inner()`, `.controller()`, `.ns_window()`; on `None` fall through to the CEF path (P5) instead of `PlatformUnsupported`. | 3.0.0-alpha.0 breaking change: runtime-specific APIs moved to runtime crates; `PlatformWebview::downcast_ref` |
| P5 | new `src/screenshot/cef.rs`, optional console/network | On CEF use `tauri_runtime_cef::WebviewCefExt`: `send_dev_tools_message` with a message id from `allocate_devtools_message_id()` for `Page.captureScreenshot`, `Accessibility.getFullAXTree`, `Runtime.enable`/`Log.enable`/`Network.enable`; `on_dev_tools_protocol` yields `DevToolsProtocol::{Message, Event, MethodResult}`. This is in-process: no port, and it replaces the `console.*` monkey patch and gives network logs, which the bridge lacks everywhere else. | `tauri-runtime-cef-3.0.0-alpha.4/src/tauri_ext.rs` |
| P6 | `src/commands/execute_js.rs` | Replace the `__script_result` listener plus `window.__TAURI__.core.invoke` round trip, and the macOS-only native path, with `WebviewWindow::eval_with_callback`. It exists in `tauri` 3.0.0-alpha.3 (`src/webview/mod.rs:2243`) and is implemented by both `tauri-runtime-wry` (`src/lib.rs:1957`) and `tauri-runtime-cef` (`src/webview.rs:1872`). Keep a `try/catch` wrapper that returns an error sentinel because the doc comment says exceptions are ignored on Windows. This also removes the dependency on `withGlobalTauri` for eval (still needed by the IPC monitor in `bridge.js`). `crates/ui/app/src/lib.rs` already does this. | `tauri-3.0.0-alpha.3/src/webview/mod.rs` |
| P7 | `permissions/autogenerated/**`, `build.rs` | Regenerate; do not commit `commands/*.toml`. Command permissions are now stored as a `commands` list on the plugin manifest and `allow-*`/`deny-*` are materialised on demand; `permissions/default.toml` keeps working. The repository's own plugin crates already show these files deleted in the working tree. | 3.0.0-alpha.0 "Performance Improvements" entry |
| P8 | `src/websocket.rs`, `src/config.rs`, `src/discovery.rs`, `src/lib.rs` | Security patch, not a Tauri 3 requirement: default `127.0.0.1`; port 0 plus a `0600` discovery file instead of scanning `9223..9322`; random per-process token checked in `accept_hdr_async` (reject when the query token or `Authorization` is wrong); reject any `Origin` header that is not absent or loopback; reject non-loopback `Host`; refuse to start unless the Cargo feature is on and `cfg(debug_assertions)` holds. Implements the `tauriDebug` contract in `config/web.json`. | upstream issue #36; Victauri `crates/victauri-plugin/src/mcp/hardening.rs` and `auth.rs` as reference |

Unchanged by Tauri 3 as far as the sources and the scratch compile show: `Manager::webview_windows`,
`get_webview_window`, `Listener::listen`, `Emitter::emit`,
`WebviewWindow::{eval, outer_size, outer_position, title, is_focused,
is_visible, set_focus, minimize, maximize}`, `tauri::VERSION`,
`#[tauri::command]`, `tauri_plugin::Builder::new(&[...]).build()`. Things that
changed in 3.0.0-alpha.3 but do not touch the bridge: `run_on_main_thread` moved
to `Manager` (the bridge never calls it); plugin hooks and `Plugin` now require
`Sync` and `Fn` closures (the bridge only registers `setup`, an `FnOnce`).

Smaller work items: the app must build with
`tauri::Builder::default().runtime(tauri_runtime_wry::Wry::default())` (or
`Cef::default()`), the WebSocket `start()` task runs on `tauri::async_runtime`
(unchanged), and `bridge.js` keeps working under Tauri 3 as long as
`__TAURI__.core` is exposed.

Compile evidence (Linux target only). A scratch copy of
`packages/tauri-plugin-mcp-bridge` outside the repository (`/tmp/survey/bridge-t3`,
its own target directory; the monorepo and `upstream/` were not touched) with
only `tauri = { version = "=3.0.0-alpha.3", default-features = false }` and
`tauri-plugin = "=3.0.0-alpha.2"` failed `cargo check` with exactly two errors:

- `src/lib.rs:177:10 error[E0599]: no method named js_init_script found for struct tauri::plugin::Builder`
- `src/screenshot/linux.rs:21:48 error[E0599]: no method named inner found for struct PlatformWebview<R>`

After the P3 rename and a P4 `downcast_ref::<tauri_runtime_wry::Webview>()` in
`linux.rs` (plus a Linux-only `tauri-runtime-wry = "=3.0.0-alpha.3"` dependency,
`default-features = false`, feature `x11`), `cargo check` finished with no
errors and no warnings in 37.5 s. The whole diff against the pin is about a
dozen changed lines in three files. The Windows, macOS, iOS and Android modules are
`cfg`-gated out on this host and were not compiled: the `with_webview` sites in
them are expected to fail the same way, and the native crate versions (P2) are
the other likely failure. A clean `cargo check` is not a parity claim: no
bridge command was exercised.

### Order of work for the integrator

1. Apply P1-P4 and P6 as a patch series against the pin, kept as `*.patch`
   files or committed on the `aphrody-code/mcp-server-tauri` fork by the
   integrating agent; do not edit `upstream/mcp-server-tauri` in place (its
   tree hash in the registry would stop matching). If a first-party crate is
   preferred, `crates/web` would vendor only the Rust plugin and the MIT scripts
   with their notices. Linux first: it is the only OS testable here.
2. P8 hardening and the `config/web.json` contract; add a Rust WebSocket client
   in `aphrody-tauri-mcp` that reads the discovery file.
3. P5 for CEF (koharu), preferably as plain CDP attach from `aphrody-web`
   because `RemoteDebugging::Pipe/Port` already gives the full protocol.
4. For wry on Windows, pass `--remote-debugging-port` through
   `with_additional_browser_args` (not only the env var) and check on an
   elevated host with WebView2 Runtime 150 or newer.
5. Evaluate `tauri-plugin-webdriver` for macOS after P4-style downcast patches
   (13 `with_webview` call sites in `src/platform/*.rs`).

## What was not verified

- No tool was run against a live Tauri window. This host has no Windows or
  macOS webview and no `WebKitWebDriver` binary; WebView2 and WKWebView rows
  are from documentation, issues and source only.
- The WebView2 Runtime 150 elevated-host behaviour is quoted from wry#1782 and
  webdriverio/desktop-mobile#542; it was not reproduced. WebView2Feedback#5645 is
  closed.
- Star counts, commit dates and download counts are snapshots from 2026-10-01.
  GitHub `pushed_at` can be later than the last commit on the default branch
  (for example `Choochmeque/tauri-plugin-webdriver`: last commit 2026-09-23,
  pushed 2026-09-30).
- `Lumither/tauri-mcp` and `DraviaVemal/tauri-remote-ui` default branches did
  not answer `commits?sha=main`; their dates are push dates.
- The private CrabNebula repository could not be inspected; the description of
  `tauri-plugin-automation` comes from the published crate only.
- The Tauri 3 patch list is derived from changelogs and source reading plus the
  Linux-only scratch compile above; the Windows, macOS, iOS and Android code
  paths were not compiled, and no patched bridge was run.
