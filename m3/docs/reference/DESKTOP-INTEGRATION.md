# Desktop integration (`aphrody-app`)

How the Tauri 3 desktop (`crates/ui/app`) integrates with Windows and Linux: installers, updates, "Open with
Aphrody", deep links, tray, loading screen, desktop pet and widget. Code:
`crates/ui/app/src/integration.rs` (native), `packages/m3` (UI surfaces),
`open-requests.ts`, `pet-behavior.ts`. Configuration: `crates/ui/app/tauri.conf.json`
and `crates/ui/app/capabilities/`.

## Plugins

The desktop shell consumes the centralized Tauri 3 line (`tauri = "=3.0.0-alpha.3"`,
`tauri-runtime-wry = "=3.0.0-alpha.3"`, `tauri-plugin-* = "=3.0.0-alpha.2"`).
The root `Cargo.toml` declares the shared dependencies; no upstream source tree
is vendored under `crates/`.

| Plugin | Use |
| --- | --- |
| single-instance (`deep-link` feature) | Registered first. A second launch forwards its files and `aphrody://` URLs to the running instance (`integration::on_second_instance`). |
| deep-link | `plugins.deep-link.desktop.schemes = ["aphrody"]`. Installers register the scheme; Linux and Windows debug runs register it at runtime (`register_all`). |
| autostart | Launches `aphrody --autostart` at login: tray, pet and widget come up, the main window stays hidden. |
| window-state | Restores geometry of `main`, `pet`, `widget` (not `quickbar`, `splash`); visibility is excluded, it is owned by the splash flow and the stored preferences. |
| updater + process | `plugins.updater` is injected at bundle time by `aphrody-ops tauri` (`APHRODY_UPDATER_ENDPOINT`, `APHRODY_UPDATER_PUBKEY`; signing key only in `TAURI_SIGNING_PRIVATE_KEY`). Settings > Application updates checks, downloads, installs and relaunches; the tray "Check for updates" entry reports through a notification. |
| store | `desktop.json`: `pet`, `widget` booleans. |
| fs | Read-only (`read_text_file`, `stat`, `exists`) for the main window, scoped to `$APPDATA`; files handed to Aphrody by the OS are added to the scope at runtime. |
| opener | `openExternal()` in `tauri-bridge.ts` (`opener:default`: http(s), mailto). |
| notification, dialog, clipboard-manager, os, global-shortcut, log | Unchanged; see `capabilities/main.json`. |
| tray (core, `tray-icon` feature) | Open Aphrody, Quick ask, Desktop pet, Desktop widget, Start with the system, Check for updates, Quit. Left click opens the main window. |

Closing the main window hides it (the tray keeps Aphrody running); "Quit Aphrody" exits.

## Windows

| Label | View | Traits |
| --- | --- | --- |
| `main` | `index.html` | Hidden at start; shown by `aphrody_app_ready` once the shell has rendered. |
| `splash` | `?view=splash` | Transparent, frameless, always on top. Animated pet (`waving`). Closed on ready, or after 30 s (the main window is then shown anyway). Skipped when started with `--autostart`. |
| `pet` | `?view=pet` | Transparent, frameless, always on top, skip taskbar. See below. |
| `widget` | `?view=widget` | Transparent, frameless, always on bottom, skip taskbar. Clock and Open / Ask / Pet. |
| `quickbar` | `?view=quickbar` | Existing Alt+Space bar. |

`splash`, `pet` and `widget` share the `desktop-surfaces-capability` (core events, OS type and
hostname, log). Their native actions go through label-checked commands: `aphrody_pet`
(`hit_rect`, `step`, `start_dragging`, `open_main`, `hide`) and `aphrody_widget` (`open_main`,
`quick_ask`, `toggle_pet`, `start_dragging`, `hide`). The main window uses
`aphrody_desktop_integration` (`state`, `set_pet`, `set_widget`, `set_autostart`) from
Settings > Desktop integration.

## Desktop pet

- Sprite: `AphrodyPet` and the single atlas from `@aphrody/identity` (no copied assets).
- Click-through except the sprite: the UI reports the sprite rectangle (`hit_rect`); a native
  poller (40 ms) toggles `set_ignore_cursor_events` depending on whether the pointer is inside it.
