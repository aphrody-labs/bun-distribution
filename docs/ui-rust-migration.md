<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Généré par `python3 scripts/migration/ui-rust-inventory.py`; ne pas éditer ce tableau à la main. -->
# Inventaire de migration UI vers Rust

Inventaire exhaustif par extension (`.ts`, `.tsx`, `.js`, `.jsx`, `.html`, `.css`) pour les surfaces du lot `uirust-app`, généré depuis l’arbre de travail. Les rôles sont déduits des chemins et restent à confirmer lors de la qualification fonctionnelle.

Fichiers recensés : **286**. `crates/ui/m3` est absent de ce checkout; les consommateurs qui en dépendent restent bloqués jusqu’à réception du socle commun.

| Surface | Fichiers |
| --- | ---: |
| App web | 62 |
| App desktop | 4 |
| Tauri | 115 |
| Packages web | 105 |

| Fichier | Surface | Rôle déduit du chemin | Cible Rust | État |
| --- | --- | --- | --- | --- |
| `apps/web/build.ts` | App web | build frontend | m3/packages/app-ui/build.ts puis constructeur Rust/WASM | relai Bun; build Rust/WASM absent |
| `apps/web/server.ts` | App web | serveur HTTP | crates/web/site + crates/ai/app-server | logique HTTP Rust et tests présents; lanceur Bun encore actif |
| `apps/web/src/arcade/ArcadeGame.tsx` | App web | arcade/ArcadeGame | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/arcade/audio.ts` | App web | arcade/audio | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/arcade/avatar.ts` | App web | arcade/avatar | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/arcade/engine.test.ts` | App web | test ou fixture | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `apps/web/src/arcade/engine.ts` | App web | arcade/engine | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/benchmarks/BenchmarkSuite.tsx` | App web | benchmarks/BenchmarkSuite | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/components/ApiPlayground.tsx` | App web | components/ApiPlayground | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/components/M3Showcase.tsx` | App web | components/M3Showcase | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/components/MultiTargetBridge.tsx` | App web | components/MultiTargetBridge | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/core/codebase-scanner.test.ts` | App web | test ou fixture | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `apps/web/src/core/codebase-scanner.ts` | App web | core/codebase-scanner | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/core/platform.ts` | App web | core/platform | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/core/theme.ts` | App web | core/theme | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/core/types.ts` | App web | core/types | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/docs/DocsHub.tsx` | App web | docs/DocsHub | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/docs/docs-data.ts` | App web | docs/docs-data | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/env.d.ts` | App web | env.d | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/ffi/FFIExplorer.tsx` | App web | ffi/FFIExplorer | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/CommandPalette.tsx` | App web | os/CommandPalette | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/DesktopOS.tsx` | App web | os/DesktopOS | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/Dock.tsx` | App web | os/Dock | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/TopBar.tsx` | App web | os/TopBar | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/WindowFrame.tsx` | App web | os/WindowFrame | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/AlpinePackageManagerApp.tsx` | App web | os/apps/AlpinePackageManagerApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/AphrodyToolsApp.tsx` | App web | os/apps/AphrodyToolsApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/BunReplApp.tsx` | App web | os/apps/BunReplApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/BunshTerminalApp.tsx` | App web | os/apps/BunshTerminalApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/CodexStudioApp.tsx` | App web | os/apps/CodexStudioApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/DiagnosticsApp.tsx` | App web | os/apps/DiagnosticsApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/FilesApp.tsx` | App web | os/apps/FilesApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/KernelMonitorApp.tsx` | App web | os/apps/KernelMonitorApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/M3FusionStudioApp.tsx` | App web | os/apps/M3FusionStudioApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/ProcessesApp.tsx` | App web | os/apps/ProcessesApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/SpacedriveVfsApp.tsx` | App web | os/apps/SpacedriveVfsApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/components/PetCompanion.tsx` | App web | os/components/PetCompanion | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/components/QuickAskBar.tsx` | App web | os/components/QuickAskBar | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/ffi-routes.ts` | App web | os/ffi-routes | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/os-router.ts` | App web | os/os-router | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/public-assets.ts` | App web | os/public-assets | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/server-extensions.ts` | App web | os/server-extensions | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/system-client.ts` | App web | os/system-client | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/system-metrics.ts` | App web | os/system-metrics | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/types.ts` | App web | os/types | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/apps.ts` | App web | os/wasm/apps | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/bun-api.ts` | App web | os/wasm/bun-api | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/bun-wasm.ts` | App web | os/wasm/bun-wasm | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/client.ts` | App web | os/wasm/client | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/fs-worker.ts` | App web | os/wasm/fs-worker | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/protocol.ts` | App web | os/wasm/protocol | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/repl-worker.ts` | App web | os/wasm/repl-worker | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/server-routes.ts` | App web | os/wasm/server-routes | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/styles/main.css` | App web | styles/main | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/templates/TemplatesExplorer.tsx` | App web | templates/TemplatesExplorer | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/templates/templates-data.ts` | App web | templates/templates-data | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/templates/templates-source.test.ts` | App web | test ou fixture | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `apps/web/src/templates/templates-source.ts` | App web | templates/templates-source | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/test/os-endpoints.test.ts` | App web | test ou fixture | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `apps/web/test/public-assets.test.ts` | App web | test ou fixture | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `apps/web/test/webos-extensions.test.ts` | App web | test ou fixture | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `apps/web/webos.ts` | App web | serveur WebOS | fork Bun, packages/bun-webos | transfert signalé par le code; reçu de destination absent |
| `crates/ui/app/examples/shell_e2e/frontend/index.html` | App desktop | fixture UI desktop | crates/ui/m3 + WASM ou hôte CEF | bundle app-ui React actif; remplacement Rust non qualifié |
| `crates/ui/app/ui-dist/app.css` | App desktop | assets UI desktop | crates/ui/m3 + WASM ou hôte CEF | bundle app-ui React actif; remplacement Rust non qualifié |
| `crates/ui/app/ui-dist/app.js` | App desktop | assets UI desktop | crates/ui/m3 + WASM ou hôte CEF | bundle app-ui React actif; remplacement Rust non qualifié |
| `crates/ui/app/ui-dist/index.html` | App desktop | assets UI desktop | crates/ui/m3 + WASM ou hôte CEF | bundle app-ui React actif; remplacement Rust non qualifié |
| `crates/tauri/aphrody-create-tauri-app/templates/_assets_/styles.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-dioxus/assets/styles.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-leptos/index.html` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-leptos/styles.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-sycamore/index.html` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-sycamore/styles.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-vanilla/src/index.html` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-vanilla/src/styles.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-vanilla-ts/build.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-vanilla-ts/index.html` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-vanilla-ts/src/styles.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-yew/index.html` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-yew/styles.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/bundle.global.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/core.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/freeze_prototype.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/init.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/ipc-protocol.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/ipc.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/isolation.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/pattern.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/process-ipc-message-fn.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/src/event/init.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/src/path/init.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/src/webview/scripts/print.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/src/webview/scripts/zoom-hotkey.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/src/window/scripts/drag.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/test/cef-rollback/dist/index.html` | Tauri | test ou fixture Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/test/fixture/dist/index.html` | Tauri | test ou fixture Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/test/fixture/isolation/dist/index.html` | Tauri | test ou fixture Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/test/fixture/isolation/isolation-dist/index.html` | Tauri | test ou fixture Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/test/fixture/isolation/isolation-dist/index.js` | Tauri | test ou fixture Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/app.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/core.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/dpi.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/event.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/global.d.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/image.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu/base.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu/checkMenuItem.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu/iconMenuItem.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu/menu.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu/menuItem.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu/predefinedMenuItem.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu/submenu.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/mocks.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/path.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/tray.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/webview.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/webviewWindow.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/window.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/src/dev/auto-reload.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/index.html` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/src/main.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/src/style.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/src/vite-env.d.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/vite.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/__example-basic/vanilla/public/index.html` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-autostart/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-autostart/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-autostart/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-clipboard-manager/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-clipboard-manager/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-clipboard-manager/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-deep-link/.test-server/server.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-deep-link/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-deep-link/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-deep-link/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-dialog/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-dialog/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-dialog/guest-js/init.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-dialog/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-dialog/src/init-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-fs/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-fs/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-fs/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-global-shortcut/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-global-shortcut/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-global-shortcut/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-log/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-log/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-log/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-notification/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-notification/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-notification/guest-js/init.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-notification/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-notification/src/init-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-opener/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-opener/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-opener/guest-js/init.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-opener/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-opener/src/init-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-os/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-os/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-os/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-os/src/init.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-process/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-process/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-process/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-store/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-store/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-store/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-updater/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-updater/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-updater/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-window-state/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-window-state/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-window-state/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-runtime/src/scripts/toggle-devtools.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-utils/src/pattern/isolation.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/build-js.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `packages/web/agent-browser/src/cdp.ts` | Packages web | agent-browser/src/cdp | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/cli.ts` | Packages web | agent-browser/src/cli | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/client.ts` | Packages web | agent-browser/src/client | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/config.ts` | Packages web | agent-browser/src/config | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/engine.ts` | Packages web | agent-browser/src/engine | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/index.ts` | Packages web | agent-browser/src/index | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/runtime.ts` | Packages web | agent-browser/src/runtime | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/service.ts` | Packages web | agent-browser/src/service | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/tauri.ts` | Packages web | agent-browser/src/tauri | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/test-preload.ts` | Packages web | agent-browser/src/test-preload | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/types.ts` | Packages web | agent-browser/src/types | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/test/agent-browser.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/agent-browser/test/cdp.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/agent-browser/test/engine-lifecycle.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/agent-browser/test/runtime.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/agent-browser/test/server.ts` | Packages web | test ou fixture de package | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/test/service-native.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/agent-browser/test/service.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/agent-browser/test/sync-client.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/agent-browser/test/tauri.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/aphrody-web-test/src/cdp.ts` | Packages web | aphrody-web-test/src/cdp | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/config.ts` | Packages web | aphrody-web-test/src/config | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/diagnostics.ts` | Packages web | aphrody-web-test/src/diagnostics | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/expect.ts` | Packages web | aphrody-web-test/src/expect | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/index.ts` | Packages web | aphrody-web-test/src/index | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/locator.ts` | Packages web | aphrody-web-test/src/locator | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/next/index.ts` | Packages web | aphrody-web-test/src/next/index | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/page.ts` | Packages web | aphrody-web-test/src/page | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/runner.ts` | Packages web | aphrody-web-test/src/runner | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/selectors.ts` | Packages web | aphrody-web-test/src/selectors | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/sites/aphrody-ui.ts` | Packages web | aphrody-web-test/src/sites/aphrody-ui | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/sites/index.ts` | Packages web | aphrody-web-test/src/sites/index | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/sites/rosegriffon.ts` | Packages web | aphrody-web-test/src/sites/rosegriffon | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/test/locator.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/aphrody-web-test/test/next-instant.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/aphrody-web-test/test/setup.ts` | Packages web | test ou fixture de package | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/test/sites.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/fuzzy/scripts/gen-fixtures.ts` | Packages web | fuzzy/scripts/gen-fixtures | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/fuzzy/src/index.ts` | Packages web | fuzzy/src/index | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/fuzzy/test/parity.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/qr/scripts/gen-fixtures.ts` | Packages web | qr/scripts/gen-fixtures | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/qr/src/index.ts` | Packages web | qr/src/index | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/qr/test/parity.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/timeline/src/crawl.ts` | Packages web | timeline/src/crawl | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/graphql.ts` | Packages web | timeline/src/graphql | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/index.ts` | Packages web | timeline/src/index | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/model.ts` | Packages web | timeline/src/model | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/pipeline.ts` | Packages web | timeline/src/pipeline | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/retrieval.ts` | Packages web | timeline/src/retrieval | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/server.ts` | Packages web | timeline/src/server | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/storage.ts` | Packages web | timeline/src/storage | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/training.ts` | Packages web | timeline/src/training | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/test/timeline.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/x/examples/06-stealth-cloudflare.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/08-massive-crawl.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/09-ai-extraction.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/10-massive-google-audit.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/crawl-chromium-developers.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/design-discovery.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/ecommerce-price-monitor.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/massive-google-map.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/reddit-json-crawler.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/showcase/hn-1000-crawler.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/wikipedia-infobox-extractor.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/x-batch.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/xcom-scraper.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/function-tools.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/x/index.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/x/ingest.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/x/purge-tweets.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/x/src/algo.ts` | Packages web | x/src/algo | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/batch.ts` | Packages web | x/src/batch | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/config/catalog.ts` | Packages web | x/src/config/catalog | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/config/query-ids.ts` | Packages web | x/src/config/query-ids | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/config/radar-surface.ts` | Packages web | x/src/config/radar-surface | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/config/x-pro-surface.ts` | Packages web | x/src/config/x-pro-surface | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/config/x-surface.ts` | Packages web | x/src/config/x-surface | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/core/client.ts` | Packages web | x/src/core/client | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/core/error.ts` | Packages web | x/src/core/error | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/core/features.ts` | Packages web | x/src/core/features | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/core/local.ts` | Packages web | x/src/core/local | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/core/parse.ts` | Packages web | x/src/core/parse | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/core/schemas.ts` | Packages web | x/src/core/schemas | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/core/session.ts` | Packages web | x/src/core/session | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/db/archive.ts` | Packages web | x/src/db/archive | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/db/ingest.ts` | Packages web | x/src/db/ingest | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/db/store.ts` | Packages web | x/src/db/store | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/index.ts` | Packages web | x/src/index | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/coverage.ts` | Packages web | x/src/services/coverage | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/crawler.ts` | Packages web | x/src/services/crawler | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/cron.ts` | Packages web | x/src/services/cron | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/media.ts` | Packages web | x/src/services/media | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/news.ts` | Packages web | x/src/services/news | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/premium.ts` | Packages web | x/src/services/premium | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/purge-engine.ts` | Packages web | x/src/services/purge-engine | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/purge-tweets.ts` | Packages web | x/src/services/purge-tweets | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/radar.ts` | Packages web | x/src/services/radar | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/unfollow.ts` | Packages web | x/src/services/unfollow | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/x-pro-deck.ts` | Packages web | x/src/services/x-pro-deck | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/tools/bundle-catalog.ts` | Packages web | x/src/tools/bundle-catalog | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/tools/function-tools.ts` | Packages web | x/src/tools/function-tools | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/tools/web-recon.ts` | Packages web | x/src/tools/web-recon | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/unfollow.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/x/web-recon.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/x/x-native.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |

