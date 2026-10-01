# Audit bas niveau, axe GPU : couche native, GPU et rendu (2026-10-01)

Niveau de preuve global : P1 (statique). Aucun `cargo`, `rustc`, `bun test` lancé. Lecture seule.
Marqueurs : [V] vérifié dans le code/les sources du registre lues ; [P] plausible, non reproduit.
Le dépôt a un arbre de travail modifié ; j'ai lu l'arbre de travail, pas HEAD. Les crates du périmètre (`crates/ui/render`,
`render-tools`, `tauri-3d`, `bun`, `model-view`) portent des modifications non commitées (diff lu pour `gpu.rs`,
`layer.rs`, `render-tools/src/lib.rs`, `scene3d.rs`, `raster.rs`) : migration vers l'API wgpu 30 (`CurrentSurfaceTexture`,
`color_space`, `queue.present`) et renommage `aphrody_m3` -> `aphrody_m3_tokens::facade` ; aucune de ces modifications ne
corrige un constat ci-dessous. Cet état n'a pas été compilé par moi ; les numéros de ligne sont ceux de l'arbre de travail au moment de la lecture.
Cargo.lock (modifié) lu tel quel ; la duplication wgpu 29/30 existe aussi dans `git show HEAD:Cargo.lock`.

## 1. Périmètre réellement lu

- `crates/native/native` : `src/lib.rs` (1-81), `src/cuda.rs` (1-193), `src/topology.rs` (1-189),
  `examples/status.rs`, `Cargo.toml`, `README.md`.
- `crates/ui/render` : `src/gpu.rs` (940 l., intégral), `src/gpu3d.rs` (972 l., intégral), `src/pipeline3d.rs`,
  `src/lib.rs` (1-300), `src/scene3d.rs` (constantes, `prepare_with`, tri des batches), `src/raster.rs`
  (Canvas, render_scene), `src/raster3d.rs` (allocations, tests), `src/canvas.rs` (limites), `src/model.rs`
  (chargement), `src/mesh3d.rs` (limites), `src/gpu3d.wgsl` (fs_main), `Cargo.toml`.
- `crates/ui/render-tools` : `src/lib.rs` (1-235), `Cargo.toml`.
- `crates/ui/tauri-3d` : `src/lib.rs`, `src/layer.rs`, `src/dcomp.rs`, `Cargo.toml`.
- `crates/ui/model-view` : `src/main.rs` (60-135), `Cargo.toml`. `crates/ui/softraster/src/lib.rs` (1-60 + grep).
- `crates/ui/bun` : `src/render.rs` (intégral), `Cargo.toml` (feature `gpu`). `packages/interop/native/src/render.ts`.
- `crates/koharu/koharu-rasterizer` : `src/native.rs` (intégral), `src/compositor.rs` (1-330 + grep), `Cargo.toml`.
  `crates/koharu/koharu-canvas` : `Cargo.toml`, `src/surface.rs` (1-80), `src/web.rs` (1015-1210).
  `crates/koharu/koharu-pipeline/src/resources/linux.rs`, `koharu-library/src/agent_host.rs` (85-125).
- Docs : `docs/architecture/rust-crate-gpu-window-ownership.md`, `docs/architecture/ui/README.md`,
  `docs/architecture/ui/design/M3-RENDER.md` (extraits), `docs/guides/web/TAURI-DEBUG.md` (10-40),
  `docs/architecture/os/ARCHITECTURE.md` (grep), `crates/ui/render/README.md`.
- Skills/agents (grille) : `render-pipeline`, `peaufiner-rendu-3d`, `nie-render-pipeline`, `pixel-perfect`,
  `rust-target-check` ; agents `asm-lowlevel-engineer`, `cpp-c-engineer`, `performance-engineer`, `rust-architect`
  (en-têtes). `rust-best-practices-2026` : non lu en détail.
- Tiers lus dans `~/.cargo/registry/src` : wgpu 30.0.1 (`api/instance.rs`, `backend/wgpu_core.rs`),
  wgpu-types 30.0.1 (`limits.rs`, `instance.rs`, `backend.rs`), wgpu-core 30.0.1 (`instance.rs`, `present.rs`,
  `device/resource.rs`), wgpu-hal 30.0.1 (`gles/egl.rs`, `Cargo.toml`), vello 0.10.0 (`util.rs`),
  tao 0.37.1 (`platform_impl/linux/window.rs`), tauri 3.0.0-alpha.3 (`window/mod.rs`), tauri-macros 3.0.0-alpha.2.
- Hôte (ls/ldconfig/nm/readelf/grep -a, aucune exécution) : `/dev/dxg`, `/usr/share/vulkan/icd.d`,
  `/usr/lib/wsl/lib`, `/etc/ld.so.conf.d`, `target/release/libaphrody_ffi.so`.

## 2. Réponses aux six points demandés

### 2.1 wgpu : un seul contexte partagé

Il existe un seul point de création dans `aphrody-render` : `gpu.rs:160` (`Instance::new`), `gpu.rs:164`
(`request_adapter`), `gpu.rs:185` (`request_device`), derrière `shared_context()` (`gpu.rs:127`). Tous les
utilisateurs de `aphrody-render` passent par `Renderer3d::new()` (`gpu3d.rs:206`) ou `shared_context()`
(`tauri-3d/src/layer.rs:126`). [V]

Ce qui n'est PAS imposé :
- `Renderer3d::with_device(device, queue, adapter)` (`gpu3d.rs:218`) accepte un device externe : c'est
  documenté comme contrat de migration, mais rien n'interdit un second device.
