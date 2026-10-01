# Audit iecode-natif : fenêtrage, entrées, GPU, audio, compositing de l'écosystème Aphrody (vague 3)

Date : 2026-10-01. Dépôt frère : /home/aphro/iecode (branche main, 15 658 fichiers suivis, 202 membres Cargo, 2 342 650 lignes
Rust suivies). Niveau de preuve global : P1 (statique). [V] = lu dans le code, [P] = plausible / non reproduit.
Contraintes appliquées : lecture seule, aucun cargo/rustc, rien écrit dans /home/aphro/iecode.
Correction du propriétaire intégrée en cours de route (docs/reference/os/YOLO-AUTHORITY.md lu) : aucune recommandation de
sandbox, d'approbation ni de W^X comme exigence de sécurité. Les points JIT/mmap RWX sont traités comme contraintes de
FONCTIONNEMENT, et les ROM/images corrompues comme question de FIABILITÉ (l'hôte ne doit pas paniquer).

---------------------------------------------------------------------------------------------------

## 0. Périmètre réellement lu

- iecode : `Cargo.toml` (1-662 en entier), `Cargo.lock` (parsé en python : 1 610 paquets, 208 chemins, 3 git, reverse-deps),
  `rust-toolchain.toml`, `.cargo/config.toml`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `THIRD_PARTY.md`, `LICENSES.md`,
  `docs/upstream/FORK-INTEGRATION.md`, `docs/architecture/{ARCHITECTURE,RENDERER-CONVERGENCE}.md`, `docs/REMAINING-WORK.md`,
  `CMakeLists.txt` (1-150), `CMakePresets.json`, `vcpkg.json`, `vcpkg-configuration.json`, `cmake/overlay-ports/*/portfile.cmake`,
  `.github/workflows/aphrody-ci.yml`, `package.json` (scripts).
- Crates first-party lus : `aphrody-gpu-backend/src/lib.rs` (1-145, entier), `aphrody-wii/src/dol.rs` (entier),
  `aphrody-homebrew/src/{lib,main}.rs` + `src/iecode-cpp/homebrew/common/include/iecode/homebrew.h`, `aphrody-emulator-host/src/lib.rs`
  (entier), `aphrody-nie-game/src/gpu_select.rs` (entier) + `main.rs` 1060-1420, 1470-1700, `aphrody-nie-render3d/src/gpu.rs` 1-60 et 440-560,
  `aphrody-nie-ffi/src/lib.rs` 60-135, 270-400, 494-530, 755-990, `aphrody-nie-trace/src/{lib,win_memory}.rs` (extraits),
  `aphrody-nie-formats/src/cfgbin.rs` 396-540, `aphrody-egui-{winit,wgpu}` (README + diff egui-winit 0.36.2), `apps/web/crate/src/webgpu.rs` 20-125,
  `apps/web/wii/crate/src/lib.rs` 380-420 et 640-700, `crates/emu/wii/core/src/{boot.rs,jit.rs,jit/arena.rs}`, `crates/emu/wii/image/src/{dol,banner,rvz,lib}.rs` (extraits),
  `crates/emu/core/src/cpu/arm9/bus/fallback.rs` 1-80, `crates/emu/ruzu/ruzu/{Cargo.toml,src/render_window_wayland.rs 1-140}`.
- Vendoré : `crates/bevy/bevy_winit/{Cargo.toml,src/state.rs (grep)}`, `bevy_internal/Cargo.toml` (grep), `bevy_render/{Cargo.toml,src/settings.rs 66-90}`,
  `crates/wgpu/.gitignore`, `crates/wgpu/wgpu-types/src/backend.rs:692-704`, `crates/wgpu/wgpu-core/src/device/surface_config.rs:182`,
  diff de `crates/wgpu/*/src` contre `wgpu-30.0.1` du registre (avant que le registre local soit vidé par un tiers pendant l'audit).
- winit 0.30.13 (registre, lu avant vidage) : `Cargo.toml` features, `src/platform_impl/linux/wayland/**` (grep fractional_scale, text_input,
  xdg_activation, DroppedFile), `smithay-client-toolkit-0.19.2/src/shell/xdg/fallback_frame.rs` (en-tête).
- Monorepo : `docs/architecture/rust-crate-gpu-window-ownership.md`, `docs/plans/iecode/PLAN.md`, `docs/reference/iecode/{FORK-INTEGRATION,APHRODY-RUST-BASELINE}.md`,
  `docs/reference/iecode/libraries/iecode-winit/**` (31 fichiers : documentation seule), `docs/migration/source-map.json` (entrées iecode-winit),
  `/tmp/stack-dedup/metadata-after.json` (versions et reverse-deps), grep compositeur/Wayland sur tout le monorepo, plugin Aphrody
  (`skills/{cpp-pro,rust-target-check,render-pipeline}`, `agents/{cpp-c-engineer,cross-platform-validator,ffi-architect,security-engineer}`) comme grille.
- Référence réutilisation : `/home/aphro/cosmic-epoch/*/{LICENSE,Cargo.toml}` (licences), sans audit.

---------------------------------------------------------------------------------------------------

## 1. Réponse explicite : compositeur / serveur d'affichage / gestionnaire de fenêtres / client Wayland first-party ?

**Compositeur Wayland : NON. Serveur d'affichage : NON. Client Wayland first-party : NON (un seul client Wayland « maison », importé et non construit).**
Gestionnaire de fenêtres : NOMINAL seulement (enrobage de Tauri).

Preuves (toutes [V]) :
1. iecode `Cargo.lock` : absents `smithay`, `wayland-server`, `sctk` (nom nu), `libinput`, `input`, `evdev`, `udev`, `gbm`, `xkbcommon` (rust), `softbuffer`,
   `iced*`, `gpui`, `sdl2/sdl3` (hors archive), `rfd`. Présents uniquement des briques CLIENT tierces : `wayland-client 0.31.15`,
   `wayland-backend 0.3.17`, `wayland-protocols 0.32.12`, `-wlr 0.3.12`, `-plasma 0.3.12`, `-experimental/-misc` (via sctk 0.20), `wayland-cursor 0.31.14`,
   `wayland-csd-frame`, `smithay-client-toolkit 0.19.2/0.20.0` (client toolkit, pas smithay), `smithay-clipboard 0.7.3`, `x11-dl 2.21.0`, `x11rb 0.13.2`,
   `xkbcommon-dl 0.4.2`, `sctk-adwaita 0.10.1`. Aucune n'est first-party ; toutes entrent par `winit 0.30.13` (registre), `arboard 3.6.1` (wl-clipboard-rs),
   `smithay-clipboard` (egui-winit) ou `glutin`.
2. Monorepo `/tmp/stack-dedup/metadata-after.json` (182 membres) : mêmes absences (`smithay`, `wayland-server`, `wayland-cursor`, `cpal`, `gilrs`, `winit` nu) ;
   présents `tauri-winit-gtk4/x11 0.31.0-beta.3`, `tao 0.37.1`, `wry 0.57.0`, `gdk4-wayland` : briques Tauri, tierces.
3. grep sur tout le monorepo (`xdg_toplevel|xdg_wm_base|wl_compositor|wl_seat|zwlr_|libinput|libseat|wlroots|smithay|xwayland|weston`, hors docs/recherche et upstream) :
   aucun code. Seuls résultats : `scripts/tools/os/scripts/wslg-manager.sh:30,81,142-146` (inspecte les journaux Weston/Xwayland de WSLg : c'est
   le serveur d'affichage réel de la machine, externe) et `docs/ecosystem/ecosystem.json:3779` (liste de dépendances `smithay-clipboard`).
4. « Window manager » dans le monorepo = `crates/ui/app/src/window.rs:2,98` et `crates/ui/app/Cargo.toml:3,9` : « Tauri as the window manager of Aphrody OS »
   (fenêtres Tauri, notifications, presse-papiers). C'est un enrobage de tao/wry, pas un WM.
5. Le seul code client Wayland écrit à la main est **`crates/emu/ruzu/ruzu/src/render_window_wayland.rs` (589 lignes, GPL-3.0-or-later)** :
   sous-surface `wl_subcompositor`/`wl_subsurface` sur la surface GTK4 (`gdk4_wayland`, `wayland_client`), EGL/Vulkan. Il vient du snapshot Ruzu
   (vricosti/ruzu-emu, FORK-INTEGRATION.md:34), n'est PAS membre du workspace (`Cargo.toml` members : aucun `crates/emu/ruzu/*`),
   et n'est pas construit (voir INA-12). Ses frères `render_window_x11.rs`, `render_window_windows.rs` suivent le même statut.
6. La couche d'affichage effectivement utilisée par l'écosystème est externe : WSLg (Weston + XWayland) sous Linux, DWM sous Windows, WindowServer sous macOS.

Conséquence : « Aphrody OS plus natif » ne se vérifie pas côté affichage : aucune brique first-party de composition, de seat, de KMS/DRM ni de gestion
de fenêtres. Il existe des consommateurs (Bevy/winit, egui, Tauri, Avalonia) ; pas de producteur.

---------------------------------------------------------------------------------------------------

## 2. Cartographie : où est réellement la couche fenêtrage / entrées / GPU / audio / compositing

Légende de classe : (a) vendoré non modifié ; (b) fork modifié avec attribution ; (c) first-party natif ; (i) importé non construit / archivé.

| Domaine | Où | Classe | Actif ? |
|---|---|---|---|
| Fenêtre native (Linux/Win/macOS) | `winit 0.30.13` **registre** (aucun `[patch]` winit ; Cargo.lock) via `crates/bevy/bevy_winit` (package `aphrody-bevy-winit`, 4 119 lignes) | (a) ; 0 marqueur de patch dans les .rs Bevy | oui : `aphrody-nie-game` `run_bevy_window` (main.rs:1500-1523) |
| « iecode-winit » (aphrody-code/winit@05b8ff17) | docs seules : `docs/reference/iecode/libraries/iecode-winit/` (31 fichiers .md) ; source absente d'iecode (pas de `libraries/`) | prétendu (b), en fait absent | non |
| Fenêtre Wasm | `winit` web via `apps/web/wii/crate` (wasm32 uniquement, Cargo.toml `[target.'cfg(target_arch="wasm32")']`) | (c) | oui (navigateur) |
| GUI desktop .NET | Avalonia 11.3.22 `.UsePlatformDetect()` (`src/IECODE/Gui/Program.cs:18`, Directory.Packages.props:9) | tiers | oui (Windows ; sous Linux backend X11 donc XWayland [P]) |
| GUI Switch | GTK4 + SDL3 (`sdl3-sys`) + ash + sous-surface Wayland/X11/Win32/CAMetalLayer : `crates/emu/ruzu/ruzu` | (i) GPL, 1,0 M lignes | non (hors membres) |
| Anciens hôtes émulateurs | `vendor/dust-imgui-frontend-archive` (winit 0.30 + imgui + cpal 0.15), `vendor/gecko-integrated-archive/{app,tinyapp,debugger}` (winit + egui + cpal 0.17.3), `hostinput` (sdl3 + hidapi) | (i) archivés | non |
| Politique GPU partagée | `crates/aphrody-gpu-backend` (145 lignes, 0 `unsafe`) | (c) | oui mais mince (INA-04) |
| Pile wgpu | fork local `aphrody-wgpu 30.0.0` (`crates/wgpu`, trunk d1c95d96 selon FORK-INTEGRATION) **non suivi par Git** + `wgpu 30.0.1` registre (Bevy) + `wgpu 29.0.4` registre (eframe) | (b) / (a) | oui, 3 piles (INA-01, INA-02) |
| Rendu Bevy | `crates/bevy/*` (93 paquets `aphrody-bevy-*`, 0.20.0-dev) | (a) | oui |
| egui | `crates/aphrody-egui-winit` / `-wgpu` 0.36.2 (diff = 1 patch wasm documenté) ; `eframe 0.34.1` + `egui 0.34.3` registre pour l'éditeur | (b) quasi amont / (a) | oui (Wii web) |
| Rendu CPU | `aphrody-dust-soft-2d/3d`, `aphrody-nie-render3d/src/render.rs`, `aphrody-softraster` (monorepo) | (c) ×3 | oui |
| Audio natif | AUCUN actif. `cpal 0.17.3` ← `rodio 0.22.2` ← `aphrody-bevy-audio` uniquement ; le jeu n'active pas `bevy_audio` | – | non |
| Audio web | `AudioContext` (`apps/web/src/ui/ui.ts:14,51`, `apps/web/crate/src/audio.rs`) | (c) | oui (DS) |
| Manette native | AUCUNE active. `gilrs 0.11.2` ← `aphrody-bevy-gilrs` (feature non activée) ; `hostinput` SDL3 archivé | – | non |
| Manette web | `allow="gamepad"` (`apps/web/src/index.html:32`) mais aucun `getGamepads` dans `apps/web` | – | non |
| Clavier/souris | winit via Bevy (`bevy_winit/src/state.rs`) ; clavier DS/Wii via `apps/web/src/ui/input.ts` | (a)/(c) | oui |
| Compositing / présentation | surface wgpu (Fifo par défaut) ; DX12 `DxgiFromHwnd` par défaut (`wgpu-types/src/backend.rs:692-704`), DirectComposition optionnelle `DxgiFromVisual` ; Metal via `CAMetalLayer` (`raw-window-metal`) | (a)/(b) | oui |
| Hôte d'émulation | `aphrody-emulator-host` (129 lignes) : planification Bevy headless d'un `Emu<Interpreter>` Dust, un `run()` par tick, ni horloge ni GPU | (c) | oui (tests) |
| Émulateurs | Dust `emu/core` (57 775 l., GPL), Gecko `emu/wii/*` (≈ 59 000 l., GPL), `aphrody-ctr` (775 l.), `aphrody-switch` (225 l.), `aphrody-aarch64` (570 l.), Ruzu (1 M l., non construit), melonDS C++ (GPL, superbuild CMake) | (i)/(c) | partiel |
| FFI | `aphrody-nie-ffi` (cdylib `iecode`, 49 `extern "C"`, 103 blocs unsafe) ; `.NET IECODE.Ffi` ; aucun cxx/cbindgen/bindgen first-party | (c) | oui |

Lignes de code et unsafe (comptage python sur fichiers suivis, [V]) : Rust suivi 2,34 M lignes = emu 1,22 M (dont ruzu 1,0 M) + bevy 543 k + nie 344 k +
tests/wgpu 41 k + archives vendor 41 k + exemples. Les ~900 fichiers de `crates/wgpu` (≈ 150 k lignes) ne sont pas dans ce total (INA-01).
`unsafe` : 9 748 lignes ; ruzu 5 747, bevy_ecs 2 353, Dust core 262, wii/core 195, nie-ffi 197, emu/utils 186, render 231.

### Présence et versions dans iecode/Cargo.lock

| Brique | Version(s) | Source | Consommateur |
|---|---|---|---|
| winit | 0.30.13 | registre | bevy_winit, egui-winit, eframe, wgpu-hal(dev), wii-web (wasm) |
| bevy_winit | 0.20.0-dev | chemin | `aphrody-bevy-winit` |
| raw-window-handle | 0.6.2 | registre | |
| wgpu / wgpu-hal / wgpu-core | 29.0.4 + 30.0.1 (registre) + 30.0.0 (`aphrody-wgpu*`, chemin) | | eframe+egui-wgpu 0.34.3 / bevy_render, bevy_solari, dlss_wgpu / gpu-backend, wii-render, egui-wgpu 0.36.2 |
| wayland-client/-protocols/-cursor | 0.31.15 / 0.32.12 / 0.31.14 | registre | via winit, sctk |
| smithay-client-toolkit | 0.19.2 et 0.20.0 | registre | winit, smithay-clipboard, sctk-adwaita |
| x11-dl / x11rb / xkbcommon-dl | 2.21.0 / 0.13.2 / 0.4.2 | registre | winit, glutin, arboard |
| ash / gpu-allocator | 0.38.0+1.3.281 / 0.28.0 | registre | wgpu-hal (3 versions) |
| cpal / rodio / symphonia | 0.17.3 / 0.22.2 / 0.5.5 | registre | uniquement `aphrody-bevy-audio` |
| gilrs / gilrs-core / libudev-sys | 0.11.2 / 0.6.8 / présent | registre | uniquement `aphrody-bevy-gilrs` |
| egui / eframe / egui-winit / egui-wgpu | 0.34.3 + 0.36.2 / 0.34.1 / 0.34.3 + 0.36.2 (local) / 0.34.3 + 0.36.2 (local) | | |
| accesskit_winit | 0.32.2 et 0.34.0 | registre | |
| arboard / smithay-clipboard | 3.6.1 / 0.7.3 | registre | bevy_clipboard, egui-winit |
| libloading | 0.8.9 | registre | wgpu-hal, ash, x11rb, glutin |
| drm / khronos-egl / glutin | 0.15.0 / 6.0.0 / 0.32.3 | registre | wgpu-hal (GL/EGL), eframe |
| zbus | 5.13.2 | registre | bevy_winit (feature linux_game_mode), accesskit_unix |
| mlua + lua-src | 0.11.6 + 550.0.0 | registre | `aphrody-nie-lua` (Lua 5.2 vendored) |
| objc2 0.5.2/0.6.4, objc2-app-kit 0.2.2/0.3.2, objc2-metal 0.2.2/0.3.2, windows 0.62.2, windows-sys ×5 | | registre | macOS / Windows |
| ABSENTS | smithay, cosmic-text (déclaré `Cargo.toml:308`, jamais résolu), cryoglyph (déclaré, absent), softbuffer, rfd (déclaré, absent), iced, gpui, sdl2/sdl3 (hors archive), cxx, region, cranelift-*, libseccomp/landlock | | |

Les 3 dépôts git du lock : `arm-decoder` (kelpsyberry, sans licence détectée), `objdiff-core`, `object` (branche dev) : dépendances non épinglées par tag.

---------------------------------------------------------------------------------------------------

## 3. Constats

### INA-01 [HAUTE] [V] Le fork wgpu (24 membres, 643 .rs) n'est pas dans Git : `**/` dans `crates/wgpu/.gitignore:16`
- `crates/wgpu/.gitignore:16` vaut `**/` (l'amont a `**/*.rs.bk` à cet endroit, sous le commentaire « backup files generated by rustfmt »).
  `git check-ignore -v crates/wgpu/wgpu/src/lib.rs` → `crates/wgpu/.gitignore:16:**/`. `git ls-files crates/wgpu` = 8 fichiers
  (.gitignore, Cargo.lock, Cargo.toml.upstream, LICENSE.*, README.md, clippy.toml, rustfmt.toml) ; 643 `.rs` présents sur disque, ignorés
  (`git ls-files --others --ignored` : naga, wgpu, wgpu-core, wgpu-hal, wgpu-types, deno_webgpu, xtask…).
- `Cargo.toml` members : 24 des 202 membres ont leur `Cargo.toml` non suivi (`crates/wgpu/{wgpu,wgpu-core,wgpu-hal,wgpu-types,naga,naga-types,
  wgpu-sync,wgpu-info,...}`). Un clone propre ne résout donc pas le workspace, alors que ces paquets alimentent `aphrody-gpu-backend`,
  `aphrody-egui-wgpu`, `aphrody-wii-render` et tous les exemples wgpu.
- Contredit CLAUDE.md (« prove clean-clone behavior », REMAINING-WORK.md:15-16) et `FORK-INTEGRATION.md` (« active imported source is located under crates/ »).
  La porte `check:licenses:forks` (package.json) liste `crates/wgpu` mais lit les fichiers suivis : elle ne voit pas les 635 fichiers ignorés [P].
- Provenance non vérifiable : 0 marqueur `aphrody|iecode` dans les .rs wgpu ; diff contre `wgpu-30.0.1` du registre = 79 063 lignes (le fork est un snapshot
  trunk d1c95d96, pas la 30.0.1) donc les modifications locales éventuelles ne sont pas isolables.
- Correction : remplacer `**/` par `**/*.rs.bk` puis `git add crates/wgpu` après revue ; ou supprimer le fork si INA-02 est résolu par le registre.

### INA-02 [HAUTE] [V lock / P cause] Trois piles wgpu ; `[patch.crates-io]` n'a aucun effet ; le « propriétaire GPU partagé » ne couvre pas Bevy
- `Cargo.toml:652-655` : `[patch.crates-io] wgpu = { package = "aphrody-wgpu", path = ... }` (idem naga, wgpu-core, wgpu-hal, wgpu-types…). Le lock
  montre que le patch n'est pas appliqué : `aphrody-bevy-render` (Cargo.lock:1796) et `aphrody-bevy-solari` dépendent de `wgpu 30.0.1` **source registre**
  (`bevy_render/Cargo.toml:90-97` : `wgpu = { version = "30" }`), ainsi que `dlss_wgpu 6.0.0`. Cause probable : un `[patch]` à clé `wgpu` avec
  `package = "aphrody-wgpu"` patche le paquet `aphrody-wgpu`, pas `wgpu` [P].
- Résultat : (1) `aphrody-wgpu 30.0.0` chemin (gpu-backend, wii-render, egui-wgpu 0.36.2, exemples) ; (2) `wgpu 30.0.1` registre (Bevy) ; (3) `wgpu 29.0.4`
  registre (`eframe 0.34.1`, `egui-wgpu 0.34.3` → éditeur NIE). Trois univers de types `Device/Queue/Texture` incompatibles dans un même workspace.
- Conséquences : `aphrody-nie-render3d::GpuRenderer::from_device` (gpu.rs:~495, « Partage le device de l'hôte ») ne peut pas recevoir le `Device` de Bevy ;
  `aphrody-nie-game` crée la fenêtre via Bevy (registre) et la capture via `aphrody-gpu-backend` (fork) dans le même processus (main.rs:1110-1146 vs 1500-1523) ;
  la doc `docs/architecture/ARCHITECTURE.md` (« GPU package aliases resolve to the local wgpu fork ») et `RENDERER-CONVERGENCE.md` (« Local wgpu 30 API ») sont fausses pour Bevy.
- Monorepo : `aphrody-render` utilise `wgpu 30.0.1` registre, `vello 0.10.0` utilise `wgpu 29.0.3` (reverse-deps lus dans metadata-after.json). Aucune des deux
  couches n'est compatible avec l'autre par type, même si les numéros se ressemblent.
- Brique à réutiliser : le registre `wgpu 30.0.1` déjà lié par Bevy (à évaluer : abandonner le fork si aucune modification n'est prouvée) ; sinon corriger la clé du patch.

### INA-03 [MOYENNE] [P] Les crates Dust exigent nightly, la toolchain pin est stable 1.98.1
- `#![feature(...)]` : `crates/emu/core/src/lib.rs:3` (`core_intrinsics, adt_const_params, doc_cfg, portable_simd`), `emu/render/soft-2d/base/src/lib.rs:1`,
  `emu/render/soft-3d/src/lib.rs:1`, `emu/render/wgpu/src/lib.rs:1`, `emu/utils/src/lib.rs:1`, `emu/utils/tests/simd_savestate.rs:1`.
  `rust-toolchain.toml:5` : `channel = "1.98.1"` (stable). Aucun `RUSTC_BOOTSTRAP` hors des CI amont archivées (`.github/upstream/wgpu`).
- Sur stable, `#![feature]` est une erreur de compilation (E0554). Touche `aphrody-emulator-host`, `aphrody-dust-cli`, `apps/web/crate`, `aphrody-dust-wgpu`.
  PLAN.md (monorepo copie) affirme « cargo check --workspace --tests --locked » vert ; soit l'environnement force nightly/BOOTSTRAP en dehors du dépôt,
  soit l'affirmation est périmée. Non vérifié (aucun cargo).
- Action : consigner la variable d'environnement exacte dans le dépôt, ou pinner un nightly daté pour ces crates.

### INA-04 [MOYENNE] [V] `aphrody-gpu-backend` : un alias de wgpu, pas une politique
- `src/lib.rs:11-29` : `create_instance`, `request_adapter`, `enumerate_adapters` sont des passe-plats. `request_device` (62-84) : `required_features = empty`,
  `Trace::Off`, deux profils de limites. Pas de choix d'adaptateur, pas de repli logiciel, pas de `compatible_surface`, pas de rappel de perte de device.
- Aucun appel à `set_device_lost_callback` / `on_uncaptured_error` dans `aphrody-gpu-backend` ni dans les consommateurs natifs (`nie-game`, `emu/render/wgpu`,
  `apps/web/crate`, `apps/web/wii/crate`). Seuls `nie-render3d/src/web.rs:199-203` et Bevy (`bevy_render/src/error_handler.rs:118-138`) le font.
- `surface_configuration` (111-145) ne borne ni `width/height` à ≥ 1 ni à `adapter.limits().max_texture_dimension_2d` : wgpu refuse l'aire nulle
  (`wgpu-core/src/device/surface_config.rs:182`, `ZeroArea`), et l'erreur part vers le gestionnaire d'erreurs du device (panique par défaut) [P]. Les appelants web
  compensent (`webgpu.rs:25-26` `.max(1)`). `desired_maximum_frame_latency` est clampé par wgpu (`instance.rs:992`), pas un problème.
- Quatre politiques de sélection divergentes : `nie-game/src/gpu_select.rs` (DX12 > Vulkan sous Windows, Vulkan seul sous Linux, Metal), `nie-render3d/src/gpu.rs:36-60`
  (`Backend::default`), `aphrody-egui-wgpu/src/setup.rs`, Dust web (`BROWSER_WEBGPU`). Le doc monorepo (`rust-crate-gpu-window-ownership.md`) parle d'une
  « shared context/adapter policy crate » : la politique réelle est dans `gpu_select.rs`, pas dans le crate partagé.
- À garder : `surface_configuration` retourne `Option` (pas de panique), filtre le mode de présentation sur les capacités, laisse l'alpha explicite (commentaire 104-106).
- Brique : le gestionnaire d'erreurs de Bevy (`error_handler.rs`) et `nie-render3d/web.rs:199-203` comme modèle à remonter dans le crate partagé.

### INA-05 [MOYENNE] [V] Lecture GPU de `aphrody-nie-game` : attente infinie et `unwrap`
- `main.rs:1380-1381` et `4368-4369` : `readback.slice(..).map_async(MapMode::Read, |_| {})` (résultat ignoré) puis
  `device.poll(PollType::wait_indefinitely()).unwrap()`. Perte de device (TDR Windows, pilote WSLg dzn) → `Err` → panique ; blocage du GPU → attente sans fin.
  `get_mapped_range()` (1383) panique si le mappage a échoué.
- Correct, à imiter : `nie-render3d/src/gpu.rs:1137-1141` (canal + `context(...)` + `?`).
- Largeurs : `bytes_per_row_padded * height` en u32 (main.rs:1355) déborderait pour ≥ 32 768² ; non atteignable par les tailles G4TX réelles [P], BASSE.

### INA-06 [MOYENNE] [V] Le chemin fenêtré ignore la politique de backend ; deux familles de variables d'environnement
- `main.rs:1500-1523` : `DefaultPlugins.set(WindowPlugin{...})` sans `RenderPlugin`/`WgpuSettings` : `NIE_WGPU_BACKEND` et `NIE_WGPU_FORCE_FALLBACK`
  (`gpu_select.rs:22-38,87`) ne s'appliquent qu'à l'hors-écran. Bevy lit `WGPU_BACKEND` (`bevy_render/src/settings.rs:84`), défaut `Backends::all()` mais wgpu n'est compilé
  qu'avec `dx12, metal, vulkan, wgsl` (`bevy_render/Cargo.toml:90-96`) : pas de GLES, donc le crash Zink/WSLg décrit dans `gpu_select.rs:59-62` ne s'applique pas à Bevy.
- La fenêtre est dimensionnée sur la texture (`resolution: (width,height)`, main.rs:1509-1511) : une texture 4096² ouvre une fenêtre 4096² hors écran possible. BASSE.
- Pas de manette (aucune feature `bevy_gilrs`), pas d'audio (aucune feature `bevy_audio`), clavier seul (`touche_neutre`, main.rs:~1585) : le « jeu jouable » natif est muet.

### INA-07 [MOYENNE] [V source winit / P comportement] Chemin Linux winit 0.30.13 sous Wayland et X11
Features réellement activées pour `aphrody-nie-game` : `aphrody-bevy` = `["std","bevy_winit","bevy_sprite_render","multi_threaded","x11","wayland"]` (`Cargo.toml:~516`), qui active
`winit/wayland` et `winit/x11` ; `bevy_winit/Cargo.toml:68` : `winit = { default-features = false, features = ["rwh_06"] }`.
- Sélection : Wayland si `WAYLAND_DISPLAY`, sinon X11 (comportement winit [P]). Sous Wayland : `xdg_toplevel` via sctk, scale fractionnaire
  (`wp_fractional_scale` + `wp_viewporter`, `wayland/types/wp_fractional_scaling.rs`, `wp_viewporter.rs`), IME `text-input` (`wayland/seat/text_input`), `xdg_activation`, curseur : présents.
- **Glisser-déposer : ABSENT sous Wayland.** `grep DroppedFile|HoveredFile` dans `winit-0.30.13/src/platform_impl/linux/wayland/` = 0 ; présent dans `x11/event_processor.rs`.
  `bevy_winit/src/state.rs:376-386` relaie `FileDragAndDrop`, mais l'événement ne naît jamais sous WSLg/GNOME. Tout flux « déposer une ROM » doit passer par XWayland
  (`WINIT_UNIX_BACKEND=x11`) ou un sélecteur portail.
- Décorations : sans feature `wayland-csd-adwaita` (non activée ici ; `sctk-adwaita 0.10.1` n'est dans le lock que parce qu'un autre membre l'active), winit utilise
  `sctk::...::FallbackFrame` (« default ugly frame », barre 24 px, sans titre) quand le compositeur ne propose pas de SSD (GNOME). Correct mais dégradé.
- `wayland-dlopen` non activée : `libwayland-client.so.0` devient NEEDED du binaire `aphrody-nie-game` même pour le mode hors écran sur serveur sans Wayland [P, à
  confirmer par `readelf -d` quand un binaire existera ; aucun artefact `target/` dans iecode].
- `accesskit_unix` non activée (`bevy_winit/Cargo.toml:17-19`) : pas d'accessibilité AT-SPI sous Linux. Presse-papiers : `bevy_clipboard` → arboard 3.6.1 (`wayland-data-control` si activé) ;
  `zwlr_data_control` est absent de GNOME/Mutter [P].
- Windows : winit Win32 + DX12 `DxgiFromHwnd` (`wgpu-types/src/backend.rs:692-697`) : pas de transparence ; DirectComposition possible (`DxgiFromVisual`, 698-704) mais jamais demandée.
  macOS : AppKit + `CAMetalLayer` (`raw-window-metal 1.0`) ; aucun code first-party, jamais exécuté ici.

### INA-08 [MOYENNE] [V] Provenance des forks : winit absent, Bevy 0.20.0-dev annoncé 0.19.1, wgpu sans marqueur
- `iecode-winit` : monorepo `docs/reference/iecode/libraries/iecode-winit/` = CHANGELOG/FEATURES/CODE_OF_CONDUCT/changelog/*.md uniquement (31 fichiers, aucun .rs) ;
  `docs/migration/source-map.json` lui attribue 176 sources Rust cibles `crates/iecode/libraries/iecode-winit/...` mais `crates/iecode` n'existe plus au HEAD du monorepo
  (supprimé par le commit da1830a1, 280 fichiers). iecode n'a pas de `libraries/`. `Cargo.lock` : `winit 0.30.13` source registre, aucun `[patch.crates-io] winit`.
  Le fork winit n'est donc ni présent ni actif.
- Bevy : `crates/bevy/*/Cargo.toml` : `version = "0.20.0-dev"` (snapshot de la branche principale) alors que `docs/plans/iecode/PLAN.md` (monorepo) et `FORK-INTEGRATION.md`
  parlent de `aphrody/stable-0.19.1`. 0 marqueur `aphrody|iecode` dans les .rs de `crates/bevy` : seules les clés `package = "aphrody-bevy-*"` des manifestes distinguent l'import
  (`[lib] name = "bevy_winit"` conservé). Classe (a) : vendoré non modifié, sans preuve de diff.
- `aphrody-egui-winit` : diff contre `egui-winit-0.36.2` = 1 fichier (`dropped_file.rs`, branche wasm), documenté dans `README.md` avec somme SHA : (b) exemplaire. `aphrody-egui-wgpu` : patch
  « sRGB format check » décrit dans son README ; amont 0.36.x absent du registre local, non diffé.

### INA-09 [MOYENNE] [V] Manque natif : aucun hôte d'émulation avec fenêtre, audio ni manette dans le graphe actif
- `aphrody-dust-cli` (binaire `dust`) = outil ROM/TUI (ratatui + crossterm, `emu/cli/Cargo.toml`) ; pas de fenêtre. `aphrody-emulator-host` = ordonnancement headless
  (`lib.rs:1-4` : « neither creates a GPU device nor reads wall time »).
- Hôtes natifs retirés : `vendor/dust-imgui-frontend-archive/Cargo.toml:43,54` (winit 0.30, cpal 0.15), `vendor/gecko-integrated-archive/{app,tinyapp}/Cargo.toml` (winit 0.30.13,
  cpal 0.17.3), `hostinput` (sdl3 + hidapi). Aucun n'est membre ; cpal 0.17.3 du lock vient de rodio, pas d'eux.
- `docs/REMAINING-WORK.md:26` : « Unify multi-console Bevy hosting only after … » : le travail n'est pas commencé. DS/Wii n'existent que dans le navigateur (WebGPU + AudioContext).
- `apps/web/src/index.html:32` : permission `gamepad` accordée à l'iframe Wii mais l'API Gamepad n'est jamais lue.
- Brique : `gilrs 0.11.2` (déjà dans le lock) via la feature `bevy_gilrs` ; `cpal 0.17.3` / `rodio 0.22.2` via `bevy_audio` ou directement (cpal) ; les hôtes archivés montrent déjà le câblage cpal 0.17.3.

### INA-10 [MOYENNE] [V] `aphrody-nie-ffi` : panique ⇒ arrêt du processus hôte
- `crates/nie/aphrody-nie-ffi/src/lib.rs` : 49 `extern "C"`. Un seul `catch_unwind` (`wiki_json_impl`, ligne 511). `decode_json_impl` (494-499), `nie_decode_json*` (759-790),
  `nie_g4tx_to_png*` (835-860), `nie_vfs_read*` (940-985) appellent les parseurs (`aphrody_nie_formats::decode::to_json`, `Vfs::read`) sur des octets arbitraires sans garde.
  `Cargo.toml` racine : pas de `[profile.release] panic` ; `extern "C"` + unwind = abandon du processus Bun (Rust ≥ 1.81).
- Mitigant : les parseurs sont majoritairement gardés (`cfgbin.rs:440-443` `checked_add` avant toute lecture : à garder). Risque résiduel [P] : `cfgbin.rs:403-406`
  `Vec::with_capacity(root.value_count.max(0) as usize)` avec `value_count` i32 lu dans le fichier (jusqu'à 2^31 lignes) et boucle `for v in 0..value_count` non bornée par la taille des données.
- Contrat mémoire : `nie_bytes_free_fields(ptr, len, cap)` (368-376) reconstruit un `Vec` depuis des champs fournis par l'appelant ; `nie_vfs_*` prend un `*mut c_void`
  sans étiquette (use-after-free si `nie_vfs_free` précède un appel). Contrat documenté (118 commentaires SAFETY pour 103 blocs : bonne couverture), pas de garde runtime.
- Fix : `catch_unwind` sur les points d'entrée de décodage ; ne pas ouvrir de table de handles tant qu'aucune exigence ne l'impose.

### INA-11 [MOYENNE] [V] ABI .NET ⇄ natif : la bibliothèque et les symboles importés n'existent pas
- `src/IECODE/Ffi/Native/IecodeNative.cs:8,11` : `[LibraryImport("iecode_ffi", EntryPoint = "iecode_core_version" / "iecode_ffi_schema")]`.
  `git grep` : aucune définition de ces symboles dans le dépôt. Le cdylib est `crates/nie/aphrody-nie-ffi` nommé `iecode` (`Cargo.toml:13`) et exporte `nie_*`.
  `docs/architecture/ARCHITECTURE.md:27` confirme « The NIE C ABI is aphrody-nie-ffi, whose shared library target is iecode ». Les 277 tests .NET (`Core.Tests`) ne touchent pas `Ffi`.
- `docs/REMAINING-WORK.md:13` reconnaît « validate … the aphrody-nie-ffi bindings against real native symbols » : trou documenté, pas un oubli caché.
- Aucune FFI C++ ⇄ Rust active : ni `cxx`/`cxx-build` ni `cbindgen` dans le lock (`bindgen` 0.71-0.73 n'est que transitif) ; le superbuild (`CMakeLists.txt:61-113,150+`)
  exécute cmake, cargo et dotnet en parallèle sans lien de symboles. Types d'ABI homebrew cohérents champ à champ (`homebrew.h:25-39` ⇄ `aphrody-homebrew/src/lib.rs:11-30`)
  mais sans `static_assert`/`const _: () = assert!(size_of...)`, et `ABI_VERSION` dupliquée (`lib.rs:7`, `homebrew.h:10`). `aphrody-homebrew/src/main.rs:13` incruste `CARGO_MANIFEST_DIR`.

### INA-12 [MOYENNE] [V] Chargement DOL/ISO : deux analyseurs, un non validé sur un chemin wasm exporté (fiabilité)
- Analyseur vérifié : `crates/aphrody-wii/src/dol.rs:30-60` (`checked_add`, bornes, 5 tests dont débordement et mémoire intacte en cas d'échec) ; appelé par `Wii::with_dol`
  (`emu/wii/core/src/boot.rs:18-37`, plages MEM1 0x80000000-0x81800000 et MEM2 0x90000000-0x94000000, point d'entrée dans une section texte).
- Analyseur non vérifié : `crates/emu/wii/image/src/dol.rs:15-39` indexe `data[0x48+..]`, `data[0xE0..0xE4]` sans test de longueur (panique si < 0xE4 octets) ;
  `size()` (49-58) additionne `offset + size` en u32. Appelé par `start_emulator` (`apps/web/wii/crate/src/lib.rs:661-673`, export `#[wasm_bindgen]`) pour le chemin GameCube :
  un DOL tronqué dépose le worker (trap wasm). `start_wii_emulator` (676-682) passe, lui, par la validation. Doublon à fusionner : réutiliser `aphrody_wii::dol`.
- Latent (non construit) : `crates/emu/wii/image/src/rvz.rs` (`panic!` 98-99, `assert!`/`expect`, tranches `data[off..off+size]` non bornées, `zstd::decode_all` sans plafond,
  `Vec::with_capacity(count as usize)` 239/261) et `banner.rs:28,34` (allocation `vec![0; fst_size]`/`file_size` lue dans l'en-tête) sont derrière des features **non déclarées**
  (`image/Cargo.toml` : `default`, `banner` seulement ; `lib.rs` `#[cfg(feature = "rvz")]`). À corriger avant toute réactivation.
- `iso.rs:14-22` : `unwrap()` sur des tranches à décalages fixes d'un fichier arbitraire (compilé, appelé seulement par les hôtes archivés).
- Wii web `lib.rs:385-388` : `_ => return` sur tout `CurrentSurfaceTexture` non réussi : une surface `Lost`/`Outdated` n'est jamais reconfigurée (écran figé) ; Dust
  (`webgpu.rs:88-99`) et `nie-render3d/web.rs:772-788` traitent chaque variante : à imiter. BASSE.
- Dust : `aphrody-dust-core` charge les ROM via `ds_slot/rom/*` (1 171 lignes) sans `unsafe` de lecture de ROM ; les `unsafe` (215 blocs, 210 sans SAFETY voisin : `gpu/vram/access.rs` 40,
  `bank_cnt.rs` 37, `engine_3d.rs` 29, `cpu/arm9/bus/fallback.rs` 12) reposent sur des index masqués (`fallback.rs:20-31`) : cohérents à la lecture partielle, non audités ligne à ligne.

### INA-13 [MOYENNE] [V] JIT : contraintes de fonctionnement (pas d'exigence de sécurité)
- Wii : un JIT Cranelift complet existe (`emu/wii/core/src/gekko/jit/{runtime,handlers,translator}.rs`, `flipper/dsp/jit/*`, `flipper/gx/jit.rs`) mais il est mort : `gekko.rs:9-10`,
  `jit.rs:1,4`, `flipper/dsp.rs:8` sont `#[cfg(feature = "jit")]` et `emu/wii/core/Cargo.toml` ne déclare pas la feature `jit` ; `cranelift-*` et `region` sont absents de `Cargo.lock`.
  S'il est réactivé : `jit/arena.rs:28` `region::alloc(reserved, READ_WRITE_EXECUTE)` = zone RWX permanente ; sous macOS arm64 l'arène bascule avec
  `pthread_jit_write_protect_np` (114-119) mais l'allocation ne passe pas `MAP_JIT` [P] : la bascule serait sans effet et `mmap` RWX échouerait sans entitlement.
- melonDS (C++) : `ENABLE_JIT` vaut ON par défaut (`melonds/CMakeLists.txt:65`) ; le superbuild (`CMakeLists.txt:100-113`) n'envoie ni `-DENABLE_JIT` ni option de repli. `ARMJIT_Global.cpp:61-68`
  alloue en RWX (`VirtualAlloc PAGE_EXECUTE_READWRITE` / `mmap PROT_READ|WRITE|EXEC`, `MAP_JIT` sous APPLE_AARCH64 ligne 63) et `:104-108` fait un `mprotect` RWX global ; `ARMJIT_Memory.cpp:778`
  résout `VirtualAlloc2` par `GetProcAddress`. Fonctionnel sous Linux/Windows ; macOS signé « hardened runtime » exige l'entitlement `allow-jit` (non vérifié).
- Ruzu `rdynarmic` : « the x64 code cache remains RWX » (`rdynarmic/Cargo.toml:16`, `block_of_code.rs:239`) ; non construit.
- Aucun sandbox n'est recommandé (YOLO) ; en revanche la gestion d'une page non exécutable (SELinux execmem, entitlements macOS) doit produire une erreur lisible, pas un abort.

### INA-14 [MOYENNE] [V] Le snapshot Ruzu (1,0 M lignes) n'est ni construit ni constructible depuis la racine
- `crates/emu/ruzu/*` : core 425 501 l., video_core 217 615, rdynarmic 151 062, shader_recompiler 89 205, ruzu (GTK4) 60 612, audio_core 42 384… ; 5 747 lignes `unsafe`
  (`ruzu/core` 2 042 blocs dont 1 950 sans SAFETY voisin ; `video_core` 1 921/1 739 ; `rdynarmic` 557/551 ; `common` 177/163).
- Non membre (`Cargo.toml` members) ; `ruzu/ruzu/Cargo.toml` fait `sdl3-sys = { workspace = true }`, `input_common = { workspace = true }`… alors que la racine n'a ni `sdl3-sys` ni `gtk4` :
  le snapshot attend un workspace amont absent. `docs/architecture/ARCHITECTURE.md` : « Switch source snapshot … Not integrated », donc honnête. « Switch » exécutable = `aphrody-switch` (225 lignes, textures Tegra).
- Les `build.rs` de ruzu exécutent `pkg-config`, `cc`, `glslang`, `git`/compilateur (`video_core/build.rs:34-201`, `common/build.rs:6-145`) : à régler avant intégration.

### INA-15 [MOYENNE] [V] Gates : CI Linux unique sans cargo ; aucune preuve Windows/macOS/wasm
- `.github/workflows/aphrody-ci.yml` : un job `ubuntu-latest` = `bun run check:workspace`, `typecheck`, `lint:ts`, `format:ts:check`, `docs:check`, `check:licenses`, `git diff --check`.
  Pas de `cargo check/test/clippy`, pas de .NET, pas de CMake, pas de matrice Windows/macOS/wasm32. Actions flottantes (`actions/checkout@v4`, `oven-sh/setup-bun@v2`,
  `dtolnay/rust-toolchain@stable`) ; dépend de `vars.APHRODY_REPOSITORY` et de `secrets.APHRODY_READ_TOKEN || github.token` ; PLAN.md (monorepo) note des `startup_failure` hébergés.
- `rust-toolchain.toml:7-14` déclare 8 cibles (MSVC, GNU, apple-darwin ×2, wasm32 ×3) mais seuls `check:wii:web` (wasm32) et les gates locales WSL existent (`package.json`).
  Code spécifique Windows/macOS first-party : `gpu_select.rs:56-66,165` (cfg), `aphrody-nie-trace/src/win_memory.rs` (Win32), `Gecko arena.rs` (Apple, mort), `.NET`.
  Jamais compilé ici ; [P].
- Build natif : aucun `build.rs` n'exécute de code réseau ; seul `wgpu/wgpu/build.rs:113` lance `git rev-parse HEAD` (docs). vcpkg : `builtin-baseline` épinglé
  (`vcpkg.json:5`), ports overlay avec SHA512 (`cmake/overlay-ports/faad2/portfile.cmake`, `.../cli11/portfile.cmake`) : à garder. `vcpkg_installed/` : 16 Ko (rien d'installé, ignoré).

### INA-16 [BASSE] [V] Scripts d'installation non épinglés (reproductibilité)
- `scripts/ruzu/install_devkitpro_macos.sh:4-20` : `releases/latest/...pkg` téléchargé vers `/tmp/devkitpro-pacman-installer.pkg` (chemin fixe) puis `installer` en root, sans empreinte.
  `scripts/dev/setup_ghidra.ps1:56` : `Invoke-WebRequest` sans hachage. `scripts/ruzu/build-common.sh:71`, `build-macos.sh:45` : `curl | sh` (rustup, Homebrew) ; `prepare_starship_switch.sh:72` : `git clone --recursive`.

### INA-17 [BASSE] [V] Dérive monorepo ⇄ iecode (qui possède quoi)
- Dépendance à sens unique : iecode → monorepo par chemin (`Cargo.toml:~555-559` : `aphrody-re` → `../aphrody/crates/os/re`, `aphrody-identity` → `crates/ui/identity`,
  `aphrody-softraster` → `crates/ui/softraster`, `aphrody-sprite-sheet` → `crates/ui/sprite-sheet`, + `aphrody-svg`) ; le monorepo n'a aucune dépendance Cargo vers iecode. Intersection des
  noms de paquets : ces 5 seulement, sans doublon divergent. Mais iecode n'est pas clonable seul (`AGENTS.md` : « Cargo path dependencies require that checkout »).
- `docs/architecture/rust-crate-gpu-window-ownership.md` (monorepo) est périmé : cite `crates/iecode/` (supprimé), « No active … Bevy, winit … member » (faux pour iecode : `nie-game`
  `main.rs:1500-1523`), « one direct wgpu 30.0.1 » (metadata : `wgpu 29.0.3` via vello 0.10.0 + `30.0.1` via aphrody-render), et prévoit d'extraire `aphrody-gpu-backend` vers `crates/ui|native` :
  le crate n'existe que dans iecode.
- Fenêtrage : trois générations winit dans l'écosystème : iecode `winit 0.30.13` ; monorepo `tauri-winit-* 0.31.0-beta.3` + `winit-common` ; `tao 0.37.1`. Moteurs CPU de rendu en triple :
  `aphrody-softraster`/`aphrody-render` (monorepo), `aphrody-nie-render3d/src/render.rs`, `aphrody-dust-soft-2d/3d`. Contextes GPU en quatre exemplaires (INA-04).

### INA-18 [BASSE] [V] Outils de mémoire de processus (fiabilité) : `aphrody-nie-trace` / `aphrody-nie-computer-use`
- `win_memory.rs:105-196` : `OpenProcess(VM_READ|VM_WRITE|VM_OPERATION)`, `VirtualProtectEx(PAGE_EXECUTE_READWRITE)` page par page puis restauration, `WriteProcessMemory` : bien commenté (SAFETY, 25 commentaires
  pour 28 blocs). `lib.rs:20,443` `patch_eac` (NOP sur copie de l'exécutable) ; `aphrody-nie-computer-use/src/lib.rs:31-33` ré-exporte `trace`. Pas de borne de longueur : `saved: Vec` croît par page. Statut gouvernance hors périmètre (YOLO).

---------------------------------------------------------------------------------------------------

## 4. Inventaire `unsafe` par crate (fichiers suivis ; blocs / sans SAFETY voisin)

| Crate | Blocs | Sans SAFETY | Remarque |
|---|---|---|---|
| `aphrody-gpu-backend` | 0 | – | 100 % sûr |
| `aphrody-egui-wgpu` / `-winit` | 2 + 1 | – | hérités de l'amont (`set_window_unsafe`, `smithay_clipboard::Clipboard::new`) |
| `aphrody-nie-ffi` | 103 | 25 | 118 SAFETY ; frontière C-ABI |
| `aphrody-nie-trace` | 28 | 2 | Win32/Wine |
| `aphrody-dust-core` (emu/core) | 215 | 210 | VRAM, bus, 3D, SIMD x86/aarch64 |
| `aphrody-wii-runtime` (emu/wii/core) | 180 | 180 | MMIO `read_unaligned`, JIT mort, DSP, GX |
| `aphrody-dust-soft-2d/base` | 91 | 91 | accès pixels, `unsafe fn ... -> &mut` depuis `&self` (lib.rs:81-84) |
| `aphrody-dust-wgpu` | 69 | 69 | |
| `aphrody-emu-utils` | 69 | 68 (57 SAFETY ailleurs) | `#![feature(...)]` |
| `apps/web/crate` | 9 | 9 | |
| Bevy `bevy_ecs` / `bevy_ptr` / `bevy_platform` | 1 349 / 54 / 58 | 15 / 4 / 5 | amont, bien documenté |
| Ruzu (non construit) | ≈ 5 000 | ≈ 4 700 | INA-14 |

---------------------------------------------------------------------------------------------------

## 5. Briques existantes à réutiliser (« à évaluer », jamais « à écrire »)

Principe du propriétaire : réutiliser plutôt que refaire. Licence = licence DÉCLARÉE amont (non relue sauf cosmic-epoch).

| Trou | Brique | Licence | Dans iecode/Cargo.lock ? |
|---|---|---|---|
| Fenêtre, entrées, IME, scale fractionnaire | `winit 0.30.13` (déjà là) | Apache-2.0 | oui |
| Décorations Wayland sans SSD | feature `wayland-csd-adwaita` de winit (`sctk-adwaita 0.10.1`) | MIT / Apache-2.0 | oui (sctk-adwaita) |
| Glisser-déposer / sélecteur de fichier sous Wayland | portail XDG via `zbus 5.13.2` (déjà là) ou `rfd` (déclaré, absent) ; ou XWayland | MIT-Apache / MIT | zbus oui, rfd non |
| Manette | `gilrs 0.11.2` via `bevy_gilrs` (feature à activer) ; `sdl3` archivé dans `hostinput` | MIT-Apache / zlib | gilrs oui, sdl3 non |
| Audio natif | `cpal 0.17.3` + `rodio 0.22.2` via `bevy_audio`, ou cpal direct (câblage dans `tinyapp`) | Apache-2.0 / MIT-Apache | oui |
| Texte (UI native) | `parley 0.11` + `swash 0.2` déjà liés par `bevy_text` ; `cosmic-text` (déclaré, jamais résolu) | MIT-Apache | parley oui, cosmic-text non |
| Fenêtre logicielle sans GPU | `softbuffer 0.4` (présent dans le monorepo 0.4.8) | MIT / Apache-2.0 | non (iecode) |
| Pile GPU unique | `wgpu 30.0.1` registre (déjà lié par Bevy) | MIT / Apache-2.0 | oui |
| Perte de device | `bevy_render/src/error_handler.rs:118-138` (patron) | MIT / Apache-2.0 | oui (vendoré) |
| DirectComposition | `Dx12SwapchainKind::DxgiFromVisual` du fork wgpu (`backend.rs:698-704`) | MIT / Apache-2.0 | oui |
| Compositeur / WM / panneau, si le propriétaire veut un jour un affichage first-party | `smithay` (rev e3d461a, `cosmic-comp/Cargo.toml:149`) ; `cosmic-comp` GPL-3.0-only ; `cosmic-panel` GPL-3.0-only ; `cosmic-session` GPL-3.0-only ; `cosmic-settings-daemon`, `cosmic-osd`, `xdg-desktop-portal-cosmic` GPL-3.0-or-later ; `cosmic-randr`, `cosmic-bg` MPL-2.0 ; `cosmic-idle`, `cosmic-launcher`, `cosmic-notifications` GPL (texte LICENSE) | MIT (smithay) / GPL-3 (COSMIC) | smithay NON ; aucun COSMIC |
| Presse-papiers | `arboard 3.6.1`, `smithay-clipboard 0.7.3` | MIT-Apache / MIT | oui |
| Accessibilité | `accesskit_winit 0.34` + feature `accesskit_unix` (zbus déjà lié) | MIT-Apache | oui |

Par domaine, fonctionnalité first-party OS native vs enrobage d'un outil externe :
- Noyau, init, IPC : hors de cet axe (autres rapports).
- Fenêtrage : enrobage (winit/Bevy/Tauri/Avalonia) ; **rien de first-party natif**.
- Entrées : enrobage (winit, navigateur) ; aucun pilote ni couche evdev/libinput.
- GPU : enrobage (wgpu) + 145 lignes de politique partagée ; pas de pilote.
- Audio : aucun actif natif ; Web Audio dans le navigateur.
- Compositing / affichage : aucun ; WSLg/DWM/WindowServer.
- Émulation : Dust, Gecko, melonDS, Ruzu = code importé GPL ; first-party réel = 2 222 lignes (`aphrody-{wii,ctr,switch,aarch64,homebrew,emulator-host}`).

---------------------------------------------------------------------------------------------------

## 6. À garder (correct)

- `aphrody-wii/src/dol.rs` et `Wii::with_dol` : validation avant mutation, tests de débordement.
- `aphrody-emulator-host` : un `run()` par tick, état explicite, pas d'horloge ni de GPU ; limité à l'interpréteur Dust.
- `aphrody-gpu-backend::surface_configuration` : `Option`, filtrage des modes de présentation, alpha explicite pour canvas.
- Gestion des variantes `CurrentSurfaceTexture` dans `apps/web/crate/src/webgpu.rs:88-99` et `nie-render3d/src/web.rs:772-788`.
- `aphrody-egui-winit` : écart amont minimal, documenté, avec somme de contrôle (README).
- `cfgbin.rs:440-443` : garde `checked_add` avant lecture ; commentaires SAFETY de `nie-ffi` et `nie-trace`.
- vcpkg épinglé (baseline + SHA512 des ports overlay) ; aucun `build.rs` n'exécute de code réseau.
- Types d'ABI homebrew identiques côté C et Rust.

---------------------------------------------------------------------------------------------------

## 7. NON EXAMINÉ

- Toute exécution : aucune fenêtre, aucun cargo, aucun `readelf` sur un binaire iecode (aucun artefact `target/`), aucun GPU ni Wayland vivant ; tous les [P] restent à reproduire.
- Registre `~/.cargo/registry/src` vidé par un tiers pendant l'audit : `region`/`cranelift-jit` (MAP_JIT), egui-wgpu 0.36 amont, wgpu-hal détaillé non relus après coup.
- Bevy vendoré (aucun diff possible faute d'amont 0.20-dev dans le registre) ; wgpu fork : seuls `backend.rs`, `surface_config.rs`, les `build.rs` lus ; diff complet contre trunk d1c95d96 impossible.
- Corps de Dust (`emu/core` hors `ds_slot` et un extrait de `bus/fallback.rs`), de Gecko (`gekko`, `flipper`, `hollywood`, `mmio` hors `boot.rs`), `aphrody-ctr` (PICA), `aphrody-aarch64`,
  `aphrody-switch/texture.rs`, melonDS C++ au-delà de `ARMJIT_*` et du CMake, `src/iecode-cpp/src` (≈ 600 fichiers de formats, 262 `memcpy/reinterpret_cast`), `third_party`.
- Les 51 crates NIE hors `nie-game`, `nie-render3d`, `nie-ffi`, `nie-trace`, `nie-formats/cfgbin.rs` ; `aphrody-nie-lua` (VM Lua 5.2 C sur `.lua.bin`), `nie-net`, `nie-steam`, `nie-mcp`.
- Ruzu au-delà de `ruzu/Cargo.toml` et de `render_window_wayland.rs` (1-140) ; `rdynarmic`, `video_core`, `audio_core` non lus.
- `src/IECODE` : seulement `Ffi/Native`, `Gui/Program.cs`, greps P/Invoke ; Avalonia/X11 vs Wayland natif affirmé de mémoire [P].
- Packages Bun (`packages/ieverse`, `azalee`, `inagle`), `apps/web/src/*.ts` (hors greps), Python, `scripts/` hors greps ; `docs/gecko`, `docs/ruzu`, `docs/bevy`.
- Le monorepo au-delà des greps compositeur et de `crates/ui/app` (en-têtes) ; `cosmic-epoch` : licences et rev smithay seulement, aucun audit.
- Licences des crates tierces proposées (hors COSMIC) : données amont de mémoire, à relire dans leurs `Cargo.toml`.
- Dates de publication/maintenance des crates ; advisories RustSec (interdit).
