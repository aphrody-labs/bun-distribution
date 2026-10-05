<!-- SPDX-License-Identifier: Apache-2.0 -->

# Converting a website or web app to a native Tauri 3 app

Owner: `packages/web-to-tauri` (probe, plan, generate, parity), `crates/ui/tauri-wrap` (runtime),
`packages/scaffold` (the Tauri shell, shared with every other generator). Contract of the
generated `wrap.json`: [`docs/apis/ui/WRAP-CONFIG.md`](../apis/WRAP-CONFIG.md).

```sh
bun run ui:wrap plan    https://example.com            # what would be generated, and the risks
bun run ui:wrap convert https://example.com --out ../example-app
bun run ui:wrap convert ./my-vite-app --out ../my-app --backend https://api.example.com
bun run ui:wrap parity  ../example-app --bridge        # needs the running app, see "Parity"
```

## Rule: change nothing the page, its API or its backend can see

The generator picks, in order, the mode that leaves the most unchanged.

| Mode | Input | What runs | Page / API / backend |
| --- | --- | --- | --- |
| `remote` | a URL | the webview loads the deployed origin | unchanged: same origin, same cookies, same requests, no proxy |
| `sidecar` | a project directory with a server (or API routes) | the project's own server runs as a child process on loopback | the same server code answers; only the origin is loopback |
| `bundle` | a project directory with a built static bundle | assets embedded by Tauri, served from loopback; configured API prefixes proxied to the backend | page unchanged; requests go through a proxy that rewrites `Origin`, `Referer`, `Set-Cookie`, `Location` |

A URL is always `remote`. `bundle` and `sidecar` exist for offline or self-contained apps and cost
you the public origin (see "Risks that cannot be removed").

The engine is the system webview (`wry`: WebView2, WKWebView, WebKitGTK) unless the probe finds a
Chromium-only API (File System Access, WebUSB/Serial/Bluetooth/HID, WebGPU, EyeDropper, speech
recognition); then it is `cef` (Chromium, as Koharu does).

## What the generated app does

- **Navigation policy**: origins of the redirect chain, the registrable domain, sign-in providers
  and third-party frames stay in the app; every other `http(s)` link opens in the system browser;
  `file:` is blocked; custom schemes reach the OS only for `mailto:`, `tel:`, `sms:`, `http(s):`.
- **Popups** (`window.open`, `target=_blank`) of an allowed origin keep their opener, so OAuth and
  payment popups that `postMessage` back keep working.
- **Downloads** go to the download folder and never overwrite a file.
- **Drag and drop**: native handling is off so HTML5 drag and drop (file drop zones, boards) works.
- **Browser parity**: zoom shortcuts on, window title follows `document.title`.
- **No IPC**: the page gets no Tauri command. Grant one per origin with a `remote` capability.
- **Persistent session**: cookies and storage live in the app data directory.

Everything is configuration in `src-tauri/wrap.json`; the behaviour is `aphrody-tauri-wrap`. A
converted app carries no copy of that logic.

The loopback server of the `bundle` mode (axum, reqwest, rustls, tokio) is the crate's `bundle`
Cargo feature, on by default. The generator keeps it only for a `bundle` project: a `remote` or
`sidecar` app depends on `aphrody-tauri-wrap` with `default-features = false` (the sidecar is std
only), so it does not compile the HTTP stack. A build without the feature refuses `mode: bundle`
at startup ("this build has no bundle server: enable the `bundle` feature"). The `wry` apps also get
a `debug-bridge` feature that forwards to `aphrody-tauri-wrap/debug-bridge`
([TAURI-DEBUG](https://github.com/aphrody-labs/aphrody/blob/main/docs/guides/web/TAURI-DEBUG.md)).

## Risks that cannot be removed

`plan` prints them; `wrap-plan.json` and the generated `README.md` repeat them. Each has a
severity and a mitigation: `applied` (the project handles it), `flag` (set the named option),
`manual` (a person has to decide). The verdict is `needs-review` when a blocker or an unmitigated
high risk remains; `--strict` turns that into exit code 2.

- Engine differences: a page tuned for Chrome can differ in WebKit. Service workers (WKWebView
  limits them to app-bound domains), Web Notifications and third-party cookies are the usual ones.
- Sign-in: Google and Apple may refuse an embedded webview. Callback URLs registered for the
  public origin do not follow a loopback origin (`bundle`, `sidecar`): use `remote`, or a fixed
  `--port` that you register.
- A `bundle` proxies HTTP only; WebSocket upgrades return 501. `__Host-` and `__Secure-` cookies
  cannot be re-scoped to plain loopback.
- Frames: WebKitGTK and WKWebView send iframe loads through the same navigation hook as the page,
  so a frame from an origin that is not listed would open in the system browser.
- `remote` needs a connection at launch.

## Parity

A build proves nothing. `web-to-tauri parity` runs two checks and reports `skipped` for any that
did not run, never `pass`:

1. **Policy replay** (no browser): the start URL, every redirect hop, the links, form actions and
   sign-in pages the probe saw are run through the plan's policy; anything that would be blocked or
   sent to the system browser is a regression.
2. **Snapshot compare** (needs both sides running): title, final path, visible text similarity,
   accessibility tree and request set of the same paths, captured with one script on the original
   (a CDP endpoint, `--reference-cdp`) and on the wrapped app (`--bridge` for wry apps built with
   `--features debug-bridge` and `APHRODY_TAURI_DEBUG=1`; `--app-cdp` for a CEF app started with
   `APHRODY_WRAP_CDP_PORT`). An API request the browser made and the app did not is a regression.

Pixel-level parity is not checked.

## Verification status

See the dated section of [`PLAN.md`](https://github.com/aphrody-labs/aphrody/blob/main/PLAN.md). In short: the probe, plan, generator,
policy and parity comparison are covered by tests that run against loopback fixtures; the policy
table is run by both the TypeScript and the Rust implementation from one fixture file; a real
window has to be launched to compare snapshots, and Windows, macOS and CEF output are not qualified.
