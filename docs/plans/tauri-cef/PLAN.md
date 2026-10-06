<!-- SPDX-License-Identifier: Apache-2.0 -->
# One desktop runtime: `tauri-runtime-cef` (CEF + `tauri-winit` + GTK 4)

Owner order 2026-10-05, plan decision 21 (this reverses decision 20, which kept wry and tao): "on migre tout
agressivement vers tauri-runtime-cef (CEF + tauri-winit + GTK4). on ne supporte qu'un seul choix pour économiser
des perfs et du temps". The aim is the most native and performant Aphrody desktop app. Exhaustive list of what
referenced the old runtime and what became of it: [INVENTORY.md](INVENTORY.md). Verified facts about the runtime and
its open defects: [research note](../../research/web/tauri-cef-native-performance-2026-10-05.md). Evidence of the
batch (measurements, gates, what could not be measured) is dated in [MEMORY.md](../../../MEMORY.md).

## Decisions

| # | Decision | Where |
| :--- | :--- | :--- |
| 1 | Removed: `aphrody-wry`, `aphrody-tao`, `aphrody-tao-macros`, `aphrody-tauri-runtime-wry`, `aphrody-tauri-driver`, their `vendor.toml` sources, `vendor.lock` and `docs/CRATES.md` rows, the `wry`/`tao`/`tauri-runtime-wry` workspace dependencies. | `crates/tauri`, `Cargo.toml`, `vendor.toml` |
| 2 | GTK 3 is out of the graph. The `gtk3` feature, the optional `gtk 0.18` dependency and the `linux-libappindicator` feature of `aphrody-tauri` are gone; the dialog plugin defaults to `xdg-portal`; `tauri-plugin-mcp-bridge` lost `webkit2gtk`, `cairo-rs 0.18` and `gio 0.18`. The tray stays on `ksni` (StatusNotifierItem over D-Bus). Acceptance: `cargo tree -i gtk@0.18.2 --target x86_64-unknown-linux-gnu` finds nothing. | `vendor.toml` rewrites, `crates/ui/tauri-plugin-mcp-bridge` |
| 3 | The debug bridge captures through the CEF DevTools protocol (`Page.captureScreenshot`, one observer per webview) on every platform; WebKitGTK, WKWebView, WebView2, Android and iOS capture code is deleted. There is no WebDriver: CEF is driven over CDP. | `crates/ui/tauri-plugin-mcp-bridge/src/screenshot/cef.rs` |
| 4 | `aphrody-app` and its isolated runtime host (`--runtime-host`) build their `Cef` profile in one module: sandbox `Auto` (`APHRODY_CEF_UNSAFE_NO_SANDBOX=1` drops it for CI images), DevTools server `Disabled` unless `APHRODY_CEF_REMOTE_DEBUGGING_PORT` names a loopback port, component updates, Safe Browsing and spell checking kept, `accept_language_list` `fr-FR,fr,en-US,en`, no `locale`, one throwaway profile directory per runtime-host session. `main` carries `#[tauri_runtime_cef::cef_entry_point]`; the manifest is CEF's plus long-path support. | `crates/ui/app/src/cef.rs`, `main.rs`, `runtime_host.rs` |
| 5 | Linux idle CPU (tauri-apps/tauri#16189): the reporter's fix is applied to the vendored runtime and kept re-applicable as three `vendor.toml` rewrites plus a real patch file with provenance in `config/upstream-sources.json` and `config/tauri-upstream.json`. Drop it when upstream merges. | `patches/tauri-runtime-cef-3.0.0-alpha.5-glib-work-source.patch` |
| 6 | Hidden windows never flash (#16205): the four windows declared `visible: false` are created parked at (-32000, -32000) and `parking::reveal` places them before showing. They are off the `tauri_plugin_window_state` list (it would persist the parking spot); the pet and the widget keep their position in `desktop.json`. The pet cursor poller sleeps 400 ms instead of 40 ms while the pet is away. | `crates/ui/app/src/parking.rs`, `integration.rs`, `tauri.conf.json` |
| 7 | Ship deb and rpm (setuid `chrome-sandbox`, sandbox on). AppImage is not built: bundling is broken upstream (#16204). The Linux bundlers also ship the `fr` locale paks (and gender variants) when the distribution has them; the runtime `locale` stays unset so Chromium picks the pak from the system locale and falls back to `en-US`. | `crates/ui/app/tauri.conf.json`, `aphrody-tauri-bundler` |
| 8 | Scaffolds and templates produce CEF apps only: `aphrody-tauri-cli` app and plugin templates, `create-tauri-app` v3 template, `@aphrody/scaffold`, `@aphrody/web-to-tauri` (`engine` is `cef`; `wrap.json` accepts `cef` only), the ten examples. Mobile scaffolding is dropped (CEF has no mobile). | `crates/tauri`, `m3/packages` |
| 10 | `libcef.so` must be the first `DT_NEEDED` entry of `aphrody-app` (`cargo:rustc-link-lib=dylib=cef` in its `build.rs`): Chromium resolves libc symbols with `dlsym(RTLD_NEXT)` from libcef and aborts at startup (`close symbol missing`) when libc is listed first, which native C++ dependencies cause. Parked windows are hidden once loaded, off the event-loop thread (an inline call from the page-load callback deadlocks). | `crates/ui/app/build.rs`, `parking.rs` |
| 9 | `cef =152.3.0` stays pinned (154.4.0 exists); no bump in this batch. Plan the bump behind the e2e suite (Playwright over CDP). | `Cargo.toml` |

## Accepted limits

- Linux windows are GTK 4 over X11 or XWayland: the runtime forces `--ozone-platform=x11` and `GDK_BACKEND=x11`.
  Native Wayland is not available and is not promised. Fractional scaling under XWayland is unmeasured.
- Windows runs without the Chromium sandbox whatever the policy (Chromium M138+ needs a broker only a
  Chromium-toolchain binary can create). A renderer compromise there is a user-account compromise. Remote pages stay in
  dedicated webviews with the navigation allowlist; Windows builds must not claim sandboxing.
- Transparent frameless windows (pet, widget, quickbar) are unqualified on Linux CEF (#15718: black window, GPU process
  exit 139 reported in July 2026). A third-party patched CEF binary is a supply-chain decision for the owner, not a
  default; qualify on X11 with a compositor first.
- HTML5 drag and drop (#16131), title-bar drag on X11 (#14936) and hardware WebGPU (#16203) are open upstream defects
  to re-test on CEF 152.
- CEF is heavier than a system webview: about 1 GB of distribution per platform, one extra engine in memory. The
  levers are the idle fix, on-demand windows and Alloy style for auxiliary windows (the last two unmeasured).
- `dbfr` has no GTK 4 development libraries and stays refused for the desktop packages (`desktopSysCrates`:
  `gdk4-sys`, `gtk4-sys`); the VPS builds them with `CEF_PATH=/srv/aphrody-build/cache/cef`.

## Open items

1. Bump CEF 152 to 154 behind the e2e gate.
2. Qualify the transparent windows, drag and drop, and the title-bar drag on a real X11 desktop and on a Wayland
   session (XWayland).
3. Decide the third-party patched CEF binary for transparency on Windows and macOS (owner decision).
4. v1/v2 `migrate` code of `aphrody-tauri-cli` still emits the upstream wry runtime for third-party projects; Aphrody
   apps are never migrated from v2.
5. Re-run `yolo import --check` where the `vendor/*` checkouts exist: the importer cannot run in this tree.