- Il existe d'autres contextes wgpu hors de ce point, dans du code importé : `koharu-rasterizer`
  `native.rs:107-109` appelle `vello::util::RenderContext::new()` (propre `Instance`, wgpu 29) ; `koharu-canvas`
  `web.rs:1097` crée un `Instance` `BROWSER_WEBGPU` (wasm32 uniquement). `n2b/bin_cmd_gpu.rs:138` est une
  chaîne de gabarit (`WEBGPU_LIB_RS`), pas du code compilé.
- `docs/architecture/rust-crate-gpu-window-ownership.md` affirme un crate `aphrody-gpu-backend` et
  `nie-render3d`. Aucun n'existe : pas de répertoire, aucune entrée `name = "aphrody-gpu-backend"` ni `nie-*` dans
  Cargo.lock (0 paquet `nie-`), seule une entrée orpheline `docs/ecosystem/ecosystem.json:4037-4038`
  (`crates/aphrody-gpu-backend`). Le même document dit qu'`aphrody-render` "still creates its own context" : périmé,
  c'est déjà le contexte partagé. [V]

Sélection de backend [V] :
- `gpu.rs:153-157` : Windows tente `DX12` puis `all()` ; ailleurs `all()`. `new_without_display_handle()`
  (`gpu.rs:162`) n'appelle pas `.with_env()` : `WGPU_BACKEND`, `WGPU_ADAPTER_NAME`, `WGPU_POWER_PREF`,
  `WGPU_VALIDATION` sont ignorés dans `aphrody-render`. Aucune référence `WGPU_*` dans le code first-party
  (grep). `vello` (koharu) les honore (`vello-0.10.0/src/util.rs:33-36,163`).
- `power_preference: HighPerformance`, `force_fallback_adapter: false`, `compatible_surface: None`
  (`gpu.rs:165-170`). Un adaptateur CPU (lavapipe, WARP) est accepté ; il est classé en dernier par wgpu
  (`wgpu-core-30.0.1/src/instance.rs:571-600`) mais choisi s'il est seul.
- Les features Cargo `vulkan/dx12/metal/webgpu/webgl/all-gpu` de `aphrody-render` sont des alias de `gpu`
  (`Cargo.toml:19-25`) ; la dépendance wgpu active toujours `["wgsl","dx12","vulkan","metal","webgpu","webgl"]`
  (`Cargo.toml:44`) et jamais `gles`. Sous Linux natif seul Vulkan est donc compilé : `libaphrody_ffi.so`
  contient `libvulkan.so.1` mais ni `libEGL` ni `libGL` (grep -a : 0 occurrence). Le GL natif n'est pas disponible.

Aucun adaptateur : `NoAdapter` propre (`gpu.rs:177`, `GpuError::NoAdapter`), mappé en `Gpu3dError::NoAdapter`
(`gpu3d.rs:206-213`) ; `Pipeline3d` mémorise l'échec (`GpuState::Unavailable`, `pipeline3d.rs:130`) et retombe en CPU sauf
`GpuRequired`. Mais le cache global ne mémorise pas l'échec : chaque appel `shared_context()` refait
`Instance::new` + énumération Vulkan (`gpu.rs:132`). [V]

Perte de device : voir G3. Timeouts de mapping : aucun (`PollType::wait_indefinitely()` à `gpu.rs:600` et
`gpu3d.rs:380` ; koharu `timeout: None`, `native.rs:390-393`). [V]

Limites et tailles venant de l'utilisateur : voir G1, G2, G9.

Poll bloquant en contexte async :
- Correct : `render-tools/src/lib.rs:202` enveloppe `Pipeline3d::render` dans `spawn_blocking` ; `ui/app`
  `models.rs:267` fait de même pour la topologie ; `koharu-desktop/src/lib.rs:100` utilise
  `tokio_rayon::spawn(Rasterizer::new)`.
- Fautif (code importé koharu) : `koharu-library/src/agent_host.rs:95-99` appelle, dans un `async fn`, `Rasterizer::new()`
  (`pollster::block_on`, `native.rs:107`) puis `rasterize()` (`device.poll(Wait, None)`, `native.rs:390`) sur un
  worker tokio. [V]
- `shared_context()` garde le Mutex global pendant `pollster::block_on(create_context())` (`gpu.rs:128-132`) : pas
  de timeout, un ICD Vulkan bloqué fige tous les appelants.

### 2.2 Création de surface / raw-window-handle : la réalité

Un seul endroit crée une surface de fenêtre : `tauri-3d/src/layer.rs:131` (non-Windows), `layer.rs:195-199` (Windows,
`create_surface_unsafe(CompositionVisual)` si backend "Dx12") et `layer.rs:203` (Windows hors DX12). Tout le reste est
hors écran : `gpu.rs`/`gpu3d.rs` (texture + readback), `koharu-rasterizer` (texture + readback), `softraster`
(CPU). `koharu-canvas` ne compile ses dépendances que pour `wasm32` (`Cargo.toml` `[target.'cfg(target_arch =
"wasm32")'.dependencies]`) : surface `SurfaceTarget::Canvas` navigateur seulement. `vello::RenderContext::create_surface`
existe mais n'est appelé nulle part. [V]

Sous Linux (X11/Wayland) la surface est créée sur la fenêtre Tauri elle-même : `tauri::Window` implémente
`HasWindowHandle` via `dispatcher.window_handle()` (`tauri-3.0.0-alpha.3/src/window/mod.rs:1032-1044`), et tao
renvoie le XID (Xlib) ou le `wl_surface` du `GdkWindow` de premier niveau
(`tao-0.37.1/src/platform_impl/linux/window.rs:946-967`). Il n'y a ni fenêtre enfant, ni sous-surface Wayland, ni
équivalent DirectComposition : voir G4. Sur cet hôte Tauri exige `GDK_BACKEND=x11` (`config/tauri-apps.json:43`), donc
le cas réel est Xlib.

