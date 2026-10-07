# Préparation — absorption de Tauri par le runtime `yolo` et renommage `aphrody-labs/bun` → `aphrody-labs/yolo`

Date : 2026-10-05. Analyse en lecture seule de `/home/aphro/aphrody` (HEAD `70541b5a2`), de `vendor/bun`
(HEAD `c439b6fbd`) et de `/home/aphro/aphrody/plugins` (HEAD `804158d`). GitHub interrogé uniquement en GET
(`aphrody git api`, `aphrody git graphql` en lecture). Seule commande Cargo : `cargo metadata --no-deps --offline`.
LOC comptées avec `Bun.Glob` (lignes physiques ; `node_modules`, `target`, `dist`, `dist-js`, `gen/schemas`
exclus).

---

## Volet A — Tauri

### A.1 Inventaire

**Membres Cargo.** `crates/tauri/*` fait partie des membres du workspace (`Cargo.toml:4`). Deux répertoires sont
exclus : `aphrody-tauri-api` et `aphrody-tauri-plugin-sql` (`Cargo.toml:5-9`). On compte 56 répertoires et
55 membres Cargo, `aphrody-tauri-specta-macros` compris. Les identités amont sont redirigées vers les forks
par alias de paquet : `Cargo.toml:396-414` (tauri, build, runtime-wry, runtime-cef, 15 plugins),
`:416` (mcp-bridge), `:452-458` (plugin, utils, runtime, macros, codegen, `wry = aphrody-wry`,
`tao = aphrody-tao`). Le patch de `tauri-plugin-dialog` n'est plus qu'un commentaire (`Cargo.toml:478`) : la
copie est consommée par alias de chemin.

**LOC par groupe** (rs / ts / js / kt+swift) :

| Groupe | Crates | rs | ts | js | mobile |
|---|---|---:|---:|---:|---:|
| Cœur | tauri, -build, -codegen, -macros, -plugin, -runtime, -runtime-wry, -utils | 73 826 | 0 | 926 | 3 023 |
| Fenêtrage | tao, tao-macros, wry | 53 711 | 0 | 23 | 1 187 |
| CEF | tauri-runtime-cef | 20 512 | 0 | 0 | 0 |
| Outillage | tauri-cli, -cli-node, -bundler, -macos-sign, -driver, -schema-generator, -schema-worker | 40 009 | 128 | 937 | 340 |
| Plugins (30) | autostart … window-state | 26 248 | 10 132 | 355 | 8 717 |
| API JS `@aphrody/api` | aphrody-tauri-api | 0 | 10 009 | 0 | 0 |
| Scaffold | create-tauri-app, -node | 2 723 | 26 | 651 | 0 |
| Specta | tauri-specta (+ macros) | 2 319 | 0 | 0 | 0 |
| Divers | acl-tests, restart, tauri-examples | 271 | 0 | 0 | 0 |
| **Total `crates/tauri`** | 56 répertoires, 2 062 fichiers | **219 619** | **20 295** | **2 892** | **13 267** |

Les crates proches, hors `crates/tauri`, comptent :

- `crates/ui/tauri-wrap` : 1 630 rs ;
- `crates/ui/tauri-plugin-mcp-bridge` : 4 269 rs et 755 js, MIT, dépôt `hypothesi/mcp-server-tauri` ;
- `crates/shell/tauri` : 389 rs ;
- `crates/ui/drive` : 3 761 rs et 801 Swift, plugin Tauri `aphrody-drive` ;
- `crates/ui/app` : 6 078 rs, plus 6 263 js dans le bundle `ui-dist/app.js`.

**Versions.**

- tauri `3.0.0-alpha.4` ; build, codegen, macros, runtime et utils en alpha.3 ; runtime-wry alpha.4 ;
  runtime-cef alpha.5.
- Plugins en `3.0.0-alpha.2`, wry `0.57.0`, tao `0.37.1`, tauri-specta `2.0.0-rc.25`.
- Paquets npm : `@aphrody/api@3.0.0-alpha.2`, `@aphrody/cli@3.0.0-alpha.4` (cli-node) et
  `@aphrody/plugin-*@3.0.0-alpha.2` (27 paquets JS). Leur sortie JS est produite par `crates/tauri/build-js.ts:1-7`.
