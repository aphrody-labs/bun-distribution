# Audit bas niveau, axe GUI-COMPAT : « aphrody compatible avec toutes les libs GUI Rust » (2026-10-01)

Niveau de preuve global : P1 (statique). Lecture seule : aucun cargo/rustc/bun test, aucune écriture hors /tmp/audit-low-level.
Légende : [V] vérifié dans le code local lu ; [N] vérifié par lecture réseau (crates.io API, raw.githubusercontent.com), état au 2026-10-01 ;
[P] plausible, non vérifié (connaissance générale ou déduction). Aucune conformité n'est déduite d'une compilation.
Contrainte du coordinateur (YOLO, docs/reference/os/YOLO-AUTHORITY.md lu en entier) : les traits proposés exposent l'autorité COMPLÈTE de
l'hôte ; aucun adaptateur n'introduit sandbox, approbation ou filtrage de capacités. La seule barrière reste `AuthPolicy` du noyau
(optionnelle, côté serveur, `crates/os/kernel/src/auth.rs:42-60`). Critère retenu : compatibilité FONCTIONNELLE (héberger le shell, afficher une
surface wgpu, appliquer les jetons M3, parler au noyau).

Précautions de méthode (à lire avant les chiffres) :
- Les fermetures « transitives » ci-dessous viennent de MON solveur python (/tmp/audit-low-level/gui-work/fsolve.py) sur
  /tmp/stack-dedup/metadata-after.json : dépendances `normal` seulement (build/dev exclues), cfg(target_os) évalués pour linux/windows/macos,
  features résolues par crate (défauts du crate racine + features déclarées par chaque arête). Ce n'est pas le solveur de cargo ; l'unification
  des features entre dépendances tierces est approximée. Le graphe `resolve` brut (unifié sur tout le workspace) donne des bornes hautes
  (ex. noyau : 998 crates avec ratatui/arboard, car la feature `builtins` est activée par le binaire du noyau lui-même).
- Pendant l'audit, `~/.cargo/registry/src` a été vidé (08:17, activité du lead) ; les sources tierces ont ensuite été lues en flux depuis
  `~/.cargo/registry/cache/index.crates.io-*/*.crate` (tar -xzO) : rien extrait dans le dépôt.

## 1. Périmètre réellement lu

- Dépôt : crates/ui/app/src/{window.rs (intégral), lib.rs (1-837), broker.rs (28-70, 280-330)}, crates/ui/tauri-3d/src/{layer.rs (80-280), dcomp.rs},
  crates/ui/model-view/src/main.rs, crates/ui/render/src/{lib.rs 1-80, gpu.rs 20-200, gpu3d.rs 395-440}, crates/ui/m3-tokens/src/{lib.rs, facade.rs 1-200,
  color.rs (extraits), grep scheme/typography/motion}, crates/os/kernel/src/{client.rs (1-268), remote.rs, transport.rs (1-282), auth.rs (1-100), lib.rs 1-120 et 318-365,
  rpc.rs 10-40}, crates/os/kernel-client/src/lib.rs (intégral), crates/contracts/subsystem (grep trait), Cargo.toml racine (grep), manifestes de
  ui/{app,render,render-tools,tauri-3d,m3-tokens}, os/{kernel,kernel-client}, contracts/subsystem, apps/cli ; docs/architecture/rust-crate-gpu-window-ownership.md ;
  rapports voisins gpu.md et affichage.md (en-têtes, §0/§1).
- Sources locales tierces : Cargo.lock cosmic-epoch (cosmic-edit, cosmic-comp, cosmic-term + grep des 28 autres), iecode/Cargo.toml + Cargo.lock +
  crates/{aphrody-gpu-backend,aphrody-egui-wgpu,aphrody-egui-winit,bevy/bevy_winit}, aphrody/Cargo.lock (grep) ; .crate en cache : egui 0.36.2 (context.rs),
  eframe 0.34.1 (epi.rs), egui-wgpu 0.34.3 (lib.rs, renderer.rs), rfd 0.17.2, tray-icon 0.25.1, global-hotkey 0.8.0, muda 0.20.0, notify-rust 4.17.0, arboard 3.6.1.
- Réseau [N] : crates.io (/crates/<nom> + /<version>/dependencies) pour ~100 crates (iced*, egui*, slint*, gpui*, xilem/masonry/vello/parley, floem, makepad, dioxus*,
  blitz*, freya*, relm4/gtk4/libadwaita, cxx-qt*, fltk, wry/tao/winit/softbuffer/wgpu/tauri*, accesskit*, ratatui/crossterm, bevy*, kas*, vizia*, ribir, cushy,
  dear-imgui*, wxdragon, nannou, servo, sciter/azul/druid/orbtk/lvgl/native-windows-gui…) ; raw.githubusercontent.com : iced 0.14.0 (Cargo.toml, wgpu/src/primitive.rs),
  slint v1.18.1 (api/rs/slint/{Cargo.toml,lib.rs}, internal/core/api.rs, LICENSE.md), zed main (gpui/Cargo.toml, gpui_wgpu, gpui_platform, Cargo.toml, window.rs,
  elements/surface.rs), xilem main (Cargo.toml), floem main (Cargo.toml), bevy v0.20.0-rc.2 (bevy_render, bevy_winit Cargo.toml). Données brutes : /tmp/audit-low-level/gui-work/.

## 2. PARTIE 1 : couplage actuel

### 2.1 Dépendances GUI/fenêtrage par crate (directes + transitives, solveur feature-aware, Linux ; Windows/macOS = ajouts indiqués)

