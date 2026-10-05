<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody on `tauri-runtime-cef`: native and fast desktop app — research, 2026-10-05

Scope: the single desktop runtime of plan decision 21 (CEF + `tauri-winit` + GTK4; wry, tao and the GTK3
stack removed). Read on 2026-10-05: upstream `tauri-apps/tauri` branch `v3`, its issues, crates.io, the CEF and
Chromium documentation, the vendored runtime in this checkout
([`crates/tauri/aphrody-tauri-runtime-cef`](../../../crates/tauri/aphrody-tauri-runtime-cef), 3.0.0-alpha.5) and
two third-party measurements (macOS only). Tags: **V** verified today in a primary source or in this tree,
**T** third-party report, **U** hypothesis to measure. Nothing here was measured on Aphrody; section 6 defines
the measurement that turns these claims into evidence.

## Verdict

1. The runtime is an alpha (alpha.5, 2026-10-01, CEF 152.3.0). Its Linux target has open defects that cost CPU,
   first-frame quality and native behaviour (section 2); they are neutralised locally before any performance
   claim is made.
2. Biggest known win: Chromium's GLib work source keeps the main thread at 100% of a core while idle (#16189). The
   reporter's patch took the whole process tree from about 105% to about 3% of a core idle (T). It is not merged
   upstream and not in the vendored copy.
3. "Native" on Linux means GTK4 windows over X11/XWayland: the runtime forces `--ozone-platform=x11` and
   `GDK_BACKEND=x11` (V). Native Wayland is not available. Desktop integration stays GTK-free: ksni tray, XDG-portal
   dialogs.
4. Every remaining GTK3 edge goes with wry/tao: the dialog plugin default, the `gtk3` feature of `aphrody-tauri`,
   the `webkit2gtk`/`cairo-rs 0.18`/`gio 0.18` dependencies of `tauri-plugin-mcp-bridge`, libappindicator.
5. CEF is heavier than a system webview (T, macOS arm64: idle RSS 663-751 MiB against 352.6 MiB, expanded bundle
   341.9 MiB against a 20.1 MiB executable). The idle fix, on-demand windows and Alloy style for auxiliary windows
   are the levers (the last two U); the base cost of a second engine is not removable.
6. Windows has no Chromium sandbox in this runtime whatever the policy (V): a renderer compromise there is a user
   account compromise. `cef` is pinned `=152.3.0` while crates.io has 154.4.0 (V): plan the bump.

## 1. How the runtime works (V)

| Topic | Fact | Where |
| --- | --- | --- |
| Entry | Tauri 3 has no default runtime: `Builder::runtime(Cef::default())` and `#[tauri_runtime_cef::cef_entry_point]` on `main`. Before this migration the app passes `tauri_runtime_wry::Wry` | `crates/ui/app/src/lib.rs`, `crates/ui/app/src/runtime_host.rs` |
| Windowing | `tauri-winit` 0.31.0-beta.3 (fork `tauri-apps/winit-gtk4`), event loop built with GTK4 | `crates/tauri/aphrody-tauri-runtime-cef/src/runtime.rs` |
| Display | on Linux/BSD `--ozone-platform=x11` for every process type and `GDK_BACKEND=x11`: CEF child windows use XIDs, so a Wayland session runs through XWayland | same file, "Force X11 usage on Linux" |
| Event pump | `external_message_pump: 1`; on Linux the pump is a GSource | `crates/tauri/aphrody-tauri-runtime-cef/src/external_message_pump/linux.rs` |
| Sandbox | `SandboxPolicy::{Auto, Required, Disabled}`. Windows is unsandboxed whatever the policy (Chromium M138+ needs a broker only a Chromium-toolchain binary can create). `Auto` drops it for an AppImage on a system with neither the setuid helper nor usable user namespaces; `Required` refuses to start | `runtime.rs` |
| DevTools protocol | `RemoteDebugging::Disabled` by default and pinned off by preference. `Port` has no authentication and is reachable by every local process; `Pipe` only by the launcher | `runtime.rs` |
| Style | per-webview `browser_runtime_style(Alloy \| Chrome)`; unset means CEF's default | `crates/tauri/aphrody-tauri-runtime-cef/src/tauri_ext.rs`, `webview.rs` |
| Linux bundle | deb/rpm ship stripped `libcef.so` (1.5 GB unstripped), `icudtl.dat`, `v8_context_snapshot.bin`, three `.pak`, `libEGL.so`, `libGLESv2.so`, the SwiftShader/Vulkan loader files, a setuid `chrome-sandbox`, and **only the `en-US` locale paks** | `crates/tauri/aphrody-tauri-bundler/src/bundle/linux/rpm.rs`, `debian.rs`, `appimage/sharun_cef.rs` |
| CEF binaries | about 1 GB per platform, downloaded once to the user cache or taken from `CEF_PATH` | `crates/tauri/aphrody-tauri-cli/src/runtime/cef.rs` |

