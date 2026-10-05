# Tauri 3 au 5 octobre 2026 : état amont et effets sur le plan de fusion

Recherche en lecture seule faite le 2026-10-05. Toutes les URL ci-dessous ont été consultées à cette date. Méthode : API GitHub via `aphrody git api` (et `aphrody git graphql` pour les discussions), sources de la documentation (`tauri-apps/tauri-docs`, branche `v3`) et page en ligne v3.tauri.app, API crates.io, lecture des crates importées dans `/home/aphro/aphrody/crates/tauri/*`. Aucun fichier du dépôt n'a été modifié.

Légende : **[F]** fait vérifié, avec sa source · **[D]** déduction ou recommandation.

---

## 1. Releases et changelogs de la v3 [F]

### 1.1 Calendrier des alphas

| Release | Date (UTC) | Commit | Crates publiées |
| --- | --- | --- | --- |
| `tauri-v3.0.0-alpha.0` | 2026-09-12/13 | `c4a167b8` (runtime/utils/bundler sur `d5d62f1e`) | tauri, runtime, runtime-wry, runtime-cef, utils, build, codegen, macros, plugin, bundler, cli, `@tauri-apps/api` |
| `alpha.1` | 2026-09-15 | `f44d1114` | tauri, runtime-wry, runtime-cef, cli |
| `alpha.2` | 2026-09-21 | `9c4f482d` | toutes |
| `alpha.3` | 2026-09-26 | `d05973d4` | toutes |
| `alpha.4` | 2026-10-01 | `a8703ee4` (tête actuelle de `v3`) | tauri a.4, runtime a.3, runtime-wry a.4, runtime-cef a.5, utils a.3, cli a.4 |