Ordre de destruction : le calque est retiré à `WindowEvent::Destroyed` (`tauri-3d/src/lib.rs:281-287`), c'est-à-dire
après la destruction de la fenêtre native. Redimensionnement : `Resized` et `ScaleFactorChanged` appellent
`layer.resize` (`lib.rs:277-280`) qui reconfigure la surface en pixels physiques (`layer.rs:224-231`) ; le
viewport, stocké en pixels physiques au moment de `set_viewport` (`lib.rs:202-211`), n'est pas recalculé au changement
de facteur d'échelle. Pas de gestion du facteur d'échelle fractionnaire Wayland (GTK3 : entier).

### 2.3 Natif : `cuda.rs` et `topology.rs`

Chargement dynamique [V] :
- Windows : `nvcuda.dll` avec `LOAD_LIBRARY_SEARCH_SYSTEM32` (`cuda.rs:60`) : durci contre le détournement de
  l'ordre de recherche.
- Linux : noms nus `libcuda.so.1` puis `libcuda.so` (`cuda.rs:67`) : la recherche suit `LD_LIBRARY_PATH`/RUNPATH/
  ld.so.cache. Sur cet hôte `ldconfig -p` résout `libcuda.so.1` vers `/usr/lib/wsl/lib/libcuda.so.1` via
  `/etc/ld.so.conf.d/ld.wsl.conf` ; `LD_LIBRARY_PATH` pointe sur `~/.aphrody/runtimes/onnxruntime-...`
  (aucun `libcuda.so*` dedans). Asymétrie de durcissement Windows/Linux, voir G12.
- La bibliothèque est fuitée volontairement (`Box::leak`, `cuda.rs:49`) et jamais `dlclose`.
- Échec propre : tout `?`/`.ok()` donne `None` (`cuda.rs:46-85`), résultat mis en cache dans un `OnceLock`
  (`cuda.rs:23`), y compris l'échec.
- `unsafe` : chaque bloc a un commentaire SAFETY ; prototypes typés d'après `cuda.h` (`CUresult`/`CUdevice` = int,
  `size_t` = usize, `extern "system"` pour `CUDAAPI` stdcall) ; `cuDeviceTotalMem_v2` est le bon symbole ;
  les `Symbol` sont recopiés en pointeurs de fonction mais la lib est `'static`. Invariants corrects. Test avec fonctions
  factices (`cuda.rs:127-168` du module `driver::tests`). [V]

Lectures système : `/proc/meminfo` uniquement (`topology.rs:97`), `MemAvailable` puis `MemFree`. Aucune lecture de `/sys`,
aucun hwloc, aucun NVML, aucune lecture cgroup dans `aphrody-native` (grep `hwloc` : 0). `cpu_count` =
`available_parallelism` (sensible à l'affinité/cgroup CPU) ; la mémoire est celle de l'hôte, pas du cgroup. Le "topology"
est une structure plate de 7 compteurs, pas une topologie (pas de sockets, cœurs physiques, NUMA, caches). NVML et
`/sys/class/drm` n'existent que dans le code importé `koharu-pipeline/src/resources/linux.rs:14,78` (`nvml-wrapper`,
lecture `mem_info_vram_*`).

Sans GPU NVIDIA : `has_cuda=false`, `cuda_device_count=0`, `cuda_vram_total_mb=0` (cohérence testée,
`topology.rs:158-169`). macOS : mémoire 0 (`topology.rs:100-103`), CUDA absent (`cuda.rs` module `driver` non-Windows/
Linux), AVX2 `false` hors x86 ; documenté dans le README. Windows : `GlobalMemoryStatusEx` correct.

### 2.4 Déterminisme CPU/GPU

Tests de parité existants [V] :
- `gpu.rs:912` `gpu_matches_cpu_within_tolerance` : scène 48x48, écart max 2/255 par canal sur >= 99,5 % des pixels.
- `gpu3d.rs:935` `gpu3d_matches_cpu_reference` : showcase 320x200 en 1x et 4x MSAA + grille 320x180, écart <= 3/255 sur
  tous les canaux, >= 99 % des pixels.
- `gpu3d.rs` `renderer_batches_instances_and_reuses_gpu_meshes` : stabilité inter-frames sur le même device.
- `raster3d.rs:915` `rendering_is_deterministic_and_thread_independent` : compare deux rendus consécutifs d'un même
  binaire ; il ne compare pas la voie `parallel` (rayon) à la voie séquentielle malgré son nom.
Les trois tests GPU sautent silencieusement sans adaptateur (`gpu.rs:913-916`, `gpu3d.rs:936-941`) : un "pass" ne prouve
pas la parité. Sur cet hôte ils s'exécuteraient sur lavapipe (CPU) si le feature `gpu` est actif (voir G5).
Le skill `render-pipeline` parle de "pixel parity" ; la réalité est une tolérance, avec jusqu'à 1 % de pixels sans borne.

Flottants non déterministes entre cibles : le CPU de référence d'`aphrody-render` utilise des fonctions libm de la
plateforme (`powf` `math3d.rs:354,361` ; `sin/cos/tan` `math3d.rs:201-203,252`, `mesh3d.rs:371-375,446,553-557` ; `exp`
`geometry.rs:45` ; `acos` `geometry.rs:357`). "Byte-deterministic" ne vaut donc que par cible ; aucun hash doré
inter-OS. À l'inverse `aphrody-softraster` annonce et respecte l'arithmétique exacte seule (`lib.rs:5-8` ; `sqrt`,
`floor`, `ceil` uniquement, pas de transcendantes) : sa promesse inter-cibles est plausible [P], sans hash doré non plus.
Le tri des batches utilise des tris stables avec `total_cmp` (`scene3d.rs:764-769`) ; les `HashMap` ne servent qu'à la
recherche (`scene3d.rs:692`). [V]

### 2.5 DRM/KMS/headless

