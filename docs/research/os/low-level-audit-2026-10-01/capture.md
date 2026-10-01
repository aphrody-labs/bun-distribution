# Audit bas niveau — axe CAPTURE (écran, fenêtres, entrées, presse-papiers, accessibilité)

Date : 2026-10-01 — dépôt /home/aphro/aphrody (main) — niveau de preuve global P1 (lecture statique).
Lecture seule : aucun fichier du dépôt modifié, aucun cargo/rustc/bun lancé. Outils : rg/grep/sed, python3 (analyse de
Cargo.lock et tools.json), lecture de ~/.cargo/registry/src (arboard 3.6.1, global-hotkey 0.8.0, wl-clipboard-rs 0.9.4,
tauri-plugin-clipboard-manager 3.0.0-alpha.2, windows 0.62.2, vigem-rust 0.2.0, uiautomation 0.25.1), readelf/nm sur
target/release/libaphrody_ffi.so.
Grille : agents security-engineer / win32-expert / cross-platform-validator, skill winclean (SKILL.md, 37 l.).
Légende : [V] vérifié dans le code lu ; [P] plausible / dépend d'un comportement OS non reproduit ici (pas de Windows).

## 0. Périmètre réellement lu

| Fichier | Lignes lues |
|---|---|
| crates/os/capture/{Cargo.toml, src/lib.rs, src/error.rs, src/capture_impl.rs} | tout (39 + 429 + 26 + 877) |
| crates/os/winclean/src/{lib.rs, dispatch.rs 1-740 + grep du reste, clipboard.rs, win32.rs, record.rs, ocr.rs, snapshot.rs} | tout sauf dispatch 740-1409 |
| crates/os/winclean/src/{memory.rs 1-300, system.rs 478-548, gamepad.rs 1-60}, tools.json (schémas des outils computer_*/window_*/screenshot), tool-migration.json (en-tête), tests/rust_surface.rs, examples/observe.rs | cités |
| crates/os/guard/{Cargo.toml, src/lib.rs, src/harden.rs, src/command_safety.rs 30-345} | tout sauf tests |
| crates/ai/agent-tools/src/computer_use.rs | tout (1062) |
| crates/ai/agent-tools/src/winclean.rs | tout (417) |
| crates/ai/agent-runtime/src/tools.rs 295-440, 570-615 ; crates/ai/engine/src/{config.rs 1-60, turn.rs 685-730, 824-849} ; crates/ai/toolcall/src/lib.rs 626-661 | cités |
| crates/ai/vision/{Cargo.toml, src/capture.rs} | tout |
| crates/ai/mcp/{Cargo.toml, src/main.rs 1335-1395, src/protocol.rs 1-200, src/winclean_tools.rs 1-70} | cités |
| crates/ui/app/src/quickbar.rs (143 l.), crates/ui/app/src/lib.rs 30-110 + 225-250 + 400-520, window.rs (clipboard), capabilities/main.json, build.rs, windows-app-manifest.xml | cités |
| crates/os/kernel/src/{admin.rs, rpc.rs 95-175, transport.rs 14-90 + 236-300, lib.rs 160-260 + 400-440, policy.rs, main.rs 80-140 + 220-236, build.rs} | cités |
| apps/cli/src/winclean_cmd.rs (1-260) ; grep screen/clipboard/hotkey dans apps/cli/src | — |
| packages/os/winclean/{package.json, src/index.ts, src/result.ts, examples/observe.ts, test/winclean.test.ts (grep)} | cités |
| Cargo.lock (analyse python des dépendances/dépendants), Cargo.toml (workspace deps) | — |
| docs/architecture/os/ARCHITECTURE.md 25-34 + 228-240, docs/reference/ai/config.md 170-185, config/ui/wsl.env.example | cités |

## 1. Inventaire : qui capture / synthétise quoi, avec quelle bibliothèque

Recherche exhaustive dans Cargo.lock : **absents** xcap, scrap, screenshots, display-info, enigo, rdev, ashpd, pipewire,
libei/reis, evdev/input-linux/uinput, atspi, accesskit, x11-clipboard, smithay-clipboard, xdotool/grim/slurp (aucun appel de
sous-processus de capture/saisie dans crates/ apps/). Aucune de ces bibliothèques n'est donc auditable : elles ne sont pas là.