- Cinq alphas en 19 jours, environ une par semaine. Sur crates.io : `tauri` 3.0.0-alpha.4, `tauri-runtime` 3.0.0-alpha.3, `tauri-runtime-wry` 3.0.0-alpha.4, `tauri-runtime-cef` 3.0.0-alpha.5, `tauri-utils` 3.0.0-alpha.3. La ligne stable 2.x continue en parallèle : 2.12.0 le 26 septembre, 2.12.1 le 30. wry est à 0.57.0 (8 septembre) et tao à 0.37.1 (26 septembre). Sources : [releases](https://github.com/tauri-apps/tauri/releases), [crates.io/tauri](https://crates.io/crates/tauri), [crates.io/tao](https://crates.io/crates/tao), [crates.io/wry](https://crates.io/crates/wry).
- Tous les fichiers `.changes/` de la branche `v3` (71) sont déjà consommés par `pre.json` (tag `alpha`) : aucun changement documenté n'attend une publication. Source : [.changes/pre.json@v3](https://github.com/tauri-apps/tauri/blob/v3/.changes/pre.json).
- Divergence des branches : `v3` a 467 commits d'avance sur `dev` (2.x) et 2 de retard (`61285f6f` doctests tauri-utils, `79d35376` relance macOS via LaunchServices). `v3` réintègre `dev` régulièrement (« Pull changes from Tauri 2.12 release »). Source : [compare dev...v3](https://github.com/tauri-apps/tauri/compare/dev...v3).

### 1.2 Ruptures v2 → v3, par crate

Sources : CHANGELOG de la branche `v3` pour [tauri](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri/CHANGELOG.md), [tauri-runtime](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri-runtime/CHANGELOG.md), [tauri-runtime-wry](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri-runtime-wry/CHANGELOG.md), [tauri-utils](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri-utils/CHANGELOG.md), [tauri-runtime-cef](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri-runtime-cef/CHANGELOG.md), [tauri-build](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri-build/CHANGELOG.md), [tauri-bundler](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri-bundler/CHANGELOG.md), [tauri-plugin](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri-plugin/CHANGELOG.md) et [tauri-cli](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri-cli/CHANGELOG.md).

**Runtime découplé** (PR [#15985](https://github.com/tauri-apps/tauri/pull/15985), fusionnée le 6 septembre dans `feat/cef` puis dans `v3`, `1e5ba7b5`)
- `tauri` ne dépend plus de `tauri-runtime-wry` ni de `tauri-runtime-cef`. Les features `wry`, `cef`, `x11`, `dbus` et `macos-proxy` de `tauri` sont supprimées.
- L'application choisit son runtime avec `tauri::Builder::default().runtime(tauri_runtime_wry::Wry::default())`. Sans runtime, la construction échoue avec `RuntimeNotConfigured`.
- `Builder::default()` utilise le runtime à effacement de type `tauri::DynRuntime`, qui devient aussi le `R` par défaut de `AppHandle`, `Window` et `Webview`. La répartition statique reste possible avec `Builder::<WryRuntime>::new()`. `runtime_init_attrs` est fusionné dans `runtime`.
- Les API propres à un runtime passent dans des traits d'extension des crates de runtime : `tauri_runtime_wry::{AppHandleWryExt, AppWryExt, WebviewWryExt, WebviewWindowBuilderWryExt, WebviewBuilderWryExt}` et `tauri_runtime_cef::{WebviewCefExt, …}`. Ils sont implémentés pour le runtime concret et pour `DynRuntime` (erreur `RuntimeTypeMismatch` sur un autre runtime). **Conséquence : les crates de runtime dépendent désormais de `tauri`.**
- `tauri::tao` et `tauri::wry` sont supprimés ; il faut passer par `tauri_runtime_wry::{tao, wry}`. `PlatformWebview::downcast_ref` est ajouté. `tauri::webview_version()` devient `App::webview_version` / `AppHandle::webview_version`.
- `Wry<T>` est renommé `WryRuntime<T>` ; `Wry` devient le type d'attributs qui sélectionne le runtime. `WebviewAttribute` est remplacé par `WryWebviewAttributes`.
- `android_binding!` passe dans `tauri_runtime_wry`.

**`tauri-runtime`** (traits)
- Nouveau module `dynamic` (`DynRuntime`, `DynWebview`, `DynWindowOpener`, `DynRuntimeInitAttrs`).
- `RuntimeSpecificInitAttrs` est renommé `RuntimeInitAttrs` : il est générique sur l'événement utilisateur, a un type associé `type Runtime`, et l'implémentation pour `()` est supprimée. Il faut `impl From<Self> for DynRuntimeInitAttrs`.
- `Runtime::WindowOpener` et `WindowBuilderBase` doivent être `'static`.
- `custom_scheme_url` passe sur `RuntimeHandle::custom_scheme_url(&self, scheme, https)` : c'est le runtime qui définit le format d'URL du schéma (`tauri://localhost` ou `http://tauri.localhost`), et `convertFileSrc` le suit.
- `RuntimeHandle::webview_version` devient obligatoire, ainsi que `WebviewDispatch::with_ios_webview` (iOS).
- `open_devtools`, `close_devtools` et `is_devtools_open` sont obligatoires même sans la feature `devtools`.
- Les types GTK sont remplacés par des `*mut c_void`. `tauri-runtime` **ne dépend plus de `gtk`** ; un nouveau module `tauri_runtime::gtk` (`declare_version`) porte la version de GTK.
- `Error::CreateWindow` porte l'erreur sous-jacente (#16043). Les pointeurs Apple passent en `*const c_void` (#16040).
- La feature `macos-private-api` est supprimée en alpha.3/a.4 (`b9a77ebb`).

**Linux**
- Nouvelles features `gtk3` et `gtk4` sur `tauri` ; `tauri-runtime-wry` active `gtk3`, `tauri-runtime-cef` active `gtk4`.
- **GTK 3 et GTK 4 ne peuvent pas coexister dans un même processus** (`Error::GtkVersionMismatch`).
- Sans runtime, `tauri` compile sous Linux et BSD sans aucune dépendance GTK.
- Le tray utilise ksni (D-Bus) par défaut ; libappindicator devient optionnel (`linux-libappindicator`). Source : #15787.

**ACL / permissions** (`fb7bdd95`, `65792f53`)
- Les permissions `allow-$cmd` et `deny-$cmd` ne sont plus générées en fichiers : le manifeste porte une liste `commands`, et ces permissions sont matérialisées à la demande lors de la résolution.
- Le manifeste d'application gagne des permissions implicites `allow-*` et `deny-*`, qui couvrent toutes les commandes de l'application en une seule entrée résolue.
- Les permissions autogénérées sont écrites dans `OUT_DIR` ; seul `reference.md` reste dans la crate. Nouvelles fonctions `tauri_utils::acl::build::{collect_permission_files, define_permissions_from_files}`.

**Autres ruptures du cœur**
- Plugins (#16135) : les hooks prennent `&self` et `Plugin: Sync`, et ils peuvent être appelés en concurrence.
- `Plugin::initialization_script` renvoie `Option<InitializationScript>`, et `extend_api` est renommé `run_invoke_handler` (#16036).
- `Invoke::state` est supprimé (#16041).
- `run_on_main_thread` passe sur le trait `Manager` (#12893).
- `WebviewBuilder::bounds/size/position` (#15971).
- Les ressources sont lues depuis les sources en dev (#15882), et `tauri_build::try_build_context` est ajouté (#15883).

**Bundler**
- `BundleSettings::webview_runtime` = `WebviewRuntime::{Wry, Cef{distribution, helper}, Other}` (remplace `cef_path` et `cef_shared_runtime`).
- Support des icônes Liquid Glass.

**CLI**
- `tauri migrate` migre v2 → v3 depuis `tauri-cli` 3.0.0-alpha.4 (`49dc7cc3`, 30 septembre).
- MSRV 1.95, edition 2024 (`c9277f3c`).

---

## 2. Guide de migration v2 → v3 et pages associées [F]

- Page en ligne : [v3.tauri.app/start/migrate/from-tauri-2/](https://v3.tauri.app/start/migrate/from-tauri-2/) (« Upgrade to Tauri 3.0 Alpha »). Source : [from-tauri-2.mdx@v3](https://github.com/tauri-apps/tauri-docs/blob/v3/src/content/docs/start/migrate/from-tauri-2.mdx).
  - Avertissement verbatim : « Tauri 3.0 is in alpha. Its APIs may still change before the stable release, and the `tauri migrate` command does not automate the 2.0 to 3.0 upgrade yet. » Le guide conseille aussi « Keep production apps on 2.x ».
  - Sections : sélection du runtime, features Cargo, Linux, schéma d'URL, ressources en dev, permissions, Android, build et bundler, « Custom Runtime Implementations », nouveautés, puis migration détaillée (Static Dispatch, Runtime-Specific APIs, Platform Webview Access, GTK, tray, MockRuntime, permissions autogénérées).
  - Le guide ne donne aucune date, ni de beta ni de stable.
- **La documentation est en retard** : le dernier commit des pages v3 date du 13 septembre (`b605dc34`, `f2e14b4f`). Elle ignore donc les ruptures des alpha.2 à alpha.4 (hooks `Sync`, `run_on_main_thread` sur `Manager`, `initialization_script`, suppression de `macos-private-api`, qu'elle décrit encore comme feature) et le `tauri migrate` v2 → v3 livré dans le CLI alpha.4.
- [Webview Runtime](https://github.com/tauri-apps/tauri-docs/blob/v3/src/content/docs/develop/webview-runtime.mdx) (v3.tauri.app/develop/webview-runtime/) :
  - « Tauri itself does not create windows or webviews. It delegates that to a webview runtime, a crate that implements the `tauri_runtime::Runtime` trait. »
  - wry s'appuie sur tao, CEF sur winit.
  - Section « Implementing a Runtime » : il faut implémenter `Runtime`, `RuntimeHandle`, `WindowDispatch`, `WebviewDispatch`, `WindowBuilder` et un `RuntimeInitAttrs`, plus `From<Self> for DynRuntimeInitAttrs`, et exposer les traits d'extension par downcast via `tauri_runtime::dynamic::{DynRuntimeHandle, DynWebviewDispatcher, DynWindowDispatcher, DynWebview}`.
  - « The Tauri CLI treats any other runtime as `Other` and does nothing runtime-specific when building or bundling the app. »
  - « A binary can only run one runtime. »
  - Le coût de `DynRuntime` est décrit comme « negligible ».
- [CEF](https://github.com/tauri-apps/tauri-docs/blob/v3/src/content/docs/develop/cef.mdx) (v3.tauri.app/develop/cef/) :
  - Desktop seulement.
  - Distribution CEF d'environ **1 Go par plateforme** téléchargée dans `~/.cache/tauri-cef` (variable `CEF_PATH`).
  - L'exécutable se relance lui-même avec `--type=` pour les processus renderer, GPU et réseau (`#[tauri_runtime_cef::cef_entry_point]`).
  - Sandbox : toujours active sur macOS. Sous Linux, l'AppImage la perd sur Ubuntu ≥ 23.10. **Windows tourne sans sandbox** depuis Chromium M138.
  - `remote_debugging(Port | Pipe)` expose CDP.
  - Schéma `http://tauri.localhost` partout.
- Blog : aucun billet n'annonce la v3. Le dernier billet est [Announcing Tauri 2.12](https://tauri.app/blog/tauri-2.12/) (26 septembre ; abandon de Windows 7, politique de MSRV « stable - 3 »), sans mention de la v3. Source : [tauri-2.12.mdx](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/blog/tauri-2.12.mdx).

---

## 3. Faits techniques structurants pour `yolo`

### 3.1 Graphe de dépendances des crates qu'on veut épingler [F]

| Crate (v3) | Dépendances normales notables | tokio / reqwest ? | Lignes Rust (copie locale) |
| --- | --- | --- | --- |
| `tauri-runtime` 3.0.0-a.3 | serde, serde_json, thiserror 2, tauri-utils, http 1, raw-window-handle 0.6, url 2, dpi 0.1, cookie 0.18 ; windows 0.62 (Win), jni (Android), objc2 (Apple). **Plus de gtk ni de webkit2gtk.** | non | 6 164 (lib 1 200, `dynamic.rs` 2 955, webview 983, window 691) |
| `tauri-utils` 3.0.0-a.3 | serde_json, phf, url, serde_with, ctor, toml, json-patch, glob, urlpattern, regex, semver, infer, uuid, http, plist ; html5ever, kuchikiki, dom_query, schemars, brotli en option | non | 16 652 |
| `tauri-runtime-wry` 3.0.0-a.4 | wry 0.57 (`os-webview`, `linux-body`), tao 0.37 (`rwh_06`), **`tauri` (features `gtk3`)**, tauri-runtime, tauri-utils ; webview2-com 0.39 + softbuffer 0.4 (Win) ; gtk 0.18 + webkit2gtk `=2.0` (Linux) | **oui, par `tauri`** | 7 488 |
| `tauri` 3.0.0-a.4 | **tokio 1 (`rt`, `rt-multi-thread`, `sync`, `fs`, `io-util`, non optionnel)**, **reqwest 0.13 (`json`, `stream`, non optionnel, « dev server proxy »)**, muda 0.20, tray-icon 0.25 (opt.), tauri-macros, gtk/gtk4 (opt.) | oui | 35 924 |
| `tauri-runtime-cef` 3.0.0-a.5 | `tauri` (`gtk4`), `cef =152.3.0`, `tauri-winit` 0.31.0-beta.3 (gtk4), kuchikiki, html5ever | oui | 20 437 |
| `tauri-bundler` 3.0.0-a.3 | tauri-utils, ureq 3 (synchrone), zip 8, tar, sha2, rpm (Linux) | **non** | 10 172 |

Sources : `Cargo.toml` de la branche `v3` pour [tauri-runtime](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri-runtime/Cargo.toml), [tauri-runtime-wry](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri-runtime-wry/Cargo.toml), [tauri](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri/Cargo.toml), [tauri-utils](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri-utils/Cargo.toml) et [tauri-runtime-cef](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri-runtime-cef/Cargo.toml) ; décomptes de lignes sur `/home/aphro/aphrody/crates/tauri/aphrody-*/src`.

**Point bloquant pour le plan** [F] : épingler `tauri-runtime-wry` en v3 fait entrer `tauri` tout entier, donc tokio et reqwest 0.13. En v2 ce n'était pas le cas (la dépendance date de #15985). Le couplage est pourtant mince :
- `src/tauri_ext.rs` (307 lignes, les traits d'extension, `use tauri::{App, AppHandle, EventLoopMessage, Manager, Runtime, Webview, WebviewWindow}`) ;
- le paramètre par défaut `pub struct WryRuntime<T: UserEvent = tauri::EventLoopMessage>` (`lib.rs:2713`) ;
- `::tauri::handle_android_plugin_response` et `::tauri::send_channel_data` dans `android_binding!` (`lib.rs:153,159`).

Rien d'autre dans les 7 488 lignes ne référence `tauri::`. Source : `/home/aphro/aphrody/crates/tauri/aphrody-tauri-runtime-wry/src/{lib.rs,tauri_ext.rs}`.

### 3.2 Surface des traits de `tauri-runtime` v3 [F]

Méthodes par trait dans `tauri-runtime/src/lib.rs` : `RuntimeHandle` 22, `Runtime` 20, `WebviewDispatch` 36, `WindowDispatch` 81, `EventLoopProxy` 1. `window.rs` contient 53 fonctions supplémentaires (`WindowBuilder`). `Runtime::new_any_thread` existe sous Windows, Linux et BSD ; il n'existe pas sous macOS, où la boucle doit tourner sur le thread principal. `tauri::Builder::any_thread()` le confirme (« on macOS the application must be executed on the main thread »). Source : `aphrody-tauri-runtime/src/lib.rs:565-575`, `aphrody-tauri/src/app.rs:1705-1716`.

Les maintenateurs reconnaissent que `tauri-runtime` casse son API à chaque version mineure pour les implémenteurs. `tauri` le verrouille désormais au mineur (`~`) : « I think it had breakages in every minor but maybe not affecting tauri, just the implementer crates like the tauri-runtime-wry » (Legend-Master, 4 octobre). Le workspace `v3` épingle `tauri-runtime = "~3.0.0-alpha.3"`. Sources : [#16209](https://github.com/tauri-apps/tauri/issues/16209), [Cargo.toml@v3](https://github.com/tauri-apps/tauri/blob/v3/Cargo.toml).

### 3.3 Format IPC v3, ce que `Bun.tauri` doit reproduire [F]

- Message côté Rust (`crates/tauri/src/ipc/protocol.rs:236-244`) : `{ cmd, callback: u32, error: u32, payload, options?: { headers }, __TAURI_INVOKE_KEY__ }`.
- Transport principal : `POST` vers `convertFileSrc(cmd, 'ipc')` (`ipc://localhost/<cmd>` ou `http://ipc.localhost/<cmd>` selon le runtime), avec les en-têtes `Content-Type`, `Tauri-Callback`, `Tauri-Error` et `Tauri-Invoke-Key`. Le repli passe par `postMessage` avec le même JSON. Code : [scripts/ipc-protocol.js](https://github.com/tauri-apps/tauri/blob/v3/crates/tauri/scripts/ipc-protocol.js), cité dans [#16061](https://github.com/tauri-apps/tauri/issues/16061).
- `@tauri-apps/api` ne touche que `window.__TAURI_INTERNALS__.{invoke, transformCallback, unregisterCallback, runCallback, callbacks, metadata, convertFileSrc, plugins}`. Décompte fait sur `aphrody-tauri-api/src`.
- Le stub du fork Bun (`packages/bun-types/tauri.d.ts` sur [aphrody-labs/bun@main](https://github.com/aphrody-labs/bun/blob/main/packages/bun-types/tauri.d.ts)) déclare `IpcMessage { cmd, callback, error, payload }`. Il manque `options` et `__TAURI_INVOKE_KEY__`, et il ne déclare pas l'objet `__TAURI_INTERNALS__`.
- Canaux (`Channel`) : aujourd'hui `plugin:__TAURI_CHANNEL__|fetch`, non soumis à l'ACL. La PR [#16037](https://github.com/tauri-apps/tauri/pull/16037) (ouverte, base `v3`) le renomme `plugin:channel|fetch`, le soumet à l'ACL (`core:channel:default` dans `core:default`) et lie les données au webview destinataire.

### 3.4 Où vit l'ACL [F]

- La résolution est dans `tauri-utils` (sans tokio) :
  - `acl/manifest.rs` : `Manifest::command_permission` matérialise `allow-$cmd`, `deny-$cmd`, `allow-*` et `deny-*` ;
  - `acl/resolved.rs` (908 lignes) : `Resolved::resolve` ;
  - `acl/capability.rs`, `acl/identifier.rs` (`allow-*` accepté).
- Le contrôle à l'exécution (`RuntimeAuthority::resolve_access`, origine, fenêtre, webview, URL distantes) est dans `tauri`, `ipc/authority.rs` (2 033 lignes).

Source : `/home/aphro/aphrody/crates/tauri/aphrody-tauri-utils/src/acl/*`, `aphrody-tauri/src/ipc/authority.rs`.

### 3.5 Schéma d'URL [F]

Le format est défini par le runtime : wry utilise `http://tauri.localhost` sous Windows et Android et `tauri://localhost` ailleurs ; CEF utilise `http://tauri.localhost` partout ; `MockRuntime` utilise `tauri://localhost` partout. Source : guide de migration et page Webview Runtime.

[D] Un schéma personnalisé `bun://` passe par wry : il sera exposé en `http://bun.localhost` sous WebView2 et Android, comme `tauri://`.

### 3.6 Liaison webkit2gtk [F]

wry 0.57 dépend de `webkit2gtk =2.0.2`, `webkit2gtk-sys`, `javascriptcore-rs =1.1.2`, `soup3` et `gtk 0.18`. Ce sont des crates `-sys` liées via pkg-config au moment du lien. tao n'utilise `dlopen2` que pour la barre des tâches Linux (`platform_impl/linux/taskbar.rs`). Sources : [wry/Cargo.toml@dev](https://github.com/tauri-apps/wry/blob/dev/Cargo.toml), [tao/Cargo.toml@dev](https://github.com/tauri-apps/tao/blob/dev/Cargo.toml).

[D] Tout binaire qui lie wry porte un `DT_NEEDED` vers libwebkit2gtk-4.1 et ne démarre pas sans elle. Le chargement dynamique n'existe pas en amont : wry doit vivre dans un exécutable ou une `.so` séparés.

---

## 4. Issues et PR utiles (état au 2026-10-05) [F résumé · D impact]

| # | Titre | État | Résumé | Impact pour nous |
| --- | --- | --- | --- | --- |
| [tauri#15985](https://github.com/tauri-apps/tauri/pull/15985) | refactor: decouple the webview runtime from the `tauri` crate | fusionnée le 6 septembre (`feat/cef` → `v3`) | `Builder::runtime`, `DynRuntime`, traits d'extension, runtime-wry → dépend de `tauri` | Modèle de sélection de runtime à reprendre ; dépendance runtime-wry → tauri à neutraliser (§8) |
| [tauri#15068](https://github.com/tauri-apps/tauri/pull/15068) | remove wry/cef feature flags, enforce runtime crates usage | fermée (remplacée par #15985) | première version | — |
| [tauri#15787](https://github.com/tauri-apps/tauri/pull/15787) | feat(cef): migrate to winit-gtk4 | fusionnée le 12 septembre | features gtk3/gtk4, `tauri-runtime` sans gtk, tray ksni | wry (GTK 3) et CEF (GTK 4) incompatibles dans un même processus |
| [tauri#16077](https://github.com/tauri-apps/tauri/pull/16077) | refactor(runtime): move per-window/per-webview event listeners from each runtime to tauri | **ouverte**, base `v3` | retire `WindowDispatch::on_window_event` et `WebviewDispatch::on_webview_event` ; seul le flux `RunEvent` reste | Un runtime proxy n'aura qu'un flux d'événements à relayer ; rupture à suivre |
| [tauri#15812](https://github.com/tauri-apps/tauri/pull/15812) | refactor(tauri-runtime-wry)!: call tao windowing functions directly | ouverte (base `dev`) | closures à la place des variantes `WindowMessage` ; nouvelles erreurs `NotSupported` et `Os` | Réécriture interne de runtime-wry (+333/−598) : rebase des forks |
| [tauri#16037](https://github.com/tauri-apps/tauri/pull/16037) | turn the channel plugin into a regular ACL-gated core:channel plugin | ouverte, base `v3` | `plugin:channel\|fetch` soumis à l'ACL | À viser directement dans `Bun.tauri` |
| [tauri#14684](https://github.com/tauri-apps/tauri/pull/14684) | feat(linux): migrate to GTK4 and WebKitGTK 6.0 | ouverte, jalon 3.0 | dépend de [wry#1530](https://github.com/tauri-apps/wry/pull/1530), [wry#1767](https://github.com/tauri-apps/wry/pull/1767), [tao#1104](https://github.com/tauri-apps/tao/pull/1104) (ouvertes) | La dépendance système Linux pourrait passer à libwebkitgtk-6.0 avant la stable |
| [tauri#15484](https://github.com/tauri-apps/tauri/pull/15484) | refactor!: remove `tauri_utils::acl::Value` | ouverte, jalon 3.0, base `v3` | `serde_json::Value` à la place | Casse le code qui réutilise `tauri_utils::acl` |
| [tauri#15636](https://github.com/tauri-apps/tauri/pull/15636) | refactor(tauri-utils): `PermissionSchemaGenerator` trait | brouillon, jalon 3.0 | rupture publique de tauri-utils | idem |
| [tauri#14586](https://github.com/tauri-apps/tauri/pull/14586) | Webview::navigate accepts WebviewUrl | ouverte, jalon 3.0 | rupture de l'API `navigate` | mineur |
| [tauri#13973](https://github.com/tauri-apps/tauri/issues/13973), [#14011](https://github.com/tauri-apps/tauri/issues/14011), [#12815](https://github.com/tauri-apps/tauri/issues/12815), [#12516](https://github.com/tauri-apps/tauri/issues/12516), [#15335](https://github.com/tauri-apps/tauri/pull/15335), [#13662](https://github.com/tauri-apps/tauri/pull/13662) | `parent` unsafe ; nettoyage des exports ; pas de panique si `setup` échoue ; retrait de v1Compatible (« may be pushed back to v4 ») ; Gradle ; schemars 1.x | ouvertes, jalon 3.0 | reste à faire de la v3 | Encore de la casse d'API avant gel |
| [tauri#16209](https://github.com/tauri-apps/tauri/issues/16209) | tauri-runtime 2.12 contains breaking changes | fermée le 4 octobre | `tauri-runtime` casse à chaque mineur pour les implémenteurs | **Épingler par révision exacte**, jamais par plage |
| [tauri#16200](https://github.com/tauri-apps/tauri/issues/16200) | Test registered URI scheme responses through MockRuntime | ouverte (3 octobre) | `MockRuntime` ignore les protocoles personnalisés | `MockRuntime` (1 476 lignes, dans `tauri`, feature `test`) ne teste pas l'IPC par protocole |
| branche [`feat/mock-runtime-impl`](https://github.com/tauri-apps/tauri/compare/dev...feat/mock-runtime-impl) | « feat(test): extend MockRuntime impl » | 1 commit, 8 juillet, non fusionné | — | à suivre |
| [tauri#15934](https://github.com/tauri-apps/tauri/issues/15934) | Linux: no CDP, so no automated UI verification of a Tauri app | ouverte | WebKitGTK ne parle pas CDP | Argument pour un runtime `obscura`/CDP vérifiable sous Linux |
| [tauri#16061](https://github.com/tauri-apps/tauri/issues/16061) | custom `fetch` impl for the ipc handle | ouverte | montre `sendIpcMessage` (en-têtes `Tauri-*`) | référence du protocole |
| [tauri#15326](https://github.com/tauri-apps/tauri/pull/15326) | IPC Introspection (`CommandMetadata`) | brouillon | métadonnées des commandes | utile pour générer les types de `Bun.tauri` |
| [tauri#7706](https://github.com/tauri-apps/tauri/issues/7706) | Deprecate JSON in IPC | ouverte | JSON limite u64 et binaire | Garder `InvokeBody::Raw` (octets) dans `Bun.tauri` |
| [tauri#8036](https://github.com/tauri-apps/tauri/issues/8036) | Make `tauri-runtime` agnostic again | fermée en 2024 | — | historique ; traité en v3 (gtk retiré) |
| [tauri#4670](https://github.com/tauri-apps/tauri/issues/4670) | bindings for different languages/runtimes | ouverte | demande historique | voir la branche `feat/bindings` (§5) |
| [tauri#16189](https://github.com/tauri-apps/tauri/issues/16189), [#16203](https://github.com/tauri-apps/tauri/issues/16203), [#16205](https://github.com/tauri-apps/tauri/issues/16205), [#16204](https://github.com/tauri-apps/tauri/issues/16204), [#16131](https://github.com/tauri-apps/tauri/issues/16131), [#15868](https://github.com/tauri-apps/tauri/issues/15868) | CEF Linux : 100 % CPU au repos, WebGPU limité à SwiftShader, flash blanc, empaquetage AppImage en 404, glisser-déposer cassé, rendu hors écran (OSR) demandé | ouvertes (1-4 octobre) | CEF Linux immature | `plugin-cef` reste tardif |
| [discussion 15546](https://github.com/orgs/tauri-apps/discussions/15546) | tauri-runtime-servocat | juin 2026 | runtime tiers en Rust pur ; FabianLars : « We actually want to rework how the runtimes work, and if we do then hopefully in v3 » | Précédent direct pour `aphrody-runtime-obscura` ; risque d'une seconde refonte des traits |
| [discussion 14300](https://github.com/orgs/tauri-apps/discussions/14300) | What new features will be added to the Tauri v3 project? | octobre 2025 | FabianLars : « v3 will be more about breaking changes eg switching from gtk3 to gtk4 maybe switching from tao to winit » | Feuille de route officieuse |
| [discussion 5837](https://github.com/orgs/tauri-apps/discussions/5837) | Bun? | 2022-2026 | demande communautaire d'un backend JS ; aucune réponse de l'équipe | aucune concurrence amont sur « Tauri + Bun » |
| [plugins-workspace#3655](https://github.com/tauri-apps/plugins-workspace/pull/3655) / [#3654](https://github.com/tauri-apps/plugins-workspace/issues/3654) | fix(dialog): import Manager for run_on_main_thread on Tauri v3 alpha.3 | ouverte | dialog ne compile pas contre alpha.3+ | **C'est notre patch local du plugin dialog** : à cherry-picker dans le fork |
| plugins-workspace [v3](https://github.com/tauri-apps/plugins-workspace/tree/v3) (#3599-#3614) | ruptures fs (`read_text_file` et `write_text_file` retirés, plus de permission `unwatch`, `watch` renvoie un `Watcher`), opener (`reveal_items_in_dir`), shell (`open` retiré), http (scope appliqué sur les redirections), store, log, upload, autostart, updater, dialog, deep-link | fusionnées les 22-23 septembre ; plugins en 3.0.0-alpha.2 le 30 septembre | — | À vérifier contre les 61 commandes et 15 plugins d'`aphrody-app` avant 2 bis |
| [wry#1872](https://github.com/tauri-apps/wry/pull/1872), [wry#1862](https://github.com/tauri-apps/wry/pull/1862) | report web content process termination / per-webview process failure handler | ouvertes | crash du processus web exposé | à remonter dans l'hôte de fenêtres |
| [wry#391](https://github.com/tauri-apps/wry/issues/391) | Offscreen rendering feature | ouverte depuis 2021 | pas de rendu hors écran dans wry | le headless reste du ressort d'Obscura |

---

## 5. Découverte majeure : la branche amont `feat/bindings` (`tauri-ffi`) [F]

- Branche [`feat/bindings`](https://github.com/tauri-apps/tauri/tree/feat/bindings), 370 commits d'avance et 211 de retard sur `dev`, dernier commit le 22 juillet 2026 (Lucas Nogueira). Aucune PR ouverte. Elle **n'est pas dans `v3`** et repose sur l'ancien modèle à features `tauri/wry` et `tauri/cef`, donc antérieur à #15985.
- Plan : [`ffi-bindings-plan.md`](https://github.com/tauri-apps/tauri/blob/feat/bindings/ffi-bindings-plan.md). Crate `crates/tauri-ffi` (cdylib, staticlib, rlib, `publish = false`, version 0.1.0), qui expose une ABI C décrite par `api-manifest.json`. Un générateur produit `bindings/c/tauri_ffi.h`, `bindings/node` (koffi), `bindings/deno` (`Deno.dlopen`) et `bindings/python` (cffi).
- Choix documentés :
  - poignées `u64` (slotmap), JSON à la frontière, `catch_unwind` à chaque entrée ;
  - **mode file d'attente** (`tauri_events_next`) pour les hôtes GC, sans rappel natif ;
  - politiques de fermeture et de sortie fixées à l'avance (`PREVENT_AND_NOTIFY`) ;
  - commandes de l'application par `Builder::invoke_handler` vers une poignée de résolveur ;
  - capabilities en JSON à l'exécution (`dynamic-acl`) ;
  - plugins définis par l'hôte avec un manifeste ACL synthétisé (`allow-all`) ;
  - CLI `tauri dev`/`build` pour un projet sans Cargo (`build > runner`), binaire autonome (`deno compile`, Node SEA, PyInstaller) emballé par `tauri-bundler` ;
  - variables d'environnement acceptées en dev seulement.
- Modèle de threads : `tauri_app_run` bloque le thread principal ; **le code applicatif tourne dans un Worker** (Node `worker_threads`, Deno `Worker`) qui pilote l'application par des appels FFI utilisables depuis n'importe quel thread. Le document rejette explicitement l'option « Sidecar process + JSON-RPC » (« adds process management, IPC latency, packaging complexity, and kills in-process embedding »). Hors périmètre v0 : mobile, runtimes personnalisés, isolation.
- Statut (selon le document) : validé sur macOS ; Linux et Windows non validés pour les bundles ; ABI v8.

---

## 6. Calendrier [F, puis D]

- [F] Aucune date de beta ni de stable n'est publiée. Le jalon [3.0](https://github.com/tauri-apps/tauri/milestone/5) n'a pas d'échéance (12 éléments ouverts, 4 fermés). Aucun gel d'API n'est annoncé. La documentation dit : « APIs may still change before the stable release », « Keep production apps on 2.x ».
- [F] Rythme : une alpha par semaine depuis le 12 septembre. 21 PR ont visé `v3` (17 fusionnées). Le 22 septembre a apporté une vague de ruptures dans plugins-workspace.
- [F] Encore ouvert sur la route de la v3 : GTK 4 / WebKitGTK 6.0 pour wry et tao, déplacement des listeners (#16077), canal soumis à l'ACL (#16037), appels tao directs (#15812), `acl::Value` (#15484), `PermissionSchemaGenerator` (#15636), `navigate` (#14586), `parent` unsafe (#13973), exports (#14011), `setup` (#12815), v1Compatible (#12516, peut-être v4), Gradle (#15335), schemars 1.x (#13662). Le passage de tao à winit est évoqué ; CEF utilise déjà `tauri-winit` 0.31.0-beta.3. La refonte des runtimes est « hopefully in v3 ».
- [D] Une beta paraît peu probable avant la fusion de GTK 4 et de la refonte des traits de runtime. Les PR wry et tao correspondantes sont encore ouvertes et en brouillon. Compter **plusieurs mois d'alphas** : le one shot 3 doit cibler une révision alpha épinglée et prévoir des rebases mécaniques, pas une version stable.

---

## 7. Écart entre nos forks et l'amont (2026-10-05) [F]

| Fork `aphrody-labs/*` | Comparé à | État | Commits propres | Remarques |
| --- | --- | --- | --- | --- |
| `tauri` `yolo` | `tauri-apps/tauri` `v3` (`a8703ee4` = alpha.4) | +4 / −0 | `35a492d5` scripts en Bun natif ; `89e82d19` scope npm `@aphrody` ; `e44f0366` `[patch.crates-io]` wry/tao vers les forks ; `890a4e24` scope échappé dans rollup | 102 fichiers. **Dans le `Cargo.lock` du fork, le patch tao est `[[patch.unused]]` (tao 0.37.1 `d19f4c12`) et tao reste à crates.io 0.37.0** ; seul wry est réellement patché. [Cargo.lock@yolo](https://github.com/aphrody-labs/tauri/blob/yolo/Cargo.lock) |
| `plugins-workspace` `yolo` | `v3` (`d9be6d04`) | +3 / −0 | Bun natif, scope npm, scope rollup | `v3` a lui-même 48 commits d'avance et 14 de retard sur `v2` |
| `wry` `yolo` | `dev` (`cab3eace`, 29 septembre) | identique | — | — |
| `tao` `yolo` | `dev` (`3fcda65f`, 5 octobre 03:49) | **identique** | — | Le fork a été avancé le 5 octobre (push 17:55). Monorepo : `vendor.lock` tao = `3fcda65f` (commit `1fc288873`, « bump tao to the fork head », 5 octobre 20:00). **L'item « tao : 2 commits » de la partie 4 (§1, §7, §9) est réglé.** |
| `create-tauri-app` `yolo` | `dev` (`12db955f`) | +9 / −0 | Bun natif, scope `@aphrody`, gabarits Tauri 3 alpha, gabarits réduits à vanilla Bun et Rust/WASM, vanilla-ts sur le bundler HTML de Bun | — |

Sources : [compare tauri](https://github.com/tauri-apps/tauri/compare/v3...aphrody-labs:tauri:yolo), [compare plugins-workspace](https://github.com/tauri-apps/plugins-workspace/compare/v3...aphrody-labs:plugins-workspace:yolo), [compare wry](https://github.com/tauri-apps/wry/compare/dev...aphrody-labs:wry:yolo), [compare tao](https://github.com/tauri-apps/tao/compare/dev...aphrody-labs:tao:yolo), [compare create-tauri-app](https://github.com/tauri-apps/create-tauri-app/compare/dev...aphrody-labs:create-tauri-app:yolo) ; `/home/aphro/aphrody/vendor.lock`.

[F] Les cinq forks sont **publics** (`private: false`) ; branches par défaut : tauri `dev`, plugins-workspace `v2`, wry `dev`, tao `dev`, create-tauri-app `dev`. Les noms de crates Rust y restent ceux de l'amont (`tauri-runtime`…) ; le renommage `aphrody-*` n'existe que dans l'import du monorepo.

---

## 8. Ce que ça change pour le plan de fusion [D, sauf mention F]

### 8.1 Corrections factuelles à apporter aux parties 3 et 4

1. Partie 3, tableau « Crate Tauri » : `tauri-runtime` v3 **ne dépend plus** de gtk ni de webkit2gtk [F §3.1]. Elle fait 6 164 lignes (dont 2 955 de `dynamic.rs`), pas 2 874. Le plan lisait `dev` 2.12.1 ; la cible réelle est `v3` : MSRV 1.95, edition 2024.
2. Partie 3, « `tauri` (cœur) non repris ; `tauri-runtime-wry` pin » : en v3 les deux sont **indissociables** tant que `tauri-runtime-wry` dépend de `tauri`, qui embarque tokio et reqwest 0.13 [F §3.1]. Sans correctif, l'invariant « tokio hors du binaire » tombe dès la feature `gui`.
3. Partie 3, « `IpcMessage { cmd, callback, error, payload }` » : le message v3 compte aussi `options.headers` et `__TAURI_INVOKE_KEY__`, et `@tauri-apps/api` attend l'objet `__TAURI_INTERNALS__` (8 membres) [F §3.3].
4. Partie 3, « `tauri-runtime-cef` … +100 Mo » : non vérifié. La seule mesure publiée est le téléchargement d'environ 1 Go de la distribution CEF par plateforme (SDK, pas la taille du bundle). CEF se relance lui-même en sous-processus, dépend de `tauri` (tokio) et de GTK 4 [F §2].
5. Partie 4 : l'item « tao : 2 commits » est soldé (§7). En revanche le patch tao du fork `tauri` est inopérant (`patch.unused`) : un `cargo update -p tao` est à faire sur le VPS dans le fork.
6. Partie 4 §4 « patch du plugin dialog » : c'est la PR amont plugins-workspace#3655, encore ouverte. On cherry-pick #3655 dans `aphrody-labs/plugins-workspace` `yolo` ; seul le préfixe ACL reste propre à Aphrody.

### 8.2 Pins

- Épingler par **révision git exacte** des branches `yolo` (et `Cargo.lock` en `--locked`), jamais par plage semver : `tauri-runtime` casse à chaque mineur pour les implémenteurs [F §3.2].
- Si on prend crates.io : `=3.0.0-alpha.N` strict, en alignant tauri-runtime a.3 / runtime-wry a.4 / utils a.3 (la numérotation diffère d'une crate à l'autre).
- Ensemble minimal pour la feature `gui` de `yolo` :
  - `tauri-runtime` (pur, sans tokio) ;
  - `tauri-utils` (sans ses features `build`, `html-manipulation`, `schema`) ;
  - `wry` 0.57 et `tao` 0.37.1 depuis les forks ;
  - `tauri-runtime-wry` **avec le correctif du §8.3**.
- Le nightly du fork Bun (`2026-09-15`) dépasse la MSRV 1.95 de la v3 et la MSRV 1.85 de wry et tao : pas de conflit de toolchain attendu.
- Le correctif `build-dir` de Rust 1.100 (`fb2dcae8`) est déjà dans `tauri-build` v3.
- `cookie 0.18` reste réexporté par `tauri-runtime` (« bumping this is a breaking change ») : le point de friction Obscura #295 de la partie 3 tient toujours.

### 8.3 Correctif à pousser dans `aphrody-labs/tauri` (branche `yolo`) avant le one shot 3

- Rendre la dépendance `tauri` de `tauri-runtime-wry` **optionnelle** derrière une feature `tauri-ext`, active par défaut pour rester proche de l'amont.
- Déplacer sous `#[cfg(feature = "tauri-ext")]` le module `tauri_ext`, le paramètre par défaut `T = tauri::EventLoopMessage` (remplacé par `T` sans défaut, ou par un type local) et les deux appels Android.
- Taille estimée : une trentaine de lignes, d'après le décompte du §3.1.
- Gain : `tauri-runtime-wry` sans tokio, sans reqwest, sans muda/tray-icon par `tauri`.
- Une PR amont est défendable, puisque les maintenateurs veulent « rework how the runtimes work … easier for runtime creators ». Sinon le patch vit dans le fork, avec sa provenance dans `config/upstream-sources.json`.
- Rejeté : réécrire un `aphrody-runtime-wry`. Ce serait dupliquer 7 500 lignes, contraire à la règle de dédoublonnage.

### 8.4 Hôte de fenêtres

- Le modèle « processus hôte » de la partie 3 est **confirmé et même obligatoire** pour trois raisons :
  1. sous macOS, la boucle tao doit posséder le thread principal (pas de `new_any_thread`) [F §3.2] ;
  2. wry lie webkit2gtk au moment du lien, sans `dlopen` [F §3.6] : seul un exécutable ou une `.so` séparés permettent au noyau `yolo` de démarrer sans webkit2gtk et de basculer sur `obscura` ;
  3. un crash du processus web est isolé (wry#1872 et #1862 l'exposent).
- Variante plus légère sous Linux et Windows : `new_any_thread` permet de faire tourner la boucle tao sur un thread dédié **dans** le processus, à condition qu'elle vive dans une `.so` chargée à la demande. Utile si la latence IPC gêne. À garder en option, pas par défaut, pour rester uniforme avec macOS.
- **Ne pas proxifier les ~210 méthodes des traits `tauri-runtime`.** Sans le crate `tauri` dans le processus principal, rien n'y consomme ces traits. Il vaut mieux faire tourner `WryRuntime` dans l'hôte et exposer un protocole court, calqué sur l'ABI `tauri-ffi` amont :
  - création de fenêtre depuis un `WindowConfig` JSON ;
  - environ 35 opérations de fenêtre ;
  - `eval`, `navigate`, gestion des poignées ;
  - file d'événements (`RunEvent`) ;
  - résolveurs d'`invoke` ;
  - politiques de fermeture et de sortie fixées à l'avance.

  C'est l'évolution naturelle de `yolo.desktop/1` et d'`ipc_protocol.h`. La PR #16077 (un seul flux `RunEvent`) va dans le même sens.
- Reprendre de `tauri-ffi` : la description de l'ABI par manifeste (fonctions, contrat de thread, appel bloquant ou non) pour générer le côté Bun (`bun:ffi` ou socket) et le côté hôte ; les poignées `u64` générationnelles ; le mode file d'attente. Ne **pas** épingler la branche, qui est expérimentale, obsolète par rapport à `v3` et non fusionnée.

### 8.5 IPC (`Bun.tauri`)

- Deux options, à trancher dans le plan final :
  - **A. IPC réécrit côté Bun** (plan actuel). L'hôte relaie le `POST ipc://` (protocole personnalisé wry) vers le processus Bun ; Bun décode `{cmd, callback, error, payload, options, invoke key}`, contrôle l'ACL et répond. Coût : réimplémenter `RuntimeAuthority::resolve_access` (2 033 lignes dans `tauri`) et le JS injecté (`__TAURI_INTERNALS__`, `ipc-protocol.js`, `core.js`), ainsi que les plugins officiels côté Bun.
  - **B. `tauri` complet dans l'hôte seulement.** tokio et reqwest restent confinés au binaire hôte, livré dans `@aphrody/plugin-tauri`, et le noyau reste propre. Les commandes de l'application sont relayées vers Bun par la file, comme le fait `tauri-ffi` avec `invoke_handler` et les résolveurs. L'ACL, les canaux et les plugins officiels (fs, dialog…) fonctionnent tels quels, et `@tauri-apps/api` reste compatible par construction. Coût : la taille de l'hôte (tauri + plugins) et une deuxième pile async dans l'hôte.
- Recommandation : **B pour le one shot 3** (moins de code, parité immédiate, conforme à « pins, pas de copies »), et A plus tard pour le runtime `obscura` dans le processus, qui n'a pas de `tauri`.
- Dans les deux cas :
  - compléter `tauri.d.ts` avec `options` et la clé d'invocation, et typer `__TAURI_INTERNALS__` ;
  - viser directement `plugin:channel|fetch` (#16037) ;
  - garder les charges binaires (`InvokeBody::Raw`) ;
  - générer les types des commandes depuis la future `CommandMetadata` (#15326) ou depuis `commands` dans `bunfig.toml`.

### 8.6 Permissions

- La sémantique Tauri 3 visée par le plan (liste `commands`, `allow-*`/`deny-*` implicites, matérialisation à la demande) est entièrement dans `tauri_utils::acl`, sans tokio [F §3.4]. La reprendre par pin plutôt que de la recoder :
  - `[desktop] commands = [...]` de `bunfig.toml` devient un `Manifest` d'application (`commands`) ;
  - les capabilities restent des fichiers JSON ou TOML lus à l'exécution, comme `tauri-ffi` ;
  - on appelle `Resolved::resolve`.
- Seul le contrôle d'accès à l'exécution reste à écrire côté Bun, ou à éviter avec l'option B.
- Surveiller #15484 (`acl::Value` → `serde_json::Value`) et #15636 : ruptures certaines de cette surface avant la stable.

### 8.7 One shot 2 bis (nettoyage d'`aphrody`)

- Avant de supprimer `crates/tauri/*` et de passer aux pins :
  - cherry-pick plugins-workspace#3655 dans le fork, et y pousser le préfixe ACL ;
  - corriger le `patch.unused` de tao dans le fork `tauri` (`cargo update -p tao`, sur le VPS) ;
  - vérifier `aphrody-app` contre les ruptures des plugins v3 (fs, opener, shell, http, store, log, upload, autostart, updater, dialog, deep-link) et contre `DynRuntime` / `run_on_main_thread` sur `Manager`.
- `tauri-runtime-cef` (20 437 lignes, aucun consommateur) sort sans regret. Un binaire ne peut pas lier wry (GTK 3) et CEF (GTK 4) ensemble [F] : CEF n'aura jamais sa place dans `aphrody-app`.
- `tauri migrate` (CLI alpha.4) peut servir à vérifier la migration d'`aphrody-app` et de shenron.

### 8.8 One shot 3 (desktop)

- `Bun.Window({ runtime })` calque `Builder::runtime` ; `"auto"` choisit wry si l'hôte démarre, sinon `obscura`.
- `aphrody-runtime-obscura` est un runtime tiers comme `tauri-runtime-verso` ou `-servocat`. La documentation décrit les cinq traits plus `RuntimeInitAttrs`, et le CLI le classe `Other`. Prévoir une seconde refonte des traits, évoquée pour la v3.
- `yolo crawl app <domaine>` : `tauri-bundler` est une bibliothèque synchrone (`bundle_project(&Settings)`, ureq, **sans tokio**), avec `WebviewRuntime::Other` ou `Wry`. Elle peut donc vivre dans `plugin-tauri` sans le CLI.
- Le patron « projet sans Cargo, `build > runner`, binaire autonome emballé par le bundler » de `feat/bindings` est le bon modèle pour `yolo build --compile` vers `.deb`/AppImage. On reprend l'idée, pas le code.
- Le gabarit create-tauri-app « vanilla Bun » du fork existe déjà.
- Prévoir le passage à GTK 4 / WebKitGTK 6.0 (#14684) : la dépendance système Linux changerait, mais l'hôte séparé l'absorbe.

### 8.9 `@aphrody/plugin-tauri`

Contenu, par pins :
- CLI (avec `migrate`) ;
- bundler (bibliothèque) ;
- create-tauri-app (fork `yolo` +9) ;
- **binaire hôte** (`tauri` + `tauri-runtime-wry` + plugins officiels si option B), seul endroit où tokio est admis.

Les plugins officiels v3 sont en 3.0.0-alpha.2 (30 septembre). Le `MockRuntime` (dans `tauri`, feature `test`) ne sert qu'aux tests de ce plugin ; #16200 montre ses limites sur les schémas personnalisés.

### 8.10 CEF (`plugin-cef`)

- Garder CEF en fin de séquence (one shot 6), comme hôte **séparé**.
- Raisons :
  - GTK 4 incompatible avec wry dans le même processus ;
  - auto-relance multiprocessus ;
  - environ 1 Go de SDK par plateforme ;
  - pas de sandbox sous Windows ;
  - bugs Linux ouverts (100 % CPU au repos, WebGPU limité à SwiftShader, AppImage en 404, glisser-déposer).
- Il dépend aussi de `tauri` (tokio).
- Le rôle de moteur embarqué sans dépendance système reste à Obscura, ce qui confirme la partie 3. CDP par `remote_debugging(Pipe)` est le seul vrai apport de CEF pour l'automatisation, et Obscura le couvre déjà.

### 8.11 Décisions à ajouter au §8 de la partie 4

1. Correctif `tauri-ext` optionnel dans le fork `tauri` (§8.3) : patch local ou PR amont.
2. IPC : option A (Bun) ou B (`tauri` dans l'hôte) pour le one shot 3.
3. Protocole hôte : ABI courte façon `tauri-ffi` (recommandé) ou proxy complet des traits `tauri-runtime`.
4. Rythme des rebases tant que la v3 est en alpha (hebdomadaire ?) et point de bascule GTK 4.

---

## 9. Sources (toutes consultées le 2026-10-05)

- Releases et tags : https://github.com/tauri-apps/tauri/releases (`tauri-v3.0.0-alpha.0` … `alpha.4`, `tauri-runtime-cef-v3.0.0-alpha.5`, `tauri-cli-v3.0.0-alpha.4`)
- Changelogs `v3` : https://github.com/tauri-apps/tauri/tree/v3/crates (`tauri`, `tauri-runtime`, `tauri-runtime-wry`, `tauri-runtime-cef`, `tauri-utils`, `tauri-build`, `tauri-bundler`, `tauri-plugin`, `tauri-cli`), https://github.com/tauri-apps/tauri/blob/v3/packages/api/CHANGELOG.md, https://github.com/tauri-apps/tauri/tree/v3/.changes
- Manifests `v3` : https://github.com/tauri-apps/tauri/blob/v3/Cargo.toml et `crates/{tauri,tauri-runtime,tauri-runtime-wry,tauri-runtime-cef,tauri-utils}/Cargo.toml`
- Comparaisons : https://github.com/tauri-apps/tauri/compare/dev...v3, https://github.com/tauri-apps/tauri/compare/v3...dev
- Guide de migration : https://v3.tauri.app/start/migrate/from-tauri-2/ ; sources https://github.com/tauri-apps/tauri-docs/blob/v3/src/content/docs/start/migrate/from-tauri-2.mdx, https://github.com/tauri-apps/tauri-docs/blob/v3/src/content/docs/develop/webview-runtime.mdx, https://github.com/tauri-apps/tauri-docs/blob/v3/src/content/docs/develop/cef.mdx
- Blog : https://tauri.app/blog/tauri-2.12/ (source https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/blog/tauri-2.12.mdx)
- Jalon : https://github.com/tauri-apps/tauri/milestone/5
- PR et issues : https://github.com/tauri-apps/tauri/pull/15985, /pull/15068, /pull/15787, /pull/16077, /pull/15812, /pull/16037, /pull/14684, /pull/15484, /pull/15636, /pull/14586, /issues/13973, /issues/14011, /issues/12815, /issues/12516, /pull/15335, /pull/13662, /issues/16209, /issues/16200, /issues/15934, /issues/16061, /pull/15326, /issues/7706, /issues/8036, /issues/4670, /issues/16189, /issues/16203, /issues/16205, /issues/16204, /issues/16131, /issues/15868, /pull/16135, /pull/16036, /pull/16041, /pull/12893, /pull/15971, /pull/15882, /pull/15883
- Discussions : https://github.com/orgs/tauri-apps/discussions/14300, https://github.com/orgs/tauri-apps/discussions/15546, https://github.com/orgs/tauri-apps/discussions/5837
- Branche `feat/bindings` : https://github.com/tauri-apps/tauri/blob/feat/bindings/ffi-bindings-plan.md, https://github.com/tauri-apps/tauri/tree/feat/bindings/bindings, https://github.com/tauri-apps/tauri/blob/feat/bindings/crates/tauri-ffi/Cargo.toml
- plugins-workspace : https://github.com/tauri-apps/plugins-workspace/tree/v3, https://github.com/tauri-apps/plugins-workspace/compare/v2...v3, https://github.com/tauri-apps/plugins-workspace/pull/3655, https://github.com/tauri-apps/plugins-workspace/issues/3654, PR #3599 à #3614
- wry et tao : https://github.com/tauri-apps/wry/blob/dev/CHANGELOG.md, https://github.com/tauri-apps/wry/blob/dev/Cargo.toml, https://github.com/tauri-apps/tao/blob/dev/CHANGELOG.md, https://github.com/tauri-apps/tao/blob/dev/Cargo.toml, https://github.com/tauri-apps/wry/pull/1530, /pull/1767, /pull/1872, /pull/1862, /issues/391, https://github.com/tauri-apps/tao/pull/1104
- crates.io : https://crates.io/crates/tauri, /tauri-runtime, /tauri-runtime-wry, /tauri-runtime-cef, /tauri-utils, /tao, /wry, /tauri-plugin-fs, /tauri-plugin-shell, /tauri-plugin-dialog
- Forks : https://github.com/tauri-apps/tauri/compare/v3...aphrody-labs:tauri:yolo, https://github.com/tauri-apps/plugins-workspace/compare/v3...aphrody-labs:plugins-workspace:yolo, https://github.com/tauri-apps/wry/compare/dev...aphrody-labs:wry:yolo, https://github.com/tauri-apps/tao/compare/dev...aphrody-labs:tao:yolo, https://github.com/tauri-apps/create-tauri-app/compare/dev...aphrody-labs:create-tauri-app:yolo, https://github.com/aphrody-labs/tauri/blob/yolo/Cargo.lock
- Fork Bun : https://github.com/aphrody-labs/bun/blob/main/packages/bun-types/tauri.d.ts
- Local (lecture) : `/home/aphro/aphrody/docs/plans/fusion/drive/PLAN-FUSION-APHRODY (3 de 3).md`, `(4 de 4).md` ; `/home/aphro/aphrody/vendor.lock` ; commit `1fc288873` ; `/home/aphro/aphrody/crates/tauri/aphrody-{tauri,tauri-runtime,tauri-runtime-wry,tauri-utils,tauri-bundler,tauri-api}/…` (fichiers cités dans le texte)