Grep réel (code, TOML, JSON, TS hors docs/upstream/os-drive/iecode) de `drm|gbm|kms|libdrm|/dev/dri|smithay|wlroots|evdev|
libinput|EGL_PLATFORM|surfaceless|wl_surface|xcb|xlib|x11rb|wayland` : une seule occurrence de code,
`koharu-pipeline/src/resources/linux.rs:78` (`read_dir("/sys/class/drm")`, lecture sysfs, importé), plus un commentaire
`crates/ai/config/src/rag.rs:164` (x11rb en commentaire). Aucun accès DRM/KMS/GBM, aucun compositeur, aucune
gestion de `/dev/dxg`. `docs/architecture/os/ARCHITECTURE.md:235` classe le compositeur Wayland Smithay/WGPU en
"Research complete" : cohérent avec l'absence de code. `APHRODY_COSMIC_COMPOSITOR=external-only`
(`config/ui/wsl.env.example:8`) est une variable de config, `cosmic` ailleurs désigne `cosmic-text`. `/dev/dri` n'existe
pas sur cet hôte ; `/dev/dxg` oui. Le headless est géré par le chemin hors écran + CPU, pas par DRM.

### 2.6 Dépendances de rendu dupliquées (Cargo.lock)

| Paquet | Versions dans Cargo.lock | Dépendants |
|---|---|---|
| wgpu | 29.0.3, 30.0.1 | 29 : `vello 0.10.0` ; 30 : `aphrody-render` |
| wgpu-core / wgpu-hal / wgpu-types / wgpu-naga-bridge | 29.0.4 et 30.0.1 | idem |
| naga | 29.0.4, 30.0.1 (+ `vello_shaders` en 29) | idem |
| pollster | 0.4.0 (`aphrody-winclean`, `rfd`), 1.0.1 (`aphrody-render`, `koharu-rasterizer`) | |
| raw-window-handle | 0.6.2 seule | bien |
| ash 0.38.0, khronos-egl 6.0.0, gpu-allocator 0.28.0, bytemuck 1.25.2 | une seule | bien |
| windows | 0.51.1, 0.52.0, 0.58.0, 0.61.3, 0.62.2 | |
| winit-* 0.31.0-beta.3 (via `tauri-winit` <- `tauri-runtime-cef`) | présent | contredit "pas de winit" au sens large du doc |

`vello` est tiré par `koharu-canvas`, `koharu-rasterizer`, `koharu-renderer`. L'artefact local
`target/release/libaphrody_ffi.so` (257 004 880 o) ne contient que la pile wgpu 30 (grep -a : `wgpu-core-30.0.1` x42,
`wgpu-hal-30.0.1` x13, `naga-30.0.1` x60 ; aucun `vello`, aucun wgpu 29) : les deux piles ne sont pas co-liées
aujourd'hui. Elles le seraient avec `--features koharu`.

### 2.7 Confirmation demandée : `koharu-rasterizer` est un compositeur 2D de couches, pas un compositeur d'affichage

Confirmé [V]. `compositor.rs:1` "Ordered GPU composition for RGBA8 images and Vello vector batches" ;
`GpuCompositor` (`compositor.rs:140-153`) compose des commandes `CompositionCommand::{Raster, Vector}` avec opacité et
masque d'effacement (`erase`) dans une texture `Rgba8Unorm` hors écran (`PREMULTIPLIED_ALPHA_BLENDING`, `compositor.rs:220`),
avec un cache LRU de tuiles (256 Mio, `DEFAULT_RASTER_CACHE_BUDGET_BYTES`, `compositor.rs:19`). `native.rs` fait ensuite
copie texture -> buffer -> `RgbaImage`. Pas de surface, pas de `present`, pas de `Surface`, pas de DRM : c'est un
rendu offscreen avec relecture. (Code importé koharu.)

## 3. Constats

### G1 | HAUTE | Limites du device (2048 px) incompatibles avec les tailles acceptées : panique wgpu
Preuves :
- `gpu.rs:188` `required_limits: wgpu::Limits::downlevel_defaults()`. `wgpu-types-30.0.1/src/limits.rs:557-568` :
  `max_texture_dimension_2d: 2048`, `max_buffer_size` hérité de `defaults()` = 256 Mio (`limits.rs:421-450`).
- `wgpu-core-30.0.1/src/device/resource.rs:1011` (`create_buffer` compare à `self.limits.max_buffer_size`),
  `:1393` (`check_texture_dimension_size(.., &self.limits)`) et `:5333` (configuration de surface) : la validation
  utilise les limites DEMANDÉES, pas celles de l'adaptateur.
- Tailles acceptées en amont : `scene3d.rs:35` `MAX_EDGE = 16_384` (`prepare_with`, `scene3d.rs:591-595`),
  `render-tools/src/lib.rs:45` `MAX_EDGE = 8192`, surface = `window.inner_size()` physique (`layer.rs:127,152-153`).
- Gestionnaire d'erreur : aucun `on_uncaptured_error` ni `push_error_scope` dans le dépôt (grep) ; le défaut de
  wgpu est fatal : `wgpu-30.0.1/src/backend/wgpu_core.rs:692-695` `panic!("wgpu error: ...")` ;
  `surface.configure` passe par `handle_error_nolabel` (`wgpu_core.rs:3978-3981`).
Conséquences [V sur la logique, P sur l'exécution, aucun test au-delà de 2048 px : tests à 48x48, 320x200] :
- `NativeLayer::attach`/`resize` sur une fenêtre > 2048 px physiques (écran 4K, 2560x1440 plein écran) : panique dans
  une commande Tauri synchrone ou dans le rappel d'événement (`lib.rs:277-280`), fil principal.
- Outil MCP `render3d_*` avec Auto : une taille 2049..8192 sur hôte avec adaptateur panique dans `spawn_blocking`,
  l'erreur remonte comme `JoinError` (`render-tools/src/lib.rs:202-208`), sans repli CPU (le repli Auto de
  `pipeline3d.rs:169` ne couvre que `Err`, pas la panique) ; le Mutex du pipeline est empoisonné, état `Renderer3d`
  partiellement modifié.
