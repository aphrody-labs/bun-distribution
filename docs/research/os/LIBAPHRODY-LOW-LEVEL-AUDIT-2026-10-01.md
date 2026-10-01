# Audit de `libaphrody` et de la couche bas niveau — 2026-10-01

Statut : recherche, **lecture seule**. Aucun code n'a été modifié par cet audit. Niveau de preuve **P1 (statique)** :
rien n'a été exécuté (pas de `dlopen`, pas de fenêtre, pas de Windows ni de macOS), donc tout effet marqué `[P]`
reste à reproduire. L'arbre de travail audité est non commité et contient la dédup UI/web du même jour et la
migration wgpu 30 ; les constats datent de cet état.

Méthode : sept axes en parallèle, un agent en lecture seule par axe (grilles : agents et skills du plugin Aphrody),
puis deux axes « hors Linux » (Windows, macOS). Le lead a **relu dans le code** les constats les plus graves
(colonne « Relu »). Le détail complet de chaque axe (inventaires, tables appel par appel, listes « à garder »,
« non examiné ») est dans [`low-level-audit-2026-10-01/`](low-level-audit-2026-10-01/).

## 1. Réponses courtes

- **Existe-t-il un compositeur Wayland, un client Wayland ou un gestionnaire de fenêtres first-party ? Non.**
  `Cargo.lock` ne contient ni `smithay`, ni `drm`/`gbm`/`libseat`/`libinput`, ni `winit`. Le fenêtrage est délégué à
  Tauri 3 (`tao` 0.37 + `wry` 0.57, GTK sous Linux) et le rendu à `wgpu`. Aucun code first-party n'ouvre un display
  ni ne lit `DISPLAY`, `WAYLAND_DISPLAY` ou `GDK_BACKEND`. `docs/architecture/os/ARCHITECTURE.md:235` l'acte :
  « Dedicated Wayland compositor (Smithay/WGPU) : research complete ; desktop window authority is Tauri/Wry ».
  Les occurrences de « compositor » sont du rendu 2D de couches (`koharu-rasterizer`), du CSS (`obscura-*`) ou de la doc.
- **Le contrat ABI de `libaphrody_ffi.so` est cohérent** : 117 exports first-party, tous présents dans `nm -D`,
  0 divergence avec le chargeur TypeScript (110 symboles) ni avec les en-têtes (85), 0 symbole déclaré inexistant,
  et les noms `aphrody_web_media_*`, `aphrody_web_x_algorithm_rank`, `bun_rs_icon_*` sont inchangés après les
  fusions de crates du jour. Les défauts sont ailleurs : panics non rattrapées, bornes de ressources, intégrité du
  chargeur, artefact non strippé (voir §3).
- **105 constats bruts** (certains recoupés entre axes) : 2 critiques, 27 hauts, 55 moyens, 21 bas. Après recadrage par
  la doctrine YOLO (§1 bis), cinq constats hauts sortent de la liste : #3 passe en « à aligner », #5 et #10 en « voulu »,
  #19 en bas ; reste **22 hauts**. Les constats d'authentification, d'intégrité, de fiabilité et d'exactitude des
  revendications restent entiers.
  Les plus graves sont des **frontières de confiance locales absentes** (§3, §4.1), pas des défauts de rendu.

## 1 bis. Doctrine YOLO : comment lire les constats