| Fonction | Windows | Linux X11 | Linux Wayland / WSLg | Lib tierce (version) |
|---|---|---|---|---|
| Capture écran principal | `aphrody-capture` : GDI BitBlt SRCCOPY sur `GetDC(NULL)` (capture_impl.rs:249-262) | **aucune** (stub `Unsupported`, crates/os/capture/src/lib.rs:204-206) | **aucune** | `windows` 0.62.2 (Cargo.lock : 5 versions de `windows` coexistent, 0.51.1/0.52.0/0.58.0/0.61.3/0.62.2 ; aphrody-capture et winclean utilisent 0.62.2) |
| Capture écran virtuel | idem avec SM_*VIRTUALSCREEN (264-280) ; non exposé par winclean (seul `capture_primary_screen` est appelé) | aucune | aucune | idem |
| Capture fenêtre | `capture_window_by_title` = rectangle ÉCRAN de la fenêtre (282-311), pas PrintWindow | aucune | aucune | idem (`Win32_Storage_Xps`, qui porte PrintWindow, est activé dans Cargo.toml:35 mais jamais utilisé) |
| Capture fenêtre Tauri | `tauri_screenshot` → même BitBlt (ui/app/src/lib.rs:419-428) | `Unavailable` explicite (ui/app/src/lib.rs:431) | idem | — |
| Enregistrement vidéo | `computer_record_clip` (record.rs) : N captures + AVI maison | `Err("Windows-only")` | idem | `image` (png) |
| OCR | `Windows.Media.Ocr` via WinRT (ocr.rs:140-230) | `Err("Windows-only")` (ocr.rs:23) | idem | `windows` 0.62.2 (WinRT) ; `pollster` 0.4 |
| Souris/clavier synthétiques | `mouse_event`, `keybd_event`, `SendInput`, `SetCursorPos` (capture_impl.rs:617-877) | **aucune** (pas de XTest/x11rb d'automation) | **aucune** (pas de libei/RemoteDesktop portal/uinput) | `windows` 0.62.2 ; `uiautomation` 0.25.1 (feature `input` activée dans winclean/Cargo.toml mais l'injection passe par aphrody-capture : feature superflue) |
| Manette virtuelle | `gamepad_*` via ViGEmBus (gamepad.rs) | non | non | `vigem-rust` 0.2.0 (README:22-24 : « last official Nefarius releases are 1.21.442 and 1.22.0 » → pilote amont figé) |
| Accessibilité | UIA (snapshot.rs:359-389) | **aucune** (pas d'AT-SPI) | aucune | `uiautomation` 0.25.1 (Apache-2.0, edition 2024) |
| Presse-papiers | Win32 natif (clipboard.rs) ; plus plugin Tauri | `clipboard_read/write` du sous-système fenêtre (window.rs:154-162, 285-293) → arboard | idem | `arboard` 3.6.1 (x11rb 0.13.2 ; `wl-clipboard-rs` 0.9.4 car `wayland-data-control` est activé par tauri-plugin-clipboard-manager 3.0.0-alpha.2, Cargo.toml:89-91) ; `clipboard-win` 5.4.1 |
| Raccourci global | Alt+Space (quickbar.rs:17) | idem via X11 | idem : **X11 seulement** | `global-hotkey` 0.8.0 (README : « Linux (X11 Only) ») via tauri-plugin-global-shortcut 3.0.0-alpha.2 |
| Entrée virtuelle navigateur | CDP `Input.*` (obscura-cdp) — interne au moteur, pas OS | idem | idem | — |
| libaphrody (`libaphrody_ffi.so`) | n'exporte AUCUNE fonction de capture/saisie (nm -D : seulement `aphrody_run_captured`/`shenron_run_captured` = capture de stdio) ; NEEDED = libstdc++, libc, ld-linux, libgcc_s, libm (aucun X11/Wayland) | — | — | — |

État de maintenance (ce que je peux établir hors ligne) : les plugins Tauri sont épinglés `=3.0.0-alpha.2` (pré-release ;
tauri-plugin-dialog est même remplacé par un fork `upstream/`) ; global-hotkey 0.8.0 (org Tauri, changelog actif, MSRV 1.77) ;
arboard 3.6.1 (1Password) ; wl-clipboard-rs 0.9.4 (changelog daté 28 sept 2026 : très récent) ; uiautomation 0.25.1 et
vigem-rust 0.2.0 sont des crates tierces à un seul mainteneur, vigem-rust dépend d'un pilote noyau ViGEmBus dont l'amont
annonce des « last official releases » [P : dates de publication non vérifiables hors ligne].

## 2. Wayland / WSLg : ce que le code fait réellement

**Capture** : ni xdg-desktop-portal/PipeWire, ni X11. Il n'existe aucun code de capture Linux. `aphrody-capture` compile en
stubs (`Err(Unsupported)`) hors Windows (crates/os/capture/src/lib.rs:200-340). Résultat sous Wayland pur, XWayland ou WSLg : **pas
d'image noire, un échec explicite** (`screen capture is not supported on this platform`) pour `screen_capture` (MCP,
main.rs:1364-1381), `computer_use` backend Linux (`UnsupportedComputerBackend`, computer_use.rs:843-846, 645-683),
`tauri_screenshot` (ui/app/src/lib.rs:431), `aphrody winclean screenshot` (winclean_cmd.rs:248-251). C'est correct et à garder.

**Entrées** : ni XTest, ni uinput, ni libei, ni RemoteDesktop portal. Idem : explicite (`Unsupported`), sauf les stubs
« muets » de la section CAP-09.

**Coordonnées absolues / énumération / focus** : tout le modèle d'automatisation suppose Windows : coordonnées écran absolues
(`SetCursorPos`), énumération globale (`EnumWindows`), focus (`SetForegroundWindow`), HWND comme identité. Wayland n'a
aucun équivalent portable (pas de coordonnées globales ni d'énumération des fenêtres d'autres clients, vol de focus refusé) ;
aucune abstraction n'est préparée. Sous WSLg (Weston/RDP + XWayland), les fenêtres Linux sont des fenêtres RAIL du bureau
Windows : une capture/injection côté Windows pourrait les voir, mais rien ne relaie depuis WSL vers le noyau Windows [P].

**Documentation en dérive** : l'en-tête de computer_use.rs:15 annonce « `Linux`: X11 desktop automation via XTest /
GetImage » ; crates/ai/config/src/rag.rs:164 et docs/reference/ai/config.md:183 annoncent « linux (x11rb) » ; ARCHITECTURE.md:31 « Linux:
Wayland/X11 » et :238 « Screen capture & UIA observation | Fully operational ». `x11rb` n'est qu'une dépendance transitive
(arboard, global-hotkey, winit) ; le code dit l'inverse (« no X11 desktop backend is compiled into this build »).