- `bun_rs_render3d_png` avec le feature `gpu` : panique dans `extern "C"` sans `catch_unwind` -> abandon du processus Bun.
- Buffers : `gpu3d.rs:629` `needed.next_power_of_two()` pour le buffer d'instances (160 o/instance) dépasse 256 Mio dès
  ~0,84 M d'instances (aucun plafond d'instances) ; `mesh3d.rs:28` plafonne les sommets (4 Mi) mais pas le nombre
  d'indices.
Recommandation : demander `adapter.limits()` borné (au moins `max_texture_dimension_2d` réel), valider les tailles
contre `device.limits()` avant toute création, installer `device.on_uncaptured_error` (gestionnaire non fatal) et des
`push_error_scope` autour des créations pilotées par l'utilisateur.

### G2 | HAUTE | `bun_rs_render_png` : taille non bornée, aucun `catch_unwind` sur un symbole C exporté
Preuves : `crates/ui/bun/src/render.rs:23-60` (`bun_rs_render_png`) désérialise un `Scene` JSON puis
`aphrody_render::raster::render_scene_png`. `raster.rs:30-32` : `vec![0; (width as usize) * (height as usize) * 4]`
sans `rgba8_len` ni plafond ; `raster.rs:99` `Canvas::new(scene.width.max(1), scene.height.max(1))` ; boucle de fond
sur `width*height` (`raster.rs:101-106`). `scene.rs:368-372` : `width`/`height` sont des `u32` désérialisés tels quels.
Le garde-fou borné existe (`canvas.rs:16-26` : 1024 px, 4 Mio) mais n'est utilisé que par `aphrody-canvas` /
`render_untrusted`, pas par le FFI. `packages/interop/native/src/render.ts:21-35` n'ajoute aucune limite. Symbole
exporté : `nm -D target/release/libaphrody_ffi.so` -> `bun_rs_render_png` et `bun_rs_render3d_png` (T). Aucun
`catch_unwind` dans `render.rs` (`catch_unwind` n'existe que pour sass, `bun/src/lib.rs:359,457`), alors que
`crates/interop/ffi/src/lib.rs:33` affirme "Every entry point catches Rust panics" : faux pour ces symboles.
Version 3D : `bun_rs_render3d_png` (`render.rs:122-160`) n'a que `MAX_EDGE = 16384` ; en CPU 4x MSAA un 16384x16384 alloue
`color` 4 Gio + `depth` 4 Gio (`raster3d.rs:699-701`) + sortie 1 Gio (`raster3d.rs:733`) soit ~9 Gio, depuis un JSON.
Niveau : [V] pour l'absence de limite et de `catch_unwind` ; [P] pour le résultat exact (échec d'allocation ou
panique "capacity overflow" -> abandon du processus hôte Bun ; sinon épuisement mémoire/CPU).
Contredit la règle du skill `render-pipeline` ("Before allocating RGBA8 storage, call `rgba8_len`" : `rgba8_len` n'est
appelé ni dans `Canvas::new` ni dans le FFI).

### G3 | MOYENNE | Perte de device : seul le cache est vidé ; aucun détenteur ne se rouvre ; aucun délai d'attente
Preuves : `gpu.rs:133-137` le rappel de perte fait `SHARED_CONTEXT.try_lock()` : si un autre fil tient le verrou
(`shared_context()` en cours), l'invalidation est perdue et le contexte perdu reste en cache. Les détenteurs gardent
leur clone de device pour toujours : `Pipeline3d` `GpuState::Ready(Box<Renderer3d>)` (`pipeline3d.rs:92-96,128-132`) ne
repasse jamais à `Untried` ; `GpuState::Unavailable` est aussi définitif (`pipeline3d.rs:130`) ; `NativeLayer` garde
`context`+`renderer` (`layer.rs:92-93,160-164`) et, sur `Lost` persistant, renvoie `Err("surface texture
unavailable")` à chaque image (`layer.rs:245-263`). `gpu3d.rs:380-386` : sur erreur de `poll`/`recv`, retour sans
`unmap` du buffer de relecture, et `offscreen.readback` est réutilisé à l'image suivante. Aucun timeout de
mapping/poll (`gpu.rs:600`, `gpu3d.rs:380`) : un GPU bloqué garde le Mutex du pipeline et un fil `spawn_blocking`
indéfiniment. La doc affirme "recreated on device loss" (`docs/architecture/ui/design/M3-RENDER.md:36-37`) et "reopened
after device loss" (`crates/ui/render/README.md:19`) : vrai pour le cache global uniquement. Bon contre-exemple dans
`koharu-canvas/src/web.rs:1057-1066,1186-1196` (drapeau de perte, erreur explicite, rappel JS).
Niveau : [V] pour le code ; [P] pour le scénario TDR/réinitialisation.

