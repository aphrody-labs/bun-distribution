# Audit bas niveau — axe AFFICHAGE (fenêtrage / compositeur / Wayland-X11-WSLg)

Date : 2026-10-01 — dépôt /home/aphro/aphrody (branche main, arbre sale) — niveau de preuve global P1 (statique).
Lecture seule : aucun cargo/rustc/bun test lancé, aucune fenêtre ouverte, aucun fichier du dépôt modifié.
Légende : [V] vérifié dans le code lu ; [P] plausible, déduit (sémantique GTK/GDK/compositeur non reproduite).

## 0. Réponse à la question posée

**Existe-t-il un compositeur Wayland ou un client Wayland first-party ? NON.** Prouvé de quatre façons :

1. `Cargo.lock` : 0 occurrence de `smithay`, aucun `wayland-server`, `drm`, `gbm`, `libseat`, `input` (libinput),
   et aucun paquet `winit` nu (seulement le fork `tauri-winit` 0.31.0-beta.3 tiré par `tauri-runtime-cef`).
   Les crates Wayland présentes sont des CLIENTS tiers transitifs : `wayland-client` 0.31.15 (via `gdk4-wayland`,
   `tauri-winit-gtk4`, `rfd` 0.17.2, `wl-clipboard-rs`←`arboard`), `wayland-protocols(-wlr)`, `x11rb` (via `global-hotkey`,
   `arboard`, `tauri-winit-x11`), `x11-dl`, `ksni`/`zbus`. Cargo.lock:27349-27411 (wayland), 29243 (x11rb), 24723-24768 (tauri-winit*).
2. `rg smithay|wayland-server|xdg-shell|wlr-layer` sur crates/ apps/ packages/ config/ scripts/ : aucun code first-party.
   Aucun usage de `layer-shell`, `xdg-activation`, `xdg-foreign`, `text-input`, `gtk-layer-shell` dans le code.