**Tauri sous WSLg** : GDK_BACKEND=x11 est exigé (config/tauri-apps.json:43). `config/ui/wsl.env.example:4`
`APHRODY_NATIVE_SURFACES=terminal,canvas,capture` déclare une surface « capture » que personne ne lit (grep : 0 consommateur)
et qu'aucun code Linux n'implémente.

## 3. Constats

### CAP-01 — HAUTE — Les résultats de capture/observation winclean n'atteignent aucun consommateur (image et texte vides)
- crates/os/winclean/src/lib.rs:101-114 : `call_raw` fabrique `ToolResult { content: Vec::new(), structured_content: Some(value) }`.
- dispatch.rs:153-158 et 184 : `computer_capture_screen` / `computer_observe` renvoient `{"mimeType","dataBase64"}` dans cette valeur structurée, jamais un `Content::Image`.
- lib.rs:169-178 et 199-209 : `text()` et `images()` ne lisent QUE `content`.
- Consommateurs qui lisent `content` : agent-tools/src/winclean.rs:277-280 (`render_result`), computer_use.rs:305-322 (Screenshot : `images` vide → `ToolOutput::ok("")`), apps/cli/src/winclean_cmd.rs:248-252 (`save_first_image` → « no image returned »), packages/os/winclean/src/index.ts:41-45 (encapsule la valeur en bloc texte JSON ; `images` filtre `type === "image"` et ne trouve jamais rien), examples/observe.rs et observe.ts (`if let Some(png)` / `if (png)` : le vide est silencieux).
- Côté noyau/MCP : rpc.rs:114-121 stringifie la valeur en `content[0].text` (la capture devient un énorme JSON texte, pas un bloc image) ; mcp/src/winclean_tools.rs:55 renvoie `CallToolResult` avec `content` vide + `structuredContent`.
- Le test qui « prouve » le contraire fabrique la forme attendue à la main : agent-tools/src/winclean.rs:325-345 (`ToolResult { content: [Text, Image] }`), forme que `call_raw` ne produit jamais. tests/rust_surface.rs ne teste que les noms de l'outil et le hash du catalogue ; `tool-migration.json:6` « state: complete » repose sur cette couverture de noms, pas sur un comportement.
- Conséquence : sur Windows, le modèle ne voit aucune capture et reçoit une chaîne vide pour list_windows/observe/clic. [V code ; effet runtime P — non exécuté, Windows requis].