### G4 | HAUTE [P] | Linux/Wayland/X11 : le calque 3D est une surface sur la fenêtre GTK de premier niveau
Preuves : `layer.rs:131` `context.instance.create_surface(window.clone())` ; handle = XID/`wl_surface` du
`GdkWindow` racine (`tao-0.37.1/.../window.rs:946-967`), c'est-à-dire la même surface que GTK/WebKitGTK peint. Sur
Windows un visual DirectComposition est placé SOUS le WebView2 (`dcomp.rs`, `layer.rs:186-199`) ; sur Linux/macOS il n'y a
rien d'équivalent (la doc écrit "window surface elsewhere", `M3-RENDER.md:54-55`). Sur Wayland, deux clients attachent des
tampons au même `wl_surface` ; sur X11, une swapchain Vulkan et GTK dessinent dans la même fenêtre. Preuve d'usage :
`docs/guides/web/TAURI-DEBUG.md:21-24` ne rapporte que l'existence de la fenêtre ("only the libEGL DRI3 warning"), pas un
pixel 3D visible ; l'app a été lancée avec une construction antérieure au plugin. Aucun test Linux de présentation.
Aggravants : `InstanceDescriptor` sans `display` (`gpu.rs:162`) alors que wgpu-types 30 documente que le GL en a besoin
pour présenter sous Wayland (`wgpu-types-30.0.1/src/instance.rs:57-61`) et que sans lui `wgpu-hal` bascule sur la
plate-forme EGL surfaceless (`gles/egl.rs:~846-858`) : sans effet tant que `gles` n'est pas compilé (cas actuel).
tao 0.37.1 (importé) ouvre une connexion `XOpenDisplay(NULL)` à chaque appel de `display_handle` sans jamais la fermer
et utilise `NonNull::new_unchecked` sans test de NULL (`tao-0.37.1/.../window.rs:934,983`) : fuite de connexions X à
chaque `create_surface`, UB si `XOpenDisplay` échoue.
macOS : `create_surface` sur la vue AppKit remplace sa couche ; non vérifié. Niveau [P] (non reproduit, pas de
pixels observés).

### G5 | MOYENNE | WSL2 : le GPU matériel est inaccessible à wgpu ; lavapipe passe pour un "GPU"
Preuves hôte [V] : `/dev/dxg` présent, `/dev/dri` absent ; ICD Vulkan installés : `asahi, gfxstream, intel_hasvk,
intel, lvp, nouveau, radeon, virtio` (`/usr/share/vulkan/icd.d`), pas de `dzn_icd.json` (Mesa Vulkan-sur-D3D12) ; aucune
ICD dans `/usr/lib/wsl/lib` (qui ne contient que `libcuda`, `libd3d12`, `libdxcore`, `libnvidia-ml`...). Le build
ne compile que Vulkan sous Linux (voir 2.1). Donc sur cet hôte `shared_context()` ne peut obtenir que `llvmpipe/lavapipe`
(`DeviceType::Cpu`), ou `NoAdapter`. Aucun code first-party ne traite `/dev/dxg` ni ne règle
`GALLIUM_DRIVER`/`MESA_D3D12_*` (seul `scripts/tools/os/scripts/wslg-manager.sh:177` exporte
`MESA_D3D12_DEFAULT_ADAPTER_NAME`, utile au GL de WebKit, pas à wgpu).
Sémantique : `is_fallback` est calculé (`gpu.rs:182`) mais perdu : `RenderedBy::Gpu { adapter, api }`
(`pipeline3d.rs:159-162`) et la sortie MCP `{"kind":"gpu","adapter":..,"api":..}` (`render-tools/src/lib.rs:215`) ne le
transportent pas ; `RenderPolicy::GpuRequired` est satisfaite par lavapipe ; `Auto` préfère lavapipe au rasteriseur CPU
déterministe. `aphrody-native` annonce en parallèle `has_cuda` via `libcuda` de WSL : deux couches en désaccord sur
"un GPU est présent". `Pipeline3d::backend()` renvoie `backend_order()[0]` (`pipeline3d.rs:119-121`) et non
l'adaptateur réel. Niveau [V] sur fichiers et code ; [P] sur le comportement d'exécution (non lancé).