- Toutes ces versions amont existent sur crates.io (vérifié par l'API crates.io le 2026-10-05).

**Provenance.**

- `vendor.toml:1-5` est la recette `yolo import`. Elle préfixe les crates en `aphrody-` et règle leur
  `repository` sur `https://github.com/aphrody-labs/yolo`.
- `vendor.lock` fixe les sources : tauri `890a4e24`, plugins-workspace `a50a1b7b`, wry `cab3eace`, tao `d19f4c12`,
  create-tauri-app `c7692bb0`.
- Comparaisons GitHub de la branche `yolo` des forks avec leur amont :
  - `aphrody-labs/tauri` : `tauri-apps:v3` + 4 commits (scripts Bun, scope npm `@tauri-apps`→`@aphrody`, patch
    wry/tao) ;
  - `plugins-workspace` : v3 + 3 commits ;
  - `create-tauri-app` : dev + 9 commits ;
  - `wry` : identique à `tauri-apps:dev` ;
  - `tao` : 0 commit propre, 2 de retard.
- Intégration au monorepo par `cf2fa3f4b` (« fuse yolo », dans `crates/vendor`), puis `3ce06ae3a`
  (vers `crates/tauri`).
- Lacune : `config/upstream-sources.json` ne déclare en « integrated » que `tauri-plugin-dialog` et
  `tauri-plugin-mcp-bridge`. Le cœur tauri, tao, wry, les 29 autres plugins et create-tauri-app n'y ont aucune
  entrée de provenance. La règle CLAUDE.md « provenance in config/upstream-sources.json » n'est donc pas
  respectée.

**Patchs locaux réels.**

1. Renommage `aphrody-*` des crates, avec réécritures de chemins (`vendor.toml:77-115`).
2. Préfixe ACL des plugins (`crates/tauri/aphrody-tauri-utils/src/acl/mod.rs:61-62`).
3. Scope npm `@aphrody` et scripts Bun.
4. Import de `Manager` dans le dialog (`patches/tauri-plugin-dialog-3.0.0-alpha.2.patch`,
   `config/tauri-upstream.json` patches[0]).
5. Fork git de tauri-specta (`koharu-rs`), réintégré comme crate.
6. mcp-bridge : patchs Tauri 3 et sécurité (`patches/tauri-plugin-mcp-bridge-0.13.0-{registry,tauri3}.patch`).

Aucun patch fonctionnel ne porte sur wry ou tao.

**Licences.**

- Apache-2.0 OR MIT : tauri, plugins, CLI, wry, create-tauri-app.
- Apache-2.0 : tao (`aphrody-tao` ; tao-macros est en MIT OR Apache).
- MIT : tauri-specta et mcp-bridge.
- Fichiers LICENSE absents de bundler, macos-sign, runtime-cef, schema-generator, schema-worker et
  tauri-plugin (relevé `Bun.Glob LICENSE*`), alors que `scripts/build/desktop/artifact.ts:57-61` copie les
  notices.

**Configs incohérentes (erreurs préexistantes).**

- `config/tauri-upstream.json:21` déclare `"pin": "released-alpha-from-crates-io"`, alors que le dépôt consomme
  des forks par chemin (`Cargo.toml:396-458`).
- `config/tauri-apps.json:57` cite `aphrody-model-view`, qui n'existe plus.
- `crates/tauri/aphrody-tauri-examples/Cargo.toml:39-75` pointe 10 exemples vers `crates/examples/tauri/*`,
  qui n'existe pas. Les fichiers sont dans `m3/examples/tauri`.
- `scripts/build/desktop/artifact.ts:57-61` lit `crates/aphrody-{tauri,wry,tao}/LICENSE*` (chemins morts ; le bon
  chemin est `crates/tauri/aphrody-*`).
- Les entrées `crates/vendor/...` de `vendor.lock:100-129` sont périmées.
- `vendor/bun/packages/bun-types/tauri.d.ts:50-52` déclare `Bun.tauri.getDisplayConfig()`, sans
  implémentation runtime : le seul fichier `src` qui mentionne tauri est `add_completions.txt`.

### A.2 Consommateurs réels

`cargo metadata` et `rg` donnent les dépendances inverses suivantes.

**`crates/ui/app` (`aphrody-app`, seule application desktop).**

- Dépendances Rust (`crates/ui/app/Cargo.toml:44-98`) :
  - `tauri` avec les features `dynamic-acl`, `image-ico` et `tray-icon` ;
  - `tauri-runtime-wry` et `tauri-build` ;
  - 15 plugins : os, dialog, clipboard-manager, notification, process, log, window-state, single-instance
    (deep-link), store, updater, global-shortcut, autostart, deep-link, fs, opener ;
  - `aphrody-shell-tauri`, `aphrody-tauri-wrap` (sidecar showcase) et `aphrody-drive`.
- Code : 61 `#[tauri::command]` (lib 18, models 10, desktop 10, identity 7, integration 7, studio 6,
  explorer 3), 6 `WebviewWindowBuilder`, `TrayIconBuilder`, menus, `ipc::Channel` ×3, `on_navigation`,
  `on_page_load`, 12 `eval`.
- Fenêtres : 5 fenêtres déclarées (main, splash, pet, widget, quickbar ; `tauri.conf.json`), `withGlobalTauri`.
- IPC réellement utilisé par l'UI :
  - commandes : `aphrody_shell_window`, `daemon_request`, `subscribe_to_events` ;
  - plugins : `plugin:store|*`, `plugin:dialog|open`, `plugin:event|*`, `plugin:updater|*`,
    `plugin:autostart|*`, `plugin:os|hostname`, `plugin:opener|open_url`, `plugin:aphrody-drive|*`.
  - Les quelque 80 `plugin:window|*` présents dans `ui-dist/app.js` viennent du module window de l'API
    embarquée en bloc.
- Hôte runtime `--runtime-host`, protocole `yolo.desktop/1` (`src/runtime_host.rs:1-4`, méthodes
  `window.create|close|title|resize|info`, `events.read`, `shutdown` aux lignes `:89-91` et `:147-252`). C'est
  déjà un hôte natif de fenêtres piloté depuis Bun par `packages/engine/runtime/src/desktop.ts:1-4`.
- Aucune cible mobile (pas de `mobile_entry_point`).
- Empaquetage : `scripts/build/desktop/artifact.ts` livre le binaire brut et ses licences, sans
  `tauri bundle`.

**m3.**

- `m3/packages/app-ui` (UI canonique) : `@aphrody/api/core` (invoke, Channel), `@aphrody/api/event`,
  `@aphrody/plugin-dialog`, et `window.__TAURI__` / `__TAURI_INTERNALS__` (`src/tauri-bridge.ts:8,47-65`,
  `TopBar/TopBar.tsx:19-96`, `quickbar.tsx:8,31`, `app.tsx:9`).
- `m3-theme/src/tauri.tsx:8-24` lit `__TAURI_INTERNALS__`.
- `m3-next-migrate/src/shims/tauri-ipc.ts:15,44` : shim IPC, 8,8 k lignes au total.
- `scaffold` (1,4 k lignes) génère des coquilles Tauri 3 (`src/tauri.ts`, épingles `src/pins.ts` dans
  `config/tauri-upstream.json` mirrors).
- `web-to-tauri` (4,2 k lignes) génère des projets autour de `aphrody-tauri-wrap`.
- `m3/apps/showcase/scripts/tauri.ts:1-8` : pas de coquille Tauri ; un sidecar Bun compilé sert UI et API
  sur loopback dans la fenêtre d'aphrody-app. C'est le précédent le plus proche de « Bun en backend ».
- `m3/examples/tauri/*` : 10 exemples ; `m3/templates/desktop/src-tauri`.

**Applications et paquets Bun.**

- `apps/yolo/web/src/main.ts:1` : `invoke`, dépendance `@aphrody/api`.
- La commande `yolo tauri|desktop|web` ne fait que `bun run build|dev` dans `apps/yolo/web`
  (`apps/yolo/cli/src/index.ts:317-339`).
- `packages/web/agent-browser/src/tauri.ts:1-13` : client WebSocket du pont de debug.
- `packages/infra/update` : `tauri-sync` et `tauri-apps` (`package.json:199-227`).

**MCP.** `crates/ai/mcp/src/tauri_tools.rs:13-16` expose 14 outils `aphrody_tauri_*`, proxifiés vers le
sous-système fenêtre que l'app enregistre dans le kernel (`crates/ui/app/src/window.rs:2`). Le pont
`tauri-plugin-mcp-bridge` n'est activé par aucun consommateur : la feature `debug-bridge` de tauri-wrap n'est
jamais demandée.

**Plugins Tauri internes.** `aphrody-shell-tauri` (PTY par `Channel`, `crates/shell/tauri/src/lib.rs:2-10`) et
`aphrody-drive` (`crates/ui/drive/src/window.rs:4`).

**Scripts, CI et gates.**

- `scripts/build/shell/tauri-e2e.sh:13` construit l'exemple `shell_e2e` (WebKitGTK sous broadway).
- `config/pipeline.json:1740` (étape `bun-tauri`) exécute typecheck et build de `@aphrody/api`.
- `config/host/toolchain.json:38,117` fixe tauriCli `3.0.0-alpha.4`.
- La CI GitHub (`.github/workflows/{inline-interpreters,update}.yml`) ne construit pas Tauri.
- Aucun script n'appelle `cargo tauri`, `tauri bundle` ou `tauri-driver` (`rg`).

**Consommateur externe.** `aphrody-labs/shenron/Cargo.toml` (GET contents) dépend du fork par git
`aphrody-labs/aphrody@df3ff0dd`. Crates concernées : `aphrody-tauri`, `-build`, `-runtime-wry`,
`-tauri-specta`, et les plugins `log`, `opener`, `process`, `single-instance`, `window-state`. La recherche de
code GitHub ne trouve pas `tauri-runtime-cef` dans shenron (index non garanti, à confirmer).

**Sans consommateur interne ni shenron.**

| Élément | Taille |
|---|---|
| 15 plugins : barcode-scanner, biometric, cli, geolocation, haptics, http, localhost, nfc, persisted-scope, positioner, shell, stronghold, upload, websocket, sql | ≈ 8,8 k rs, 6,9 k ts, 4,1 k kt/swift |
| `tauri-runtime-cef` (seul usage : feature optionnelle des exemples morts) | 20,5 k rs |
| create-tauri-app (+ node) — doublon du scaffolder unique `@aphrody/scaffold`, `config/tauri-apps.json` | 3,4 k |
| restart | 163 |
| tauri-examples (chemins morts) | — |
| Outillage CLI, bundler, driver, schema-* (aucun appelant) | 40 k rs |

PLAN §7-8 prévoit toutefois de publier `api` et les `plugin-*` (`PLAN.md:155-156`). Leur retrait est donc une
décision de publication, pas seulement de code.

### A.3 Ce que signifierait « Bun remplace Tauri »

**Ce que le fork Bun fournit déjà** (`vendor/bun`, Bun 1.4.3).

- **`Bun.WebView`** (`docs/runtime/webview.mdx:8-20,79-89`, `src/runtime/webview/*`, 9,5 k lignes) : navigateur
  **headless** expérimental pour automatisation (navigate, evaluate, click, screenshot). WKWebView sur macOS,
  Chrome/Edge par CDP ailleurs. Ce n'est **pas** une fenêtre native visible : il ne remplace ni tao ni wry.
  - Il est pertinent pour deux usages : les outils MCP `aphrody_tauri_*` (même surface : DOM, evaluate,
    screenshot, wait) et `playwright`/`puppeteer` (`config/bun-absorb.json:52-54`).
  - Contrainte décisive (`src/runtime/webview/HostProcess.rs:1-12`) : WKWebView exige le thread principal, et le
    pont CFRunLoop→kqueue sur le thread JS a été abandonné. Bun lance donc un **sous-processus hôte** qui parle
    par socketpair.
- **`bun build --compile`** (`docs/bundler/executables.mdx`) :
  - cibles linux/windows/darwin x64/arm64 et musl (`:185-198`), **ni Android ni iOS** ;
  - fichiers et répertoires embarqués (`:706+`), exécutables full-stack HTML+serveur (`:557+`), Worker (`:644`),
    SQLite embarquée (`:685`), addons N-API (`:886`) ;
  - `--windows-icon` et `--windows-hide-console` (`:1087-1090`), signature macOS (`:1132`), bytecode et PGO
    (`:270-329`).
- **Mécanisme de modules natifs** : table `HardcodedModule` (`src/resolve_builtins/HardcodedModule.rs:217-227`,
  `src/jsc/modules/NativeModuleList.h:11`) et modules JS embarqués (`src/js/bun/*`, `src/js/thirdparty/*`, où le
  fork sert déjà picocolors, uuid, dotenv et tiny-invariant). Un schéma `yolo:` exige d'étendre ce résolveur ;
  `bun:app` est déjà pris par Bake.
- Le fork est un workspace Cargo d'environ 100 crates (`vendor/bun/Cargo.toml`). `cf4e24966` propage les
  bibliothèques natives Rust au lien Linux (`scripts/build/rust/native-link.ts:1-25`), mais **refuse les chemins
  de frameworks** (assert) : AppKit et WebKit sous macOS ne sont pas couverts.

**Conception proposée** (en s'appuyant sur ce qui existe).

1. **`yolo:window` / `yolo:webview`** : module natif du runtime adossé à un **hôte de fenêtres en
   sous-processus**. C'est le modèle de `Bun.WebView`/HostProcess et de `yolo.desktop/1`.
   - L'hôte (`yolo --window-host` ou binaire dédié) fait tourner l'event loop tao sur son thread principal et
     crée les webviews wry.
   - JS ↔ hôte : trames binaires sur socketpair, avec le modèle de droits de `yolo.desktop/1` (grants
     `window.create|control|observe`, origines autorisées, jeton ; `runtime_host.rs:89-99,395`).
2. **IPC remplaçant `invoke`.**
   - Page → hôte par `window.ipc.postMessage` et un protocole personnalisé `yolo://` (wry
     `with_asynchronous_custom_protocol`).
   - Hôte → runtime par le socket ; côté JS, `view.handle(cmd, fn)` et `view.emit/listen`.
   - `Channel` devient un `ReadableStream`/`MessagePort` avec contre-pression ; le PTY d'aphrody-shell-tauri
     borne à 256 événements.
   - Une couche de compatibilité `__TAURI_INTERNALS__.invoke` laisse `m3/packages/app-ui` inchangé pendant la
     transition.
   - Pages distantes : aucun accès implicite (règle CLAUDE.md) ; l'ACL Tauri (`capabilities/*.json`,
     `dynamic-acl`) doit avoir un équivalent avant bascule.
3. **Logique Rust de l'app** (61 commandes, LLM in-process, kernel, drive) : la garder dans `aphrody_ffi`,
   appelée par `bun:ffi` (PLAN §3), ou dans des processus. Les plugins deviennent :
   - API Bun natives : fs → `Bun.file` plus portées ; store → `Bun.file`/`bun:sqlite` ; os → `node:os` ;
     process ; log ; opener → `Bun.spawn` ; single-instance et deep-link → verrou plus socket ;
     autostart → XDG/LaunchAgent/Run ; updater → `yolo upgrade` (`apps/yolo/cli/src/distribution.ts`) ;
   - côté hôte (crates.io) : dialog → rfd, clipboard → arboard, notification, global-shortcut → global-hotkey,
     tray → tray-icon, menus → muda.
4. **Empaquetage** : `bun build --compile` produit un seul exécutable (UI embarquée par import HTML / `type:
   "file"`, plus l'icône Windows), auquel s'ajoute l'hôte de fenêtres.
   - Manquent : installateurs deb/rpm/AppImage/MSI/NSIS/DMG, ICNS, `.desktop`, signature des mises à jour,
     notarisation. Garder `aphrody-tauri-bundler` comme bibliothèque appelée par `yolo bundle`, ou ne rien
     livrer de plus que le binaire brut actuel (`artifact.ts`).
5. **Mobile** : Bun n'a aucune cible Android/iOS. Tauri mobile (13,3 k lignes kt/swift et la CLI mobile)
   n'a pas d'équivalent. Aphrody-app n'a pas de cible mobile, alors que PLAN l'évoque (`PLAN.md:102`). Il faut
   décider entre l'abandon et le maintien temporaire de Tauri pour le mobile.

**Ordre proposé.**

| Phase | Action |
|---|---|
| 0, sans Bun | Corriger les chemins morts (artifact.ts, exemples, `tauri-apps.json`, `tauri-upstream.json:21`). Déclarer la provenance dans `upstream-sources.json`. Retirer les 15 plugins orphelins, runtime-cef, create-tauri-app(-node), restart et les exemples après décision de publication. Remplacer `aphrody-wry`/`aphrody-tao` par crates.io (aucun patch local), ou les déplacer tels quels dans le dépôt `yolo`. |
| 1 | `yolo:window` = façade du client existant `packages/engine/runtime/src/desktop.ts` (348 lignes) sur l'hôte `aphrody-app --runtime-host` (494 lignes), sans code natif dans le runtime. |
| 2 | Hôte natif tao+wry dans le dépôt `yolo` (sous-processus), sans tauri ni tauri-runtime. Parité grants, origines, événements, puis IPC page↔Bun. |
| 3 | Bascule de m3 `app-ui` par la couche `__TAURI_INTERNALS__`. Showcase : déjà sidecar Bun. `web-to-tauri`, `scaffold` et `m3-next-migrate` générés pour `yolo:window`. Outils MCP sur l'hôte. |
| 4 | aphrody-app réécrite en Bun + `aphrody_ffi` + hôte. Retrait de tauri-wrap, mcp-bridge, shell-tauri (PTY par flux), du plugin drive et de `@aphrody/api`/`plugin-*` (dépréciation npm). |
| 5 | Shenron migré (dépend aujourd'hui de `aphrody-tauri@df3ff0dd`). Ensuite seulement, retrait du cœur tauri, runtime-wry, utils, codegen, macros, build, plugin, specta, cli, bundler (ou bibliothèque conservée), driver, schema-*, acl-tests. |

**Crates qui deviennent inutiles** : toutes celles de `crates/tauri` sauf wry, tao et tao-macros, qui partent
dans `yolo` (ou passent sur crates.io), et éventuellement `bundler`. S'y ajoutent `crates/ui/tauri-wrap`, le
mcp-bridge, `crates/shell/tauri`, la partie Tauri de `crates/ui/drive` et `config/tauri-{apps,upstream}.json`.
Cela représente environ 200 k lignes rs, 20 k ts et 12 k kt/swift.

**Risques.**

1. Thread principal (AppKit, GTK, boucle de messages Windows) : la preuve est dans `HostProcess.rs:1-12`, d'où
   l'hôte en sous-processus.
2. Lier webkit2gtk, WebView2 ou AppKit dans le binaire runtime l'impose aussi aux serveurs. Utiliser un hôte
   séparé ou un chargement à la demande ; le lien macOS n'est pas supporté (assert de native-link).
3. Latence IPC : passer de l'in-process au saut de processus coûte ; à mesurer.
4. Parité de sécurité ACL et capabilities.
5. Perte du LLM in-process d'aphrody-app (`Cargo.toml` features `in-process`).
6. Mobile.
7. Consommateur externe shenron et publication npm/crates.io déjà annoncée (PLAN §8).
8. `Bun.WebView` est expérimental (`webview.mdx:8`).
9. Les déclarations `Bun.tauri` sont fictives (`tauri.d.ts`).

**Mesures avant/après** (comparables, même hôte, n ≥ 20) :

- Taille de l'exécutable desktop et de l'hôte ; démarrage à froid jusqu'au premier rendu ; RSS au repos avec
  5 fenêtres.
- Latence `invoke` ping (p50/p99) et débit `Channel` PTY (Mo/s, contre-pression).
- Temps de build Cargo propre et incrémental de l'app ; nombre de crates dans `cargo tree` ; LOC et membres
  du workspace.
- Taille du bundle `ui-dist` ; gate `tauri-e2e.sh` reproduit sur l'hôte `yolo`.

---

## Volet B — Renommage `aphrody-labs/bun` → `aphrody-labs/yolo`

### B.1 Contenu unique de l'ancien `aphrody-labs/yolo`

**Métadonnées GitHub** (GET) :

- privé, non archivé, 15 855 Ko, créé le 2026-10-03, dernier push le 2026-10-05 02:20 ;
- branches `main` = `dev` (`048886bf9`) et `vendor` (`cb2714551`, 0 en avance / 190 en retard sur main : contenue
  dans main) ; 220 commits sur main ; tag `v0.1.0` → `2e760423` ;
- 0 release, issue, PR, webhook, clé de déploiement, secret, variable, environnement ou fork ;
- 202 exécutions Actions (CI et « Runtime artifact », récentes en échec) ; collaborateurs aphrody-code,
  KyrioFox et aphrody-dev.

**Historique.** Il n'est **pas** dans le monorepo : un seul commit racine
(`git rev-list --max-parents=0 HEAD`). La fusion a copié des fichiers (`255189af1`, `dbd94c7bf`, `cf2fa3f4b`) ;
la branche « yolo » fusionnée par `1cdbae818` était une branche du monorepo. Les 220 commits, leurs messages
et leurs auteurs n'existent que sur GitHub.

**Arbre `main`** (3 977 blobs, comparés par SHA à la base d'objets du monorepo) :

- 2 362 identiques à HEAD ;
- 1 550 présents seulement dans l'historique : Turbopack/Next (59 crates retirées par `b9609c7da`), anciennes
  versions de `config/host`, tests, docs ;
- 65 absents. Presque tous ont un homologue modifié (tests sous `apps/yolo/cli/test/*`, `crates/compat/n2b-core`,
  `crates/compat/toolchains`, fichiers racine).

Éléments réellement uniques :

- `.github/workflows/ci.yml` et `runtime.yml` : matrice runtime en 5 cibles (Linux x64/arm64, macOS
  Intel/arm, Windows), sans équivalent dans `.github/workflows` du monorepo ;
- `.serena/project.yml` et `.npmrc` ;
- anciennes versions de `GOAL`, `PLAN`, `MEMORY`, `TODO`, `AGENTS`, `ARCHITECTURE` et des lockfiles ;
- **10 gitlinks** de sous-modules (`.gitmodules`, branche `yolo`) : `aphrody-labs/{bun@cf4e2496, obscura@43ae887f,
  tauri@890a4e24, plugins-workspace@a50a1b7b, create-tauri-app@c7692bb0, wry@cab3eace, tao@d19f4c12,
  next.js@d2f22200}`, `plugins@cf22c6e9`, `aphrody-m3@a64b9fe4`.

Dépendances vivantes à ce dépôt :

- `py/config/sibling-checkouts.json:4-5` fixe la révision `27403350` (« package reproducible committed SDK
  snapshots », 2026-10-03), qui **n'existe que** dans l'ancien yolo.
- `vendor.lock` y cite les SHA d'import des forks Tauri, qui ne sont atteignables que dans ces forks.

**Conclusion.** Archiver sans perte de contenu est possible. Avant tout renommage :

1. Garder l'historique : archiver et renommer, ne pas supprimer.
2. Repointer `py/config/sibling-checkouts.json`.
3. Décider du sort des workflows `runtime.yml`/`ci.yml`.

Le renommage en `yolo-legacy` (ou autre) est obligatoire pour libérer le nom.

### B.2 Références à classer

`rg` sur le monorepo, hors `vendor/` et lockfiles ; détail dans `refs-*.json` du scratchpad :

| Motif | Lignes | Fichiers |
|---|---:|---:|
| `aphrody-labs/bun` | 47 | 26 |
| `vendor/bun` | 111 | 34 |
| « fork Bun » / « Bun fork » | 121 | 70 |
| `aphrody-labs/yolo` | 81 | 63, dont 49 `Cargo.toml` de `crates/tauri` |
| `bun-forge` | 38 | 16 |

Dans `plugins/`, on trouve 3 occurrences de `aphrody-labs/bun`, 9 de `vendor/bun` et aucune de
`aphrody-labs/yolo` (`yolo/skills/bun-upstream/SKILL.md:13-15`, `plugin-sources.json:142`). Aucune unité
systemd suivie n'est concernée : l'unité bun-forge est générée par `apps/yolo/forge/src/plan.ts:468-487`, avec
une description qui cite `aphrody-labs/bun`.

**À renommer** (opérationnel) :

- `config/vendor.json:8` (url) et `config/bun-forge.json:3-4` (repository) ;
- `scripts/tools/vendor/bun_upstream_sync.ts:2,93-94,244` ;
- `apps/yolo/forge/{src/main.ts:3,23; src/plan.ts:412,471; package.json:4}` ;
- `apps/yolo/cli/src/{index.ts:122; package-commands.ts:119}` et `scripts/audit/workspace/bun-absorb.ts:9` ;
- docs vivantes : `docs/BUN_FORK.md:3,42`, `docs/BUN_UPSTREAM_TRACKER.md:4`, `docs/cli/HELP.md:40,272`,
  `docs/ecosystem/*` (généré), `PLAN.md:115`, `MEMORY.md:40-54` (factuel daté, ajouter une note) ;
- `plugins/yolo/skills/bun-upstream/SKILL.md:13-15` ;
- les remotes : `vendor/bun` (origin) et le miroir de la fabrique bun-forge.

**À garder** (identité `bun`, contrat de compatibilité) :

- le binaire `bun` (lien de compatibilité), le schéma `bun:*`, le global `Bun.*` ;
- `bun.lock`, `bunfig.toml`, les variables `BUN_*` / `BUN_FORGE_*` ;
- `@aphrody/bun-types`, `@aphrody/bun` (FFI), `upstream oven-sh/bun` ;
- le chemin `vendor/bun` : renommer en `vendor/yolo` est optionnel mais touche 34 fichiers, dont 31 lignes de
  `packages/infra/workspace/test/build-factory-source.test.ts`.

**Historique** (ne pas réécrire) :

- `config/host/inventory/2026-09-30-bun-transfer.json` ;
- (removed import receipt) (liens PR 1 et run Actions, redirigés après renommage) ;
- `docs/research/infra/github-mirrors-audit-2026-10-02.md:65`.

**Erreurs préexistantes à corriger dans le lot.**

- `docs/operations/infra/update/BUN.md:7,102` et `docs/operations/infra/UPDATE.md:93` disent le fork
  « supprimé le 2026-10-02 » (faux).
- `docs/reference/infra/APHRODY-BUN-PLATFORM.md:13` dit « privé » ; le dépôt est public.
- `scripts/tools/vendor/packages_upstream_sync.ts:41-98` est mort : 8 sous-modules `vendor/*` disparus,
  `trackingBranch: "yolo"`.
- `scripts/tools/vendor/bun_upstream_tracker.ts:312,346-352` utilise `checkout yolo` / `push origin yolo` sur
  une branche supprimée.
- Épingle en retard : `config/vendor.json:10` = `954db0c0`, alors que le checkout et `main` sont à `c439b6fbd`.
- `apps/yolo/cli/test/{cli_app,stack}.test.ts` lisent `vendor/bun/LATEST` et parlent de « submodule ».

**Références à `aphrody-labs/yolo` qui changeraient silencieusement de sens** (elles désignaient l'ancien
dépôt et pointeraient vers le fork Bun) :

- `apps/yolo/cli/src/distribution.ts:18` (`DEFAULT_REPO`, `yolo upgrade` par releases),
  `apps/yolo/install.sh:4-17` et `install.ps1:2-11` ;
- `py/config/sibling-checkouts.json:4` (révision introuvable dans le fork : cassé) ;
- `packages/engine/plugins/src/generator.ts:82` ;
- `crates/engine/yolo-core/README.md:5`, `vendor.toml:5` et 48 champs `repository` des crates Tauri ;
- les tests `apps/yolo/cli/test/{import,aphrody,upgrade}.test.ts` et
  `packages/infra/workspace/test/build-factory*.test.ts` (fixtures, sans effet réseau) ;
- `docs/DISTRIBUTION.md:8-12`.

Pour les crates Tauri, le nouveau sens (« le dépôt qui absorbera Tauri ») devient cohérent à terme, mais il est
faux tant que le code reste dans le monorepo.

**Statut de la branche du fork.** Sur GitHub, le dépôt a `main` par défaut (`c439b6fbd`, « Merge upstream
oven-sh/bun main into yolo ») et `yolo` absent (404), conformément à la précision du coordinateur. Il compte
toutefois **12 457 branches et 265 tags** (GraphQL `refs.totalCount`), copiés de l'amont à la création du fork
le 2026-10-02. « Branche unique `main` » (`PLAN.md:115`, `config/bun-forge.json:3`) n'est vrai que pour les
branches Aphrody. Le checkout local n'a que `main`.

### B.3 Collisions du nom `yolo` et nomenclature

**Sens actuels de « yolo ».**

1. CLI Bun `yolo` : `@aphrody/yolo-cli`, `apps/yolo/cli`, bin `yolo` (`bin/yolo`), plus de 40 sous-commandes.
2. Outil Rust multi-call `aphrody yolo` (`crates/infra/yolo`, crate `aphrody-yolo`,
   `crates/infra/aphrody-command/src/multicall.rs:35`).
3. Crates `yolo-core` (moteur), `yolo-runtime` (ABI C, rlib) et `yolo-pyo3` (cdylib `_yolo_native`).
4. Paquets `@aphrody/yolo-core` (`packages/engine/core`), `@aphrody/yolo-web` et `@aphrody/bun-forge`
   (`apps/yolo/forge`).
5. SDK runtime « Yolo » : symboles `yolo_*` d'`aphrody_ffi`, protocole `yolo.desktop/1`, `~/.yolo`, `YOLO_ROOT`,
   `YOLO_REPO`.
6. MCP `yolo mcp` (`yolo_*`) et plugin Claude `yolo` (`plugins/yolo`).
7. Projet Python `yolo` (`packages/engine/python/pyproject.toml:6`).
8. Profils et sources `"yolo"` (`apps/yolo/cli/src/host.ts:1463-1628`, workspace profiles).
9. Ancien dépôt `aphrody-labs/yolo`.
10. Branches `yolo` des forks `aphrody-labs/{tauri,wry,tao,plugins-workspace,create-tauri-app,obscura,next.js}`.

**Nomenclature proposée.**

- **`yolo`** = le runtime : dépôt `aphrody-labs/yolo`, fork de Bun 1.4 Rust + JSC, modules natifs `yolo:*`
  (`yolo:window`, `yolo:webview`, `yolo:tray`, `yolo:dialog`, `yolo:ipc`). Le binaire s'appelle `yolo`, avec
  `bun`/`bunx` en argv0 de compatibilité ; les identités `bun:*` et `Bun.*` restent inchangées.
- **CLI d'orchestration** : l'embarquer dans le runtime comme commandes intégrées. Les collisions avec les
  sous-commandes Bun à trancher sont `create`, `update`, `upgrade`, `help` et `--version`/`-v`. Proposition :
  `upgrade` devient la mise à jour yolo (les releases yolo remplacent `bun upgrade`) ; `create`, `update` et
  `help` gardent leur sens Bun ; les variantes yolo passent sous `yolo ws …`/`yolo ops …`. Risque :
  `bun <nom>` exécute un script `package.json` ou un fichier, donc chaque commande intégrée (`status`, `scan`,
  `verify`, `bench`, `docs`, `serve`…) masque les scripts de même nom. Alternative : garder un binaire séparé
  et renommé.
- **`yolo-core`, `yolo-runtime`, `yolo-pyo3` et `@aphrody/yolo-core`** : ce sont la supervision, les benchmarks
  et l'ABI. Deux voies : (a) les déplacer dans le dépôt `yolo` comme modules natifs (`yolo:process`,
  `yolo:bench`) ; (b) les laisser dans le monorepo et les renommer `aphrody-engine-*` (identités publiées :
  conserver des alias, PLAN §5).
- **`aphrody yolo`** (Rust) → à renommer, par exemple `aphrody runtime`, ou à garder s'il pilote le runtime.
- **`yolo.desktop/1`** → devient le protocole de l'hôte `yolo:window` : naming cohérent.
- **Forks Tauri, obscura et next** : les archiver (`PLAN.md:166-168`) sans supprimer leurs branches `yolo`, qui
  portent les SHA de `vendor.lock`.
- **Ancien dépôt** : `aphrody-labs/yolo` → `aphrody-labs/yolo-legacy`, archivé.

### B.4 Effets GitHub (documentation citée)

**Renommer** ([docs.github.com, renaming-a-repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)) :

- Redirigé : « All existing information, with the exception of project site URLs, is automatically redirected
  to the new name » ; « All `git clone`, `git fetch`, or `git push` operations targeting the previous location
  will continue to function ».
- Non redirigé : les actions hébergées dans le dépôt renommé (« GitHub will not redirect calls to an action
  hosted by a renamed repository ») et Pages. Pages n'est pas utilisé (404).
- Réutilisation du nom : « If you create a new repository … do not reuse the original name … redirects to the
  renamed repository will no longer work ». En conséquence :
  1. Renommer `yolo` en `yolo-legacy`, puis `bun` en `yolo`, **casse la redirection `yolo` → `yolo-legacy`**.
     Les URL de l'ancien yolo pointent désormais vers le fork Bun (voir B.2).
  2. `aphrody-labs/bun` redirige vers `aphrody-labs/yolo` tant qu'aucun dépôt `bun` n'est recréé dans
     l'organisation.
  3. GitHub recommande `git remote set-url` : `vendor/bun` origin, miroir bun-forge, `config/vendor.json`,
     `config/bun-forge.json`.

**Réseau de forks** ([transferring](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository),
[about-forks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/about-forks)) :

- Transfert : « If the transferred repository is a fork, then it remains associated with the upstream
  repository » et « webhooks, services, secrets, or deploy keys … will remain associated ». La page de
  renommage n'en dit pas plus ; le parent `oven-sh/bun` est censé rester (non vérifiable avant l'opération).
- Visibilité : « Public repository forks are public » et « You cannot change the visibility of a fork by
  itself ». `aphrody-labs/yolo` restera donc public, avec ses 12 457 branches amont.
- Synchronisation : `POST /repos/{owner}/{repo}/merge-upstream` est indexé par le nom du fork
  ([REST branches](https://docs.github.com/en/rest/branches/branches#sync-a-fork-branch-with-the-upstream-repository)).
  Utiliser `aphrody-labs/yolo` après renommage ; la procédure de `MEMORY.md:47-48` doit être mise à jour.

**État constaté** :

| Dépôt | Clés de déploiement | Webhooks | Secrets | Actions | Collaborateurs |
|---|---|---|---|---|---|
| bun | 0 | 0 | 0 | activées, « all », 31 workflows amont | aphrody-code, KyrioFox, aphrody-dev |
| yolo | 0 | 0 | 0 | 202 exécutions | aphrody-code, KyrioFox, aphrody-dev |

Le fork bun a 0 release et 0 fork. Rien ne casse côté clés.

**Ordre sûr.**

1. Repointer `sibling-checkouts`.
2. Renommer `yolo` → `yolo-legacy`, puis archiver.
3. Renommer `bun` → `yolo`.
4. Mettre à jour en un lot les remotes et configs de B.2, la description bun-forge, PLAN, MEMORY, docs et
   plugins.
5. Vérifier par GET : parent `oven-sh/bun`, `merge-upstream`, et un clone par l'ancien nom.