L’état « migration à planifier » ne signifie pas que le comportement est qualifié. Aucun fichier source n’est supprimé tant que sa parité de routes, interactions, sécurité et accessibilité n’est pas prouvée dans sa cible Rust.

<!-- BEGIN uirust-site inventory -->
## Lot uirust-site : site et serveurs

L'inventaire global est au-dessus; ce bloc détaille les surfaces de ce lot.
Les états décrivent le code constaté et ne valent pas preuve de parité.

| Fichier | Rôle | Cible Rust | État |
| --- | --- | --- | --- |
| `crates/web/site/assets/site.css` | Styles du site Rust | crates/ui/m3 (tokens/styles); servi par crates/web/site | Le serveur Axum existe; rendu/actifs et parité UI restent à qualifier |
| `apps/web/server.ts` | Lanceur HTTP de l'app web | crates/ai/app-server + crates/web/site (Axum) | Déjà un lanceur du serveur Rust; scripts web:dev/start invoquent encore Bun |
| `apps/web/webos.ts` | Relais du serveur WebOS du fork Bun | Fork Bun: packages/bun-webos (propriétaire déclaré dans la source) | Délègue à @aphrody/bun-webos; SHA mentionné dans la source, reçu de transfert absent |
| `apps/web/src/os/ffi-routes.ts` | Routes API FFI | Contrat Axum à définir; préserver le propriétaire runtime/FFI du fork Bun | Handler TS encore présent; parité Axum et retrait non qualifiés |
| `apps/web/src/os/os-router.ts` | Routes OS de démonstration | Contrat Axum à définir après retrait/qualification des simulations WebOS | Handlers simulés seulement; ne pas les publier comme capacités OS réelles |
| `apps/web/src/os/server-extensions.ts` | Composition des routes WebOS/FFI | Contrat Axum à définir; préserver le propriétaire runtime/FFI du fork Bun | Handler TS encore présent; parité Axum et retrait non qualifiés |
| `apps/web/src/os/wasm/server-routes.ts` | Routes bridge fetch/TCP WebOS | Contrat Axum à définir après retrait/qualification des simulations WebOS | Handler TS encore présent; parité Axum et retrait non qualifiés |

<!-- END uirust-site inventory -->