3. Aucun code first-party ne lit `DISPLAY`, `WAYLAND_DISPLAY`, `XDG_SESSION_TYPE`, `GDK_BACKEND`, `WEBKIT_*`
   (rg sur crates/ apps/ packages/ : aucun usage lié à l'affichage ; seuls faux positifs : taffy `DISPLAY::NONE`, obscura `WEBKIT_KEYFRAMES_SELECTOR_PREFIX`, pgl_domains.txt « ozone-project »).
4. La documentation l'acte : docs/architecture/os/ARCHITECTURE.md:235 « Dedicated Wayland compositor (Smithay / WGPU) |
   Research complete; desktop window authority is Tauri/Wry across Windows and Linux » ; docs/architecture/rust-crate-gpu-window-ownership.md:11-12
   (« No active first-party Cargo member directly depends on Bevy, winit, SDL, glutin, or tao ») ; config/ui/wsl.env.example:8
   `APHRODY_COSMIC_COMPOSITOR=external-only` (variable sans consommateur, voir AFF-01).

Le fenêtrage est délégué à : `tauri` 3.0.0-alpha.3 + `tauri-runtime-wry` 3.0.0-alpha.3 → `tao` 0.37.1 + `wry` 0.57.0 → GTK3 + WebKitGTK 4.1
(aphrody-app, aphrody-model-view, apps générées) ; `tauri-runtime-cef` 3.0.0-alpha.4 → `tauri-winit-gtk4` (GTK4, X11 forcé) + CEF 152 (Koharu, importé).
Le rendu GPU natif passe par `wgpu` 30.0.1 ; le seul site de création de surface native est `aphrody-tauri-3d` (crates/ui/tauri-3d/src/layer.rs:131,203).
Le dépôt contient seulement de l'OUTILLAGE autour de compositeurs externes (COSMIC Epoch, Weston de WSLg), voir §2(c).

## 1. Périmètre réellement lu

- crates/ui/app : Cargo.toml, build.rs, tauri.conf.json, tauri.drive.conf.json, capabilities/{main,desktop-surfaces,quickbar}.json,
  src/{lib.rs (1-837), quickbar.rs (1-143), window.rs (1-335), main.rs, desktop.rs (1-200 + fs), integration.rs (1-520 + extraits 560-670)},
  gen/schemas/acl-manifests.json (clés), linux/aphrody.desktop, README.md (1-80), tests/ (liste).
- crates/ui/tauri-wrap : Cargo.toml, src/{window.rs, config.rs, debug.rs, lib.rs, policy.rs (1-130)}, extraits serve.rs/sidecar.rs.
- crates/ui/tauri-3d : Cargo.toml, src/{lib.rs (1-60), layer.rs (70-280)} ; crates/ui/model-view : Cargo.toml, tauri.conf.json, capabilities/main.json, src/main.rs.
- crates/koharu/koharu : tauri.conf.json, tauri.linux.conf.json, capabilities/default.json, src/main.rs, Cargo.toml ; koharu-app/src/app.rs (1-200) ; koharu-desktop (nature).
- crates/os/kernel : src/transport.rs (1-282), src/auth.rs (1-148), src/policy.rs, src/admin.rs (1-60) ; crates/os/capture/src/lib.rs (1-40).
- packages/ui/scaffold/src/tauri.ts (100-276) ; packages/ui/web-to-tauri/src/generate.ts (150-262), plan.ts (engine), parity.ts/drivers.ts (têtes) ;
  packages/infra/workspace/src/{desktop-smoke.ts (1-182), tauri-sync.ts (gate), tauri*.ts (grep)} ; config/tauri-apps.json (1-120).
- Scripts : scripts/tools/os/scripts/wslg-manager.sh, scripts/build/ui/scripts/package-cosmic-sysext.sh (extraits), config/ui/wsl.env.example,
  grep GDK_BACKEND / WAYLAND_DISPLAY / XDG_SESSION_TYPE / WEBKIT_ / DISPLAY / ozone sur tout le dépôt (hors exclusions du brief).
- Docs : docs/architecture/rust-crate-gpu-window-ownership.md, docs/architecture/os/ARCHITECTURE.md (20-40, 222-245), research/RUST-OS-…ANALYSIS.md (25-60),
  docs/guides/web/TAURI-DEBUG.md, docs/reference/ui/DESKTOP-INTEGRATION.md, PLAN.md:510-575, docs/products/ui/README.md:36-48.
- Grille : agents/cross-platform-validator.md, skills tauri-v2 (504 l.), rust-target-check (87 l.), cross-platform-cli-toolbelt (grep), web-frames (37 l. — traite
  l'indexation de FRAMES vidéo d'anime, aucun rapport avec le fenêtrage : aucune règle exploitable).
- Sources tierces vérifiées dans ~/.cargo/registry/src : tao 0.37.1 (linux/{window,event_loop,util,portal,device}.rs), wry 0.57.0 (webkitgtk/mod.rs, synthetic_mouse_events.rs),
  tauri-runtime-wry 3.0.0-alpha.3 (Cargo.toml, lib.rs), tauri 3.0.0-alpha.3 (Cargo.toml features, gtk_version.rs, webview/mod.rs ACL, manager/webview.rs),
  tauri-runtime-cef 3.0.0-alpha.4 (runtime.rs, switches.rs, sandbox.rs), global-hotkey 0.8.0 (x11/mod.rs), tray-icon 0.25.1 (ksni), ksni 0.3.6,
  tauri-plugin-single-instance 3.0.0-alpha.2 (linux.rs), tauri-plugin-window-state, tauri-plugin-clipboard-manager (desktop.rs), tauri-build 3.0.0-alpha.2 (acl.rs), wgpu-hal 30.0.1 (vulkan/instance.rs).
- Hôte (lecture) : Ubuntu 24.04 WSL2, DISPLAY=:0, WAYLAND_DISPLAY=wayland-0, GDK_BACKEND vide, D-Bus session présent, pas de StatusNotifierWatcher,
  libwebkit2gtk-4.1.so.0.21.10, GTK 3.24.41 ; `readelf -d target/debug/aphrody-app` : NEEDED libwebkit2gtk-4.1, libgtk-3, libgdk-3 (pas de gtk-4, pas d'appindicator).

## 2. Classification des occurrences wayland|compositor|smithay|xdg-shell|winit|x11|xcb|wlr|drm (290 lignes brutes, 75 fichiers)

(a) Compositeur d'affichage ou client Wayland/X11 first-party réel : **AUCUN**.
    Seuls clients réels = dépendances tierces (carte §3). Aucun code first-party n'ouvre un display Wayland/X11 ; la seule interaction directe
    avec l'affichage est `create_surface(window)` dans crates/ui/tauri-3d/src/layer.rs:131,203 (wgpu), via les handles de tao.

(b) « Compositor » 2D / couches / pompe de frames (pas d'affichage) :
    - crates/koharu/koharu-rasterizer/src/compositor.rs (13 hits : `GpuCompositor`, wgpu offscreen), native.rs (7), lib.rs (3), README.md:4 — importé Koharu ;
    - crates/koharu/koharu-canvas/src/web.rs (8 hits : compositeur wgpu sur `<canvas>` wasm, web.rs:1102) — importé Koharu ;
    - crates/koharu/koharu-renderer/README.md:124,232 (« no compositor … public subsystem ») ; koharu-desktop = coordination de frames vers le frontend, pas de fenêtre ;
    - crates/web/obscura-{cdp,render,js,browser} (≈16 hits : « compositor tick/damage », `Page.screencastFrame`, obscura-cdp/src/domains/page.rs:639,724-727,1568) — importé, headless ;
    - packages/ui/material-web (CSS « compositor-driven » : appbar/internal/top-app-bar-styles.ts:143 ; tests-web/run.ts:68 flag Chrome
      `--run-all-compositor-stages-before-draw` d'un Chrome headless).

(c) Simple documentation / config / outillage autour de compositeurs EXTERNES :
    - docs/architecture/os/ARCHITECTURE.md:31,235 ; docs/architecture/os/research/RUST-OS-…ANALYSIS.md:29-31,46-49,194 ;
    - config/ui/wsl.env.example:8 (7 variables `APHRODY_*` : aucun consommateur dans le dépôt, rg exhaustif) ;
    - config/ai/plugins/aphrody/skills/best-stack-2026/SKILL.md:154 (recommande `winit` 0.30, déconseille `tao`) ;
    - scripts/build/ui/scripts/package-cosmic-sysext.sh (13 hits) : empaquette/valide une image systemd-sysext de COSMIC Epoch depuis `~/cosmic-epoch`
      (checkout ABSENT sur cet hôte) — outillage d'un compositeur Smithay externe, aucun source de compositeur ici ;
    - scripts/tools/os/scripts/wslg-manager.sh (22 hits) : diagnostic WSLg/Weston ;
    - inventory/targets.json:46 (`guiPolicy: cosmic-native-headless-no-gtk-no-qt`, « historical-not-revalidated ») ;
    - config/tauri-apps.json:43 ; packages/koharu/docs/*/development/setup.mdx (`dbus-x11` pour les tests) ;
    - crates/ai/agent-tools/src/computer_use.rs:15,36,649,830,845 et crates/ai/config/src/rag.rs:164 : annoncent un backend « Linux X11 (XTest / x11rb) »
      qui n'est PAS compilé (`UnsupportedComputerBackend`, computer_use.rs:845).

(d) Importé : crates/koharu/koharu-app/src/app.rs:82 (`--ozone-platform=x11`) ; crates/koharu/koharu-pipeline/src/resources/linux.rs:78 (lecture de `/sys/class/drm`
    pour détecter les GPU — pas un client d'affichage) ; crates/os/drive/patches/ffmpeg-sys-next/Cargo.toml:44 (`build-drm`) et patches whisper.cpp ; `upstream/` (exclu).

(e) Faux positifs (≈ 190 lignes) : constantes hex `0xCB…` (locales/*.json ×6 = 126 lignes, FNV 0xcbf29ce4…, team-emblem-map), sous-chaîne « xcb » dans `BxcBridgeService`/`bxc`,
    User-Agent « X11; Linux x86_64 » (obscura-net/client.rs:1106, obscura-js/ops.rs:3201, obscura-cdp/server.rs:989…, scripts), bundles minifiés ui-dist/app.js|css, svg, pdf.

Frontière (hors périmètre) : docs/ecosystem/{ecosystem.json,ECOSYSTEM.md} listent `crates/bevy/bevy_winit`, `iecode-winit` : ce sont des entrées du dépôt frère
/home/aphro/iecode (catalogue « 3 repositories »), pas des crates de ce dépôt (`ls crates` : pas de `bevy/` ni `iecode/`). Non audité.

## 3. Carte de la pile réelle (d'après Cargo.lock + sources du registre)

| Hôte | Runtime | Toolkit | Backends d'affichage |
|---|---|---|---|
| aphrody-app, aphrody-model-view, apps `web-to-tauri` (engine wry) | tauri-runtime-wry → tao 0.37.1 + wry 0.57.0 | GTK3 + WebKitGTK 4.1 | choisi par GDK à l'exécution : Wayland puis X11 (GTK3 essaie wayland avant x11 si `GDK_BACKEND` vide) |
| koharu, koharu-app (importé) | tauri-runtime-cef → tauri-winit(-gtk4/-x11) + CEF 152 | GTK4 | **X11 forcé** : `set_var("GDK_BACKEND","x11")` + `set_allowed_backends("x11")` + `--ozone-platform=x11` (tauri-runtime-cef runtime.rs:3154-3180) |
| aphrody-tauri-3d | (plugin des hôtes wry) | surface wgpu 30 sur le handle tao | Vulkan seul sur Linux (aphrody-render Cargo.toml:44 : pas de `gles`) |

Features générées / workspace : `tauri-runtime-wry = { default-features = false, features = ["x11", "macos-private-api"] }` (Cargo.toml:414 ; scaffold tauri.ts:144).
Défauts amont de tauri-runtime-wry : `["x11", "dbus"]` (Cargo.toml du crate, `[features] default`). Donc **`dbus` est retiré**.

Ce que `x11` active réellement (lu dans le code, pas supposé) :
- ce n'est PAS un sélecteur de backend : tao compile Wayland inconditionnellement (`gdkwayland-sys` non optionnel, tao Cargo.toml:265) ;
- tao `x11` = `gdkx11-sys` + `x11-dl` : (1) handles raw-window-handle Xlib pour une session X11 (tao window.rs:955-961, 980-992) — sans lui `window_handle()`
  renvoie `Err(Unavailable)` sous X11 et la création de surface wgpu de tauri-3d échouerait ; (2) un thread XInput2 qui sélectionne `XI_RawKeyPress/Release`
  sur la racine pour tous les « master devices » (tao device.rs:18-27, démarré si `is_x11()`, event_loop.rs:257-281) ;
- wry `x11` = chemin `new_x11` (webview à partir d'un handle brut / `build_as_child`, wry webkitgtk/mod.rs:96-136) ; Tauri utilise `build_gtk(vbox)` (tauri-runtime-wry lib.rs:5501-5527),
  donc ce chemin n'est pas emprunté pour les fenêtres normales ; sous Wayland il renverrait `UnsupportedWindowHandle` (mod.rs:96-136).
- Verdict de cohérence : `x11` est cohérent avec une exécution Wayland (aucun effet, rien n'est compilé OUT) et nécessaire sous X11/WSLg pour tauri-3d. À GARDER. L'anomalie est ailleurs : `dbus` (AFF-08) et le choix du backend (AFF-01).

## 4. Constats détaillés

### AFF-01 — HAUTE [V] — Aucun choix ni garde du backend d'affichage ; Wayland par défaut sous WSLg est documenté comme cassé
- Lu : crates/ui/app/src/lib.rs:668-670 (`Builder::default().runtime(Wry::default())`, aucune variable posée) ; crates/ui/model-view/src/main.rs:75-76 ;
  packages/ui/scaffold/src/tauri.ts:206 (le `main.rs` généré, donc TOUTE app `web-to-tauri` engine wry, a la même absence) ; rg GDK_BACKEND|WEBKIT_|DISPLAY|ozone dans crates/ apps/ packages/ : aucun usage lié à l'affichage
  hors koharu-app/src/app.rs:82 (faux positifs : taffy, obscura-render, pgl_domains.txt) ; sur cet hôte `GDK_BACKEND=` (vide) alors que `WAYLAND_DISPLAY=wayland-0` et `DISPLAY=:0` sont tous deux posés → GTK3 ouvre Wayland.
- Preuve de l'échec : PLAN.md:525 « la fenêtre se lance sous `GDK_BACKEND=x11` (Wayland : erreur de protocole Gdk 71, non résolue) » ; PLAN.md:560.
- Le contournement n'existe qu'en documentation, et incohérent : config/tauri-apps.json:43 (seulement `aphrody-model-view`, rien pour `aphrody-app` L8-24) ;
  docs/guides/web/TAURI-DEBUG.md:21,66 ajoute `WEBKIT_DISABLE_DMABUF_RENDERER=1` (absent de PLAN.md:560 et de tauri-apps.json) ;
  scripts/tools/os/scripts/wslg-manager.sh:174 `export GDK_BACKEND="wayland,x11"` (l'inverse de ce qu'exige PLAN.md:525) et :232 `"x11": true` codé en dur (ne teste pas le socket) ;
  config/ui/wsl.env.example ne contient pas `GDK_BACKEND` et ses 7 variables n'ont aucun lecteur.
- Contre-exemple dans les dépendances : tauri-runtime-cef force X11 lui-même (runtime.rs:3154-3180) ; rien d'équivalent côté wry.
- Existe et est faux / manque : manque un helper unique (voir recommandation 1).

### AFF-02 — HAUTE [V code / P comportement compositeur] — pet / widget / quickbar : API non portables Wayland, dégradation SILENCIEUSE
Fenêtres : crates/ui/app/tauri.conf.json:31-90 (`splash`, `pet`, `widget`, `quickbar` : `transparent`, `alwaysOnTop`/`alwaysOnBottom`, `skipTaskbar`, `decorations:false`).
- `alwaysOnTop`/`alwaysOnBottom` → tao event_loop.rs:384-387 `set_keep_above/below` ; `skipTaskbar` → event_loop.rs:396-397 `set_skip_taskbar_hint` : aucune branche Wayland, aucune erreur ;
  xdg-shell n'a pas de protocole pour cela → no-op [P] (le widget « always on bottom » est impossible sans layer-shell, absent du dépôt).
- Position : `outer_position()` lit des atomiques alimentées par `configure-event`/`frame_extents` (tao window.rs:317-351, 464-470) — pas de branche Wayland ; `set_outer_position` →
  `window.move_` (ignoré par les compositeurs Wayland) [P]. Usages : quickbar.rs:71, integration.rs:432 (placement du pet), integration.rs:630 (marche du pet), window.rs:242 (`window_set_bounds`) et
  la skill `open_beside` qui suppose un écran 1920×1080 (window.rs:300-316).
- **`cursor_position()` renvoie `Ok((0,0))` sous Wayland** (tao util.rs:18-20, window.rs:827) : quickbar.rs:60-63 choisit alors toujours le moniteur contenant (0,0) ;
  le poller du pet (integration.rs:380-409, période 40 ms) calcule `x=y=0` (cursor − outer_position, tous deux nuls), bascule `set_ignore_cursor_events` d'après ce faux point (L396) → le pet peut devenir
  définitivement click-through (l'événement pointeur ne parvient plus à la fenêtre une fois la région d'entrée vide) et son regard est figé. Le poller réveille aussi le thread principal 25×/s
  (`is_visible()` = aller-retour au thread GTK) même pet caché (L380-392).
- `set_focus()` → `present_with_time(GDK_CURRENT_TIME)` (event_loop.rs:313-314) : sous Wayland le focus n'est pas garanti sans jeton xdg-activation (absent) ; `show_main` (integration.rs:185-193) et la quickbar
  (quickbar.rs:45) ignorent le résultat réel.
- Taille avant première configuration : `outer_size` est initialisé depuis `root_origin()` (copier-coller amont, tao window.rs:329) et ne change qu'au `configure-event` ; la quickbar est créée cachée (conf. L77-90)
  puis `place()` est appelée AVANT `show()` (quickbar.rs:44-45) → `outer_size()` ≈ 0 à la première ouverture → décalage horizontal d'une demi-largeur, sur X11 comme Wayland [P].
- Conséquence : sur Wayland natif le sous-système « surfaces bureau » est inutilisable tel que conçu, sans que l'app ne le détecte ni ne le dise. `aphrody_meta` (lib.rs:176) n'expose aucun type de session.

### AFF-03 — HAUTE [V] — Raccourci global Alt+Space : X11 uniquement, échec silencieux, pas de repli
- quickbar.rs:17,25-33 ; tauri-plugin-global-shortcut → `global-hotkey` 0.8.0 : backend unique `x11/mod.rs` (XGrabKey), message explicite « Other window systems on Linux are not supported » (x11/mod.rs:230-231).
- `GlobalHotKeyManager::new()` renvoie toujours `Ok` (x11/mod.rs:31-39) ; si la connexion X11 échoue (pas de DISPLAY) le thread meurt, et `register()` renvoie quand même `Ok(())`
  (x11/mod.rs:44-52 : l'envoi échoue, `if let Ok(result) = rx.recv()` n'est pas satisfait) → `quickbar::register` ne journalise RIEN (quickbar.rs:30-32 n'est atteint que sur `Err`).
- Même avec XWayland (WSLg : DISPLAY=:0), les grabs ne voient que les touches destinées aux clients X11 focalisés ; sous Wayland natif elles ne sont jamais livrées. Alt+Space est aussi le « menu de fenêtre »
  de Mutter/KWin/Windows (BadAccess → `AlreadyRegistered`), l'accélérateur n'est pas configurable (const quickbar.rs:17). Seul repli : l'entrée « Quick ask » du tray (integration.rs:302), elle-même dépendante de AFF-04.
- Aussi : le thread global-hotkey scrute toutes les 50 ms en permanence (x11/mod.rs:326).

### AFF-04 — MOYENNE [V] — Tray (StatusNotifierItem) : échec journalisé seulement, mais fermeture = masquage inconditionnel → application invisible
- tray-icon 0.25.1 utilise ksni (D-Bus) car tauri active `tray-icon?/ksni` (tauri Cargo.toml `tray-icon = [...]`, Cargo.lock tray-icon: `ksni`, pas de libappindicator) ; `TrayIcon::new` fait `.spawn()?`
  (tray-icon ksni/mod.rs:43), qui échoue avec `Error::Watcher` sans StatusNotifierWatcher (ksni blocking.rs:71) — constaté sur cet hôte (PLAN.md:560-562 « pas de StatusNotifierWatcher »).
- crates/ui/app/src/integration.rs:441-443 : `build_tray` en erreur → `log::error!` et on continue ; lib.rs:734-735 : `CloseRequested` de `main` → `prevent_close()` + `hide()` SANS vérifier que le tray existe ;
  `--autostart` ferme le splash et ne montre rien (integration.rs:478-480). Sans tray (GNOME sans extension, WSLg, Wayland minimal) l'app tourne sans fenêtre ni moyen de quitter (`app.exit(0)` n'est que dans le menu tray, integration.rs:347 ; hors UI masquée) ;
  seul un relancement (single-instance → `show_main`) la rouvre.
- Dérive : tauri.conf.json:172 `depends: libayatana-appindicator3-1` et docs/products/ui/README.md:41, docs/reference/ui/DESKTOP-INTEGRATION.md:84, skill tauri-v2 refs : obsolètes pour Tauri 3 (ksni ; le binaire ne lie pas appindicator).

### AFF-05 — MOYENNE [V] — Les capabilities par fenêtre ne bornent PAS les commandes applicatives (pas de manifeste ACL d'app)
- crates/ui/app/build.rs:30-32 : `tauri_build::Attributes::new().windows_attributes(...)` sans `.app_manifest(...)`, pas de dossier `permissions/` ; gen/schemas/acl-manifests.json : aucune clé d'app (liste : aphrody-drive, core*, dialog, fs, …) →
  `has_app_acl` faux. Dans tauri webview/mod.rs:2138-2142 le contrôle ACL ne s'applique alors qu'aux commandes de plugin et aux origines distantes : toute fenêtre LOCALE (splash, pet, widget, quickbar — qui chargent le même bundle ui-dist)
  peut invoquer les ≈35 commandes de `generate_handler!` (lib.rs:759-806), dont `aphrody_rpc` (L104), `aphrody_fs_read_dir`/`aphrody_fs_read_text` (L515,521 → desktop.rs:150,189 : chemin arbitraire, aucun scope, 2 Mo),
  `aphrody_capture_primary`, `koharu_rpc`, `aphrody_model_remove/pull`.
- La documentation affirme le contraire : lib.rs:7 « The webview sees three allow-listed commands », README.md (« grants no generic filesystem … the webview is not a general system API »), capabilities/desktop-surfaces.json
  (« Default-deny … ») et quickbar.json (« Agent traffic goes through aphrody_rpc … »).
- À garder : les origines DISTANTES sont bien refusées (tauri webview/mod.rs:2138-2142 + :2102-2106 `Origin::Remote`) ; capabilities `local:true` ; `aphrody_shell_window`/`aphrody_quickbar`/`require()` vérifient le label (lib.rs:591-596, quickbar.rs:92-95, integration.rs:503-509).
  Exploitation réaliste : XSS dans le bundle (rendu de sorties d'agent) ⇒ lecture de fichiers + pilotage de l'agent (le second est déjà possible via `aphrody_rpc`).

### AFF-06 — MOYENNE [V Rust / P UI] — Aucun `on_navigation` / `on_new_window` sur les fenêtres d'aphrody-app
- rg `on_navigation|on_new_window` dans crates/ : seulement crates/ui/tauri-wrap/src/window.rs:94-103. Les 5 fenêtres de tauri.conf.json (créées par Tauri) et `window_open` (window.rs:211-214, URL http(s) quelconque, aucun filtre
  ni liste d'hôtes, loopback inclus) n'ont pas de garde ; le hook par défaut autorise tout (tauri manager/webview.rs:623-641).
  La CSP (`script-src 'self'`…) ne restreint pas la navigation top-level. Un lien `<a href>` non intercepté navigue le webview principal hors de l'app (fenêtre sans décoration, `decorations:false`) ;
  l'IPC reste refusé (origine distante) mais la fenêtre est piégée. Le bundle contient un `openLink` via `plugin:opener|open_url` (ui-dist/app.js, repli `window.open`) mais l'UI source (`@aphrody/app-ui`) n'est pas dans le workspace → non vérifiable [P].
- Popups : quand tauri-wrap répond `NewWindowResponse::Allow`, wry crée une fenêtre GTK avec `WebViewAttributes::default()` (wry webkitgtk/mod.rs:510-546) : la politique de navigation n'y est pas reconduite (BASSE).
- Bon exemple à reprendre : tauri-wrap window.rs:31-40,94-103 (décision Allow/External/Deny, schémas OS limités `OPENABLE` L17).

### AFF-07 — MOYENNE [V code / P exploitation] — Point d'accès local du noyau : sous-système fenêtre piloté sans authentification
- crates/ui/app/src/lib.rs:68 `Kernel::new()` → `AuthPolicy::default()` = `Disabled` → `SessionScope::unrestricted()` (kernel auth.rs:42,128). Tout client du même UID sur `$XDG_RUNTIME_DIR/aphrody-os.sock` peut appeler
  `tauri_execute_js` (lib.rs:227,414 : JS arbitraire dans la fenêtre `main`, qui a fs lecture, dialog, process:restart/exit, opener, updater), `window_open` (window.rs:174-223), `clipboard_read` (window.rs:285-287),
  `tauri_interact`, `window_close_label`. Un agent confiné qui atteint la socket sort de son bac à sable via ces outils.
- transport.rs:269-270 : `UnixListener::bind` PUIS `set_permissions(0o600)` (fenêtre de course) ; repli `/tmp/aphrody-os-<user>.sock` prévisible si `XDG_RUNTIME_DIR` absent (transport.rs:76-80) ;
  lib.rs:53-54 : `start_kernel` « joint » n'importe quel écouteur déjà présent (`connect` réussi) et lui expose les sous-systèmes fenêtre/webview, sans vérifier l'UID du pair (pas de SO_PEERCRED).
- Observé : 7 sockets `aphrody-os.sock-test-*` orphelines dans /run/user/1000 (tests qui ne nettoient pas).
- Défaut mineur : `tauri_driver_session` (lib.rs:288-300) ne fait que basculer un AtomicBool et répond `persistent:true` — aucune session réelle, ne conditionne aucun outil.
- À garder : socket 0600 dans un répertoire 0700, limites MAX_LINE/MAX_IN_FLIGHT/timeouts (transport.rs:17-21), pipe Windows `reject_remote_clients` ; `tauri_screenshot` renvoie `Unavailable` hors Windows (lib.rs:431), honnête.

### AFF-08 — MOYENNE [V] — `dbus` retiré par `default-features = false` : thème système Linux toujours « light »
- Cargo.toml:414 et scaffold tauri.ts:144 ne gardent que `x11` ; Cargo.lock : pas de crate `dbus`. Sans la feature tao `dbus`, `Window::theme()` ne consulte jamais le portail
  `org.freedesktop.appearance color-scheme` et retombe sur `Theme::Light` (tao window.rs:211-214, 1026-1036 ; suivi des changements event_loop.rs:287-295 absent).
- Effet : `aphrody_shell_window` `State`/`SetTheme{System}` (lib.rs:598-606, 648-652) rapporte `light` sous X11 comme sous Wayland quel que soit le thème de l'OS ;
  le commentaire de lib.rs:527-528 (« reports the effective light or dark theme selected by Tauri/Wry ») est faux sur Linux. Même défaut dans toutes les apps générées.
- Correctif : rétablir `dbus` dans la liste de features (le portail est facultatif à l'exécution : erreurs `.ok()`), ou lire GTK/`gsettings`.

### AFF-09 — MOYENNE [P] — aphrody-tauri-3d : le « 3D natif sous webview transparent » n'a pas d'équivalent Linux ; propriétaires de fenêtre non documentés
- layer.rs:128-131 et :215-217 : hors Windows la surface wgpu est « la fenêtre elle-même » (DirectComposition seulement sous Windows, lib.rs:1-9). Sous GTK3 la fenêtre est déjà peinte par GTK/WebKit : surface Vulkan sur le XID de la fenêtre (X11)
  ou sur le `wl_surface` du toplevel GDK (tao window.rs:948-953, display = `wl_display` de GDK) → deux producteurs de buffers pour la même surface. Hypothèse sur l'« erreur de protocole Gdk 71 » de PLAN.md:525 (tao window.rs:112 mentionne déjà
  les erreurs « mismatched xdg_surface_buffer sizes ») ; non prouvé : la cause WebKitGTK/DMABUF sous WSLg (TAURI-DEBUG.md:21) reste une autre piste.
- Jamais vérifié visuellement : PLAN.md:526 « pixels non capturés (XWayland) ». `capabilities` minimales de model-view (core:default + start-dragging + close + aphrody-3d:default) et CSP stricte = bien.
- Pas de repli GL (render Cargo.toml:44 : dx12/vulkan/metal/webgpu/webgl, pas `gles`) : sans ICD Vulkan, `attach` échoue proprement (`Err`, layer.rs:128-143), pas de panique.
- « Clic droit = déplacer » (model-view main.rs:12, view.js:29-30) : tao `DragWindow` code le bouton 1 en dur et timestamp 0 (event_loop.rs:336-345) [P].
- docs/architecture/rust-crate-gpu-window-ownership.md:11-12 ne cite que l'hôte Koharu ; elle omet aphrody-app, aphrody-model-view et aphrody-tauri-3d (3 propriétaires de fenêtre/surface first-party, section « Choose one window owner per product host »).

### AFF-10 — MOYENNE [V] — Session sans affichage et cycle de vie : panique sans message exploitable, instance unique dégradée en silence
- tao event_loop.rs:217-219 : `.expect("Failed to initialize gtk backend!")` (panique, pas de `Result`). Sans DISPLAY/WAYLAND_DISPLAY (SSH) : GTK affiche « cannot open display » sur stderr puis panique ;
  aucun pré-test dans le dépôt (rg DISPLAY : 0) ni message guidant vers le CLI. Le `ExitCode::FAILURE` de model-view (main.rs:128-131) et le `.expect` de lib.rs:798 ne sont pas atteints (la panique survient dans `run`).
- tauri-plugin-single-instance (linux.rs:48-88) : D-Bus session absent → `build()` en erreur ignorée par `_ => {}` (L88) : pas d'instance unique ; nom déjà pris → `process::exit(0)` sans message (L86) même si l'instance détentrice est figée.
- Cinq webviews WebKit sont créées dès le démarrage (tauri.conf.json:14-90, 4 cachées) : coût mémoire constant [V].
- Dégradent proprement : notifications (`show().map_err(failed)`, window.rs:59), presse-papiers (arboard ouvert à l'init, erreur différée : tauri-plugin-clipboard-manager desktop.rs:17,25-27 ; binaire contient « Successfully initialized the Wayland data control clipboard »),
  `aphrody_capture_primary` (Windows seul : crates/os/capture/src/lib.rs:10-13 → `Unsupported`).

### AFF-11 — MOYENNE [V] — Aucune porte d'essai d'affichage Linux/Wayland ; la variante vérifiée par cargo n'est pas celle livrée
- packages/infra/workspace/src/desktop-smoke.ts:30-44,92-96,157 : test WebView2 (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`), filtre `target.url.startsWith("http")` (WebKitGTK sert `tauri://`) → inopérant sous Linux ;
  docs/reference/ui/DESKTOP-INTEGRATION.md:113-116 décrit la même procédure WebView2. crates/ui/app/tests/ui_dist_assets.rs = assets seulement. rust-target-check / cross-platform-validator = `cargo check` Linux/MSVC/wasm : aucun cas Wayland/X11/headless.
- Unification de features : tauri 3.0.0-alpha.3 est lié à `gtk` ET `gtk4` dans Cargo.lock (deps de `tauri`) car tauri-runtime-wry (GTK3) et tauri-runtime-cef (GTK4) cohabitent dans le workspace ;
  tauri gtk_version.rs:3-8,24-40 : GTK4 gagne et les API GTK / l'intégration de menus Linux renvoient `GtkVersionMismatch` pour un runtime GTK3. `cargo check --workspace` et le gate `cargo check -p … -p …`
  (tauri-sync.ts:765-766) valident donc la variante unifiée, alors que `-p aphrody-app` seul (le binaire inspecté : NEEDED gtk-3) est GTK3. Impact actuel faible (aphrody-app n'appelle aucune API GTK, seulement `Menu::with_items` du tray, integration.rs:316), latent.

### AFF-12 — BASSE [V, importé Koharu / amont] — CEF : X11 forcé, port DevTools sans authentification en debug, drapeau « unsafe », sandbox
- X11 : doublon `("--ozone-platform","x11")` (koharu-app/src/app.rs:82) du forçage amont (runtime.rs:3167,3177) ; CHANGELOG koharu:19. Donc CEF = XWayland obligatoire ; sans DISPLAY `gtk4::init` échoue (tauri-winit-gtk4 event_loop.rs:163) → `.expect` (koharu/src/main.rs:46).
- `RemoteDebugging::Port { port: 4000, allowed_origins: [] }` en build debug (app.rs:71-75) : amont « reachable by every process on the machine, and the protocol has no authentication » (runtime.rs:199-210) ; loopback seulement, mais WSL2 relaie localhost vers l'hôte Windows [P]. Par défaut amont = `Disabled` (+ préférence épinglée).
- `--enable-unsafe-webgpu` (app.rs:80) figure dans `DANGEROUS_SWITCHES` d'amont (switches.rs:57) et part en RELEASE Linux (bloc `#[cfg(target_os = "linux")]`, pas de `debug_assertions`) → l'amont journalise « do not ship it ».
- Sandbox : `SandboxPolicy::Auto` (défaut, non surchargé) ; AppImage sans userns/chrome-sandbox → sans sandbox + avertissement ; **Windows : toujours sans sandbox** (sandbox.rs, runtime.rs:147-157). cible Linux : deb/rpm/appimage (tauri.linux.conf.json).
  Hôte : `user.max_user_namespaces=96079`, pas de restriction AppArmor visible. /dev/shm : aucun drapeau (`--disable-dev-shm-usage` non posé) ; GPU : ANGLE-Vulkan forcé (app.rs:78-81) sans repli.
- Koharu `csp: null` (tauri.conf.json), capabilities `core:default` + `process:default` + `opener:default` (importé, non modifié).
- À garder : les arguments Chromium de la ligne de commande sont ignorés en build livré (`allow_chromium_command_line_args` faux, runtime.rs:3245), `SSLKEYLOGFILE` neutralisé.

### AFF-13 — BASSE [V] — Dérive documentaire et skills périmés
- docs/architecture/os/ARCHITECTURE.md:31 (« Linux : Wayland/X11 ») et research/…:29-31 (« Intégration Wayland native (Smithay / Wry WebKitGTK) ») : ni Smithay ni Wayland natif fonctionnel (AFF-01) ; inventory/targets.json:46 `guiPolicy` « no-gtk-no-qt » alors que la pile est GTK3/GTK4 ;
  skill best-stack-2026:154 recommande `winit` 0.30 / déconseille `tao` alors que le dépôt livre tao (wry) et tauri-winit 0.31-beta (CEF) ; crates/ai/agent-tools/src/computer_use.rs:15 et ai/config/src/rag.rs:164 promettent un backend X11 inexistant.
- Skill `tauri-v2` (config/ai/plugins/aphrody/skills/tauri-v2/SKILL.md) — périmé pour Tauri 3 : Quick Start sans `.runtime(...)` (L34-47 ; en Tauri 3 le runtime est obligatoire, lib.rs:669 « Tauri 3 has no implicit runtime ») ; versions `^2` (L221-226, 411-414) vs `=3.0.0-alpha.3` ;
  `crate-type = ["staticlib","cdylib","rlib"]` + `mobile_entry_point` (L40,216-218) vs `["rlib"]` desktop (app Cargo.toml) ; `tauri-plugin-shell`/`http` (L424-425) absents ; section « Aphrody OS context » (L499-504) renvoie au dépôt `aphrody-ui` /
  `crates/aphrody-app` Tauri v2 / `docs/tauri/` / `.github/workflows/desktop-bundle.yml` / `deny.toml`, désormais `crates/ui/app` Tauri 3 ; aucune consigne Linux (GDK_BACKEND/WSLg, tray SNI, global-hotkey X11, `enableGTKAppId`, CEF) ni
  `fs:allow-read-text-file` supprimé / `tauri::Wry`→`DynRuntime` / `autolaunch()`→`autostart()` (PLAN.md « Ligne Tauri 3 »).
- Grille agents : cross-platform-validator/rust-target-check ne connaissent que 3 cibles de compilation ; aucune ligne sur la session d'affichage ; le skill `web-frames` est hors sujet (frames vidéo).

### AFF-14 — BASSE [P] — Identité Wayland (app_id), échelle fractionnaire, IME
- `enableGTKAppId` absent (tauri.conf.json ; défaut faux : tauri-utils config.rs:3382, tauri app.rs:2461) → `app_id` GTK = nom du binaire `aphrody-app`, alors que le .desktop installé est `aphrody.desktop` (linux/aphrody.desktop:5
  `StartupWMClass={{exec}}` n'aide que X11) → icône/regroupement génériques sous Wayland.
- GTK3/WebKitGTK 4.1 : échelle entière uniquement (tao window.rs:446 `scale_factor` entier) ; pas de wp-fractional-scale → rendu flou à 125/150 % sous Wayland ; WSLg transmet l'échelle de Windows (non testé).
- IME : `set_ime_position` est un `//TODO` (tao window.rs:749-751) mais non appelé ici ; WebKitGTK gère l'IME via GtkIMContext (text-input-v3 selon `GTK_IM_MODULE`).
- window-state sauvegarde `outer_position` = (0,0) sous Wayland (lib.rs window-state:254-255,331-332) ; le fichier d'état partagé rend à (0,0) la position restaurée si l'on bascule ensuite en X11 [P].

### AFF-15 — BASSE [V, importé tao] — Connexion Xlib ouverte à chaque `display_handle`, jamais fermée, pointeur nul non testé
- tao window.rs:934,983-986 et event_loop.rs:107,130 : `XOpenDisplay(NULL)` à chaque appel de `raw_display_handle`, aucun `XCloseDisplay` dans le crate, puis `NonNull::new_unchecked` sur le résultat
  (`XDefaultScreen(NULL)` avant). Un appel par `create_surface` de tauri-3d (layer.rs:131) et par consommateur de `display_handle` : fuite d'un client X par appel (XWayland limite les clients), UB si l'ouverture échoue.

## 5. Fonctions fenêtre : dégradation sous Wayland (appel → usage dans le code → comportement)

| Appel | Usage (chemin:ligne) | Wayland natif | X11 / WSLg (GDK_BACKEND=x11) |
|---|---|---|---|
| position absolue `set_position` / `outer_position` | quickbar.rs:71 ; integration.rs:418-432,619-630 ; window.rs:238-244 | silencieux : (0,0) / no-op [P] | OK |
| always-on-top / bottom | tauri.conf.json:40,56,71,86 | no-op silencieux [P] | OK avec WM compositant |
| skip-taskbar | tauri.conf.json:41,57,72,87 | no-op [P] | OK |
| curseur global `cursor_position` | quickbar.rs:60 ; integration.rs:387 | `Ok((0,0))` FAUX (tao util.rs:18) | OK |
| raccourci global | quickbar.rs:25 | inopérant, `Ok(())` silencieux | XGrabKey ; seulement clients X11 focalisés |
| tray SNI | integration.rs:300-364 | OK si watcher ; sinon Err journalisé (AFF-04) | idem |
| décorations / CSD | tauri.conf.json:26,37,53,68,83 `decorations:false` ; tao window.rs:193-196 | `set_titlebar(EventBox)` CSD, redimensionnement par bordure 5 px (event_loop.rs:523) — OK | OK |
| plein écran | non utilisé (`fullscreen:false`) | — | — |
| `set_focus` / `show_main` | integration.rs:188 ; quickbar.rs:45 | focus non garanti (pas de xdg-activation) | OK |
| drag fenêtre `start_dragging` | lib.rs:647 ; integration.rs:614,667 | `begin_move_drag(1,…,0)` (event_loop.rs:343) : OK clic gauche, bouton codé en dur | OK |
| drag-and-drop de fichiers | défaut Tauri (wry drag_drop GTK) | OK (DnD GTK) | OK |
| presse-papiers | window.rs:285-293 (plugin arboard, `wayland-data-control`) | OK si wlr-data-control, sinon repli XWayland ; erreur propagée | OK |
| IME | — | WebKitGTK/GtkIMContext ; `set_ime_position` TODO | idem |
| HiDPI / multi-écran | quickbar.rs:58-74 | échelle entière GTK3 ; moniteur sous curseur faux (0,0) | OK (échelle WSLg non testée) |
| capture écran / fenêtre | desktop.rs:34 ; lib.rs:431 | `Unavailable` explicite (Windows seul) | idem |
| click-through `set_ignore_cursor_events` | integration.rs:396 | région d'entrée supportée, mais décisions prises sur coordonnées fausses | OK |

## 6. À garder (correct, ne pas toucher)

- Feature `x11` sur tauri-runtime-wry (nécessaire aux handles Xlib de wgpu/tauri-3d sous X11 ; inerte sous Wayland).
- Refus des origines distantes pour toute commande (tauri webview/mod.rs:2138-2142), capabilities `local:true`, vérifications de label dans `aphrody_shell_window` / `aphrody_quickbar` / `require()` ; CSP de production sans `unsafe-inline` pour les scripts (tauri.conf.json:93, devCsp séparé) ; CSP stricte de model-view.
- aphrody-tauri-wrap : politique de navigation, popups, schémas OS limités, serveur bundle sur `127.0.0.1:0` (serve.rs:139), bridge de debug (loopback, jeton 64 hex, 0600, vide en release : debug.rs:110-120,200-214).
- Redimensionnement/CSD des fenêtres sans décoration gérés par tao sur Wayland (window.rs:193-196 ; event_loop.rs:523) — pas besoin de `start-resize-dragging` côté wry.
- `UnsupportedComputerBackend` et `tauri_screenshot` : erreurs explicites plutôt que résultats inventés.
- Runtime CEF : défauts sûrs amont (DevTools distants désactivés, arguments Chromium de la ligne de commande ignorés en livré, sandbox Auto avec avertissement).
- Pas de panique dans `NativeLayer::attach` (erreurs `String`), pas de GL implicite.

## 7. Recommandations priorisées

1. Un helper unique de préparation d'affichage (Linux) appelé avant `Builder::run` dans aphrody-app, aphrody-model-view et le gabarit `scaffold/web-to-tauri` : détecter WSL/WSLg, poser `GDK_BACKEND=x11` (et `WEBKIT_DISABLE_DMABUF_RENDERER=1` après mesure)
   tant que Wayland est « non résolu » (PLAN.md:525), refuser proprement sans `DISPLAY`/`WAYLAND_DISPLAY` (message + renvoi vers le CLI `aphrody`), et exposer `session: wayland|x11|windows` dans `aphrody_meta`. Aligner wslg-manager.sh:174, wsl.env.example, tauri-apps.json.
2. Détecter les capacités avant d'activer pet/widget/quickbar : désactiver le poller de curseur, le placement absolu, always-below et le raccourci global sous Wayland ; faire échouer visiblement `register` (sonder X11 soi-même ou
   utiliser le portail GlobalShortcuts) ; ne pas masquer `main` à la fermeture si le tray est absent.
3. Fermer le contrat IPC : `tauri_build::AppManifest::new().commands(&[…])` + fichiers de permission par fenêtre ; scoper `aphrody_fs_read_*` ; hook de plugin `on_navigation` limitant les fenêtres locales à l'origine de l'app, `on_new_window` en `Deny`, liste d'hôtes pour `window_open`.
4. Durcir le point d'accès local : SO_PEERCRED + vérification du propriétaire du socket avant `host_remote`, `bind` sous umask 0177 / répertoire privé, refus du repli `/tmp` sans répertoire 0700, `AuthPolicy` ou opt-in explicite pour `tauri_execute_js`, `clipboard_read`, `window_open`.
5. Réaligner build et vérification : rétablir `dbus` sur tauri-runtime-wry, retirer `libayatana-appindicator3-1` du deb, ajouter un gate Linux (Xvfb/Weston headless + bridge de debug ou WebKitWebDriver) et un `cargo check -p aphrody-app` isolé (GTK3) en plus du workspace (GTK4 unifié) ;
   mettre à jour le skill `tauri-v2` pour Tauri 3 et corriger ARCHITECTURE.md:31, research:29-31, targets.json:46, computer_use.rs:15, rust-crate-gpu-window-ownership.md:11-12.

## 8. NON EXAMINÉ

- Toute exécution : aucune fenêtre lancée, aucun test GTK/WebKit/CEF réel ; la sémantique GDK sous Wayland (keep_above, position, frame_extents, xdg-activation, input region) est déduite du code tao et de la connaissance GTK, [P].
- La cause exacte de l'« erreur de protocole Gdk 71 » (WebKitGTK DMABUF sous WSLg vs surface wgpu partagée) : non tranchée.
- Source UI `@aphrody/app-ui` (absente du workspace ; `ui-dist/app.js` minifié non audité : interception des liens, XSS) ; crates/ui/app/src/{broker,models,identity,koharu,shenron}.rs ; crates/ui/drive ; tauri-3d `permissions/` et `view.js`.
- Koharu au-delà de l'amorçage CEF (koharu-agent, koharu-ml, sentry…), Obscura, upstream/, plugins tauri hors single-instance/clipboard/window-state/global-shortcut, `tauri-plugin-dialog` (patché dans upstream/) et `rfd`.
- packages/infra/workspace/src/tauri-apps.ts (542 l.) et tauri.ts (336 l.) lus par grep seulement ; packages/ui/web-to-tauri/src/{probe,signals,policy}.ts non lus ; parity.ts/drivers.ts têtes seulement.
- Dépôt frère /home/aphro/iecode (iecode-winit, bevy, iced) : hors périmètre, frontière notée au §2.
- Windows / macOS : seules les gardes de plateforme visibles ont été relevées ; aucune vérification DirectComposition/WebView2.