### G6 | MOYENNE | Sélection d'adaptateur figée : pas d'environnement, pas de compatibilité surface
Preuves : `gpu.rs:160-170` (voir 2.1) ; `compatible_surface: None` aussi pour la surface de fenêtre (`layer.rs:126` utilise
l'adaptateur choisi sans surface) ; si la surface ne l'accepte pas, `get_capabilities` renvoie une liste vide et
`attach` échoue avec "the surface reports no formats" (`layer.rs:132-141`) sans nouvelle sélection ; sur Windows le test
`context.report.backend == "Dx12"` est une comparaison de chaîne (`layer.rs:186`). Aucun moyen documenté de forcer
Vulkan/DX12 ou un adaptateur. Niveau [V].

### G7 | MOYENNE | Plusieurs piles wgpu/naga ; "un seul contexte" impossible entre aphrody-render et koharu
Preuves : section 2.6. Les types `vello::wgpu` (29) et `aphrody_render::wgpu` (30) sont distincts : aucun partage de
device/texture. `RenderContext::new()` (koharu) crée sa propre instance et son propre device
(`native.rs:107-120`). Le doc `rust-crate-gpu-window-ownership.md` affirme "one direct wgpu dependency (30.0.1)" : exact
pour "direct", faux pour l'arbre, et cite deux crates inexistants (`aphrody-gpu-backend`, `nie-render3d`). `vulkan/dx12/...`
de `aphrody-render` sont décoratifs (`Cargo.toml:19-25,44`). L'artefact FFI par défaut embarque wgpu 30 (+ Vulkan en
dlopen paresseux) alors que `aphrody-ffi` `default = []` : le feature `gpu` d'`aphrody-render` est activé par unification
via `aphrody-app -> aphrody-render3d -> aphrody-render[gpu]` (`render-tools/Cargo.toml:19`, `ui/app/Cargo.toml:48`) ;
`aphrody-bun/gpu` reste inactif, donc `bun_rs_render3d_png` Auto = CPU, mais le sous-système `render3d_*`
(`ui/app/src/lib.rs:83`, `Render3dSubsystem::new()` = Auto) peut utiliser le GPU dans le même processus.
Niveau [V] (Cargo.lock, Cargo.toml, grep -a de l'artefact).

### G8 | MOYENNE [P] | Commandes Tauri synchrones : présentation vsync et initialisation Vulkan sur le fil principal
Preuves : toutes les commandes du plugin sont des `fn` non-async (`tauri-3d/src/lib.rs:158-248`) ; Tauri exécute les
commandes synchrones sur le fil principal sauf `#[tauri::command(async)]` (`tauri-macros-3.0.0-alpha.2/src/lib.rs:48-56`).
`Layers::with` rend et présente une image à chaque commande (`lib.rs:51-63`, `layer.rs:237-279`) avec
`PresentMode::AutoVsync` (`layer.rs:154`) ; `orbit` est appelée à chaque delta de pointeur. Le premier `attach` fait
`pollster::block_on(create_context())` sous Mutex (`gpu.rs:128-132`) : initialisation du chargeur Vulkan + énumération
d'ICD sur le fil UI. Niveau [P] (durée non mesurée).

### G9 | BASSE | Voie 2D GPU (`render_scene_gpu`) : aucune validation, recompile tout à chaque appel ; hors produit
Preuves : seuls appelants = tests et bench (`gpu.rs:912-913`, `benches/frame.rs:46-53`). `gpu.rs:212-213`
`scene.width.max(1)` sans plafond ; `gpu.rs:568` `width * 4` en u32 (débordement) ; `gpu.rs:521-547` taille d'icône
tirée de `rect.w` sans plafond ; `gpu.rs:548-563`/`791-830` `Node::Image` : `rgba.len()` jamais comparée à
`width*height*4`, `width * 4` u32 ; chaque appel recrée shader module et 2 pipelines (`gpu.rs:228,283,358`) et, par
noeud, un buffer + bind group (`gpu.rs:682,737,855`) ; `gpu.rs:609` `vec![0; w*h*4]` non vérifié. Non atteignable depuis le
FFI (`bun/src/render.rs:1-8` l'exclut explicitement). À corriger avant toute exposition. Niveau [V].

### G10 | MOYENNE | Poll/attente bloquants sur un worker tokio (code importé koharu)
Preuves : `koharu-library/src/agent_host.rs:95-99` (voir 2.1). `native.rs:390-395` `PollType::Wait { timeout: None }`.
Le crate impose pourtant une bonne validation de taille en amont (`native.rs:425-431` `check_device_limit`,
`checked_mul`), à garder. Niveau [V]. Importé : à corriger par un wrapper local plutôt que par modification du source.

### G11 | MOYENNE | Déterminisme : "pixel parity" revendiquée, tolérance mesurée ; libm non figée ; tests qui sautent
Preuves : section 2.4. Aucun test ne compare CPU parallèle/séquentiel ni ne fixe un hachage de sortie ;
`render-pipeline/SKILL.md` ("must keep pixel parity") et `render-tools/src/lib.rs:72` ("CpuOnly for bit-exact output")
promettent plus que ce qui est vérifié. Niveau [V] pour l'écart doc/tests.

### G12 | BASSE | `aphrody-native` CUDA : asymétrie de durcissement, `cuInit` dans le processus hôte, VRAM sommée
Preuves : `cuda.rs:60` (Windows System32) vs `cuda.rs:67` (Linux, nom nu, `libcuda.so` non versionné accepté en repli : un
`libcuda.so` de stubs CUDA dans `LD_LIBRARY_PATH` donne `cuInit` en erreur et donc `None`, sans trace) ; `cuda.rs:95`
`cuInit(0)` exécuté dans le processus (threads du pilote, non sûr après `fork`, latence au premier appel ; échec mis en
cache à vie `cuda.rs:23`) ; `cuda.rs:104-123` VRAM = somme de tous les devices, mise à 0 si une seule requête échoue,
aucun détail par device, ni version du pilote, ni capacité de calcul, ni mémoire libre (`known(0)` -> `null`,
`ui/app/src/models.rs:258-284`). Le README annonce "topology" ; la structure est plate. Niveau [V]. Gravité basse : le
code est défensif et correct pour ce qu'il fait.

### G13 | BASSE | Cycle de vie du calque : destruction après la fenêtre, facteur d'échelle du viewport
Preuves : `tauri-3d/src/lib.rs:281-287` (retrait à `Destroyed`, pas à `CloseRequested`) : la `VkSurfaceKHR` est détruite
après la fenêtre native ; sur Wayland, détruire la surface protocolaire avant la swapchain est une erreur de protocole
potentielle [P]. Windows : champ `composition` déclaré avant `surface` (`layer.rs:88-90`), donc libéré en premier ;
le commentaire SAFETY (`layer.rs:191-193`) s'appuie sur la référence COM propre à wgpu [P]. `lib.rs:202-211` viewport
physique figé au moment de l'appel, non recalculé à `ScaleFactorChanged` (`lib.rs:278-280`). `Orbit::apply`
(`layer.rs:66-70`) : un delta infini donne un yaw non fini, caméra invalide à chaque image jusqu'à `reset`.

### G14 | BASSE | Dérive doc/skills sur les chemins et les crates
Preuves [V] : `render-pipeline/SKILL.md` cite `crates/aphrody-render`, `crates/aphrody-tauri-3d`,
`crates/aphrody-render3d` (inexistants ; réels : `crates/ui/render`, `crates/ui/tauri-3d`, `crates/ui/render-tools`) ;
`render.ts:12,38` cite `crates/aphrody-render/src/*.rs` ; `nie-render-pipeline`, `peaufiner-rendu-3d`, `pixel-perfect`
décrivent `crates/engine/nie-render3d`, `nie-render`, `crates/tools/nie-*` : aucun n'existe (0 paquet `nie-` dans
Cargo.lock ; `scripts/build/ui/apps/nie-web/` référence `nie-wasm`) ; le doc de propriété GPU est périmé (G7).
`render-pipeline/SKILL.md` vérification : `bun test ./packages/canvas/index.test.ts` -> le chemin réel est
`packages/ui/canvas/index.test.ts`.

## 4. À garder (correct)

- `#![forbid(unsafe_code)]` dans `aphrody-render` (`lib.rs:11`) et `aphrody-softraster` ; tout l'`unsafe` du périmètre est
  isolé dans `cuda.rs`, `dcomp.rs`, `layer.rs:194` avec invariants écrits.
- Chargement différé de Vulkan/CUDA : `libaphrody_ffi.so` n'a aucun `NEEDED` GPU (readelf : libstdc++, libc, ld-linux,
  libgcc_s, libm) ; le chargement échoue proprement en `None`/`NoAdapter`.