| Crate (chemin) | Directes GUI (manifeste) | Transitives GUI (fermeture normal) | Verdict |
|---|---|---|---|
| contracts/subsystem | aucune | aucune (30 crates, tokio/serde/async-trait) | neutre [V] |
| os/kernel-client | aucune | aucune (27 crates, tokio) | neutre [V] |
| os/kernel, lib seule (default-features=false, Cargo.toml racine:92) | aucune | aucune sur Linux/macOS (357 crates) ; Windows : `windows` 0.62.2 via `aphrody-winclean` non optionnel (kernel/Cargo.toml:37) | neutre côté GUI [V] |
| os/kernel + `builtins` (binaire du noyau, défaut) | aucune | aphrody-shell→aphrody-nu→nu-command→arboard 3.6.1 (→x11rb, wl-clipboard-rs→wayland-client ; macOS objc2-app-kit) ; aphrody-shell→aphrody-tui→ratatui 0.30.2/crossterm 0.29.0 (745 crates) | GUI-adjacent seulement dans le binaire [V] |
| ui/m3-tokens | aucune | aucune (2 crates avec base64 ; no_std sans `std`) | neutre [V] |
| ui/render (défaut) | aucune | fontdue 0.9.4 seulement (46 crates) | neutre [V] |
| ui/render (`gpu`) / render-tools (aphrody-render3d) | wgpu 30.0.1 (optionnel, render/Cargo.toml:44) | wgpu-core/hal 30.0.1, raw-window-handle 0.6.2 (394 crates ; Windows : windows 0.58/0.62) ; render-tools lie aphrody-kernel (Cargo.toml:30) sans builtins | wgpu seulement ; pas de toolkit [V] |
| ui/svg, identity, bun, softraster, sprite-sheet, a2a-ui, m3-reproduce | skrifa/tiny-skia 0.12.0 (svg, optionnels) | kurbo, skrifa 0.47.0, tiny-skia | neutres (2D CPU) [V] |
| ui/tauri-3d | tauri (default-features=false : AUCUN runtime) ; windows (cfg) | tauri 3.0.0-alpha.3, tauri-runtime 3.0.0-alpha.2, muda 0.20.0, wgpu 30.0.1, raw-window-handle (264 crates) | couplé Tauri (API) mais sans wry/tao/gtk [V] |
| ui/tauri-wrap | tauri | idem sans wgpu (255) | couplé Tauri [V] |
| ui/drive | tauri, windows | tauri + muda + tauri-runtime (445) ; licence FSL-1.1-ALv2 (drive/Cargo.toml) | couplé Tauri [V] |
| ui/model-view | tauri, tauri-runtime-wry | + wry 0.57.0, tao 0.37.1, gtk 0.18.2/gdk/webkit2gtk 2.0.2 (Linux), webview2-com 0.39.1 (Windows), objc2-app-kit (macOS), wgpu 30.0.1 (319) | binaire Tauri/wry [V] |
| ui/app (aphrody-app) | tauri, tauri-runtime-wry, 8 plugins tauri (dialog, clipboard-manager, notification, global-shortcut, window-state, single-instance…) | tout ce qui précède + tray-icon 0.25.1, ksni 0.3.6, global-hotkey 0.8.0, notify-rust 4.17.0, rfd 0.16.0, arboard 3.6.1, wl-clipboard-rs, x11rb, wayland-client 0.31.15, wgpu 30.0.1 (665 ; Windows 620, macOS 591) | le seul vrai « shell toolkit » [V] |
| ui/tauri-mcp | aucune | aucune GUI (394) | neutre [V] |
| apps/cli (aphrody) | aucune (kernel default-features=false) | ratatui 0.30.2, crossterm 0.29.0, tiny-skia 0.12.0 (965) ; macOS : objc2-app-kit (via webbrowser) | TUI seulement [V] |
| koharu/* (IMPORTÉ) | koharu : rfd 0.17.2, tauri, tauri-runtime-cef ; koharu-rasterizer/renderer : vello 0.10.0 ; koharu-canvas : vello (wasm32) | tauri 3.0.0-alpha.3 + tauri-runtime-cef 3.0.0-alpha.4 → tauri-winit 0.31.0-beta.3 (fork), gtk4/gdk4 0.11.5, cef 152.3.0, softbuffer 0.4.8, tray-icon, wgpu **29.0.3** (via vello) | fait : second toolkit (CEF) + wgpu 29 dans le même lock |

Autres faits du Cargo.lock aphrody [V] : AUCUN `accesskit`, `cosmic-text`, `egui`, `eframe`, `iced`, `slint`, `winit` (nu), `gpui`, `xilem`, `bevy`, `parley` ;
`raw-window-handle` 0.6.2 unique ; `wgpu` 29.0.3 ET 30.0.1 ; `rfd` 0.16.0 ET 0.17.2 ; `arboard` 3.6.1 ; `notify-rust` 4.17.0 ; `tray-icon` 0.25.1 ;
`global-hotkey` 0.8.0 ; `muda` 0.20.0 ; `auto-launch` 0.5.0 ; `open` 5.4.4 ; `webbrowser` 1.2.4 ; `taffy` 0.12.1 (chemin, importé) ; `ashpd` absent.

### 2.2 FRONTIÈRE réelle : API publiques qui exposent des types de toolkit [V]

- `crates/ui/app/src/window.rs:38-45` `WindowSubsystem::new(app: AppHandle)` ; `lib.rs:186-193` `TauriWebviewSubsystem` ; `broker.rs:147` `AppServerBroker::new(AppHandle)` (+ `Channel<Value>`,
  `Emitter::emit`, `tauri::async_runtime::spawn`, lignes 15, 286, 322) ; `integration.rs:164-278,436` (`&AppHandle`) ; `quickbar.rs:24-92` (`<R: Runtime>`) ; `models.rs`, `koharu.rs:42`, `runtime.rs:36`.
- `crates/ui/tauri-3d/src/layer.rs:125` `NativeLayer::attach<R: tauri::Runtime>(window: &tauri::Window<R>)` ; `lib.rs:70,113,252` (`attach_window`, `load_path`, `init`).
- `crates/ui/tauri-wrap/src/lib.rs:121` `init<R: Runtime>` ; `window.rs:81` `build<R>` ; `crates/ui/drive/src/lib.rs:292` `init() -> TauriPlugin<DynRuntime>`, `window.rs:20` `show(&AppHandle<DynRuntime>)`.
- Déjà un joint : Tauri 3 choisit son runtime explicitement (`.runtime(tauri_runtime_wry::Wry::default())`, lib.rs:670) ; `broker.rs:44-55` a un trait `NotificationSink` (impl pour `Channel<Value>`) ;
  `tauri-3d` n'active AUCUN runtime (`tauri` default-features=false, Cargo.toml racine:412).
- Le noyau, les jetons, le rendu et libaphrody n'exposent aucun type de toolkit (§2.1).

### 2.3 Où vit la logique window_open / focus / set_bounds / clipboard / notify, et ce qu'il faut extraire

Dans `crates/ui/app/src/window.rs` (le sous-système « window » du noyau, 335 lignes) :
- **Neutre (à extraire tel quel)** : schémas des 10 outils `window_list/open/focus/close_label/set_bounds/set_state/set_title`, `desktop_notify`, `clipboard_read/write` (l.101-163) ;
  validation d'arguments (label `[A-Za-z0-9_-]`, l.176-182 ; URL http/https, l.194-201 ; tailles par défaut 1100x760, l.202-203 ; états `minimized|maximized|normal|hidden|shown`, l.258-269) ;
  `adaptive_title` (l.21-36) ; JSON de `describe` (l.67-81) ; skill `open_beside` (l.298-317, géométrie 1920x1080 codée en dur) ; consommation de l'événement bus `desktop/notify` (l.319-333).
- **Couplé Tauri (à passer derrière un trait)** : `AppHandle::get_webview_window/webview_windows`, `WebviewWindowBuilder`, `Position/Size`, `ClipboardExt`, `NotificationExt` (l.14-19, 48-61, 166-293).
- `lib.rs` : `start_kernel` (49-98 ; enregistre en processus OU rejoint via `host_remote`), publication `window/focused|closed` sur le bus via `static BUS` (43, 746-757), actions de barre de titre M3
  (`ShellWindowAction`, 545-656 : close/minimize/maximize/start_dragging/set_theme), outils DOM `tauri_*` (196-499, `eval_with_callback` → capacité « webview », non portable aux toolkits natifs).
- Ce que le noyau suppose d'un hôte fenêtre : RIEN de plus que des outils enregistrés par `register` (in-process) ou `system/register_subsystem` (distant) ; les noms `window_*`, `desktop_notify`, `clipboard_*`, les événements
  `window/focused|closed`, `desktop/notify` forment le contrat. Collision connue `window_close` (admin Win32 `hwnd`) vs `window_close_label` (window.rs:124-126). `rpc.rs:21` nomme « window: the desktop ».
- Extraction proposée : trait `WindowHost` + capacités (§4.1) ; `WindowSubsystem<H>` générique dans une crate neutre ; l'adaptateur Tauri devient une impl mince de `WindowHost`.

### 2.4 Surface : comment aphrody-render / tauri-3d obtiennent un pixel à l'écran [V]

- `tauri-3d/src/layer.rs:131` : `context.instance.create_surface(window.clone())` — cible = tout type `HasWindowHandle + HasDisplayHandle + Send + Sync + 'static` (raw-window-handle 0.6) ; Windows/DX12 :
  visual DirectComposition (`dcomp.rs`, `SurfaceTargetUnsafe::CompositionVisual`, layer.rs:179-205) pour l'alpha prémultiplié sous le webview. L'attache n'utilise de `tauri::Window` que `inner_size()` (127) et la poignée :
  le découplage vers un `HasWindowHandle` générique est quasi trivial (GC-07).
- `aphrody-render` (neutre, `#![forbid(unsafe_code)]`, lib.rs:13) offre trois niveaux, tous indépendants du toolkit : (a) CPU déterministe (référence pixel pour pixel) ; (b) offscreen GPU + readback RGBA8 straight-alpha
  (`render_scene_gpu` gpu.rs:205, `GpuFrame.rgba` gpu.rs:35-45) ; (c) `Renderer3d::with_device(device, queue, report)` (gpu3d.rs:218) + `render_to_view(prepared, &TextureView, format, size, origin)` (gpu3d.rs:418) ou
  `render_to_texture` (gpu3d.rs:405, `Rgba8Unorm`). `pub use wgpu` (lib.rs) force l'hôte à utiliser la même version. `shared_context()` (gpu.rs:127) crée Instance/Adapter/Device uniques (Vulkan/DX12/Metal/WebGPU/WebGL, pas GL).
- Aucun toolkit « tiers » ne fournit aujourd'hui sa surface à aphrody : seul `create_surface(window)` + notre propre device. Un hôte avec son propre device (egui/iced/slint…) n'est exploitable que via le niveau (c) à version wgpu identique, sinon (b).

### 2.5 Jetons M3 : ce qu'ils exposent, ce qui manque [V]

- Expose : `ColorRoles` (36 rôles u32 ARGB, consts `BASELINE`, `BASELINE_DARK`, `APHRODY`, `APHRODY_DARK`, color.rs:106-253) ; `export_css` (:309), `color_vars` (:507, couples nom/#RRGGBB), `export_tailwind_theme/shadcn_aliases/fusion_css` ;
  `DynamicScheme`/`Variant`/`Role` (scheme.rs:364-471, port de material-color-utilities, `std`) ; `TypeStyle` x15 (typography.rs:179) ; `Easing/CubicBezier/M3Spring` (motion.rs) ; `CornerRadius` (shape.rs) ; `StateLayer` ; `Breakpoint/LayoutContract`
  (adaptive, facade.rs:118-160) ; `ThemeMode {System, Light, Dark, HighContrast}` ; constantes d'accessibilité (cible 48 dp, contraste WCAG) (facade.rs:51-65). `no_std` sans `std` : color/elevation/motion/shape/state/typography/adaptive/spaceui/tonal ;
  `std` : CSS, dynamic, scheme, hct, facade (lib.rs:32-82).
- Manque pour alimenter d'autres toolkits : (1) un instantané de thème sérialisable (serde est seulement en dev-dependency, m3-tokens/Cargo.toml:30-32) ; (2) conversions couleur f32 linéaire/sRGB, `[f32;4]`, `Color32`-like ;
  (3) tables de correspondance rôle→toolkit (egui `Visuals`, iced `Palette`, Slint `Palette`, GTK CSS, Qt `QPalette`, ratatui `Color::Rgb`) ; (4) source de `ThemeMode::System` (portail XDG Settings / appel natif) et notification de changement ;
  (5) élévation en ombres (dp→flou/offset) et mouvement mappés vers les API d'animation de chaque toolkit. Seul le web (CSS) est servi aujourd'hui.

### 2.6 Client du noyau depuis une boucle non-tokio [V]

- Deux clients : `aphrody_kernel::client::Client` (multiplexé, `incoming` pour notifications/requêtes, `host_remote` ; client.rs:38-268) et `aphrody-kernel-client::KernelClient` (série, 27 crates, un `Mutex` autour du flux ; lib.rs:113-245).
- Dépendance dure à tokio dans les deux : `Client::from_stream` appelle `tokio::spawn` (client.rs:74, 97) → panique hors contexte tokio ; `request` utilise `tokio::time::timeout` (147) ; `KernelClient::request` idem (lib.rs:213) et
  `UnixStream::connect`/pipes nommés tokio (lib.rs:247-273, transport.rs:200-230). Aucune API bloquante, aucune API indépendante de l'exécuteur. `Client.incoming` est un `mpsc::UnboundedReceiver` tokio (exploitable depuis n'importe quel exécuteur pour `recv().await`, mais pas la connexion).
- Send/Sync : `SystemSubsystem: Send + Sync` (contracts/subsystem/src/lib.rs:223) ; `KernelClient` = tokio `Mutex<BufReader<Box<dyn KernelIo + Send>>>` + `AtomicU64` → Send+Sync par construction [P : non compilé] ; futures tenant un garde tokio = Send [P].
- Conséquence : une boucle GLib/winit/Qt/calloop doit posséder un runtime tokio privé (thread dédié) et ponter par canaux ; il n'y a pas de client « sans runtime ». Défauts relevés : GC-01, GC-02, GC-04.

## 3. Constats (ordre de gravité ; ≤ 15)

| ID | Sév. | chemin:ligne | constat | preuve |
|---|---|---|---|---|
| GC-01 | MOYENNE (HAUTE dès qu'un adaptateur GUI garde un `KernelClient` ouvert) | crates/os/kernel-client/src/lib.rs:220-227 ; crates/os/kernel/src/transport.rs:118-119 ; kernel/src/lib.rs:333-337,356-360 | `KernelClient::request` lit la PROCHAINE ligne et exige `id == requête` sinon `Protocol("response id does not match request")`, sans sauter les notifications. Le noyau envoie `notifications/tools/list_changed` (sans id) à TOUTES les sessions à chaque `register`/`unregister` (dont le démarrage du desktop via `host_remote`). La réponse réelle reste dans le flux : décalage permanent d'un cran, la connexion est inutilisable jusqu'à reconnexion. | [V] lecture du code des deux côtés ; non reproduit |
| GC-02 | MOYENNE | crates/ui/app/src/lib.rs:56-66 ; crates/os/kernel/src/client.rs:242-267 | `host_remote` retourne quand la connexion se ferme ; l'appelant journalise et `return` : aucun rejeu. Après un redémarrage du noyau, les sous-systèmes `window`/`tauri` du desktop ne sont plus enregistrés tant que l'appli n'est pas relancée. | [V] |
| GC-03 | MOYENNE (dette) | crates/ui/app/src/window.rs:14-19,48-61,166-293 | Logique d'outil (schémas, validation, JSON) et appels Tauri sont mêlés dans un type dont le constructeur prend `AppHandle` ; aucun test ne peut utiliser un autre hôte. | [V] |
| GC-04 | BASSE | kernel/src/rpc.rs:18 vs kernel-client/src/lib.rs:194 ; transport.rs:60-79 vs kernel-client/src/lib.rs:90-110 | Dérive : protocole MCP `2025-06-18` (noyau) vs `2025-03-26` (client série) ; `default_endpoint` dupliqué ; deux clients aux sémantiques différentes (auth via env vs options). | [V] |
| GC-05 | MOYENNE | crates/ui/tauri-3d/src/layer.rs:125-131 | `NativeLayer::attach` est générique sur `tauri::Runtime` alors que seuls `inner_size` et une poignée raw-window-handle servent ; empêche tout autre hôte de réutiliser la couche native (le chemin DComp ne lit que `HasWindowHandle`, :184-189). | [V] |
| GC-06 | MOYENNE | Cargo.lock (wgpu 29.0.3 et 30.0.1) ; iecode/Cargo.toml:505,655-661 | Fragmentation wgpu : vello 0.10 (koharu) tire wgpu 29.0.3 à côté du wgpu 30.0.1 d'aphrody-render ; iecode remplace wgpu par un fork `aphrody-wgpu` 30.0.0 via `[patch.crates-io]` → types NON interchangeables avec le wgpu 30.0.1 du monorepo malgré le même numéro. | [V] |
| GC-07 | BASSE | crates/ui/app/src/window.rs:298-317 | Skill `open_beside` code en dur une zone 1920x1080 (x=960, 960x1040) : faux hors écran 1080p, et non liée à une API d'écran. | [V] |
| GC-08 | MOYENNE | rfd/global-hotkey (cache .crate) ; Cargo.lock | Briques actuelles : `global-hotkey` 0.8.0 « Linux (X11 only) » (README) → raccourcis globaux inopérants sous Wayland pur ; aucun `ashpd` (portail GlobalShortcuts) dans le lock ; aucun `accesskit` : pas de pont d'accessibilité pour un toolkit natif. | [V] |
| GC-09 | BASSE | m3-tokens/Cargo.toml:30-32 ; lib.rs:32-82 | Pas d'instantané sérialisable de thème (serde dev-only), schéma dynamique/HCT derrière `std` : un adaptateur no_std ou IPC ne peut pas consommer un `DynamicScheme`. | [V] |
| GC-10 | BASSE (décision) | crates/ui/app/src/window.rs:109-111,194-201 | `window_open` limité à http/https et « no desktop capability » : politique d'outil existante, en tension avec la ligne « autorité complète » du propriétaire ; le futur `WindowHost` ne doit pas la graver dans le trait (voir décisions). | [V] |
| GC-11 | MOYENNE | Cargo.toml racine:412-430 ; crates.io | Le shell de référence est épinglé sur Tauri **3.0.0-alpha.3** et plugins `=3.0.0-alpha.2` ; la stable crates.io est 2.12.1 [N]. Toute abstraction doit survivre à un changement d'API Tauri 3. | [V]+[N] |
| GC-12 | BASSE | crates/ui/drive/Cargo.toml (`license = "FSL-1.1-ALv2"`) | Crate du workspace sous licence Functional Source (non Apache-2.0 pur) dans un dépôt déclaré Apache-2.0 (Cargo.toml racine:18) ; à mentionner si un adaptateur la lie. | [V] |

## 4. PARTIE 2 : matrice des toolkits (état crates.io/GitHub au 2026-10-01 [N], sauf mention)

Notation wgpu : version exigée par la version publiée (et, entre parenthèses, le git main si différent).

| Toolkit | Version publiée / dernier publish | Licence | Rendu (wgpu) | Fenêtrage | Async / boucle | Texte / a11y | Mécanisme surface wgpu externe | Thème |
|---|---|---|---|---|---|---|---|---|
| iced | 0.14.0 (2025-12-07) ; iced_winit 0.14.1 (2026-09-13) | MIT, MSRV 1.88 | wgpu **27.0** (iced/Cargo.toml:236 @0.14.0) ; tiny-skia 0.11 + softbuffer en repli | winit 0.30 | executor `thread-pool` par défaut ; features `tokio`/`smol` (Cargo.toml:25,56-59) | cosmic-text 0.15 ; pas d'accesskit amont [P] | `iced::widget::shader` → trait `iced_wgpu::primitive::Primitive` (prepare/draw/render avec `&TextureView`), `MaybeSend+MaybeSync` [V primitive.rs] | `Theme`/`Palette` [P] |
| libcosmic (iced fork) | 1.0.0 **git seulement** (« crate libcosmic does not exist ») ; cosmic-text 0.19.0 (2026-04-22) | libcosmic MPL-2.0 [P] ; apps COSMIC GPL-3.0 (indiqué par le propriétaire) [P] | wgpu **28.0.0** (cosmic-edit/cosmic-comp Cargo.lock [V]) | winit 0.31.0-beta.2 fork pop-os (rev 9567503) ; smithay-client-toolkit 0.20.0 | calloop 0.14.4 ; tokio 1.53.1 [V lock] | cosmic-text 0.19.0, accesskit 0.22.0 fork wash2 [V lock] | shader widget d'iced fork (même Primitive) [P] | `cosmic-theme` (git) ; MPL/GPL à confirmer |
| egui / eframe | 0.36.2 (2026-09-08), MSRV 1.95 | MIT OR Apache-2.0 | egui-wgpu ^**30.0** (identique à aphrody-render) ; glow/glutin en option | winit ^0.30.13 | immédiat ; `Context` = `Arc<RwLock<…>>` Clone+Send+Sync (egui context.rs:722-723 [V]) ; `request_repaint` depuis tout thread | epaint ; accesskit ^0.24.1 (accesskit_winit ^0.32.0) | `egui_wgpu::CallbackTrait` (prepare/finish_prepare/paint dans le `RenderPass<'static>`, Send+Sync) [V egui-wgpu 0.34.3] ; `eframe::Frame::wgpu_render_state()` donne adapter/device/queue/target_format [V eframe 0.34.1] | `Visuals`/`Style` [P] |
| slint | 1.18.1 (2026-09-21), MSRV 1.92 | **GPL-3.0-only OR Royalty-free-2.0 OR commerciale** [V LICENSE.md] | femtovg (GL, défaut), Skia, logiciel, vello ; features `unstable-wgpu-29` / `unstable-wgpu-30` (slint/Cargo.toml) | winit ^0.30.2 ; LinuxKMS, Qt, Android | boucle propre, `RenderingNotifier` ; `slint::Weak`/`invoke_from_event_loop` [P] | parley ^0.11.1 ; accesskit ^0.24 | `Window::set_rendering_notifier` + `GraphicsAPI::WGPU30{instance,device,queue}` (api.rs:266-312) ; import `slint::Image::try_from(wgpu::Texture)` [V lib.rs:584] | langage `.slint` + `Palette` global [P] |
| gpui (Zed) | crates.io 0.2.2 (2025-10-22) obsolète ; **git main** : gpui_wgpu + wgpu **29.0.4**, accesskit 0.24, taffy =0.13.0 | Apache-2.0 | Linux/Windows via `gpui_wgpu` (main) ; Metal macOS | propre (wayland/x11 features) | smol 2.0 + exécuteur propre ; crate `gpui_tokio` [V zed Cargo.toml:374] | font-kit zed, accesskit | `paint_surface(CVPixelBuffer)` **macOS/iOS seulement** ; portable : `paint_image(Arc<RenderImage>)` (CPU) [V window.rs:4875,4977] | gpui-component 0.7.0 (2026-09-28, Apache-2.0) |
| xilem / masonry | crates.io 0.4.0 (2025-10-29, vello 0.6, parley 0.6, accesskit 0.21, tokio 1.48) ; git main (MSRV 1.96) : vello 0.8, **wgpu 28.0.0**, parley 0.8, winit 0.30.13, accesskit 0.24 | Apache-2.0 | vello (wgpu) | winit 0.30 | tokio (dépendance normale) | parley, accesskit | pas de point d'entrée « wgpu externe » vérifié ; scène vello/`peniko::Image` [P] | thème Masonry [P] |
| floem | crates.io 0.2.0 (2024-11-14, wgpu ^22, floem-winit ^0.29.5) obsolète ; git main (dernier commit 2026-09-24, MSRV 1.91) : **wgpu 27**, parley 0.7, peniko 0.6, taffy 0.9.2, fork floem-winit | MIT | vello / vger / skia / tiny-skia | fork winit lapce | canaux `ext_event` ; tokio optionnel | parley | pas de point d'entrée vérifié [P] | styles floem [P] |
| makepad | makepad-widgets 1.0.0 (2025-05-13) | MIT OR Apache-2.0 | moteur GPU propre (aucun wgpu/winit en dépendance) | propre | boucle propre | propre | CPU image uniquement [P] | DSL `live_design` [P] |
| dioxus desktop | 0.8.0-alpha.1 (2026-07-31) : wry ^0.55.1, tao ^0.35.2, muda ^0.19.1, tray-icon ^0.24, rfd ^0.17.2 | MIT OR Apache-2.0, MSRV 1.85 | webview système (pas de wgpu) | tao/wry | tokio | DOM | même technique que tauri-3d sous webview via poignée tao [P] | CSS (jetons M3 déjà prêts) |
| dioxus native (Blitz) | dioxus-native 0.8.0-alpha.1 ; blitz 0.3.0-beta.2 (2026-08-24) ; anyrender_vello 0.14.0 → vello ^0.10, **wgpu ^29**, wgpu_context 0.9 | MIT OR Apache-2.0, MSRV 1.89 | vello/vello_hybrid/skia/vello_cpu | winit **=0.31.0-beta.2** (exact) | tokio optionnel | parley 0.11.1, accesskit 0.24 | source de peinture personnalisée Blitz [P non lu] | CSS (Blitz rend du HTML/CSS) |
| freya | 0.5.0-rc.8 (2026-09-29) | MIT | Skia (freya-engine) [P] ; gl/glutin ou softbuffer 0.4.8 | winit ^0.30.13 (accesskit_winit ^0.33) | tokio [P] | accesskit ^0.24 | non vérifié [P] | thèmes freya-components [P] |
| relm4 / gtk4-rs | relm4 0.11.0 (2026-04-08, MSRV 1.93) ; gtk4 0.11.5 (2026-09-20) ; libadwaita 0.9.2 | Apache-2.0 OR MIT ; gtk4-rs MIT ; GTK4 lib LGPL-2.1+ [P] | GSK (GL/Vulkan) | GTK/GDK (Wayland/X11/Win/macOS) | boucle GLib + tokio ^1.51 (dépendance de relm4) | Pango, AT-SPI natif | `gdk::MemoryTexture` (CPU) ; dmabuf `gdk::DmabufTexture` GTK ≥4.14 [P] ; pas de wgpu surface native fiable [P] | CSS GTK/libadwaita [P] |
| cxx-qt (Qt) | 0.10.0 (2026-08-24, MSRV 1.85) ; qmetaobject 0.2.10 (2023-11-03) obsolète | MIT OR Apache-2.0 (crate) ; Qt LGPL-3/GPL/commerciale [P] | Qt RHI (Vulkan/D3D/Metal/GL) | Qt | boucle Qt ; `CxxQtThread` [P] | Qt | `QQuickRhiItem`/`QImage` [P] ; import VkImage wgpu-hal très lourd | QPalette/QML [P] |
| fltk-rs | 1.5.23 (2026-05-03, MSRV 1.71) | MIT (crate) ; FLTK LGPL-2 + exception [P] | GL/Cairo/logiciel | FLTK natif | `app::awake`, canaux [P] | FLTK | feature `raw-window-handle` 0.4/0.5/**0.6** optionnelles [N] → surface wgpu sur fenêtre FLTK [P] | style FLTK [P] |
| tauri (déjà) | 3.0.0-alpha.3 (2026-09-30, MSRV 1.90) ; stable 2.12.1 | Apache-2.0 OR MIT | webview (wry 0.57.0) ou CEF | tao 0.37.1 (2026-09-26) / tauri-winit | tokio (`tauri::async_runtime`) | DOM | surface sous le webview par poignée rwh 0.6 (tauri-3d, [V]) ; DComp Windows | CSS (m3-tokens) |
| wry + tao nus | wry 0.57.0 (2026-09-08), tao 0.37.1 | Apache-2.0 (OR MIT pour wry) | webview | tao (rwh 0.4/0.5/0.6 en features) | `EventLoopProxy` [P] | DOM | idem tauri-3d sans Tauri [P] | CSS |
| winit + softbuffer/wgpu nus | winit 0.30.13 (stable) / 0.31.0-beta.3 (2026-09-04) ; softbuffer 0.4.8 (2025-12-13) ; wgpu 30.0.1 (2026-08-22) | Apache-2.0 / MIT OR Apache-2.0 | wgpu 30 direct ou CPU softbuffer | winit | `EventLoopProxy` [P] | à fournir (cosmic-text/parley) ; accesskit_winit 0.34.1 (accesskit 0.25.1) | `instance.create_surface(Arc<Window>)` : même motif que layer.rs:131 [V] | à fournir |
| ratatui | 0.30.2 (2026-06-19, MSRV 1.88) ; crossterm 0.29.0 | MIT | cellules texte ; images via sixel/kitty/half-blocks (hors crate) [P] | terminal | synchrone ; flux async crossterm [P] | texte | CPU image uniquement (déjà dans le lock : aphrody-tui) | `Color::Rgb` depuis `ColorRoles` |
| bevy_ui / bevy_egui | bevy 0.20.0-rc.2 (2026-09-28, MSRV 1.96) ; bevy_egui 0.43.0-rc.1 (egui ^0.36) | MIT OR Apache-2.0 / MIT | **wgpu ^30** (bevy_render v0.20.0-rc.2 [N]) | bevy_winit (winit 0.30) | ECS + `bevy_tasks` ; ressources Send+Sync [P] | accesskit ^0.24 (bevy_ui) | passes du render graph / texture handle Bevy [P] ; egui via bevy_egui | styles Bevy / `Visuals` |
| sciter / azul / druid / orbtk / lvgl / native-windows-gui | sciter-rs 0.5.58 (2022-02) ; azul 1.0.0-alpha4 (2021-08), azul-dll 0.0.5 (2025-03, MPL-2.0, rwh ^0.5) ; druid 0.8.3 (2023-02) ; orbtk 0.3.1-alpha4 (2022-03) ; lvgl 0.6.2 (2023-04) ; nwg 1.0.13 (2022-09) | MIT/MPL | — | — | — | — | **à écarter** (abandonnés ou runtime propriétaire Sciter [P]) | — |

Autres toolkits notables [N] : **kas** 0.17.0 (2026-01-27, Apache-2.0, kas-wgpu 0.17.1 → wgpu ^28.0.0) ; **vizia** 0.4.0 (2026-04-23, MIT, skia-safe ^0.93.1, winit 0.30.13, glutin) ;
**ribir** 0.4.0-alpha.65 (2026-04-21, MIT, winit ^0.30.11, wgpu ^29 optionnel) ; **dear-imgui-rs** 0.18.0 (2026-09-15, MIT OR Apache-2.0 ; `dear-imgui-wgpu` accepte wgpu 27/28/29/30 par features exclusives : modèle à imiter) ;
**cushy/kludgine** 0.4.0/0.11.0 (2024, wgpu ^22, obsolètes) ; **wxdragon** 0.9.22 (2026-09-17, wxWidgets) ; **nannou** 0.20.0 (wgpu ^29) ; **servo** 0.6.0 (2026-09-25, MPL-2.0, accesskit ^0.24, API d'embarquement) ;
**macroquad/miniquad** 0.4.16/0.4.11 (GL propre) ; **cursive** 0.21.1 (TUI) ; web uniquement (hors périmètre desktop) : leptos 0.9.0-beta2, yew 0.23.0.

Regroupement par version wgpu [V/N] : **30** = aphrody-render (30.0.1), egui/eframe 0.36.2, bevy 0.20-rc, slint (feature 30), dear-imgui-wgpu ; **29** = vello 0.10/koharu (29.0.3), gpui main, Blitz/anyrender, ribir, nannou, slint (feature 29) ;
**28** = libcosmic, xilem main, kas ; **27** = iced 0.14.0, floem main ; **22** = floem/cushy publiés. Briques d'accessibilité : accesskit 0.22 (fork COSMIC), 0.24 (egui, slint, bevy, freya, servo, gpui), 0.25.1 (courant).
Fragmentation taffy : 0.9.x (cosmic, floem), =0.13.0 (gpui main), ^0.10 (slint), ^0.14 (blitz), 0.12.1 (importé chez nous) → aucun moteur de mise en page partageable ; le contrat `adaptive` de m3-tokens (logique pure) est le bon niveau.

## 5. PARTIE 3 : proposition d'architecture (aucun code écrit dans le dépôt)

### 5.1 Crates neutres (principe : zéro toolkit, zéro tokio, `#![forbid(unsafe_code)]`, MSRV du workspace 1.97)

- `aphrody-gui-core` (nouveau, `crates/ui/gui-core`) ; dépendances : `raw-window-handle` 0.6.2 (déjà au lock), `aphrody-m3-tokens`, `serde` optionnel, `async-trait` (déjà workspace), `futures-channel` ; AUCUN `tauri`, `wgpu`, `tokio`. Traits `Send + Sync`, futures indépendantes de l'exécuteur :
  - `WindowHost` : `list`, `open(spec)`, `focus`, `close`, `set_bounds`, `set_state`, `set_title`, `describe` → `WindowInfo` (même JSON que window.rs:67-81) ; `capabilities() -> Caps` (webview, multi-fenêtre, transparent, always_on_top, surface_sous_contenu). Autorité complète : `open` accepte tout `WindowSpec` (URL quelconque, fenêtre native, geometry libre) ; la politique « http/https seulement » reste dans la couche d'outil, pas dans le trait (GC-10).
  - `WebviewHost` (capacité optionnelle) : `eval(label, script)`, `capture(label)` — supporte les outils `tauri_*` ; absent pour egui/iced/slint (ou fourni via wry embarqué).
  - `SurfaceProvider` : `raw_handles(label) -> Arc<dyn HasWindowHandle + HasDisplayHandle + Send + Sync>` (cas rwh 0.6) ; enum `SurfaceTarget { RawWindow, CompositionVisual /*Windows*/, HostGpu{device,queue,format,view-cb} /*même version wgpu*/, CpuImage{rgba} }`.
  - `ThemeProvider` : `snapshot() -> ThemeSnapshot` (ColorRoles/DynamicScheme + `ThemeMode` + contraste + typo + mouvement, sérialisable) + `subscribe()` ; source système via portail XDG Settings / API native [P].
  - `ClipboardProvider`, `DialogProvider`, `NotificationProvider`, `TrayProvider`, `HotkeyProvider`, `AutostartProvider`, `OpenerProvider`, `SingleInstance` : implémentations par défaut = briques déjà au lock (§5.4).
  - `KernelBridge` : enveloppe `aphrody-kernel-client` + `host_remote`, possède un runtime tokio privé quand la boucle hôte n'est pas tokio, expose `call_tool`, `events() -> Stream`, `host_subsystem(Arc<dyn SystemSubsystem>)` avec supervision/reconnexion ; transmet `APHRODY_OS_AUTH_TOKEN` tel quel, sans filtre.
  - `AccessibilityBridge` : arbre neutre → accesskit (version fixée par adaptateur : 0.22 fork/0.24/0.25).
- `aphrody-gui-subsystem` : `WindowSubsystem<H: WindowHost + ClipboardProvider + NotificationProvider>` = le contenu neutre de window.rs:101-335 ; tests d'outils sur un hôte factice ; l'adaptateur Tauri ne garde que l'impl des traits.
- `aphrody-gpu-backend` (existe dans iecode : crates/aphrody-gpu-backend, 145 lignes [V]) à extraire/aligner côté monorepo (la doc rust-crate-gpu-window-ownership.md le promet ; gpu.md a constaté son absence) : propriétaire unique Instance/Adapter/Device/surface config (aujourd'hui dupliqué gpu.rs:147-195 et layer.rs:132-158).
- Adaptateurs : `crates/ui/gui-<toolkit>` (un par toolkit, derrière features non-défaut) ; ratatui = adaptateur dégénéré (un « fenêtre », thème seul).
- Harnais de conformité headless `aphrody-gui-conformance` : (1) suite de traits sur hôte factice en mémoire ; (2) tests d'or : définitions d'outils identiques (10 outils window.rs:101-163) ; (3) cycle de vie fenêtre/bounds/focus sous xvfb ou compositeur headless pour chaque adaptateur réel ;
  (4) rendu : comparaison au CPU de référence d'aphrody-render (déjà pixel pour pixel) via `render_scene_gpu`/lavapipe ; (5) événements `window/focused|closed`, `desktop/notify` ; (6) régression GC-01 (notification intercalée).

### 5.2 Stratégie wgpu (plusieurs versions)

1. Socle universel = niveau (b) : readback RGBA8 straight-alpha existant (`GpuFrame.rgba`) ou CPU de référence → image du toolkit (egui `ColorImage`, iced `image::Handle`, Slint `Image::from_rgba8`, gpui `RenderImage`, GTK `MemoryTexture`, Qt `QImage`, FLTK `RgbImage`). Coût : copie par image, acceptable pour 3D d'inspection.
2. Zéro copie à version identique (30) : egui, Bevy, Slint(30) via `Renderer3d::with_device` + `render_to_view` ; `aphrody_render::wgpu` réexporté pour garantir l'identité de crate (attention GC-06 : le fork iecode `aphrody-wgpu` casse cette identité).
3. Autres versions (27/28/29) : soit attendre les bumps amont, soit compiler `aphrody-render` pour N versions par features exclusives avec dépendances renommées (`wgpu-27`…`wgpu-30`), comme Slint (`dep:wgpu-29`, `dep:wgpu-30`) et dear-imgui-wgpu le font [N] ; coût = shim par version (dérive d'API déjà subie 29→30 : `CurrentSurfaceTexture`, `color_space`, `queue.present`).
4. Partage natif (dmabuf/DXGI/IOSurface via wgpu-hal) : réservé à une phase ultérieure, par plateforme ; ne pas l'imposer à la conformité.

### 5.3 Runtime async

`gui-core` n'impose aucun exécuteur. `KernelBridge` ouvre un runtime tokio privé (thread nommé, 2 workers) et ponte vers la boucle hôte par canaux + réveil spécifique (egui `request_repaint`, iced `Subscription`/`Task`, Slint `invoke_from_event_loop`, GLib `MainContext`, Qt `CxxQtThread`, winit `EventLoopProxy`, Bevy via ressource à canal) [P pour les API de réveil non lues]. Jamais de `block_on` dans le thread UI. Cible secondaire : un client noyau indépendant de l'exécuteur (supprimerait `tokio::spawn` de `Client::from_stream`) — à décider.

### 5.4 Réutiliser l'existant (état dans Cargo.lock aphrody)

| Besoin | Brique | Lock aphrody | Remarque |
|---|---|---|---|
| poignées fenêtre/affichage | raw-window-handle 0.6.2 | présent (unique) | pas de 0.7 publié [N] ; wgpu, rfd, wry, tao, softbuffer l'utilisent |
| presse-papier | arboard 3.6.1 (MIT OR Apache-2.0) | présent (wl-clipboard-rs actif) | sans fenêtre ; Wayland via data-control |
| dialogues | rfd 0.17.2 (`set_parent(&impl HasWindowHandle+HasDisplayHandle)`, xdg-portal+wayland par défaut) | présent en 0.16.0 ET 0.17.2 | unifier ; portail = Wayland OK |
| notifications | notify-rust 4.17.0 (zbus pur) | présent | features `async`/`tokio` à choisir |
| tray | tray-icon 0.25.1 (+ ksni 0.3.6, Unlicense ; muda 0.20.0) | présent | boucle d'événements requise sur Windows/macOS ; GTK3 par défaut sinon ksni |
| raccourcis globaux | global-hotkey 0.8.0 | présent | **X11 seulement** (GC-08) ; Wayland = portail GlobalShortcuts (ashpd absent) |
| autostart / ouverture | auto-launch 0.5.0 ; open 5.4.4 ; webbrowser 1.2.4 | présents | |
| texte | cosmic-text 0.19.0 (MIT OR Apache-2.0), parley 0.11.1, fontdue 0.9.4 | cosmic-text/parley ABSENTS ; fontdue présent | cosmic-text est la pile d'iced/libcosmic/gpui(opt) |
| accessibilité | accesskit 0.25.1 | ABSENT | 3 versions en circulation |
| 2D CPU | tiny-skia 0.12.0 (BSD-3), resvg 0.47.0, kurbo 0.13.1 | présents | |
| TUI | ratatui 0.30.2, crossterm 0.29.0 | présents | |

### 5.5 MSRV et licences

- MSRV : le workspace est à 1.97 (Cargo.toml racine:16) ≥ tous les MSRV relevés (egui 1.95, bevy 1.96, xilem main 1.96, slint 1.92, relm4 1.93, tauri 1.90, floem main 1.91) : pas de blocage ; les adaptateurs optionnels restent hors du chemin par défaut.
- Dépôt : Apache-2.0 (Cargo.toml racine:18). Permissifs (MIT/Apache) : egui, iced, bevy, xilem, floem, dioxus, freya, gtk4-rs/relm4, cxx-qt (crate), fltk (crate), ratatui, vizia, kas, gpui. **Points critiques** [pas un avis juridique] :
  (i) **Slint** : GPL-3.0-only OU Royalty-free 2.0 (usage propriétaire desktop/mobile/web gratuit avec mention « AboutSlint », embarqué exclu) OU commerciale [V LICENSE.md] — un binaire adaptateur-Slint doit suivre la licence choisie ; le source de l'adaptateur peut rester Apache-2.0 ;
  (ii) **COSMIC** : applications GPL-3.0, libcosmic MPL-2.0 [P] — lier libcosmic sans copier de code d'applications COSMIC ; dépendance git épinglée par révision ;
  (iii) **Qt** via cxx-qt : LGPL-3/GPL/commerciale [P], édition de liens dynamique ; (iv) servo et azul-dll : MPL-2.0 [N] ; (v) `aphrody-drive` FSL-1.1-ALv2 [V] et l'artefact iecode « famille GPL » (iecode/LICENSES.md) [V].
  Recommandation : adaptateurs à licence copyleft/redevance hors membres par défaut, avec liste de licences par livrable.

### 5.6 Ordre de mise en œuvre (valeur/risque)

1. Prérequis S : corriger GC-01/GC-02, unifier les deux clients (GC-04), découpler `NativeLayer::attach` (GC-05), extraire `WindowSubsystem<H>` (GC-03).
2. winit + wgpu nus (adaptateur de référence, rwh 0.6, testable headless) — M, risque faible.
3. egui/eframe (même wgpu 30, MIT/Apache, `CallbackTrait`) — M, risque faible.
4. Adaptateur Tauri recentré sur les traits (existant ; surveiller l'alpha, GC-11) — S/M.
5. Slint (feature wgpu-30 ; décision de licence d'abord) — M, risque licence.
6. Bevy/bevy_egui (wgpu 30 ; lien avec iecode et le fork `aphrody-wgpu`, GC-06) — M.
7. iced (wgpu 27 → niveau b) puis libcosmic (wgpu 28, git, GPL côté apps) — M/L.
8. GTK4/relm4 (MemoryTexture/dmabuf) ; dioxus-desktop (versions wry/tao divergentes) ; dioxus-native/Blitz — M.
9. gpui, xilem, floem, freya, makepad (git/instables, API non vérifiées) — L.
10. cxx-qt, fltk (chaîne native C++) — L ; ratatui (S, dégénéré) à tout moment.

## 6. Tableau final : toolkit × (rendu, fenêtrage, async, thème, surface wgpu, licence, effort S/M/L, risque)

| Toolkit | Rendu | Fenêtrage | Async | Thème (injection M3) | Surface wgpu externe | Licence | Effort | Risque |
|---|---|---|---|---|---|---|---|---|
| winit+wgpu nus | wgpu 30 | winit 0.30 | proxy | à écrire (ColorRoles→struct) | native (`create_surface`) | Apache/MIT | M | faible |
| egui/eframe | wgpu 30 | winit 0.30 | immédiat, ctx Send+Sync | `Visuals` | `CallbackTrait` / render_state (même version) | MIT/Apache | M | faible |
| Tauri 3 (existant) | webview/CEF | tao/wry | tokio | CSS | poignée rwh + DComp | Apache/MIT | S (recentrage) | moyen (alpha) |
| Slint | femtovg/skia/vello (wgpu 29/30) | winit/KMS/Qt | boucle propre | `Palette`/.slint | `set_rendering_notifier` + `Image::try_from(Texture)` | GPL/Royalty-free/Commerciale | M | licence |
| Bevy / bevy_egui | wgpu 30 | winit 0.30 | ECS | styles Bevy / Visuals | graphe de rendu / texture | MIT/Apache | M | moyen (rc, fork iecode) |
| iced | wgpu 27 / tiny-skia | winit 0.30 | thread-pool/tokio/smol | `Palette` | `shader::Primitive` (wgpu 27) → niveau b | MIT | M | moyen (version wgpu) |
| libcosmic | wgpu 28 | winit 0.31 beta fork | calloop+tokio | cosmic-theme | shader (wgpu 28) → niveau b | MPL [P] / apps GPL | M-L | moyen-élevé (git, GPL) |
| GTK4 / relm4 | GSK | GDK | GLib+tokio | CSS GTK | MemoryTexture/dmabuf | MIT + LGPL lib | M | moyen |
| dioxus desktop | webview | tao/wry (anciens) | tokio | CSS | poignée tao [P] | MIT/Apache | M | moyen (doublons wry/tao) |
| dioxus native (Blitz) | vello (wgpu 29) | winit =0.31 beta.2 | tokio | CSS | custom paint [P] | MIT/Apache | M-L | élevé (beta) |
| gpui | wgpu 29 (main)/Metal | propre | smol(+tokio) | gpui-component | `paint_image` CPU ; surface macOS only | Apache | L | élevé (git, API mobile) |
| xilem/masonry | vello (wgpu 28 main) | winit 0.30 | tokio | thème Masonry | non vérifié | Apache | L | élevé (crates.io périmé) |
| floem | vello/vger/tiny-skia (wgpu 27 main) | fork winit | canaux | styles | non vérifié | MIT | L | élevé (crates.io périmé) |
| freya | Skia | winit 0.30 | tokio [P] | composants | non vérifié | MIT | L | élevé (rc) |
| makepad | moteur propre | propre | propre | live_design | CPU seulement | MIT/Apache | L | élevé |
| cxx-qt (Qt) | Qt RHI | Qt | boucle Qt | QPalette/QML | QQuickRhiItem/QImage | MIT/Apache + Qt LGPL | L | élevé (C++) |
| fltk-rs | GL/Cairo | FLTK | `awake` | style | rwh 0.6 → `create_surface` [P] | MIT + LGPL-exc | M | moyen |
| wry+tao nus | webview | tao | proxy | CSS | poignée tao | Apache/MIT | S | faible |
| ratatui | texte | terminal | sync | `Color::Rgb` | CPU image | MIT | S | faible |
| kas / vizia / ribir / dear-imgui | wgpu 28 / Skia / wgpu 29 / wgpu 27-30 | winit | variés | propres | selon version | Apache/MIT | L | élevé |
| sciter / azul / druid / orbtk / lvgl / nwg | — | — | — | — | — | — | — | À ÉCARTER (abandonnés) |

## 7. Décisions que le propriétaire doit trancher

1. Périmètre de « compatible » : hôte/services + surface + thème + noyau (critère fonctionnel, retenu ici) OU réimplémentation des écrans du shell dans chaque toolkit ? Le shell actuel est une page web (frontendDist, `ui/app/src/lib.rs:759-796`) : un toolkit natif doit soit réécrire les écrans, soit embarquer une webview (wry/CEF).
2. Politique wgpu : épingler 30 (egui, Bevy, Slint) + niveau b universel, OU features multi-versions 27-30 ; sort du fork iecode `aphrody-wgpu` (identité de type, GC-06) et de wgpu 29 de koharu (vello).
3. Licences : accepter Slint (GPL / Royalty-free avec mention / commerciale), COSMIC (GPL-3.0 côté apps), Qt (LGPL) comme adaptateurs hors défaut ; statut de `aphrody-drive` (FSL) dans un dépôt Apache-2.0.
4. Tauri 3 alpha (`=3.0.0-alpha.3`) comme adaptateur de référence, ou repli 2.12.1 ?
5. Où vit `aphrody-gui-core` (crates/ui/) et son nom (docs/architecture/rust-crate-naming.md non lu).
6. Client noyau : garder tokio obligatoire + runtime privé dans `KernelBridge`, ou réécrire un client indépendant de l'exécuteur ; fusionner `kernel::client::Client` et `aphrody-kernel-client` ; reconnexion automatique de `host_remote`.
7. Autorité (YOLO) : lever, dans les traits, les restrictions d'outil actuelles (http/https seulement, aperçus « sans capacité desktop », window.rs:109-111,194-201) ou les garder comme validation d'arguments dans la couche d'outil.
8. Raccourcis globaux sous Wayland (portail GlobalShortcuts, `ashpd` à ajouter) et accessibilité (adopter accesskit, quelle version face au fork COSMIC 0.22).
9. libcosmic : dépendance git (pas sur crates.io) épinglée par révision, ou hors périmètre.
10. Tolérance aux crates amont obsolètes sur crates.io (xilem 0.4.0, floem 0.2.0, gpui 0.2.2) : accepter des dépendances git.

## 8. NON EXAMINÉ

- Skills et agents du plugin Aphrody (config/ai/plugins/aphrody/…) non ouverts cette fois ; docs/architecture/rust-crate-naming.md et docs/architecture/os/ARCHITECTURE.md non lus (ARCHITECTURE cité via affichage.md).
- Aucun appel docs.rs ; API de thème, réveil inter-threads, Send/Sync des états d'UI de chaque toolkit marqués [P] (non lus dans les sources), sauf egui (context.rs), iced (primitive.rs), Slint (api.rs/lib.rs), gpui (window.rs/surface.rs).
- Licence de libcosmic/cosmic-theme et des applications COSMIC non vérifiée (crates absentes de crates.io) ; licences GTK4/Qt/FLTK/FLTK-exception citées de mémoire [P].
- Chemins dmabuf (GTK ≥4.14), Qt RHI, import de textures wgpu dans Blitz/vello/xilem : non lus.
- Solveur de fermetures : approximation maison ; build/dev dependencies exclues ; non confronté à `cargo tree`.
- `Send`/`Sync` de `kernel::client::Client` (champ `incoming` public) non compilé ; futures de `KernelClient` supposées Send.
- Windows/macOS : aucune vérification d'exécution ; koharu au-delà des manifestes ; code web du shell (packages/ui/*) ; config/ai/agent-domains.json ; crates/os/drive ; sources tierces hors liste du §1.
- Fichiers de travail : /tmp/audit-low-level/gui-work/ (fsolve.py, analyze.py, crates/*.json, raw/*).