## 2. Open upstream defects that cost performance or native behaviour on Linux

State read from the GitHub API on 2026-10-05. The last commit of `v3` touching the CEF crate is the alpha.5
version bump (2026-10-01): none of these was fixed after the release.

| Issue | Effect | Local action |
| --- | --- | --- |
| [#16189](https://github.com/tauri-apps/tauri/issues/16189) open | Idle main thread at 100% of a core: Chromium's `MessagePumpGlib` work source returns timeout 0 under `external_message_pump`, so every blocking `g_main_context_iteration` returns at once. Reporter (T): 382,080 `ppoll` with timeout 0 in about 20 s against 2,452 patched; process tree 105% to 3% idle, 125% to 21% during a 1080p30 screen share | Apply the reporter's patch (three hunks: destroy the Chromium work source in the Linux pump, re-export it, call it after the signal restore that follows CEF initialisation). Record provenance in `config/upstream-sources.json`; drop it when upstream merges. Gate: idle CPU and `ppoll` count |
| [#16205](https://github.com/tauri-apps/tauri/issues/16205) open | `visible(false)` is ignored at creation: the window maps and shows a blank canvas until first paint. `hide()` right after build makes CEF flag the browser hidden, which throttles rendering and stalls the page load. Reporter's workaround: create at (-32000, -32000), then a synchronous `XMoveWindow` after build | The splash flow and `tauri_plugin_window_state` (VISIBLE excluded) rely on hidden creation: add one helper in `crates/ui/app` and make sure the state restore does not undo the parking move. Do not hide windows that must keep loading |
| [#15718](https://github.com/tauri-apps/tauri/issues/15718) open | `transparent: true` gives a black window and GPU process exit 139 on Linux (July 2026). A maintainer says macOS/Windows transparency needs a CrabNebula-patched CEF build (`CEF_DOWNLOAD_URL`) and that Linux is unconfirmed | The pet, widget and quickbar windows are transparent, frameless and always-on-top (`crates/ui/app/src/integration.rs`, `quickbar.rs`). Qualify them on Linux/X11 with a compositor first. A patched third-party CEF is a supply-chain decision (pin and checksum), not a default |
| [#16131](https://github.com/tauri-apps/tauri/issues/16131) open | HTML5 drag and drop does not work on Linux CEF | Test file drops on the main window (open file/folder flows) |
| [#14936](https://github.com/tauri-apps/tauri/issues/14936) open | Crash when dragging a `data-tauri-drag-region` toolbar on X11 (CEF 144, February; `BadWindow` in `X_QueryPointer`) | Re-test custom title bars on CEF 152 (U: may be stale) |
| [#16203](https://github.com/tauri-apps/tauri/issues/16203) open | No hardware WebGPU adapter on Linux (none or SwiftShader) while WebGL2 is hardware; the GPU process is a zygote fork that does not receive the browser-process switches | Matters only if the UI uses WebGPU; check GPU status through CDP `SystemInfo.getInfo` in qualification |
| [#16204](https://github.com/tauri-apps/tauri/issues/16204) open | `tauri build --bundles appimage` fails: the bundler downloads `quick-sharun.sh` from a fork whose helper sources were deleted upstream (404) | Ship deb/rpm: they carry the setuid `chrome-sandbox`, so the sandbox stays on |
| [#15764](https://github.com/tauri-apps/tauri/issues/15764), [#15190](https://github.com/tauri-apps/tauri/issues/15190), [#16025](https://github.com/tauri-apps/tauri/issues/16025) open | IPC degrades after DevTools opens; IPC fails for `WebviewUrl::External` (no `Origin`); `requestFullscreen()` does not fullscreen the native window | Compatible with the rule that remote pages get no host IPC; do not build on them |

## 3. Native Linux integration and GTK3 removal

- Tray: `ksni` (pure D-Bus StatusNotifierItem) is the default backend of `aphrody-tauri` (`tray-icon` feature);
  never enable `linux-libappindicator` (GTK3) (V).
- Menus: `muda/gtk4` through the `gtk4` feature of `aphrody-tauri` (V).
- File dialogs: `tauri-plugin-dialog` defaults to `gtk3` (`rfd/gtk3`). Use `default-features = false` with
  `xdg-portal`: the chooser is then the desktop's own and GTK3 stays out (V manifest; behaviour U, test GNOME and
  KDE).
- Lock analysis before the migration (V, `Cargo.lock` 2026-10-05): `gtk 0.18.2` is reached through
  `aphrody-tao`, `aphrody-wry`, `aphrody-tauri-runtime-wry` (the only crate enabling the `gtk3` feature of
  `aphrody-tauri`), the `tray-icon`/`muda` edges of `aphrody-tauri`, and `webkit2gtk =2.0.2` with `cairo-rs 0.18`
  and `gio 0.18` direct in `tauri-plugin-mcp-bridge` (Linux native screenshot). The bridge needs a CDP backend
  (`Page.captureScreenshot`) on CEF. Acceptance: `cargo tree -i gtk@0.18.2 --target x86_64-unknown-linux-gnu`
  finds nothing, on the VPS.
- `tune_linux_display` in `crates/ui/app/src/runtime_host.rs` sets `WEBKIT_DISABLE_DMABUF_RENDERER` (WebKitGTK only,
  dead under CEF) and `__NV_DISABLE_EXPLICIT_SYNC`; remove the first, re-test the second under XWayland.
- Wayland: XWayland only. Fractional scaling and per-monitor behaviour under XWayland are U; measure on a
  Wayland session. CEF itself warns that `--ozone-platform=wayland` is not compatible with Vulkan (T, #16203).

## 4. `Cef` profile for the app

Defaults and advice are quoted from the doc comments of the vendored `Cef` builder (V).

| Setting | Value | Reason |
| --- | --- | --- |
| `sandbox` | keep `Auto`; treat the "sandbox lost" warning as a QA signal | `Required` refuses to start where no sandbox is possible (always on Windows) |
| `remote_debugging` | `Disabled` in production; `Pipe` (harness is the parent) or loopback `Port` in e2e builds only | `Port` is unauthenticated and visible to every local process |
| `component_updates` | keep on | feeds revocation sets, Certificate Transparency list and download policies; off only without a route to the updater |
| `safe_browsing` | keep on | showcase windows load remote pages |
| `spell_checking` | off only where no editable field exists | on, the first use downloads a dictionary from `redirector.gvt1.com` |
| `locale` | leave unset until `fr` paks ship in the bundle | only `en-US` paks are bundled; another locale breaks Chromium's own strings |
| `accept_language_list` | `fr-FR,fr,en-US,en` | independent of `locale`; sets `Accept-Language` and `navigator.language` |
| `javascript_flags`, `enable_features`, `disable_features` | use the setters | a raw `--js-flags`, `--enable-features` or `--disable-features` replaces CEF's own list |
| `browser_runtime_style` | measure Alloy against Chrome per window kind | CEF presents Alloy style as the lightweight one ([cef#3681](https://github.com/chromiumembedded/cef/issues/3681)); the memory and startup delta is U |
| `persist_session_cookies` | on only if sign-in must survive restarts | cookies then sit in the cache directory |

French Chromium strings (context menus, form validation, error pages) need the `fr` paks (and gender variants)
in the bundler file lists of `rpm.rs`, `debian.rs` and `sharun_cef.rs`; that is a local bundler change (U that
`fr.pak` alone suffices).

## 5. GPU, media and size

- Compositing and WebGL2 are hardware on Intel/Mesa under the runtime (T, #16203). Add a GPU status check
  (`SystemInfo.getInfo` over CDP) to qualification so a silent fall back to software is caught.
- VA-API video is not supported by Chromium on Linux but can be enabled
  ([Chromium doc](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/vaapi.md), V): features
  `AcceleratedVideoDecodeLinuxGL`, `AcceleratedVideoDecodeLinuxZeroCopyGL`, `AcceleratedVideoEncoder`, optionally
  `--ignore-gpu-blocklist`; verify with `vainfo`, `chrome://gpu` and media-internals (`GpuVideoDecoder`); H.264
  needs a build with proprietary codecs (U for the shipped CEF). Off by default; effect U.
- Size: libcef is the cost (1.5 GB unstripped; the bundler strips it and fails if strip fails). Third-party macOS
  figures (T): expanded bundle 341.90 MiB; macOS x64 DMG 172,566,901 bytes and bundle tree 571,753,199 bytes. No
  Linux figure exists yet. cef-rs' `bundle-cef-app --release` shrinks cef-rs sample bundles; Tauri's bundler has
  its own file list and strip, so it does not apply here.
- Build: share one CEF distribution through `export-cef-dir` and `CEF_PATH` so each build does not extract the same
  files again ([cef-rs README](https://github.com/tauri-apps/cef-rs)); on the VPS keep it beside the sccache.

## 6. Footprint reference and measurement protocol

Third-party reference (T, macOS arm64 26.6.2, Tauri 3 alpha.0 CEF against Tauri 2 WebKit,
[ai-mission-manager#135](https://github.com/pierophp/ai-mission-manager/issues/135)): RSS summed over six processes
(browser, GPU, two utility, two renderers) 751.0 MiB at start and 663.0 MiB at 60-70 s, against 352.6 MiB; a
separate footprint reading gave 301.1 MiB; the report notes the summed RSS overstates exclusive memory and found no
RAM advantage over Electron. Linux was not measured. A second migration report
([gitru#133](https://github.com/ruru-m07/gitru/pull/133)) hit the AppImage `locales` directory, nondeterministic
macOS CDP disconnects and eight nested `@tauri-apps/api@2.11.1` copies.

Protocol for the migration batch: same machine, same page set and window layout, the wry build at the pre-migration
commit against the CEF build, five runs each, median and range, on a Linux X11 desktop (WSLg is a valid smoke target
for X11 behaviour, not for GPU or memory figures).

| Metric | Method |
| --- | --- |
| Idle CPU | sum of `utime+stime` of the process tree and of the main thread over 60 s from `/proc` (the #16189 method), plus `ppoll` count |
| Memory | sum of `Pss` from `/proc/<pid>/smaps_rollup` over the tree (RSS double counts shared pages), at start and at 60 s, for one window and for every window open |
| First paint | process start to first contentful paint (`performance.getEntriesByType('paint')`) and to window map |
| Size | bytes of the deb/rpm and of the installed tree |
| Build | cold and warm wall time on the VPS with `CEF_PATH` populated |

Record the numbers in `MEMORY.md`, not in this note.

## 7. Version and security

- `cef =152.3.0` (CEF 152.0.6, Chromium 152.0.7977.83) is an exact pin of `tauri-runtime-cef` alpha.5; crates.io has
  `cef` 154.4.0+154.0.33 (2026-10-03), four 154.x releases in eight days; `tauri-winit` is 0.31.0-beta.3. The last
  CEF bump on `v3` is 2026-09-14 and no upstream bump beyond 152.3.0 was found on 2026-10-05 (V).
- Chromium ships security fixes with each milestone; an old pin ages. Carry a bump through the vendor pipeline only
  with the e2e suite (Playwright over CDP; there is no WebDriver on CEF, so `tauri-driver` has no role) green.
- Windows runs unsandboxed (V). Keep remote pages in dedicated webviews with the navigation allowlist already used
  by the showcase and runtime-host windows, and do not claim sandboxing for Windows builds.

## 8. Ordered work for the migration batch

1. Switch `aphrody-app` and the runtime host to `Cef::default()` with the section 4 profile; remove wry, tao,
   `tauri-runtime-wry`, `gtk3`, libappindicator, the dialog `gtk3` default and the mcp-bridge WebKit backend
   (acceptance: section 3 `cargo tree`).
2. Apply the #16189 patch; gate on idle CPU.
3. Hidden-window helper (#16205) and splash flow; then qualify transparent windows (#15718), drag and drop
   (#16131) and title-bar drag (#14936) on Linux/X11.
4. Dialogs through `xdg-portal`; mcp-bridge screenshot through CDP.
5. Ship deb/rpm; decide the `fr` locale paks.
6. Run the section 6 measurement before and after; write the numbers to `MEMORY.md`.
7. Plan the 154 bump behind the e2e gate.

## 9. Limits of the evidence

The runtime is an alpha and issue states change daily. The reporter's patch and every workaround were read, not
compiled or run here: this host is WSL2 with no desktop GPU session and heavy Cargo stays on the VPS. All memory and
size figures are third-party macOS figures. Items tagged U are hypotheses until section 6 is run.

## Sources

- Upstream runtime: <https://github.com/tauri-apps/tauri/tree/v3/crates/tauri-runtime-cef>; release
  `tauri-runtime-cef-v3.0.0-alpha.5` (2026-10-01); winit-gtk4 migration
  [PR #15787](https://github.com/tauri-apps/tauri/pull/15787).
- Issues: #16189, #16205, #15718, #16131, #14936, #16203, #16204, #15764, #15190, #16025 on
  `github.com/tauri-apps/tauri/issues/<number>`.
- crates.io: <https://crates.io/crates/cef>, <https://crates.io/crates/tauri-runtime-cef>,
  <https://crates.io/crates/tauri-winit>.
- CEF: [#3681 lightweight Alloy-style browsers](https://github.com/chromiumembedded/cef/issues/3681),
  [#3685 Alloy bootstrap removal](https://github.com/chromiumembedded/cef/issues/3685).
- Chromium VA-API: <https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/vaapi.md>.
- Related notes: [Tauri debugging survey](tauri-debugging-survey-2026-10-01.md).