- `Scene3d::prepare_with` : validation exhaustive (dimensions + `rgba8_len`, échantillons 1/4, caméra, non-finis, lumières,
  profondeur) avant tout rendu ; `mesh3d.rs:28` plafond de sommets ; `model.rs:113-136` (test à `:131`) refus de `..`, absolu, `:` pour les
  buffers glTF externes.
- Pools/caches bornés : TTL des maillages 120 images (`gpu3d.rs:34`), cache d'images koharu 256 Mio, 4 cibles de
  relecture (`native.rs:411`).
- `render-tools` : plafond 8192, `spawn_blocking`, sortie dans `std::env::temp_dir()/aphrody-render3d`.
- `NativeLayer::render` gère `Outdated/Lost/Timeout/Occluded/Suboptimal` de `get_current_texture` sans `unwrap`.
- Sondage de topologie côté UI en `spawn_blocking` (`ui/app/src/models.rs:267`).
- Gestion explicite de la perte de device côté navigateur (`koharu-canvas/src/web.rs`).

## 5. Recommandations priorisées

1. Poser les limites réelles : demander `adapter.limits()` (borné à un plafond produit) à `request_device`, valider toute
   dimension/taille de buffer contre `device.limits()` avant création et rendre `on_uncaptured_error` non fatal ; aligner
   `MAX_EDGE` (scene3d 16384, MCP 8192) sur ce plafond et ajouter un repli CPU sur erreur GPU (G1).
2. Fermer les symboles C exportés de rendu : borner `bun_rs_render_png`/`bun_rs_render3d_png` (réutiliser les plafonds de
   `canvas.rs` ou un budget d'octets, appeler `rgba8_len`), envelopper dans `catch_unwind`, plafonner la mémoire MSAA 3D (G2).
3. Rendre la perte de device récupérable et les attentes bornées : invalider le cache sans `try_lock` (époque atomique),
   faire que `Pipeline3d`/`NativeLayer` détectent la perte et recréent, mapper avec délai (`PollType::Wait` + timeout)
   et `unmap` sur toutes les sorties d'erreur (G3).
4. Décider et documenter la réalité Linux : soit une fenêtre enfant/sous-surface dédiée pour le calque 3D, soit
   hors écran + texture partagée avec le webview ; tester réellement X11 et Wayland (pixels observés) avant d'annoncer le
   plugin ; fermer le calque sur `CloseRequested` (G4, G13).
5. Exposer la vérité adaptateur : `RenderedBy::Gpu { is_software }`, `GpuRequired` refusant `DeviceType::Cpu`, activer
   `InstanceDescriptor::with_env()` pour `WGPU_BACKEND`/`WGPU_ADAPTER_NAME`, `compatible_surface` pour les fenêtres,
   décider du chemin WSL2 (installer dzn ou activer `gles` sur l'instance, sinon documenter que WSL2 = CPU) (G5, G6).
Autres : réconcilier la doc de propriété GPU et les skills avec les chemins réels (G14), tracer le calendrier de
convergence wgpu 29/30 avant de lier koharu et aphrody-render (G7), exécuter les commandes du plugin en
`#[tauri::command(async)]` (G8).

## 6. NON EXAMINÉ

- Aucune exécution : pas de `cargo`, pas de test, pas d'exécution de `cuInit`, de Vulkan ni de l'application Tauri ; les
  durées, les paniques et le comportement sur lavapipe sont déduits du code (P).
- `vulkaninfo`, `nvidia-smi`, `eglinfo` non lancés ; adaptateurs réellement énumérés sur cet hôte inconnus.
- `rust-best-practices-2026` (skill) non lu ; agents lus par en-tête seulement.
- `gpu.wgsl` et `gpu3d.wgsl` : seul `fs_main` du 3D lu ; pas de revue des shaders (précision, `pow`, mapping de ton).
- `raster3d.rs`, `geometry.rs`, `text.rs` : lus pour allocations et appels libm uniquement, pas de revue algorithmique.
- `crates/ui/model-view` hors `main.rs` ; `crates/ui/app` hors `models.rs`/`lib.rs:83` ; `packages/ui/material-web/native3d`
  et le côté page de `md-native-3d` ; `scripts/tools/os/scripts/wslg-manager.sh` hors grep.
- Windows (DirectComposition, DX12, WARP) et macOS (Metal, AppKit) : code lu, rien vérifié à l'exécution.
- `koharu-*` : seulement `koharu-rasterizer`, `koharu-canvas`, `koharu-pipeline/resources/linux.rs`, `agent_host.rs` ;
  le reste de koharu, `koharu-torch`/`koharu-llama` (CUDA via LibTorch/llama.cpp) non examinés.
- Parseurs `model.rs` (glTF/OBJ : tailles de fichiers, bombes de décompression, liens symboliques) : seulement la
  traversée de chemin ; `std::fs::read` sans plafond d'octets (`model.rs:74-75,134`) noté, non creusé.
- Audit de l'ABI (en-tête `aphrody.h`, chargeur `packages/interop/native`) hors `render.ts` : autres axes.
- `upstream/`, `crates/iecode`, `crates/os/drive` (dont `ggml-webgpu.cpp`) non examinés.
