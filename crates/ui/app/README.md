<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-app — Aphrody Tauri desktop host

`aphrody-app` is the Tauri 3 (`tauri-runtime-wry`) shell in the root Aphrody OS Cargo workspace.
It owns the native main window, a local app-server broker, the local kernel
subsystems and the desktop-only Drive bridge. The agent remains out of process:
the broker starts `aphrody app-server` and speaks JSON-RPC over stdio.

The trusted main window's core commands include:

| Command | Returns | Use |
|---|---|---|
| `aphrody_meta()` | `{ app_version, target_os, target_arch, family }` | header / about info |
| `aphrody_rpc(request)` | JSON-RPC result | app-server sessions, turns and interruption |
| `aphrody_shell_window(action)` | native window state | main-only window controls and navigation |

Shenron's public, read-only grounded chat is available in the existing Chat
surface with `/shenron <question>`. Its typed `aphrody_shenron_chat` command calls
only `https://dragonballfr.com/api/chat`; it accepts no arbitrary URL or token.
It does not represent an authenticated Shenron account or grant admin access.
See [`../../docs/integrations/SHENRON.md`](../../../docs/reference/ui/integrations/SHENRON.md)
for the API, FFI, auth, and database ownership decisions.

The main window also exposes `koharu_rpc(method, params)`. The Koharu engine is
directly linked in-process via `koharu-library`, eliminating subprocess overhead,
stdio serialization, and external sidecar requirements. It dispatches commands
directly in-process and emits live engine events as `koharu://event`. Both the editor
and the Aphrody desktop shell share the unified Tauri 3 line (pinned `=3.0.0-alpha.3`),
providing full M3 theming and zero-subprocess performance.


The shell command takes its invoking `WebviewWindow`, accepts no target label and
rejects every label except `main`. Remote Wry previews have no capability and
cannot control desktop windows.

## Canonical runtime layout

`aphrody_runtime_layout` is the only desktop layout resolver. It materializes
Tauri's platform-specific application directories and exposes these child
directories under `app_data_dir`: `profiles/`, `assets/`, `binaries/` and
`sqlite/`. The UI, kernel clients, Bun packages and uv clients must use this
contract instead of creating `.aphrody`, repository-local databases or ad-hoc
sidecar directories. Tauri's `resource_dir` remains read-only packaged input;
runtime state is never written into the repository or bundle.

Existing SQLite databases and non-regenerable assets require an explicit,
checksum-preserving migration into this layout. The resolver intentionally does
not copy or delete them during startup.

## Runtime boundary

| Surface | Owner | Contract |
|---|---|---|
| Agent sessions | `aphrody app-server` | broker-managed stdio JSON-RPC |
| Web tools | Aphrody kernel | `aphrody_web` Obscura/provider subsystem |
| Web retrieval and crawl | Aphrody kernel / Obscura | backend capability; no embedded browser or crawler-management view in the public webview |
| File libraries | `aphrody-drive` + `sd-daemon` | local socket; daemon stays outside this Cargo graph |

## Capability surface (default-deny)

`capabilities/main.json` is v2 default-deny: it grants only window and application
integration permissions to `main`; it grants no generic filesystem, shell execution,
HTTP or database plugin.
Domain routes use typed Rust commands or the local kernel/Drive RPC boundary; the
webview is not a general system API. The window loads only first-party assets.

Plugin rationale: `docs/tauri/plugins.md`. Integration design:
`docs/tauri/aphrody-integration.md`.

## Build, run and package on Windows

`../../packages/ui/app-ui/` is the sole frontend source package. Bun builds it to ignored
`ui-dist/` before Tauri packages the Wry shell. It reuses the canonical
`@aphrody/m3-theme/spaceui.css`, `@aphrody/m3-ai` and
`@aphrody/m3-primitives` surfaces. Material Symbols are copied from the one
local canonical font during this build.

`ui-dist/index.html`, `app.js`, `app.css` and the SVGs under `ui-dist/fonts/` are committed.
The binary assets of `ui-dist/fonts/` (webfonts, file-kind icons, sounds) are not: `build.rs`
copies them from their single canonical packages (`packages/ui/m3-fonts`,
`crates/ui/bun/icons/material-symbols`, `packages/ui/assets`) into `ui-dist/fonts/` before
`tauri::generate_context!()` embeds the directory, as listed in `ui-dist.manifest`. A clean
clone therefore builds with no staging command; `cargo test -p aphrody-app --test
ui_dist_assets` checks that every listed file is staged byte-for-byte and that every font
`app.css` loads is present. The shipped configuration (`--features custom-protocol`) fails the
build if a source is missing; a plain `cargo check` only warns.

The desktop build helper prefers the OS-owned FSL workspace at
`crates/os/drive/Cargo.toml` (or `APHRODY_DRIVE_WORKSPACE`) and falls back to
the retained UI Drive workspace for standalone checkouts. It stages the daemon
as a target-suffixed Tauri `externalBin` and copies it beside the unbundled executable
for `run` and `dev`. The shipped Drive UI uses the existing explorer, search, sidebar, tabs and
file actions through `aphrody-drive`; React Native/iOS/Android are outside this product target.

```pwsh
bun install --frozen-lockfile
bun run --cwd packages/ui/app-ui build
pwsh scripts/tauri.ps1 -Action check
pwsh scripts/tauri.ps1 -Action run
pwsh scripts/tauri.ps1 -Action bundle         # Windows: NSIS setup executable
pwsh scripts/tauri.ps1 -Action bundle -Bundles msi
```

On Linux, use `bash scripts/tauri.sh check|build|run|dev|bundle`. Both helpers require the
Drive Cargo graph and the OS Cargo graph to compile on the host. They fail when the daemon
cannot be built, instead of delivering a desktop bundle with an empty Drive view.

The PowerShell helper clears any user-level Rust compiler wrapper. The Tauri
package command executes the same frontend build and does not load a CDN.