- Gaze: the same poller emits `aphrody://pet/cursor` (logical, window-relative); while idle the
  pet shows the `gazeFrame` of the 16-way direction ring within 360 px.
- Idle 8 to 20 s, then strolls 2 to 5 s (`running-left` / `running-right`), clamped to the
  monitor work area; hovering waves.
- Left click focuses the main window, drag moves the window (`start_dragging`), right click hides
  the pet (persisted).

## Open with Aphrody and deep links

- `bundle.fileAssociations`: `.aphrody` (owner, `application/x-aphrody`); `.md`/`.markdown`,
  `.txt`/`.log`, `.json` as alternate viewers. NSIS writes the "Open with" registry entries; the
  Linux `.desktop` gets `MimeType=` (associations plus `x-scheme-handler/aphrody`).
- `crates/ui/app/linux/aphrody.desktop` is the deb desktop template: identical to the
  bundler default plus `Exec=... %U`, without which Linux would not pass files or URLs.
- Native side: arguments of the first launch and of second launches are classified
  (`classify_args`: `aphrody:` URLs, existing files, flags ignored), queued, and the main window
  is notified with `aphrody://open`; it drains the queue with `aphrody_take_open_requests`.
- Links: `aphrody://ask?q=<prompt>` prefills the composer, `aphrody://thread/<id>` resumes a
  thread, `aphrody://<pane>` (`settings`, `drive`, `models`, ...) opens a pane; anything else is
  ignored. Files prefill the composer with a prompt that names their paths.

## Installers

`bun aphrody-ops tauri bundle` (NSIS on Windows, deb + AppImage on Linux):

- NSIS: per-user install (`currentUser`, no elevation), Start menu folder `Aphrody`, installer
  and uninstaller icon `icons/icon.ico`, English and French, LZMA; WebView2 through the silent
  download bootstrapper.
- deb: runtime `depends` (WebKitGTK 4.1, Ayatana AppIndicator for the tray, librsvg, OpenSSL 3)
  and the desktop template above. AppImage is built from the same tree.
- The `aphrody` CLI ships as the sidecar `binaries/aphrody-<triple>` (`externalBin` in
  `tauri.drive.conf.json`), staged by `aphrody-ops tauri` from `../aphrody-ai` (`--locked`) or
  `APHRODY_SIDECAR_SOURCE`. `broker.rs` prefers it over `PATH`; `APHRODY_BIN` overrides both.
- Windows MSVC builds link the C runtime statically (`+crt-static` in `.cargo/config.toml`), so no
  VC++ redistributable is needed.
- The auto-update feed does not exist yet: `aphrody-infra` has no desktop update route and no
  minisign key pair is published, so `check` reports the missing endpoint as an error.

## Runtime

- `aphrody app-server` and every model server it starts run in a kill-on-close process group
  (`aphrody-proc::spawn_group`: Job Object on Windows, process group on Unix).
- Model downloads run in the CLI (`aphrody model pull`: resumable `.part`, SHA-256), never in the
  webview; progress is relayed as `aphrody://model-pull`. The models folder chosen at onboarding
  is passed to every `aphrody` child as `APHRODY_MODELS_DIR`.
- Preferences and theme persist through the `store` plugin (`preferences.json`).

## Pitfalls

- A plain `cargo build --release` without the `custom-protocol` feature loads `devUrl`
  (`localhost:1421`) and shows an unreachable page. Use `bun run desktop:build`, or pass
  `--features custom-protocol` to plain cargo release builds so the bundled `ui-dist` is served.
- Code written for Vite (`import.meta.glob`, query-suffix imports) crashes the Bun-bundled UI at
  load and leaves a black window.
- Windows declared in `tauri.conf.json` (`splash`, `pet`, `widget`, `quickbar`) can invoke
  commands before `setup` has called `manage()`; a `state()` call then panics and aborts the
  process on Windows. Manage state before any window can call in.
- Green unit tests do not prove the app renders. To verify, launch the built executable with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`, check every webview
  over CDP (non-empty body, no `Runtime.exceptionThrown`) and keep the process alive for 60 s.
  Process liveness alone proves nothing.
- Window and tray icons set from Rust must be embedded (`include_image!`,
  `Image::from_bytes`), not read from `CARGO_MANIFEST_DIR`, which does not exist once installed.