Rappel du propriétaire : **Aphrody est un OS YOLO, un sandbox est contraire au but du projet.**
[`YOLO-AUTHORITY.md`](../../reference/os/YOLO-AUTHORITY.md) le dit : l'agent authentifié a l'autorité autonome complète,
`aphrody-sandbox` n'est volontairement pas un filtre universel, le noyau est un domaine de confiance mono-utilisateur
par défaut (`--auth-file` pour la production). Une première version de ce rapport appliquait une grille de sécurité
classique (sandbox, approbations, listes d'interdits) ; elle est retirée.

- **Voulu, donc hors constats** : autonomie `FullAuto`, `--dangerously-*`/`bypassPermissions` pour les pairs, outils
  `computer_use`/`winclean`/`shell-exec`/`apply_patch` sans approbation, `guard`/`execpolicy` opt-in, V8 sans isolation
  de fichiers, extraction de cookies par l'agent. Aucune recommandation de sandbox, d'approbation humaine ou de
  moindre privilège n'est faite.
- **À aligner** : le code qui **annonce** un confinement qu'il n'applique pas (`probe()` → `Enforced`). La correction
  est de retirer l'annonce ou la surface, pas d'implémenter le confinement.
- **Reste un défaut sous YOLO** : (a) l'**authentification du principal** et l'intégrité du canal (la doctrine suppose
  un agent authentifié : un point d'entrée joignable par une page web ou par un autre utilisateur n'est pas « l'agent ») ;
  (b) l'intégrité et la provenance de ce que l'OS exécute (chargeur, artefacts, déploiement) ; (c) l'exactitude des
  revendications du code et de la doc ; (d) la fiabilité (panic qui abat l'hôte, fuite, blocage du noyau, écriture non
  atomique, bornes de ressources vues comme garde anti-crash) ; (e) les **lacunes fonctionnelles** : un OS YOLO doit
  laisser l'agent voir et piloter le bureau, donc l'absence de capture et de saisie sous Linux/Wayland (#11) est un
  défaut central, pas périphérique ; (f) portabilité et chaîne d'approvisionnement.

## 2. Périmètre et limites

Lu : `crates/interop/ffi`, `crates/ui/{app,bun,render,render-tools,tauri-wrap,tauri-3d,model-view}`, `crates/os/*`
(hors `drive`, importé), `crates/native/native`, `crates/shell/*`, `crates/koharu/*` (importé : signalé comme tel),
`packages/interop/native`, scripts de déploiement et unités systemd, plus `target/release/libaphrody_ffi.so`
inspecté avec `readelf`/`nm`/`objdump` (artefact daté 04:25, **antérieur** aux fusions de crates de 07:21).
Non examiné (liste complète par axe) : toute exécution ; `crates/os/base` en partie ; sous-commandes d'`apps/cli`
(grep seulement) ; `upstream/` ; le dépôt frère `iecode` ; Windows/macOS au-delà de §7.

## 3. Constats critiques et hauts

« Relu » : le lead a lu le code cité. Sans cette mention, le constat est rapporté par l'agent avec lecture du code cité.

| # | Sév. | ID | Constat | Lieu | Relu |
|---|---|---|---|---|---|
| 1 | CRITIQUE | T-01 | `aphrody term` ouvre un **shell interactif derrière un WebSocket sans jeton, sans contrôle d'`Origin`, sans TLS**. Défaut `127.0.0.1:8788`, l'aide dit « localhost uniquement » mais `--addr` accepte toute adresse. Une page web peut ouvrir `ws://127.0.0.1:8788` (le navigateur n'applique pas de CORS aux WebSocket) et piloter le shell. | `terminal-backend/src/lib.rs:128-157`, `apps/cli/src/lib.rs:542-546`, `commands.rs:1923-1945` | oui |
| 2 | CRITIQUE | OS-01 | L'écouteur A2A (`/msg`, JSON-RPC, REST) n'a **aucune authentification** : n'importe quel client local choisit le pair et fournit le prompt d'un CLI d'agent, dont la sortie lui revient. Le mode sans permissions de ces CLI (`--dangerously-skip-permissions`, `bypassPermissions`) est **voulu** ; le défaut est que l'appelant n'est pas authentifié. Défaut `127.0.0.1:8788` (**même port** que `aphrody term`). | `a2a-coord/src/listener.rs:71-92,134-139`, `executor.rs:60-75`, `peer.rs:265-306` | oui |
| 3 | ALIGNER | OS-02, W-01 | **Revendication de confinement fausse.** `probe_linux()` annonce `Enforced` (« Landlock + seccomp supported ») après un simple test de présence du syscall 444, alors que le helper ne fait que `PR_SET_NO_NEW_PRIVS` puis `execvp` ; côté Windows le « Restricted Token + Low-IL + Job Object » n'existe pas non plus. **Sous la doctrine YOLO le confinement est contraire au but du projet** : la correction est de ne plus l'annoncer (ou de retirer la surface), pas d'implémenter Landlock, seccomp ou AppContainer. | `sandbox/src/unix.rs:33-84`, `capability.rs:103-125`, `sandbox/src/windows.rs:19-64` | oui |
| 4 | HAUTE | OS-03, AFF-07 | IPC du noyau : pas de `SO_PEERCRED`, pas de DACL de pipe, **authentification désactivée par défaut** (portée `*`), repli `/tmp/aphrody-os-<user>.sock` prévisible, `bind` puis `chmod 0600` (course), clients sans vérification du propriétaire. `tauri_execute_js`, `window_open`, `clipboard_read` sont ouverts à tout client du même UID. | `kernel/src/transport.rs:62-82,238-276`, `auth.rs:18-44`, `app/src/lib.rs:68` | |
| 5 | VOULU | OS-04, CAP-14 | `guard` est un garde-fou **opt-in** (`APHRODY_GUARD=1`, désactivé par défaut) : ses contournements (`env <cmd>`, PowerShell jugé sur le premier jeton) ne sont pas un défaut sous YOLO. À ne pas durcir. | `guard/src/command_safety.rs:97,291-318,633` | |
| 6 | HAUTE | OS-05 | `a2a-server` : authentification jamais branchée (`user: None`), **SSRF** par l'URL de rappel push (aucune validation, redirections suivies), panique distante sur `pageToken`. Latent tant qu'il n'est pas exposé. | `a2a-server/src/rest.rs:109..328`, `push/sender.rs:32-51` | |
| 7 | HAUTE | CAP-01 | Les résultats `winclean` (image, texte) sont renvoyés dans `structuredContent` alors que `text()`/`images()` ne lisent que `content` : **screenshot, observe et la CLI renvoient du vide**. Le test fabrique `content` à la main. | `winclean/src/lib.rs:101-114`, `agent-tools/src/winclean.rs:277-280` | |
| 8 | HAUTE | CAP-02 | Scroll, drag, type, keypress, focus_window et click par `element_id` envoient des noms d'arguments que le dispatch rejette ; `is_error` n'est jamais testé. | `computer_use.rs:323-445` ↔ `dispatch.rs:445..728` | |
| 9 | HAUTE | CAP-03, CAP-04 | Capture Windows : `bm` détruit avant `mem_dc` (un HBITMAP fuit par capture) ; la « capture de fenêtre » est un BitBlt du rectangle écran (couvert/réduit faux), repli silencieux plein écran. | `capture/src/capture_impl.rs:129-170,282-311` | |
| 10 | VOULU | CAP-05, CAP-06 | Autonomie `FullAuto` par défaut, `ComputerPolicy` minimale, outils `winclean_tools()` sans politique : autorité autonome voulue. Reste réel, hors politique : le noyau de l'app n'a ni authentification ni audit (voir #4, `OS-08`). | `computer_use.rs:423-438`, `engine/src/config.rs:10-14` | |
| 11 | HAUTE | CAP-07 | **Aucune capture d'écran ni injection d'entrées sous Linux** (ni X11 ni Wayland) : `xcap`, `scrap`, `enigo`, `ashpd`, `pipewire`, `libei`, `evdev`, `atspi` sont absents de `Cargo.lock`. L'outil `computer_use` est pourtant enregistré par défaut sous Linux et rejette 100 % des actions ; la doc promet un backend X11 inexistant. | `computer_use.rs:15,843-846`, `ARCHITECTURE.md:238` | oui (absence des crates) |
| 12 | HAUTE | F-01, G2 | 15 exports `bun_rs_*` (+ `shenron_persona_prompt`) **sans `catch_unwind`** : une panique abat le processus Bun, contre le commentaire « every entry point catches panics » (`lib.rs:33`). `bun_rs_render_png` alloue `vec![0; w*h*4]` sans plafond (3D CPU 16384² MSAA 4x ≈ 9 Gio). | `ui/bun/src/{lib,render,reproduce,svg,icons_ffi}.rs`, `raster3d.rs:699-701` | oui (render.rs) |
| 13 | HAUTE | ART-01, F-06 | Intégrité du chargeur contournable : manifest voisin du `.so`, auto-attesté et sans signature ; vérification puis `dlopen` non atomiques ; `APHRODY_FFI_LIB` honoré hors dev ; `APHRODY_FFI_DEV` n'est **pas** une frontière de sécurité ; Bun charge `.env` du cwd. | `native-artifact.ts:66,133-201`, `library.ts:293-352` | |
| 14 | HAUTE | ART-02, ART-03 | Aucun `[profile.*]` (défauts Cargo : LTO off) ; `panic=unwind` requis par les 16 `catch_unwind` mais implicite ; **52,2 Mo (20 %) de `.symtab`/`.strtab` non strippés** dans l'artefact « release ». | `Cargo.toml` racine, `readelf -SW` | oui (symtab) |
| 15 | HAUTE | AFF-01 | **Rien ne choisit ni ne protège le backend d'affichage.** Sous WSLg (`WAYLAND_DISPLAY=wayland-0`, `DISPLAY=:0`, `GDK_BACKEND` vide) GTK3 prend Wayland, que `PLAN.md:525` documente comme cassé. Seule la doc contourne, de façon incohérente (`wslg-manager.sh:174` pose `wayland,x11`). | `app/src/lib.rs:669-670`, `model-view/src/main.rs:75`, `scaffold/tauri.ts:206` | |
| 16 | HAUTE | AFF-02, AFF-03 | Pet, widget et quickbar reposent sur des appels non portables Wayland (always-on-top, position, curseur global) qui **échouent en silence** ; `cursor_position()` renvoie `Ok((0,0))` ; Alt+Space est X11 seulement et `register()` renvoie `Ok` même si le thread X11 est mort. | `integration.rs:380-432`, `quickbar.rs:25-71` | |
| 17 | HAUTE | G1 | Device wgpu créé avec `downlevel_defaults()` (texture 2048 px) alors que les tailles acceptées montent à 16384 ; aucun gestionnaire d'erreur installé : une fenêtre 4K ou un rendu 3D > 2048 px **panique** [P]. | `gpu.rs:188`, `scene3d.rs:35`, `layer.rs:152` | |
| 18 | HAUTE | G3 | Sous Linux la surface wgpu du calque 3D est créée sur la **même fenêtre GTK** que peint WebKitGTK, sans sous-surface ; aucun pixel 3D jamais observé. | `tauri-3d/src/layer.rs:131` | |
| 19 | BASSE | T-02 | Le mode `--gated` est **opt-in** (approbation humaine, contraire au défaut YOLO) ; seul bug restant : l'invite tient sur une ligne et la commande est tronquée. | `tui/src/ui.rs:33,149-170` | |
| 20 | HAUTE | T-03 | La sortie du modèle est écrite brute sur stdout/stderr (OSC 52 presse-papiers, titre, requêtes DA/CPR) : aucun filtre hors TUI. | `apps/cli/src/agent_run.rs:162-178,257` | |
| 21 | HAUTE | T-04 | `nu_eval` : enfants externes héritent du stdin (flux MCP du noyau), sortie non bornée, le timeout ne tue ni l'enfant ni le thread. | `shell/nu/src/lib.rs:58-196,344-358` | |
| 22 | HAUTE | T-05, T-06 | Arrêt du pty par SIGHUP seul, sans escalade ni plafond de sessions ; aucune gestion de SIGTERM/SIGHUP : terminal non restauré, outils en groupe propre orphelins au Ctrl-C. | `terminal-backend/src/session.rs:110-273`, `tui/src/app.rs:53-62` | |
| 23 | HAUTE | T-07 | Le défilement du TUI compte des lignes logiques alors que ratatui replie ensuite : la fin du transcript sort de l'écran. | `tui/src/ui.rs:56-125` | |

Constats moyens et bas : voir les tables complètes de chaque axe (annexes). Quelques-uns à ne pas manquer :
`AFF-05` (aucun manifeste ACL applicatif : une trentaine de commandes Tauri, dont `aphrody_fs_read_text` sans portée,
sont appelables depuis toute fenêtre locale, contre ce que dit le README), `AFF-06` (aucune politique de navigation
sur les fenêtres locales), `F-05` (arbre DOM en pointeur brut sans registre : double destroy = use-after-free),
`F-11` (cookies Chromium déchiffrés en clair par l'ABI), `OS-09` (`FileSecretStore` sans mode 0600, un fichier de jeton
sous `~/.aphrody/credentials/` observé en mode 777), `OS-12`/`T-15` (DLL chargées par nom nu : `Everything64.dll`,
`conpty.dll`), `G5` (sur WSL2 wgpu n'atteint que lavapipe, CPU, alors que le MCP annonce `"kind":"gpu"`).

## 4. Thèmes transverses

1. **Frontières de confiance locales absentes** (#1, #2, #4, #6, #13, AFF-05). Quatre services écoutent ou lisent sans
   authentifier leur pair : terminal WebSocket, A2A, noyau, chargeur de `.so`. Correctif commun : un seul module
   d'authentification locale (jeton de démarrage + `SO_PEERCRED`/DACL + liste d'`Origin`), appliqué partout, et
   `bind` loopback imposé sans option de contournement silencieuse.
2. **Revendications de confinement non tenues** (#3). Le sandbox annonce `Enforced` sans rien appliquer, sous Linux comme
   sous Windows. Sous YOLO la bonne réponse n'est pas de confiner mais de **ne plus prétendre** : retirer l'annonce ou la
   surface, et aligner README, description du crate et `probe()` sur la doctrine.
3. **Frontière FFI** (#12, #13, `F-05`, `F-08`, `F-09`). Un `ffi_guard!` unique (panic → code d'erreur), des plafonds
   explicites, un registre pour tout pointeur opaque, une enveloppe d'erreur unique, un manifeste unique d'où générer
   en-têtes, table de symboles et test de dérive.
4. **Artefact** (#14, `ART-04..13`). Strip, version-script (347 des 464 exports sont hors contrat : `temporal_*` 302,
   V8 36), `-z nodelete`, plancher glibc ≥ 2.39 non déclaré, build non reproductible (2 733 chemins `/home/aphro`),
   257 Mo dont ≈ 27 Mo de polices et ≈ 52 Mo de symboles.
5. **Affichage Linux** (#15, #16, #18). Un helper unique avant `Builder::run` (WSL → `GDK_BACKEND=x11`, refus propre
   sans display, type de session exposé) et une détection de capacités avant d'activer pet/widget/quickbar.
6. **Capture et saisie** (#7, #8, #9, #11). Pour un OS YOLO c'est la lacune fonctionnelle centrale : l'agent doit voir et
   piloter le bureau. Windows : le contrat des résultats est cassé ; Linux : rien n'existe. Ne pas bâtir de backend
   maison (voir §6).
7. **GPU et rendu** (#17, #18, `G4..G10`). Demander les `limits()` réelles de l'adaptateur, installer
   `on_uncaptured_error`, rendre la perte de device récupérable, et dire la vérité sur lavapipe.
8. **Terminal et pty** (#19..#23). Cycle de vie du terminal, arrêt par groupe de processus, sanitisation des
   séquences d'échappement.

## 5. Ce qui est correct et à garder

- Contrat ABI : symboles Rust = `nm` = TypeScript ; mimalloc en TLS `local_dynamic_tls` effectif (0 relocation TPOFF,
  donc `dlopen` sûr) ; symboles C++ de V8 non exportés, 0 collision avec les 681 exports de Bun 1.4.2 ; un seul `free`
  par pointeur côté TS ; hash vérifié avant `dlopen` ; test d'étape qui compare les 7 versions d'ABI sur l'artefact réel.
- Durcissement ELF : RELRO complet, `BIND_NOW`, pile non exécutable, aucun segment RWX, pas de RPATH ni TEXTREL.
- Terminal : hook de panique ratatui + `RestoreGuard` (raw mode et écran alternatif restaurés), filtrage des contrôles
  sur tout le chemin TUI, contre-pression sans perte, `#![deny(unsafe_code)]`. `agent-tools/src/shell.rs` : stdin
  null, groupe propre, `killpg` à l'expiration, sortie plafonnée. `aphrody-proc` : Job Object `KILL_ON_JOB_CLOSE`.
- GPU : `forbid(unsafe_code)` dans `aphrody-render`, `prepare_with` complet, perte de device explicite côté
  `koharu-canvas`, aucune lib GPU dans `NEEDED`.
- Les origines distantes restent refusées par les fenêtres d'`aphrody-app` ; `x11` (feature de `tauri-runtime-wry`)
  est cohérente et inerte sous Wayland.
- Déploiement atomique avec `--restore`, MDWE volontairement absent (JIT de V8/JSC).

## 6. Réutiliser plutôt que refaire

Principe demandé par le propriétaire : **utiliser les bibliothèques, CLI et apps Rust existantes (COSMIC et autres)
dans leur domaine plutôt que tout réécrire.** Le tableau croise les trous de l'audit avec l'état réel de
`Cargo.lock` (version, utilisateurs directs). « À évaluer » = non adopté, non testé ; les licences sont celles
déclarées par les projets, à reconfirmer avant adoption (dépôt Apache-2.0 : les applications COSMIC, GPL-3.0, ne
s'utilisent que comme programmes séparés).

| Besoin / trou | Linux | Windows | macOS | Déjà dans Aphrody |
|---|---|---|---|---|
| Capture d'écran (CAP-07) | Portails `ScreenCast`/`Screenshot` via **`ashpd`** (MIT) ; backend COSMIC = `xdg-desktop-portal-cosmic` (GPL, appelé par D-Bus, jamais lié) ; X11 : `x11rb` | corriger `winclean` (CAP-01..04) ou `windows-capture`/`xcap` (à évaluer) | ScreenCaptureKit (crate à évaluer) + permission TCC | `ashpd`, `xcap`, `scrap`, `windows-capture`, `screencapturekit` **absents** ; `windows` direct (au moins 6 crates du workspace) |
| Injection d'entrées | Portail `RemoteDesktop` (implémenté par le portail COSMIC) / libei | `SendInput` via `windows` (déjà direct) ou `enigo` (à évaluer) | CGEvent + permission Accessibilité | `enigo` absent |
| Presse-papiers, raccourcis globaux, tray | `arboard` (X11 + wl-clipboard-rs), `global-hotkey` X11-only (AFF-03), `ksni` ; **le portail COSMIC n'implémente pas GlobalShortcuts** | `arboard`, `global-hotkey`, `tray-icon` | idem | `arboard` 3.6, `global-hotkey` 0.8, `tray-icon` 0.25, `ksni` 0.3 présents (transitifs via Tauri) |
| Fenêtrage / compositeur | Tauri → `tao`/`wry` (déjà). Pas de compositeur à écrire ; si un jour : `smithay` (MIT) + lecture de `cosmic-comp` (GPL) | Tauri | Tauri | `tao` 0.37, `wry` 0.57 ; **`winit`, `smithay` absents** (ne pas ajouter `winit` : Tauri utilise `tao`) |
| Toolkit GUI | Tauri (webview) ; `libcosmic` est lié à Wayland/COSMIC | idem | idem | `iced`, `slint`, `egui`, `gpui`, `libcosmic` **absents** : rien à changer sauf outils internes (`egui`) |
| Rendu 2D, texte | — | — | — | `wgpu` 29 **et** 30, `vello` 0.10 (koharu), `tiny-skia`/`resvg` (svg, obscura), `swash`, `skrifa` ×4 ; `cosmic-text` (multiplateforme) et `parley` absents : candidats seulement si le texte du terminal ou de la 3D est à refaire |
| Terminal / pty | `portable-pty` | `portable-pty` (ConPTY) | `portable-pty` | `portable-pty` 0.8.1 (direct), `rio-vt` 0.5, `ratatui` 0.30 ; `alacritty_terminal` absent : garder l'existant |
| Sandbox (OS-02) | sans objet : confinement contraire à la doctrine YOLO (voir §1 bis) | sans objet | sans objet | `landlock`, `seccompiler` absents ; ne pas les ajouter |
| IPC local (OS-03) | UDS | named pipe | UDS | `interprocess` absent : l'adopter simplifierait le transport mais **n'apporte pas à lui seul** l'authentification de pair |
| Dialogues, notifications, dossiers, métriques | `rfd`, `notify-rust`, `dirs`, `sysinfo` | idem | idem | `rfd` 0.16/0.17 (koharu), `notify-rust` 4.17 (transitif), **`dirs` ×4 versions**, `sysinfo` ×2 ; `directories` absent |
| Audio | — | — | — | `cpal`, `rodio`, `symphonia` absents ; aucun besoin first-party identifié (sons joués par la webview) |

Doublons de versions à traiter dans une prochaine dédup (non appliqué) : `dirs` ×4 (4, 5, 6, 7), `windows` ×5,
`windows-sys` ×6, `skrifa` ×4, `nix` ×3, `wgpu` ×2 (29 via vello/koharu, 30 via `aphrody-render`), `sysinfo` ×2,
`fontdb` ×2, `rfd` ×2.

## 7. Hors Linux : Windows et macOS

*(Section complétée par la vague 2 : voir ci-dessous.)*

## 8. Plan de correction proposé

Rien n'est appliqué : chaque lot demande ton accord. Ordre proposé.

- **P0 — fermer les frontières de confiance** : #1 (`aphrody term` : loopback imposé, jeton, liste d'`Origin`), #2 et #6
  (A2A : authentifier le pair ; les drapeaux `--dangerously-*` sont voulus), #4 (noyau : `SO_PEERCRED`/DACL, répertoire
  0700 sans repli `/tmp`), AFF-05 (manifeste ACL), #3 (aligner la revendication `Enforced` sur la doctrine : retirer l'annonce).
- **P1 — contrat et robustesse** : `ffi_guard!` + plafonds (#12), intégrité du chargeur (#13), profil release + strip +
  version-script (#14), helper d'affichage Linux et détection de capacités (#15, #16), contrat des résultats `winclean`
  (#7..#9), sanitisation de sortie du terminal (#20).
- **P2** : limites et perte de device wgpu (#17), décision sur le calque 3D Linux (#18), arrêt pty et signaux (#21..#23),
  capture/saisie Linux via portails (#11) ou relais vers le noyau Windows depuis WSLg, dérive de docs.
- **P3** : taille de l'artefact (−27 Mo de polices externalisées, `image` sans features par défaut), build reproductible,
  chemin de déploiement de `libaphrody_ffi.so` (aujourd'hui seul `libaphrody_web_ffi.so` de l'ancien superprojet a
  des scripts), dédup des versions (§6).

## 9. Annexes

Détail par axe : [`abi`](low-level-audit-2026-10-01/abi.md), [`artefact`](low-level-audit-2026-10-01/artefact.md),
[`affichage`](low-level-audit-2026-10-01/affichage.md), [`capture`](low-level-audit-2026-10-01/capture.md),
[`gpu`](low-level-audit-2026-10-01/gpu.md), [`os`](low-level-audit-2026-10-01/os.md),
[`terminal`](low-level-audit-2026-10-01/terminal.md) ; brief commun :
[`BRIEF`](low-level-audit-2026-10-01/BRIEF.md).