### CAP-02 — HAUTE — Le backend Windows de `computer_use` envoie des arguments que le dispatch rejette ou ignore
Comparaison computer_use.rs ↔ dispatch.rs/snapshot.rs/tools.json :
- Scroll → `computer_scroll {deltaX,deltaY}` (computer_use.rs:383-386) ; dispatch.rs:445-451 exige `x`,`y` (+ axis/direction/wheelTimes) → erreur.
- Drag → `{startX,startY,endX,endY}` (361-366) ; dispatch.rs:570-584 exige `fromX/fromY/toX/toY` → erreur.
- Type → `{text}` (393) ; dispatch.rs:617-624 exige `x`,`y` → erreur.
- Keypress → `{key}` (400) ; dispatch.rs:598 exige `shortcut` → erreur.
- FocusWindow → `switch_to_window {title}` / `{windowHandle}` (428-436) ; dispatch.rs:728 exige `titleSubstring` → erreur dans les deux cas.
- Click par `element_id` → `{elementId}` (325) ; snapshot.rs:211-218 exige automationId/name/className/controlType → erreur ; aucun mapping `@e1` → élément UIA n'existe.
- DoubleClick → `"doubleClick": true` (347) ; dispatch.rs:413 lit `clicks` → simple clic silencieux.
- Aucune des 12 branches ne teste `res.is_error` (computer_use.rs:323-445) : une erreur winclean devient `ToolOutput::ok(<texte d'erreur>)`, marquée succès (le texte d'erreur reste lisible, mais `ToolCallEnd.ok=true`).
- Hors du bug CAP-01, seuls click(x,y), move et wait fonctionnent. [V].

### CAP-03 — HAUTE — Fuite d'un HBITMAP GDI à chaque capture (ordre de libération)
- capture_impl.rs:158 `mem_dc`, 163 `bm`, 170 `SelectObject(mem_dc, bm)` sans jamais resélectionner l'ancien objet. Rust libère `bm` AVANT `mem_dc` (ordre inverse de déclaration) : `CompatBitmap::drop` (129-137) appelle `DeleteObject` alors que le bitmap est encore sélectionné dans `mem_dc` ; le résultat est ignoré (`let _ =`, 134). Documentation MSDN de DeleteObject : retour 0 si le handle est « currently selected into a DC ». `MemDc::drop` détruit ensuite le DC : le bitmap n'a plus de propriétaire. [V ordre/ignorance du retour ; P effet : un HBITMAP de w×h×4 octets (~8 Mo en 1080p) perdu par capture, quota GDI 10 000 objets par processus]. Les hôtes visés sont de longue durée (kernel, MCP, app Tauri) et la boucle observe→agir de computer-use capture à chaque pas.
- Le commentaire de module (capture_impl.rs:5-6) et la description du crate (Cargo.toml:10) promettent « RAII GDI handle guards ... released even on early-return », ce que l'ordre contredit.
- Mineur dans la même fonction : `GetDIBits(mem_dc.hdc, bm.hbm, …)` (212-221) alors que `bm` est sélectionné — l'exemple Microsoft passe le DC écran et la doc exige que le bitmap ne soit pas sélectionné [P].

### CAP-04 — HAUTE — « Capture de fenêtre » : mauvais pixels, mauvaise fenêtre, repli silencieux sur tout l'écran
- capture_impl.rs:282-311 : la fenêtre est identifiée par sous-chaîne de titre (`find_window_by_title_substr`, 416-420 : première en Z-order, sensible à la casse malgré « case-insensitive » annoncé dans mcp/src/main.rs:168), puis la capture est un BitBlt du **rectangle écran** (`GetWindowRect`). Toute fenêtre qui la recouvre est capturée avec ; une fenêtre réduite (rect à −32000) donne du noir/du hors-écran ; pas de CAPTUREBLT (fenêtres layered/transparentes absentes) ; jeux D3D en plein écran/contenus protégés : noir sans détection [P]. `PrintWindow`/Windows.Graphics.Capture/DXGI : 0 occurrence dans le dépôt (grep).
- Le contrat annoncé est faux : tools.json (`window_capture`) promet « PrintWindow + GetDIBits. Works even when the window is MINIMISED, OFF-SCREEN or COVERED » et un paramètre `fullContent` que dispatch.rs:187-204 ignore.
- dispatch.rs:176-179 (`computer_observe`) : si la capture de la fenêtre échoue (`or_else`) ou si le HWND demandé est introuvable, le code capture **tout l'écran principal** sans le signaler : divulgation hors périmètre demandé. Même schéma par titre dans ocr.rs:44, record.rs:60, dispatch.rs:197 (HWND → titre → première correspondance : peut viser une autre fenêtre).
- Une capture de fenêtre peut donc contenir un gestionnaire de mots de passe qui la chevauche. [V code ; P effets graphiques].

### CAP-05 — HAUTE — `ComputerPolicy` (allow/deny) n'est appliquée presque nulle part ; l'interrupteur `enabled=false` ne coupe pas winclean
- computer_use.rs:423-438 : `verify_target` n'est appelé que pour `FocusWindow` avec `window_title`. La branche `window_id` (433-438) n'est pas contrôlée ; click, type, keypress, drag, scroll, screenshot, observe n'appellent jamais la politique (même constat dans le backend Mock, 712-716, et Browser, 623-626).
- La politique teste la chaîne fournie par le modèle, pas la fenêtre résolue : `denied_apps=["regedit"]` n'arrête pas `window_title:"Registry"` (la sous-chaîne atteint « Registry Editor »).
- agent-runtime/src/tools.rs:376-383 : sous Windows, `winclean_tools()` enregistre en parallèle `computer_click`, `computer_type`, `computer_key`, `computer_drag`, `computer_scroll`, `computer_capture_screen`, `computer_ocr`, `list_windows` (tous « Direct », agent-tools/winclean.rs:31-42) et la passerelle `winclean` (166 outils), sans aucune `ComputerPolicy`. `desktop_computer_tool` (400-427) ne gouverne que `computer_use` : `enabled=false` ne désenregistre pas ces outils (le test tools.rs:585-591 ne le vérifie pas).
- Liste interdite codée en dur (computer_use.rs:106-115) : anglais uniquement (« user account control », « windows security », « credential manager »...), alors que l'hôte est francophone (« Contrôle de compte d'utilisateur », « Sécurité Windows ») ; sous-chaînes courtes (« uac », « sudo ») = faux positifs (« pseudo »).
- docs/reference/ai/config.md:174-180 et crates/ai/config/src/rag.rs:154-163 promettent « A non-empty list denies every app not in it » / « always enforced ». Contrat non tenu. [V].

### CAP-06 — HAUTE — Aucun consentement/garde effectif pour capture et injection d'entrées ; `Escalate` est du code mort
- engine/src/config.rs:10-14 : autonomie par défaut `FullAuto` (aucune approbation). `Gated` demande l'accord appel par appel mais pas par catégorie.
- toolcall/src/lib.rs:658-660 : `safety()` vaut `Safe` par défaut ; `ComputerTool` ne le surcharge pas (computer_use.rs:895-907).
- engine/src/turn.rs:701 : le seul usage de `safety()` compare à `Refuse`. `Escalate` n'est consommé nulle part (grep `.safety(` : 1 site). Donc agent-tools/winclean.rs:94-100 (`MUTATING_TOOLS → Escalate`) et shell.rs:463 (`Prompt → Escalate`) n'ont aucun effet.
- Même si `Escalate` était honoré : `guardrails_enabled()` est opt-in (guard/src/lib.rs:29-45, `APHRODY_GUARD=1`) et `MUTATING_TOOLS` (winclean.rs:45-89) omet toutes les primitives d'entrée et de lecture sensibles : computer_click/type/key/drag/scroll, click/type/shortcut, keyboard_*, mouse_*, set/get_clipboard_text, computer_capture_screen, screenshot, computer_record_clip, window_post_message, window_send_message, window_set_text, launch_app, mem_enable_debug_privilege, mem_read_*, mem_dump_region, gamepad_*. Taper une commande dans un terminal puis Entrée équivaut à un shell et contourne `classify_command` (guard/command_safety.rs).
- Le noyau embarqué de l'app (`Kernel::new()`, ui/app/src/lib.rs:68) n'a ni authentification, ni politique d'exécution, ni audit : ces options n'existent que via les drapeaux de `aphrody-kernel` (kernel/src/main.rs:93-97, 231-232). Journalisation : aucune par défaut.
- Données sensibles : `screen_capture`/`computer_capture_screen` partent vers le fournisseur de modèle (turn.rs:835-846 : retenues seulement si le modèle n'a pas de vision) ; `clipboard_read` / `get_clipboard_text` (window.rs:285-287) lisent le presse-papiers (secrets de gestionnaires de mots de passe) sans filtre.
- Posture assumée (« no human in the loop », guard/src/lib.rs:4-6) ; le constat porte sur l'écart entre cette posture et les contrôles affichés (docs, `ToolSafety`), et sur le fait que le toolchain mémoire distante (`mem_write_bytes`, `mem_allocate rwx`, `window_post_message` WM_TIMER avec lParam=pointeur) est classé `Safe` quand le garde est éteint. Impact [P] : toute injection de prompt dans une page lue par l'agent peut piloter le bureau.
- BASSE [P] : les commandes Tauri `aphrody_capture_primary` (ui/app/src/lib.rs:503-505) ne sont restreintes par aucun `AppManifest::commands` (build.rs) ; « after an explicit user action » n'est pas imposé.

### CAP-07 — HAUTE — Fonction inutilisable sous Linux/Wayland/WSLg : aucun backend, documentation trompeuse
Voir section 2. Absent (« ce qui manque ») : portail Screenshot/ScreenCast (ashpd + PipeWire) avec dialogue de consentement, RemoteDesktop portal / libei pour la saisie, XGetImage/XTest via x11rb pour X11 pur, énumération de fenêtres (aucune API portable : wlr-foreign-toplevel, GNOME/KWin spécifiques), AT-SPI. Le comportement actuel (échec explicite) est correct ; ce qui est faux, ce sont les promesses : computer_use.rs:15 et 36, crates/ai/config/src/rag.rs:164, docs/reference/ai/config.md:183, ARCHITECTURE.md:238. Le modèle reçoit en outre une description d'outil qui annonce « Linux desktop » (computer_use.rs:975-977) et `ComputerEnvironment::auto_detect()` sélectionne `Linux` par défaut (computer_use.rs:45-58) → l'outil est enregistré par défaut et rejette 100 % des actions. Le message d'erreur dit « no X11 desktop backend » (845) sans mentionner Wayland/WSLg ni la piste Windows-hôte.

### CAP-08 — MOYENNE — Raccourci global et presse-papiers sous Wayland : échec muet ou tardif
- quickbar.rs:24-33 enregistre Alt+Space et ne journalise que sur `Err`. global-hotkey 0.8.0 (Linux = X11 seulement, README) : `GlobalHotKeyManager::new()` renvoie toujours `Ok` (x11/mod.rs:31-40) ; l'échec de connexion X est dans le thread (`events_processor`, 227-231) et n'est journalisé qu'avec la feature `tracing` (absente du Cargo.lock) ; `register()` ignore `rx.recv()` en échec (42-51 : `if let Ok(result) = rx.recv() { result?; } Ok(())`). Sous Wayland pur, la barre rapide ne s'ouvrira jamais, sans la moindre trace. Même avec XWayland, XGrabKey ne voit que le focus X11 [P]. `set_focus`/`set_position` de la barre sont ignorés par les compositeurs Wayland [P].
- arboard 3.6.1 (linux/mod.rs:128-147) : si `WAYLAND_DISPLAY` est défini, tente `wl-clipboard-rs` (protocoles ext/wlr-data-control, absents de GNOME/Mutter et vraisemblablement de Weston/WSLg) puis retombe sur X11/XWayland ; README arboard:29-36 recommande XWayland. Le plugin stocke le `Result` du constructeur (clipboard-manager desktop.rs:17) : l'erreur n'apparaît qu'à la première lecture/écriture. [P : comportement de WSLg non reproduit].

### CAP-09 — MOYENNE — Stubs non-Windows « réussis » et catalogue Windows annoncé partout
- crates/os/capture/src/lib.rs:224-231, 258-260, 270-272 : `list_windows`/`list_detailed_windows`/`enum_children` renvoient `Vec::new()`, `send_message` renvoie `0` (stubs non-Windows). dispatch.rs:274-279 → `{"Count":0,"Windows":[]}` ; dispatch.rs:338-344 → `{"success":true,"result":0}` ; dispatch.rs:300-313 → `{"hwnd":0}` : trois succès muets sous Linux/WSL ; crates/ai/vision/capture.rs:72-74 `window_titles()` vide idem.
- `AdminSubsystem::tools()` (kernel/src/admin.rs:27-37) annonce les 166 outils sur toutes plateformes (le noyau et l'app l'enregistrent sans cfg(windows) : kernel/main.rs:100, ui/app/src/lib.rs:52) ; `screen_capture` est annoncé par aphrody-mcp sans cfg (main.rs:1358-1385) et marqué lecture seule. Le modèle découvre l'indisponibilité en essayant.
- dispatch.rs:287 fabrique des champs : `"visible":true,"minimised":false,"maximised":false,"className":""` pour toute fenêtre (données inventées). lib.rs:78-81 `shared()` renvoie toujours `Ok` (« unavailable » du doctor ne peut pas se produire) ; `catalog()` (62-73) renvoie un catalogue VIDE sans erreur si tools.json ne se parse pas (`unwrap_or_default`).

### CAP-10 — MOYENNE — `computer_record_clip` : mémoire non bornée, durée bloquante, AVI > 4 Gio corrompu
- record.rs:29-32 borne seulement durée (≤30 s) et fps (≤30) ; la boucle 58-72 conserve TOUTES les images décodées (`frames`) puis crée une seconde copie (`bgr24_frames`, 84) : ≈ 900 images × 6,2 Mo (1080p RGB) × 2 ≈ 11 Go ; ≈ 20 Go en 1440p. Le nombre d'images ne s'adapte pas à la vitesse réelle de capture (aller-retour PNG encode+décode par image, 59-64) : la requête 30 s/30 fps dure plusieurs minutes sur le thread appelant.
- 159 : `4u32 + header.len() as u32 + body.len() as u32` tronque/déborde au-delà de 4 Gio (RIFF classique) ; 132/151 idem pour les offsets de l'index.
- Les dimensions changeant en cours de clip (rotation, DPI) font échouer tout l'enregistrement après coup (81-83), images perdues.

### CAP-11 — MOYENNE — Écritures de fichier arbitraires par outils « lecture seule » ; captures laissées dans %TEMP% sans rétention
- dispatch.rs:24-36 (`screenshot`, `window_capture`) : `outputPath` du modèle → `image.save_with_format` (écrase n'importe quel chemin, en BMP) sans restriction ; ocr.rs:105-119 (`outputPath`, `audioPath`), record.rs:33-43 (`create_dir_all` du parent arbitraire), mcp/src/main.rs:1376-1385 (`save_path` → `std::fs::write`). Aucune validation de répertoire ni refus d'écrasement.
- mcp/src/protocol.rs:104 et 131 mettent `screenshot` et `screen_capture` dans `READ_ONLY` (correspondance par sous-chaîne, :181-191) → `readOnlyHint=true`, et USAGE_GUIDE:49-50 dit que ces outils « can run without confirmation ». Or ils écrivent un fichier choisi par le modèle. `screenshot` n'est pas non plus dans `MUTATING_TOOLS`.
- agent-tools/winclean.rs:277-300 écrit chaque image dans `%TEMP%\aphrody-winclean\{outil}-{millis}-{index}.{ext}` (nom prédictible, aucune purge, aucune ACL explicite) ; dispatch.rs:29 `aphrody-{stem}-{pid}.bmp`, record.rs:39 `winclean-clip-{pid}.avi` : prédictibles et cumulatifs. %TEMP% est propre à l'utilisateur sous Windows donc le risque d'usurpation est faible ; l'accumulation d'images d'écran (mots de passe affichés, données privées) sans nettoyage est le vrai défaut. Contre-exemple correct : ai/vision/capture.rs (tempfile, supprimé au drop).

### CAP-12 — MOYENNE — Appels bloquants sur les workers Tokio, sans délai ; messages Win32 sans timeout
- winclean/lib.rs:116-127 : `call_async`/`call_raw_async` appellent `call_raw` de façon synchrone ; la doc générée (generated.rs:6119 « runs on the library thread pool ») est fausse. kernel/admin.rs:40-56 appelle `call_rust` (58-60) dans un `async fn` sans `spawn_blocking`. Or dispatch dort : `steam_wait_for_launch` jusqu'à 600 s (dispatch.rs:228-249), `computer_record_clip` jusqu'à plusieurs minutes, `scrape_url` utilise `reqwest::blocking` (dispatch.rs:48-52 ; panique probable sous runtime Tokio [P]), `OpenClipboard` retente ~1 s (clipboard.rs:44-70). Avec 16 requêtes concurrentes admises (kernel/transport.rs:23) le runtime (celui de l'app Tauri) peut être saturé, et le délai de 300 s (:24) ne peut pas annuler un appel bloquant.
- capture_impl.rs:571-581 : `send_message` = `SendMessageW` synchrone, sans `SendMessageTimeoutW`/`SMTO_ABORTIFHUNG` : une fenêtre qui ne répond plus gèle le thread appelant indéfiniment. `computer_use` `Wait` accepte un `duration_ms: u64` non borné (computer_use.rs:406-408).
- snapshot.rs:373-387 : le parcours UIA est borné en nombre d'éléments (1 à 1000) mais sans délai global.

### CAP-13 — MOYENNE — Injection d'entrées Windows : échecs indétectables, état résiduel, DPI et multi-écrans
- capture_impl.rs:617-642, 644-660, 752-767 utilisent `mouse_event`/`keybd_event` (retour `()` dans windows 0.62.2 : bindings Gdi/KeyboardAndMouse, lignes 263-271) et rendent `Ok(())` sans condition. Sous UIPI (fenêtre élevée) ou bureau sécurisé (UAC), l'entrée est perdue sans erreur ; `SendInput` lui-même ne signale pas le blocage UIPI (MSDN) : il faut comparer le niveau d'intégrité de la cible. Aucune vérification que la fenêtre cible est au premier plan avant `type_unicode`.
- capture_impl.rs:863-876 `mouse_drag` : `mouse_move(...)?` après `mouse_event(down)` : une erreur laisse le bouton enfoncé.
- capture_impl.rs:510-524 : `switch_to_window` fait `SW_RESTORE` inconditionnel : une fenêtre maximisée est ramenée à sa taille normale ; `activate` vaut true par défaut dans computer_click/key/type/drag (dispatch.rs:397, 562, 595, 614) → chaque action peut décaler les coordonnées relevées à l'observation précédente [P].
- dispatch.rs:474-498 (`type`) : valide `clear` APRÈS avoir déplacé et cliqué (486-492) ; `pressEnter` envoie U+000A en Unicode (495) au lieu de VK_RETURN (computer_type le fait bien, 633).
- Aucune sensibilité DPI : pas de manifeste dpiAware ni `SetProcessDpiAwareness*` dans capture/winclean/kernel/mcp/cli (grep) ; seul l'app Tauri passe par tao (build.rs:29 le dit). Les binaires `aphrody-kernel`, `aphrody-mcp`, `aphrody` (hôtes effectifs de winclean) tournent donc non conscients du DPI : SM_CXSCREEN/BitBlt virtualisés, captures floues, OCR dégradé à 125-150 % [P].
- Multi-écrans : `computer_capture_screen` ne capture que l'écran principal (SM_CXSCREEN) tandis que les clics sont en coordonnées virtuelles ; `capture_virtual_screen` n'est jamais appelé par winclean ; aucune énumération de moniteurs (`EnumDisplayMonitors` : 0 occurrence).
- Tampon : capture_impl.rs:236-245 duplique le tampon (`rgba.to_vec()`) → ≥ 2× la taille de l'image brute (99 Mo × 2 pour 3×4K), PNG complet renvoyé en Base64 ; agent-tools/winclean.rs:92 écarte du modèle toute image > 4 Mio (silencieusement : seul le chemin disque est cité).

### CAP-14 — MOYENNE — `aphrody-guard` : la liste « sûre » autorise `env` et les arguments PowerShell arbitraires (actif seulement avec APHRODY_GUARD=1)
- guard/src/command_safety.rs:97 : `"env"` (et `"printenv"`, `"sort"`, `"date"`, `"hostname"`) figure dans la liste « lecture seule » sans examen des arguments : `env <programme>` exécute un programme arbitraire ; `classify_command` (42-50) teste d'abord `is_dangerous_command`, qui ne connaît pas `env` comme enveloppe. `sort -o`/`--compress-program`, `date -s` écrivent/exécutent aussi (les listes d'options interdites n'existent que pour base64, find, rg, git, sed).
- 291-318 `is_safe_powershell_words` : seul le PREMIER jeton après `-Command` est comparé à `SAFE_CMDLETS` ; `pwsh -c Get-Date "; Remove-Item -Recurse X"` est jugé sûr (le commentaire 288-290 promet que « a pipe to a mutating cmdlet » retombe en Prompt : le code ne le fait pas).
- Hors capture mais dans le périmètre guard ; harden.rs:87-93 : sous Windows `pre_main_hardening` est un no-op (documenté). [V].

### CAP-15 — MOYENNE — Surface `unsafe` Windows : invariants, handles et privilèges
- capture_impl.rs : 74 occurrences de `unsafe`, 0 `// SAFETY:`. L'en-tête (8-14) affirme « Every unsafe block calls exactly one foreign function whose preconditions are documented inline » : vrai pour 41-232, faux pour 429-877 (move_window, set_window_text, enum_children, post/send_message, mouse_*, key_*, set_opacity : aucun commentaire). winclean : memory.rs 27 unsafe/0 SAFETY, snapshot.rs 7/0, speech.rs 3/0, notification.rs 3/0 ; clipboard.rs (14/14), services.rs (15/15), eventlog.rs, winreg.rs sont bien documentés.
- Handles sans RAII, fuites sur chemins d'erreur : memory.rs:105-107 et 133-135 (`protection(..)?` évalué après `OpenProcess(PROCESS_VM_WRITE…)` : handle perdu pour tout argument `protect` invalide), system.rs:529-530 et 539-540 (`?` après `OpenProcess` sans `CloseHandle`). Fuite répétable par le modèle.
- memory.rs:241-260 : `AdjustTokenPrivileges` de windows 0.62.2 renvoie `Result` via `.ok()` sur le BOOL : `ERROR_NOT_ALL_ASSIGNED` (jeton non élevé, privilège absent) n'est pas une erreur ; l'outil répond `{"success":true,"privilege":"SeDebugPrivilege"}` à tort. Aucune élévation n'est demandée nulle part (manifeste `asInvoker`, ui/app/windows-app-manifest.xml:24) ; la skill winclean cite `/winclean-elevate`, commande introuvable dans le plugin.
- capture_impl.rs:559-581 : `post_message`/`send_message` transmettent wParam/lParam bruts du modèle à des HWND quelconques (y compris ceux du processus hôte : WM_TIMER avec lParam=pointeur, WM_SETTEXT avec pointeur arbitraire provoquent un saut/lecture à une adresse choisie) ; `close_window`, `set_opacity(click_through)`, `minimize_all` agissent sur tout HWND sans vérification de propriétaire ni `IsWindow` (réutilisation de HWND entre l'énumération et l'action). `HWND(handle as *mut _)` fabriqué depuis un entier : sûr côté mémoire Rust, mais un défaut de contrat si le HWND est périmé.
- Dépendances : `uiautomation` feature `input` inutilisée ; `vigem-rust` 0.2.0 requiert un pilote noyau tiers dont l'amont est figé (README:22-24).

## 4. Points corrects, à garder
- Gardes RAII ScreenDc/MemDc/CompatBitmap (capture_impl.rs:41-137), validation w/h > 0 avant blit, `GetDC(None)`/`ReleaseDC(None)` appariés ; `bgra_to_rgba` + correction de l'alpha + tests (crates/os/capture/src/lib.rs:346-352, tests 357-).
- clipboard.rs : `OpenGuard` RAII, retry borné, `GlobalLock/Unlock/Free` correctement appariés, SAFETY sur chaque bloc (44-141).
- type_unicode : plafond 4096 caractères et contrôle du nombre d'événements de SendInput (capture_impl.rs:667-702) ; `key_shortcut` refuse la touche Windows sauf outil `shortcut` explicite (812-843) ; clamps de scroll/drag (648, 865-866).
- snapshot.rs : parcours UIA borné, propriétés lues indépendamment, `computer_click_element` retourne les candidats si ambigu (262-283).
- Échecs explicites hors Windows : `UnsupportedComputerBackend` (computer_use.rs:645-683) avec test (agent-runtime/src/tools.rs:610-619), `tauri_screenshot` (`Unavailable`, ui/app/src/lib.rs:431), vision/capture.rs « refused rather than faked » (145-149), clipboard Windows-only `Unsupported`.
- ai/vision/capture.rs : fichier temporaire `tempfile`, supprimé au drop, `.png` forcé (105-115).
- Moteur : `images_withheld` quand le modèle n'a pas de vision (turn.rs:842-845) ; noyau : lignes ≤ 64 Mio, 16 requêtes concurrentes, socket Unix 0600, tube nommé `reject_remote_clients(true)` (transport.rs:21-24, 252-270).
- libaphrody_ffi.so n'expose ni capture ni saisie et n'a aucune dépendance X11/Wayland.

## 5. Recommandations priorisées
1. Réparer le contrat des résultats winclean (CAP-01/02) : mapper `{mimeType,dataBase64}` en `Content::Image` + bloc texte dans `call_raw`/dispatch, propager `is_error` dans WindowsComputerBackend, générer les arguments des 12 actions depuis le schéma de `tools.json` et ajouter un test Windows sur la sortie RÉELLE de `call_raw` (pas un `ToolResult` fabriqué).
2. Rendre le consentement réel (CAP-05/06) : appliquer `ComputerPolicy` côté dispatch (résoudre HWND → processus/titre/intégrité à chaque action d'entrée ou de capture), faire désenregistrer `winclean_tools` par `[computer_use].enabled=false`, implémenter `Escalate` dans turn.rs (ou le supprimer), classer en `Escalate` capture/entrées/presse-papiers/messages de fenêtre/mem_*, ajouter des motifs localisés (fr) ou fondés sur le nom de processus, activer l'audit par défaut dans le noyau de l'app.
3. Corriger la capture Windows (CAP-03/04/13) : resélectionner l'ancien objet avant `DeleteObject` (ou libérer `bm` après `mem_dc`), capturer par HWND (PrintWindow `PW_RENDERFULLCONTENT` ou Windows.Graphics.Capture), supprimer le repli silencieux sur l'écran entier, ajouter CAPTUREBLT, manifeste PerMonitorV2 pour kernel/mcp/cli, énumération des moniteurs, `SendInput` + contrôle d'intégrité ; remplacer `mouse_event/keybd_event`.
4. Décider et documenter la voie Linux (CAP-07/08/09) : Wayland → portails `ashpd` (Screenshot/ScreenCast + RemoteDesktop, consentement natif) / libei ; X11 → x11rb (déjà transitif : XGetImage/XTest) ; sous WSLg → relais vers le noyau Windows hôte. D'ici là, corriger computer_use.rs:15, crates/ai/config/src/rag.rs:164, config.md:183, ARCHITECTURE.md:238 ; ne pas annoncer les outils indisponibles ; faire que les stubs non-Windows renvoient `Unsupported` ; faire échouer bruyamment l'enregistrement du raccourci global quand X11 n'est pas joignable.
5. Borner les ressources et les écritures (CAP-10/11/12/14/15) : plafonner `computer_record_clip` (images/octets, écriture en flux, sans aller-retour PNG), `spawn_blocking` pour tout dispatch winclean, `SendMessageTimeoutW`, `OwnedHandle` RAII pour tous les HANDLE, restreindre `outputPath/save_path` à un répertoire de travail, retirer `readOnlyHint` de `screenshot`/`screen_capture`, purge des captures dans %TEMP%, corriger la liste sûre de guard (retirer `env`, valider tous les jetons PowerShell).

## 6. NON EXAMINÉ
- Exécution : aucun test, aucune compilation, aucun Windows/Wayland/WSLg vivant ; tous les effets graphiques/OS marqués [P] restent à reproduire (fuite GDI, noir sous D3D, UIPI, SW_RESTORE, DPI).
- dispatch.rs 740-1409, winclean : windows_search.rs (36 unsafe), services.rs, eventlog.rs, winreg.rs, tcp.rs, defender.rs, steam.rs, speech.rs, notification.rs, coordination.rs (coord A2A), registry.rs, filesystem.rs, winml.rs, generated.rs (hors signatures citées), scripts `verify-winclean-integration.ps1` (absent) ; memory.rs 120-225 et system.rs hors 478-548.
- crates/ai/agent-runtime hors tools.rs ; persistance des images dans l'historique/rollout de session (screenshots potentiellement stockées sur disque : `record_history`, rollout) ; crates/ai/app-server ; MCP tools autres que screen_capture/tauri.
- apps/cli au-delà de winclean_cmd.rs et du grep (screen/clipboard/hotkey) ; packages/ hors packages/os/winclean (le dossier packages/os/kernel-client n'a été que listé).
- Moteur navigateur (crates/web/obscura-*, `Input.*`/captures hors écran) et crates koharu/m3-reproduce (importés ; la feature `capture` de m3-reproduce est déclarée morte dans docs/migration/stack-dedup/dead.json).
- Sandbox (crates/os/sandbox), execpolicy (au-delà de son usage par kernel/policy.rs), a2a-* ; amont `upstream/` (tauri, wry, tao) : le comportement Wayland de tao/wry (focus, position, curseur) est inféré, pas lu.
- Dates de publication et état de maintenance réels des crates (uiautomation, vigem-rust, global-hotkey) : non vérifiables hors ligne.
