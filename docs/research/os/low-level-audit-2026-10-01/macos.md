# Audit bas niveau — axe MACOS (vague 2 « hors Linux » : chemins macOS et portabilité hors Linux/Windows)

Date : 2026-10-01 — dépôt /home/aphro/aphrody (main) — niveau de preuve global P1 (lecture statique ; aucune machine macOS).
Lecture seule : aucun fichier du dépôt modifié, aucun cargo/rustc/bun test/bun install lancé. Outils : rg, sed -n, grep, python3
(analyse de texte de Cargo.lock), lecture de ~/.cargo/registry/src (libc 0.2.189, wgpu-hal 30.0.1, raw-window-metal 1.1.0, wry 0.57.0,
tao 0.37.1, tauri 3.0.0-alpha.3, tauri-runtime-wry 3.0.0-alpha.3, tauri-plugin-{deep-link,global-shortcut,notification,
single-instance,autostart} 3.0.0-alpha.2, global-hotkey 0.8.0, tray-icon 0.25.1, notify 8.2.0, tokio 1.53.1, ort-sys 2.0.0-rc.12,
rookie-cookies 0.6.0).
Grille : agents cross-platform-validator, security-engineer, rust-architect ; skills cross-platform-cli-toolbelt, rust-target-check
(lus : config/ai/plugins/aphrody/{agents,skills}/…). Légende : [V] vérifié dans le code ou la source tierce lue ; [P] plausible, dépend
d'un comportement macOS non reproduit ici. Les rapports de vague 1 ont été consultés ; leurs IDs sont cités quand ils sont confirmés
ou complétés (OS-02/03/07/09/14, CAP-09, G4/G8, T-12/T-15, ART-04/08/12).

## 0 bis. Cadre appliqué : doctrine YOLO (docs/reference/os/YOLO-AUTHORITY.md, lu en entier, 37 l.)

Correction du propriétaire reçue en cours d'audit : Aphrody est un OS YOLO ; l'autorité de l'agent authentifié est voulue ; ni sandbox
(seatbelt, Landlock, seccomp, AppContainer), ni approbation humaine, ni politique restrictive ne sont recommandés dans ce rapport.
Classement utilisé : **voulu (YOLO)** = comportement assumé, non traité comme défaut ; **revendication à aligner** = le code ou la doc annonce
un confinement qui n'est pas appliqué ; sont restés légitimes : authentification du principal et intégrité du canal, intégrité/provenance
des artefacts exécutés, exactitude des revendications, fiabilité (panique, fuite, blocage, bornes de ressources comme anti-crash), lacunes
fonctionnelles (l'agent doit voir et piloter le bureau), portabilité, chaîne d'approvisionnement. Entitlements, TCC et notarisation sont
traités comme conditions de FONCTIONNEMENT (JIT, accès écran/entrées, chargement de bibliothèques), jamais comme confinement.
Application : MAC-03 est reformulé en « revendication à aligner » (aucun portage seatbelt) ; l'exposition de `tauri_execute_js` et de
`clipboard_*` par l'app est **voulue** (autorité de l'agent), MAC-01 ne porte que sur QUI répond sur le canal ; la sensibilité à la casse de
`aphrody-sandbox` (traitée dans MAC-13) est classée voulu/revendication ; `harden_macos` (opt-in `APHRODY_GUARD=1`) reste voulu.

## 0. Périmètre réellement lu

| Zone | Fichiers / lignes lus |
|---|---|
| Politique et gates | rust-toolchain.toml (tout) ; inventory/targets.json (tout, 122 l.) ; .github/workflows/rg-migration.yml 1-45 ; .github/shenron/workflows/{ci.yml 15-45, release.yml 15-50, aphrody-ci.yml} ; Cargo.toml 1-30, 395-470 ; docs/architecture/os/ARCHITECTURE.md 24-36 ; config/ai/plugins/aphrody/agents/{rust-architect,cross-platform-validator,security-engineer}.md, skills/{rust-target-check,cross-platform-cli-toolbelt}/SKILL.md ; PLAN.md (grep macOS) ; docs/guides/web/TAURI-DEBUG.md 20-60 |
| os/sandbox | Cargo.toml, lib.rs, unix.rs, capability.rs, runner.rs 60-162, policy.rs 1-200, patch_guard.rs (tout) |
| os/guard | harden.rs 1-260 (tout sauf tests), Cargo.toml ; apps/cli/src/main.rs |
| os/proc | Cargo.toml, lib.rs, unix.rs, lock.rs, group.rs 1-80, port.rs, lease.rs 1-60 |
| os/kernel, kernel-client | transport.rs 1-330 ; kernel-client/src/lib.rs 90-110, 260-270 ; packages/os/kernel-client/src/index.ts 1-60 |
| os/secrets | Cargo.toml, lib.rs 340-640 (FileSecretStore, EncryptedFileSecretStore) ; consommateurs (rg) |
| os/capture, winclean, stdio-capture, search, fsindex, coreutils, compat, systemd, base | Cargo.toml + cfg(rg) ; capture/lib.rs 1-120, 195-260 ; winclean/src/{tcp.rs 237-300, coordination.rs 30-100} ; stdio-capture/src/lib.rs 1-130 ; coreutils/subsystem.rs 60-125 ; compat/{wine_proton,dotnet,pwsh}.rs |
| shell/terminal-backend | lib.rs 60-130, 225-275 ; Cargo.toml ; rg session.rs |
| native/native | Cargo.toml, lib.rs, topology.rs (tout), cuda.rs (cfg) ; consommateurs pillars_cmd.rs 40-100, ui/app/src/models.rs 260-295 |
| ui/app | tauri.conf.json (tout), Cargo.toml, build.rs 1-40, src/{lib.rs 40-100, 180-445, 560-810 ; integration.rs 1-560 ; quickbar.rs ; window.rs 150-295 ; desktop.rs 1-120 ; broker.rs 100-145} |
| ui/tauri-3d, model-view, render | tauri-3d/src/{layer.rs 75-280, lib.rs 1-292} ; model-view/src/main.rs 60-160, tauri.conf.json ; render/{Cargo.toml, src/lib.rs 270-360, src/gpu.rs 140-215} |
| ui/tauri-wrap, packages/ui/{web-to-tauri,scaffold} | tauri-wrap/src/{window.rs 40-168, debug.rs 60-215} ; web-to-tauri/src/{plan.ts 205-300, 640-670 ; generate.ts 150-250} ; scaffold/src/tauri.ts 100-285 |
| ui/drive (dérivé Spacedrive, FSL) | Cargo.toml, build.rs, src/{macos.rs, service.rs 1-110, 165-335} |
| interop/ffi + chargeur Bun | ffi/Cargo.toml ; packages/interop/native/{package.json, src/native-artifact.ts (tout), src/library.ts 270-397} ; packages/infra/workspace/src/{bun-native.ts 225-384, tauri.ts 1-72, 226-336} ; crates/web/web-bridge/src/resolve.rs 40-200 |
| Tiers (registre) | libc (prctl/ptrace/getpeereid), wgpu-hal metal/{surface,adapter,mod}.rs, raw-window-metal lib.rs/observer.rs, wry wkwebview/{download,class/wry_web_view_ui_delegate}.rs, tauri webview_window.rs/app.rs/permissions/webview, tauri-runtime-wry lib.rs 1338-1356, global-hotkey platform_impl/macos, tray-icon macos, deep-link/notification/single-instance/autostart, tokio net/unix/ucred.rs, ort-sys build/download/dist.txt, rookie-cookies macOS keychain, notify Cargo.toml |
| Autres | apps/cli/src/{platform.rs, ide_cmd.rs 240-330 et 625-665, commands.rs 545-560, oc_cmd.rs 325-345, package_cmd.rs 160-180, vpn_cmd.rs 375-420} ; crates/ai/{antigravity auth.rs/oauth.rs, models accel.rs, infer runtime.rs, agent-tools computer_use.rs 30-75 + shell.rs 335-375} ; crates/web/{web-chromium lib.rs, obscura-cdp server.rs 640-700} ; Cargo.lock (analyse python des dépendants) |

## 1. Réponses synthétiques aux huit questions du brief

1. **Compilation / gate** : un seul module ne compile pas sur macOS dans le périmètre : `aphrody-sandbox` (`unix.rs:34`, MAC-02). Tout le
   reste de crates/os, shell, native, ui, interop est soit portable, soit correctement gardé (liste en §4). Les cibles apple sont dans
   `rust-toolchain.toml:15-16` mais PAS dans `inventory/targets.json` (hôtes de déploiement : Windows, WSL, VPS, dbfr), pas dans le
   workflow actif (`.github/workflows/rg-migration.yml` = ubuntu-latest, tests Bun seulement), pas dans les 3 cibles « bloquantes » des
   agents (Linux, Windows MSVC, wasm32). **Il n'existe aucun gate macOS** et aucun gate Rust tout court dans `.github/workflows` (MAC-05).
2. **Sandbox** : inexistant et non souhaité (cadre YOLO). Ce que le code *affirme* est faux (MAC-03, « revendication à aligner ») :
   `probe()` annonce `BestEffort` + « macOS seatbelt (sandbox-exec) supported » sans test ni code, et la description du crate/ECOSYSTEM.md
   promet « macOS seatbelt ». Le runner refuse les politiques restrictives (`runner.rs:77-82`), ce que YOLO-AUTHORITY.md documente. La source
   seatbelt de Codex n'est pas importée (nested-source-map.json:74550-74600, `target: null`) et il ne faut pas l'importer.
3. **libaphrody_ffi.dylib** : le chargeur Bun sait nommer l'artefact darwin (`<arch>-apple-darwin`, suffixe `bun:ffi`), mais aucune étape
   n'existe pour signer, vérifier une signature, attester Mach-O, produire x86_64 depuis arm64 ni documenter la quarantaine (MAC-04). V8
   (deno_core/obscura-js, v8 150.4.0) est lié dans la dylib et dans le CLI : Hardened Runtime sans `allow-jit` ne démarre pas V8 (MAC-04).
4. **TCC** : aucune API TCC n'est appelée (0 occurrence de `CGPreflightScreenCaptureAccess`, `AXIsProcessTrusted`, `NSScreenCaptureUsageDescription`
   dans le code first-party). Capture, fenêtres et entrées sont `Unsupported` explicites sous macOS et `computer_use` retombe sur `Browser` :
   la dégradation est propre et honnête, mais c'est une **lacune fonctionnelle** : l'agent ne peut ni voir ni piloter le bureau macOS
   (MAC-09). `global-hotkey` n'exige PAS Accessibilité pour une touche ordinaire (Carbon `RegisterEventHotKey`) : l'hypothèse du brief est
   inexacte (MAC-08). Autre trou fonctionnel TCC : web-to-tauri (caméra/micro sans clé Info.plist, MAC-09).
5. **Fil principal** : `NativeLayer::attach` n'est correct sur macOS que parce que la commande Tauri est synchrone (donc sur le fil
   principal) ; `raw-window-metal` panique hors fil principal (MAC-06). Le correctif G8 de la vague 1 doit en tenir compte.
6. **Chemins / sockets** : le socket noyau par défaut est `/tmp/aphrody-os-<user>.sock` sur macOS parce que `XDG_RUNTIME_DIR` n'y existe pas
   (MAC-01) ; longueur < 104 octets pour les chemins par défaut (≈ 29-52) ; aucun contrôle de longueur ni message dédié pour les chemins
   fournis (std renvoie `InvalidInput`). Pas de Keychain dans `aphrody-secrets` (MAC-11).
7. **Comportements** : RLIMIT_NOFILE jamais relevé (fiabilité, MAC-13), `notify` utilise FSEvents (bon), `pre_exec` ⇒ fork+exec
   (async-signal-safe, bon), `dlclose` à vérifier (MAC-04) ; la sensibilité à la casse de `aphrody-sandbox` est classée voulu/revendication
   (MAC-13), pas défaut.
8. **Crates tierces** : voir §5 ; aucune crate « Linux/Windows seulement » n'est présente dans Cargo.lock pour ces fonctions : les
   dépendances résolues (arboard, global-hotkey, tray-icon, muda, rfd, notify-rust+mac-notification-sys, portable-pty, sysinfo, notify,
   keyring) ont toutes un backend macOS ; `interprocess`, `directories`, `cpal`, `trash`, `ctrlc`, `xcap`, `enigo`, `rdev` sont absentes.

## 2. Tableau des constats (classés par gravité ; les IDs suivent l'ordre des sections de détail du §3)

| ID | Sév. | chemin:ligne | Constat | Classe / preuve |
|---|---|---|---|---|
| MAC-01 | HAUTE | os/kernel/src/transport.rs:76-80,260-272 ; kernel-client/src/lib.rs:104-108 ; packages/os/kernel-client/src/index.ts:23-24 ; ui/app/src/lib.rs:50-67 ; os/kernel/src/client.rs:220-268 ; tauri-plugin-single-instance macos.rs | Intégrité du canal : socket par défaut dans `/tmp` partagé sur macOS, pair non authentifié ; l'app « rejoint » le noyau de quiconque y répond | légitime (principal/canal) ; [V] code, [P] exploitation |
| MAC-02 | HAUTE | os/sandbox/src/unix.rs:32-37 ; lib.rs:17 ; runner.rs:96-98 | Portabilité : `aphrody-sandbox` ne compile pas sur macOS (libc::prctl / PR_SET_NO_NEW_PRIVS) | légitime (portabilité) ; [V] libc 0.2.189 |
| MAC-04 | HAUTE | packages/infra/workspace/src/bun-native.ts:231-291 ; native-artifact.ts:46-60 ; library.ts:311-327 | Provenance/chargeur dylib : aucune signature ni attestation Mach-O, x86_64 impossible depuis arm64, V8 exige `allow-jit` de l'hôte | légitime (artefacts, fonctionnement) ; [V] code, [P] dyld/Gatekeeper |
| MAC-05 | HAUTE | packages/infra/workspace/src/tauri.ts:53,305 ; ui/app/tauri.conf.json:97-170 ; scaffold/src/tauri.ts:131-134 ; rust-toolchain.toml:15-16 ; Cargo.toml:21 ; docs/architecture/os/ARCHITECTURE.md:29-32 | Aucune chaîne de livraison macOS (le builder refuse macOS), aucun gate, politique contradictoire | légitime (portabilité, chaîne d'approvisionnement) ; [V] |
| MAC-06 | HAUTE | ui/tauri-3d/src/layer.rs:131,143-152 ; raw-window-metal lib.rs:402-403, observer.rs:81 ; wgpu-hal metal/adapter.rs:468-471 | Calque 3D macOS : alpha forcé Opaque, sous-couche au-dessus du WKWebView, panique hors fil principal | légitime (fonction inutilisable/panique) ; [V] alpha/panique, [P] ordre |
| MAC-09 | HAUTE | os/capture/src/lib.rs:200-260 ; ai/agent-tools/src/computer_use.rs:46-56 ; ui/app/src/lib.rs:414-431 ; scaffold/src/tauri.ts:131-134 ; web-to-tauri/src/plan.ts:259-267 | Lacune fonctionnelle : l'agent ne voit ni ne pilote le bureau macOS ; prérequis TCC non préparés (Info.plist, entitlements, états de permission) ; `getUserMedia` d'une app générée termine le processus | légitime (lacune fonctionnelle) ; [V] code, [P] TCC |
| MAC-03 | MOYENNE | os/sandbox/src/capability.rs:70-77 ; Cargo.toml:12 ; docs/ecosystem/ECOSYSTEM.md:129 | « seatbelt supported / BestEffort » sans aucun code : revendication fausse | revendication à aligner (aucun portage) ; [V] |
| MAC-07 | MOYENNE | ui/app/src/lib.rs:797 ; integration.rs:330-349,454-462 ; tauri.conf.json:41,57,72,87 | Intégration bureau macOS incomplète : Dock/Accessory, `skipTaskbar` inopérant, Reopen, Opened (fichiers), icône de barre de menus | légitime (fiabilité/portabilité) ; [V] code, [P] effets |
| MAC-08 | MOYENNE | ui/app/src/quickbar.rs:17,24-33 | `alt+space` : Carbon (pas de TCC) mais capte l'espace insécable ; échec = simple log | [V] source ; [P] versions macOS |
| MAC-10 | MOYENNE | ui/tauri-wrap/src/window.rs:93-117 ; wry wkwebview/class/wry_web_view_ui_delegate.rs:170-275 ; web-to-tauri/src/plan.ts:662, generate.ts:188 | WKWebView : popups hors du modèle Tauri (politique de navigation et UA non appliqués), zoom inerte, service workers | légitime (parité) ; [V] source wry/tauri |
| MAC-11 | MOYENNE | os/secrets/Cargo.toml:12 ; lib.rs:371-385 ; ai/antigravity/src/auth.rs:168-190, oauth.rs:425-440 ; Cargo.lock:3098,13041 | Matériel d'authentification en fichiers (pas de Trousseau) ; OS-09 aggravé par le home 0755 de macOS ; `keyring`+`apple-native-keyring-store` déjà résolus | légitime (secrets du principal) ; [V] |
| MAC-12 | BASSE | apps/cli/src/platform.rs:20-32 ; ui/app/src/broker.rs:117-130 ; os/compat/src/dotnet.rs:26-29 ; terminal-backend/src/lib.rs:80-96 | Chemins de données dispersés (5 conventions), doc/code contradictoires, PATH minimal des apps GUI | [V] |
| MAC-13 | BASSE | os/guard/src/harden.rs:159-163 ; os/sandbox/src/policy.rs:163,168 ; patch_guard.rs:19 | RLIMIT_NOFILE à 256 jamais relevé (fiabilité) ; `dlclose` ; casse APFS dans la politique de sandbox = voulu/revendication | [V] code ; [P] APFS |
| MAC-14 | BASSE | native/native/src/topology.rs:100-103 ; apps/cli/src/pillars_cmd.rs:75 ; ai/models/src/accel.rs:243 ; ort-sys dist.txt | macOS : mémoire 0, Metal annoncé sans sonde, pas de binaire ORT x86_64-apple-darwin | [V] |
| MAC-15 | BASSE | ui/drive/build.rs:50-53 ; Cargo.toml:31 ; src/service.rs:228-231 | Pont Swift de drive : `cfg(target_os)` de l'hôte dans build.rs, deployment target 11.0, `launchctl load` historique | [V] ; non compilé |

## 3. Détail des constats

### MAC-01 [HAUTE] Intégrité du canal : socket noyau dans `/tmp` partagé sur macOS ; l'app rejoint le noyau d'un pair non authentifié
Cadre YOLO : YOLO-AUTHORITY.md pose que le socket local est « un domaine de confiance d'un seul utilisateur OS » (mode 0600) et interdit de l'exposer à un autre
utilisateur. L'exposition de `tauri_execute_js`, `tauri_interact` et `clipboard_*` par l'app est **voulue** (autorité de l'agent authentifié) ; ce qui reste légitime est
l'authentification du principal et l'intégrité du canal, c'est-à-dire s'assurer que celui qui répond sur ce chemin est bien le noyau de CET utilisateur.
Sous macOS, la doctrine n'est pas tenue par défaut. Complète OS-03 (aucune authentification de pair) et OS-07 (stale cleanup, bind puis chmod).
- `transport.rs:76-80` : `XDG_RUNTIME_DIR` si défini, sinon `/tmp/aphrody-os-<user>.sock`. Sous macOS `XDG_RUNTIME_DIR` n'existe pas (pas de
  logind) : le cas « repli » devient le cas normal. `/tmp` (→ `/private/tmp`) est partagé par tous les comptes ; le nom est prévisible
  (`USER`). Le chemin n'utilise ni `$TMPDIR` (répertoire par utilisateur `/var/folders/…/T/`, déjà employé ailleurs : web-bridge/actors.rs:162-165,
  tauri-wrap/debug.rs) ni `~/Library/…`. Les clients Rust et Bun dupliquent la même règle (`kernel-client/src/lib.rs:104-108`, `index.ts:23-24`).
- `transport.rs:260-272` : `connect()` d'abord ; si ça répond → AddrInUse ; sinon `remove_file` (sticky bit : échec EPERM sur le fichier d'un
  autre compte ⇒ le noyau ne démarre pas) puis `bind` puis `chmod 0600`.
- `ui/app/src/lib.rs:50-67` : si `connect(&endpoint)` réussit, l'app ne démarre pas de noyau : elle appelle `host_remote(windows|webviews, &endpoint)`
  (`client.rs:220-268`) qui enregistre ses sous-systèmes et exécute tout `tools/call` reçu, sans vérifier qui est au bout du socket. Les sous-systèmes
  exposent `tauri_execute_js` (`lib.rs:227,414-416` : `webview_eval(window, script)`, fenêtre `main` avec `withGlobalTauri: true`) et `clipboard_*`
  (`window.rs:154,159,285-291`).
- Défaillance concrète (canal, pas confinement) : un autre compte local peut occuper `/tmp/aphrody-os-<utilisateur>.sock` avant le noyau de l'utilisateur
  (UnixListener, fichier rendu accessible en écriture, ce que macOS exige pour `connect()`). L'app de la victime « rejoint » alors ce faux noyau, lui
  publie ses outils et exécute ce qu'il lui envoie ; le noyau légitime, lui, ne peut pas démarrer (le `remove_file` échoue sous sticky bit). Il s'agit
  d'un défaut d'authenticité du pair, pas d'une demande de restriction de l'agent. Sur un Mac mono-utilisateur le risque est faible ; il est réel sur un Mac partagé.
- Même famille, composant tiers : `tauri-plugin-single-instance 3.0.0-alpha.2`, `platform_impl/macos.rs` : `PathBuf::from("/tmp/{identifier}_si.sock")`
  (« must be shorter than 100 chars ») ; `notify_singleton` se connecte à ce chemin et, en cas de succès, `std::process::exit(0)` : un socket
  pré-créé par un autre compte fait quitter l'app silencieusement (blocage de démarrage) et reçoit les arguments de lancement [V source].
- Longueur `sun_path` (104 sur macOS) : défauts 29-52 octets (OK) ; `serve --socket`/`APHRODY_OS_SOCKET` trop longs → `InvalidInput` générique de std
  (`path must be shorter than SUN_LEN`), pas de message dédié.
- Correctif d'authentification/canal, sans nouvelle dépendance : tokio 1.53.1 fournit `UnixStream::peer_cred()` sur macOS (`ucred.rs:294-325`, `getpeereid`) :
  comparer l'uid du pair à `geteuid()` côté client (avant `initialize`/`register_subsystem`) et côté serveur ; défaut `$TMPDIR/aphrody-os.sock` (ou
  `~/Library/Application Support/Aphrody/…`) dans un répertoire 0700 créé avant le bind, pour que l'endpoint reste dans le domaine d'un seul utilisateur.

### MAC-02 [HAUTE] `aphrody-sandbox` ne compile pas sur macOS (portabilité)
- `sandbox/src/lib.rs:17` : `#[cfg(all(unix, not(target_arch = "wasm32")))] pub mod unix;` ; `unix.rs:32-37` : `libc::prctl(libc::PR_SET_NO_NEW_PRIVS, …)`.
  libc 0.2.189 définit `prctl`, `PR_SET_NO_NEW_PRIVS` et `PR_SET_PDEATHSIG` uniquement sous `linux_like`/android/fuchsia/l4re
  (`src/unix/linux_like/linux_l4re_shared.rs:1036-1135,1791` ; rien dans `src/unix/bsd/apple`). Erreur E0425 sur macOS/*BSD. OS-14 l'avait classé
  BASSE ; c'est un blocage de `cargo check --workspace` sur toute cible apple déclarée dans `rust-toolchain.toml`.
- `runner.rs:96-98` appelle `crate::unix::configure_command` sous la même garde (aucun repli).
- Atténuant : aucun consommateur de `aphrody-sandbox` (OS-02) ; le reste du périmètre est compilable (voir §4). Les autres usages
  Linux-only sont bien gardés : `proc/unix.rs:24-28` (PDEATHSIG sous `target_os="linux"`), `obscura-cdp/server.rs:652-690` (`target_env = "gnu"`),
  `winclean/tcp.rs:37-300` (`target_os="linux"` + repli), `native/topology.rs:95-101`.
- Correctif minimal, sans ajouter de confinement : garder l'appel `prctl` sous `target_os = "linux" | "android"` (ou retirer le module d'aide, qui n'applique
  rien d'autre qu'un `execvp`), de sorte que le crate compile partout ; ajouter `cargo check -p aphrody-sandbox --target aarch64-apple-darwin` à un gate
  (compilation croisée d'un crate libc seul avec `rustup target add`, à valider).

### MAC-03 [MOYENNE] Revendication à aligner : « macOS seatbelt (sandbox-exec) supported » sans aucun code
Cadre YOLO : aucun confinement n'est voulu ; YOLO-AUTHORITY.md dit que `aphrody-sandbox` est une bibliothèque de vérification de politique dont le runner par défaut
refuse les politiques restrictives faute de pouvoir les appliquer. Le défaut est donc uniquement l'exactitude de ce que le code et la doc affirment (même nature qu'OS-02
côté Linux, de moindre portée : `BestEffort` au lieu d'`Enforced`).
- `capability.rs:70-77` : sous `target_os = "macos"`, `CapabilityReport { filesystem: BestEffort, network: BestEffort, details: "macOS seatbelt (sandbox-exec) supported" }`
  sans rien tester ni appeler (ni `/usr/bin/sandbox-exec`, ni profil, ni `sandbox_init`). `capability.rs:14` (doc de `BestEffort`) cite aussi « macOS sandbox-exec seatbelt ».
  La description du crate (`Cargo.toml:12`) et docs/ecosystem/ecosystem.json:928 / ECOSYSTEM.md:129 annoncent « macOS seatbelt ».
- `runner.rs:77-82` : tout mode autre que `Disabled`/`DangerouslyBypass`, ou réseau refusé → `RunnerError::Policy("… unavailable for this runner")` : le runner n'affiche aucune
  fausse protection effective ; seul le rapport de capacités et les descriptions sont faux.
- Alignement recommandé (aucun portage) : `probe()` renvoie `Unavailable` (ou un état « aucun confinement, autorité de l'agent ») sous macOS avec un `details` exact ;
  corriger la description du crate et les entrées docs/ecosystem. La source seatbelt de Codex (`codex-rs/sandboxing/src/seatbelt*.rs`, `*.sbpl`) figure dans
  docs/migration/nested-source-map.json:74550-74610 avec `"target": null` : elle ne doit pas être importée dans ce but.

### MAC-04 [HAUTE] Chaîne libaphrody_ffi.dylib / Bun / Hardened Runtime
Ce qui existe et est correct : `nativeHostTriple()` (`native-artifact.ts:40-52`) renvoie `aarch64-apple-darwin`/`x86_64-apple-darwin`, `libc: null` ;
`resolveNativeLibraryPath()` (`library.ts:311-327`) construit `libaphrody_ffi.<suffix>` et cherche `native/<triple>/` ; le CLI n'appelle PAS
`pre_main_hardening` depuis la cdylib (`apps/cli/src/main.rs:20-26`) : bon, `PT_DENY_ATTACH` dans Bun serait destructeur ; Rust expose
`web-bridge/resolve.rs:66-91` les noms `.dylib`.
Ce qui manque ou est faux :
- Aucune étape de signature ni de vérification : `rg codesign|notarytool|otool|lipo|install_name_tool|xattr` hors dossiers importés = 0 résultat
  first-party. `bun-native.ts:231-286` ne produit que l'empreinte SHA-256 (`attestation`) et le smoke ; le manifeste n'a aucun champ de
  signature ni d'identité (cf. ART-01 : auto-attesté). Sur arm64, chaque page exécutable doit porter une signature valide (au minimum ad hoc,
  que l'éditeur de liens Apple pose par défaut) ; tout post-traitement (strip, install_name_tool, copie qui altère le binaire) l'invalide ⇒
  « Killed: 9 » au `dlopen`. La chaîne actuelle copie et renomme seulement (`bun-native.ts:300-340`), donc l'ad hoc survit [P], mais rien ne le vérifie.
- Pas de binaire x86_64 depuis un hôte arm64 : `bun-native.ts:231-232` ne retient que le triple HÔTE de `rustc` ; l'artefact est écrit sous
  `native/<triple hôte>/` (`:291`) ; le test `:283-284` refuse un autre triple. Un Bun x64 sous Rosetta (`process.arch === "x64"`) cherche
  `x86_64-apple-darwin` et ne trouvera rien : il faut un hôte Intel dédié (pas de dylib universelle, pas de `lipo`) [V].
- Hardened Runtime et V8 : `v8 150.4.0` est lié (`deno_core` ← `obscura-js` ← `aphrody-web-engine`/`obscura-browser`/`obscura-cdp` ;
  36 exports `v8__*/rusty_v8_*` : ART-04). V8 sur Apple Silicon alloue son tas de code avec `MAP_JIT` ; sous Hardened Runtime il faut
  `com.apple.security.cs.allow-jit` sur le PROCESSUS HÔTE. Dans Bun, c'est l'entitlement de Bun lui-même (docs du dépôt
  `docs/architecture/upstream-bun/guides/runtime/codesign-macos-executable.mdx` : allow-jit, allow-unsigned-executable-memory,
  disable-executable-page-protection, allow-dyld-environment-variables, disable-library-validation) [P : binaire Bun officiel non
  inspecté]. Pour le CLI `aphrody` utilisé comme sidecar signé par Tauri, voir MAC-05 : aucun entitlement n'est fourni.
- `dlopen` d'une dylib non signée par la même équipe que l'hôte : Library Validation la refuse sauf `disable-library-validation` sur l'hôte.
  Idem pour `libonnxruntime.dylib` téléchargé sous `~/.aphrody/runtimes` (`infer/src/runtime.rs:28-33`, `ort` en `load-dynamic`).
- Quarantaine/Gatekeeper : un fichier téléchargé par navigateur porte `com.apple.quarantine` ; une dylib non notarisée est alors bloquée
  au chargement par un processus tiers. Une installation par npm/curl ne pose pas l'attribut. Rien dans le dépôt ne documente `xattr -d`.
- `dlclose` : `engine.ts` appelle `close()` (ART-08). Sous macOS, dyld ne décharge pas les images contenant des variables thread-local
  (les `thread_local!` de Rust/tokio/mimalloc en créent) : l'appel est alors sans effet [P, comportement dyld non vérifié ici] ; ne pas s'en servir
  comme garde-fou contre le `dlclose` sous threads vivants.
- À vérifier sur un Mac : `codesign -dvvv --entitlements - libaphrody_ffi.dylib`, `otool -L`, `otool -l | rg -A2 'LC_RPATH|LC_ID_DYLIB'`,
  `nm -gU | rg -c ' _'` (exports hors contrat), `spctl -a -t exec -vv`, `lipo -info`.
- Install name : rustc émet `-install_name @rpath/libaphrody_ffi.dylib` pour une cdylib Apple [P : comportement rustc connu, non relu] ; sans
  incidence pour `dlopen(chemin absolu)` ; à fixer si un hôte C lie la dylib par `-l`.

### MAC-05 [HAUTE] Aucune chaîne de livraison macOS, aucun gate, politique contradictoire
- Le pilote de build officiel refuse macOS : `packages/infra/workspace/src/tauri.ts:51-53` → `throw new Error("Aphrody desktop targets Windows and Linux")` ;
  bundles par défaut `isWindows ? "nsis" : "deb,appimage"` (`:305`). Donc pas de `app,dmg`.
- `ui/app/tauri.conf.json` (tout) : `bundle.targets: "all"` mais aucune clé `bundle.macOS` (ni `entitlements`, `signingIdentity`, `hardenedRuntime`,
  `minimumSystemVersion`, `dmg`), aucun `Info.plist`, aucun `icon.icns` dans `icons/` (la liste `bundle.icon` ne contient que des .png et `icon.ico`).
  Le bundler macOS doit synthétiser un .icns à partir de PNG (tailles 16…256 ; `64x64`, `24x24`, `48x48` ne sont pas des tailles icns) [P].
  Comparaison : Koharu (importé) a `crates/koharu/koharu/tauri.macos.conf.json` (`titleBarStyle: Overlay`, `trafficLightPosition`, `entitlements`) et
  `Entitlements.plist` (`com.apple.security.cs.disable-library-validation`) ; aphrody-app n'a rien d'équivalent.
- Entitlements nécessaires et absents pour aphrody-app (sidecar `aphrody` = V8 + `ort` dynamique + llama.cpp téléchargés) : `allow-jit`
  (V8), `disable-library-validation` (bibliothèques tierces de `~/.aphrody/runtimes`), éventuellement `allow-unsigned-executable-memory` ;
  `device.audio-input`/`device.camera` si web-to-tauri (MAC-09). Sans eux, le CLI sidecar signé en Hardened Runtime par `tauri build` s'arrête au premier
  isolate V8 [P]. Le sidecar n'est de toute façon inclus que par `tauri.drive.conf.json` (`externalBin: sd-daemon, aphrody, koharu-sdk`), et
  `ui/app/binaries/` ne contient que des `*-x86_64-pc-windows-msvc.exe` / `*-x86_64-unknown-linux-gnu` : aucun `aphrody-aarch64-apple-darwin`.
- Notarisation : aucune trace (`notarytool`, `APPLE_*`) ; `plugins.updater.pubkey: ""` et `endpoints: []` (`tauri.conf.json`) : mise à jour inerte (rapportée
  explicitement par le code, à garder).
- Scaffold `@aphrody/scaffold` (`scaffold/src/tauri.ts:131-134`) : `bundle: { active, targets: "all", icon: ["icons/icon.png"] }` ; pas de bloc macOS, pas
  d'Info.plist, `tauri-runtime-wry` avec `features = ["x11"]` seulement (`:144`) : OK pour wry mais un shell généré ne peut pas avoir de fenêtre transparente sur
  macOS (`macos-private-api` n'y est ajouté que pour CEF).
- Gate : `.github/workflows/rg-migration.yml` (seul workflow actif ; `.github/rg/workflows` et `.github/shenron/workflows` ne sont pas lus par GitHub)
  = `ubuntu-latest`, Bun uniquement. `shenron/ci.yml:26-33` exclut macOS explicitement (binding skia absent) ; `shenron/release.yml:25-26` compile le
  bot Bun pour darwin sur `macos-latest` (sans signature). Les agents `cross-platform-validator`/skill `rust-target-check` ne vérifient que Linux,
  Windows MSVC et wasm32 ; l'agent `rust-architect.md:23` dit « macOS = best-effort only ».
- Dérive de politique : `docs/architecture/os/ARCHITECTURE.md:29-32` (trois environnements : Windows, Linux, Web/WASI) et `Cargo.toml:21`
  (« Linux/Windows/WASM ») excluent macOS ; `rust-toolchain.toml:15-16` installe quand même `aarch64-apple-darwin` et `x86_64-apple-darwin` ;
  `PLAN.md:494,583,665` écrit « macOS non qualifié » ; `docs/plans/2026-09-29-consolidation-initial-archive.md:513` prévoit d'« ajouter macOS ».
  Il faut trancher : soit macOS est un non-objectif documenté (retirer les cibles du toolchain et les `cfg(macos)` morts), soit un gate
  `cargo check --workspace --target aarch64-apple-darwin` sur `macos-14` doit exister.

### MAC-06 [HAUTE] Calque 3D `aphrody-tauri-3d` : opaque, au-dessus du webview, et lié au fil principal
Corrige/complète G4 (« create_surface remplace la couche » : faux ; c'est une sous-couche) et G8.
- Alpha : `layer.rs:143-152` choisit parmi `[PreMultiplied, Opaque]` ce que la surface annonce. wgpu-hal Metal annonce
  `composite_alpha_modes: [Opaque, PostMultiplied]` (`wgpu-hal-30.0.1/src/metal/adapter.rs:468-471`) : `PreMultiplied` est absent ⇒ **Opaque** est choisi
  et `surface.rs:270` fait `setOpaque(true)`. Avec `viewport = None` le calque couvre toute la fenêtre : la fenêtre « transparente sans cadre » de
  `aphrody-model-view` (`tauri.conf.json`/`main.rs:84-94` : `transparent(true)`) devient un rectangle opaque. [V] code + source wgpu.
  (Sur Metal, un calque non opaque attend du prémultiplié malgré le nom `PostMultiplied` de wgpu : à valider sur machine.)
- Ordre des couches : `wgpu` → `raw_window_metal::Layer::from_ns_view` (`lib.rs:402-421`) : force `setWantsLayer:true`, puis, si la couche racine
  n'est pas un CAMetalLayer, `ObserverLayer::new` ajoute une SOUS-couche (`observer.rs:81` : `root_layer.addSublayer(&this)`) à la fin de
  `sublayers`. Le WKWebView (sous-vue du NSView de contenu tao) est déjà là : la couche Metal est donc au-dessus ; l'UI M3 est masquée, le contraire de
  Windows où la visual DirectComposition est SOUS le WebView2 (`layer.rs:179-209`) [P : AppKit peut réordonner les sous-couches de vues].
- Fil principal : `from_ns_view` fait `MainThreadMarker::new().expect("can only access NSView on the main thread")` (`lib.rs:403`) → panique hors fil
  principal. `attach_window` n'est appelé que depuis `#[tauri::command] fn attach` (synchrone ⇒ fil principal, `tauri-3d/src/lib.rs:157-161`) et
  `model-view/src/main.rs:95` (setup) : correct par construction. Le correctif G8 « `#[tauri::command(async)]` » transformerait cette panique en crash sur macOS :
  la création de surface doit passer par `run_on_main_thread`, pas par un pool.
- `get_current_texture`/`present` peuvent s'exécuter hors fil principal ; `Surface::drop` (observateurs KVO) doit rester sur le fil principal (déjà vrai :
  `WindowEvent::Destroyed` dans `on_event`).
- Backend : `render/src/lib.rs:282-283,357` Metal sur apple ; `gpu.rs:152-175` `Backends::all()` + `PowerPreference::HighPerformance` (force le GPU discret
  sur MacBook Intel bi-GPU). wgpu 29 (vello) et 30 (aphrody-render) coexistent dans Cargo.lock : deux piles wgpu si vello est lié (non vérifié).

### MAC-07 [MOYENNE] Intégration bureau macOS incomplète (app Tauri)
- Politique d'activation : `rg ActivationPolicy|set_activation_policy|dock_visibility|LSUIElement` sur crates/ui/app = 0. L'application est « Regular » :
  avec `--autostart` (`integration.rs:45,478-481`, lancement en arrière-plan tray/pet/widget) l'icône Dock apparaît et rebondit à l'ouverture de session.
- `skipTaskbar: true` sur `splash`, `pet`, `widget`, `quickbar` (`tauri.conf.json:41,57,72,87`) : « macOS: Unsupported » (tauri 3.0.0-alpha.3
  `webview_window.rs:645-652` ; `tauri-runtime-wry` `lib.rs:1351` est un no-op sous macOS). Idem `model-view/src/main.rs:92`.
- Dock : la fenêtre `main` se cache à la fermeture (`lib.rs:729-737`, `api.prevent_close(); window.hide()`) mais l'app démarre par
  `.run(tauri::generate_context!())` (`lib.rs:797`) sans rappel : `RunEvent::Reopen { has_visible_windows }` (`tauri app.rs:269-276`, émis par
  `applicationShouldHandleReopen`) n'est pas traité : un clic sur l'icône Dock ne restaure pas la fenêtre cachée [P].
- Fichiers/URL : `fileAssociations` (aphrody, md, markdown, txt, log, json) et schéma `aphrody` : sur macOS le plugin deep-link émet les URLs
  d'`RunEvent::Opened` (`tauri-plugin-deep-link … lib.rs:587-596`), y compris `file://`. `integration.rs:454-462` les range dans `OpenRequest { urls, files: vec![] }`
  sans passer par `classify_args` : `scope.allow_file` n'est jamais appelé (le fs-scope n'est pas élargi pour ces fichiers, `dispatch_open` ligne 203-215),
  `urls` (documenté « aphrody:// URLs », `integration.rs:82-86`) contient des `file://` non filtrés. Windows/Linux passent par `classify_args` (`:91-120`, validé).
- Barre de menus : `TrayIconBuilder` (`integration.rs:330-349`) sans `.icon_as_template(true)` : l'icône colorée par défaut ne s'adapte pas au thème de la barre de
  menus (`tray-icon 0.25.1` macos : `set_icon_as_template`). Le clic gauche ouvre la fenêtre (`show_menu_on_left_click(false)`) : cohérent.
- Barre de titre : `main` est `decorations: false` (`tauri.conf.json:26`) sans `titleBarStyle`/`trafficLightPosition` ; aucune fenêtre macOS
  native (feux tricolores, plein écran) alors que Koharu fournit `tauri.macos.conf.json`. Les contrôles M3 sont des commandes (`aphrody_shell_window`).
- Notifications : `tauri-plugin-notification` utilise `notify-rust` + `mac-notification-sys` (API NSUserNotification dépréciée) et fixe
  l'application sur `com.apple.Terminal` en dev, `identifier` en production (`…/desktop.rs:228-236`) : en production il faut un `.app` installé dont
  l'identifiant (`dev.aphrody.desktop`) existe.
- À garder : `autostart` utilise `MacosLauncher::LaunchAgent` par défaut (pas d'Automation TCC) ; le tray se crée dans `setup` (fil principal, exigé par
  `tray-icon` : `Error::NotMainThread`) ; `macOSPrivateApi: true` est déclaré pour les fenêtres transparentes (conséquence : exclu du Mac App Store).

### MAC-08 [MOYENNE] Raccourci global `alt+space`
- `quickbar.rs:17` `SHORTCUT = "alt+space"`. `global-hotkey 0.8.0` sous macOS (`platform_impl/macos/mod.rs:116`) enregistre via Carbon `RegisterEventHotKey` :
  PAS de permission Accessibilité ni Surveillance de l'entrée pour une touche ordinaire. Seules les touches média passent par `CGEventTapCreate`
  (`:206-215`, droit TCC requis) : sans objet ici. `tauri-plugin-global-shortcut` renvoie l'enregistrement sur le fil principal (doc, lignes 8, 76-93) ; l'appel
  est fait dans `setup` (`lib.rs:722`) : correct.
- Option+Espace produit une espace insécable dans les champs texte (courant en français) : un raccourci global Carbon l'intercepte pour toutes les applis.
  Les rapports d'Apple/communauté signalent aussi des restrictions de `RegisterEventHotKey` pour les combinaisons à Option seul sous macOS 15 [P : à vérifier].
- Dégradation : l'échec est loggé seulement (`quickbar.rs:30-32`) ; l'entrée de menu tray « Quick ask » (`integration.rs:303`) reste le seul repli et affiche
  « Alt+Space » (accélérateur ignoré par muda sur macOS tant qu'il n'est pas `Option+Space`).
- Recommandation : défaut macOS `Cmd+Shift+Space` ou configurable ; ne pas annoncer `Alt` sous macOS.

### MAC-09 [HAUTE] Lacune fonctionnelle : l'agent ne voit ni ne pilote le bureau macOS ; prérequis TCC non préparés
Cadre YOLO : l'agent authentifié doit pouvoir voir et piloter le bureau ; les droits TCC (Enregistrement d'écran, Accessibilité, Automatisation) sont ici des conditions
de FONCTIONNEMENT, pas un confinement. Équivalent macOS des lacunes de capture/entrées constatées sous Wayland (axe CAP de la vague 1).
Ce qui est correct (garder) : la dégradation est honnête. Capture d'écran, énumération/commande des fenêtres, entrées = `Unsupported` explicite sous macOS
(`os/capture/src/lib.rs:200-260` ; `winclean/ocr.rs:20-24` ; `tauri_screenshot` : « available on Windows only », `ui/app/src/lib.rs:414-431`) ; `ComputerEnvironment::auto_detect()`
retombe sur `Browser` hors Windows/Linux (`computer_use.rs:46-56`) ; aucune image noire fabriquée.
Ce qui manque :
- Aucun backend macOS : ni capture (ScreenCaptureKit / `CGWindowListCreateImage`), ni injection d'entrées (`CGEvent`), ni accessibilité (`AXUIElement`), ni Automatisation (Apple Events).
  Les crates qui en fourniraient (xcap, scrap, enigo, rdev, accessibility, screencapturekit) sont absentes de Cargo.lock. Aucune sonde TCC non plus : 0 occurrence de
  `CGPreflightScreenCaptureAccess`, `CGRequestScreenCaptureAccess`, `AXIsProcessTrusted(WithOptions)`. Le jour où un backend existera, « permission refusée » et « non supporté »
  doivent être des erreurs distinctes (aujourd'hui `CaptureError::Unsupported` unique ; `list_windows()` renvoie `Vec::new()` : confusion « aucune fenêtre » / « pas de droit », cf. CAP-09).
- Prérequis de fonctionnement à prévoir pour ce backend : `NSScreenCaptureUsageDescription` (et `NSAppleEventsUsageDescription` si Automatisation) dans l'`Info.plist` de l'app
  (Tauri fusionne un `Info.plist` placé dans `src-tauri`) ; identité de signature STABLE (une signature ad hoc change à chaque build et fait perdre l'autorisation TCC accordée) ;
  autorisation attribuée au processus « responsable » (l'app, pas un sidecar lancé depuis un terminal) ; sous Hardened Runtime, `com.apple.security.device.*` seulement pour caméra/micro.
- web-to-tauri : `plan.ts:259-267` classe `media-devices`/`geolocation` en risque « manual » (« the macOS usage descriptions belong to the packaged app ») mais le shell généré
  (`scaffold/src/tauri.ts:100-135`, `tauriShell`) ne contient ni `Info.plist` ni entitlements. Sous macOS `getUserMedia` sans `NSCameraUsageDescription`/`NSMicrophoneUsageDescription`
  termine le processus (TCC), et sous Hardened Runtime il faut aussi `com.apple.security.device.camera`/`audio-input` [P : comportement TCC] : fonction cassée par construction pour
  les sites enveloppés qui utilisent la caméra/le micro.
- Presse-papiers : `clipboard_read` (`window.rs:285-287`, outil exposé au noyau) lit via `arboard`/NSPasteboard ; les versions récentes de macOS (15.4+, « Allow paste from other apps »)
  peuvent demander une confirmation pour les lectures programmatiques [P] : l'outil renverra une chaîne vide/erreur sans message dédié. Condition de fonctionnement, à signaler à l'agent.
- Dossiers protégés : `aphrody_fs_read_dir`/`aphrody_fs_read_text` (`lib.rs:515-523`) sont synchrones donc sur le fil principal ; un parcours de `~/Desktop`, `~/Documents` ou
  `~/Downloads` (invite TCC « Fichiers et dossiers ») fige l'interface jusqu'à la réponse [P] (fiabilité, cf. G8) ; idem `unique_path` de tauri-wrap sur `~/Downloads`.
- Cookies navigateur : `rookie-cookies 0.6.0` (via `web-chromium`) lit la clé « Chrome Safe Storage » dans le Trousseau avec échéance
  (`chromium_platform_keys/macos.rs`) : invite système attendue, échec journalisé (bon, à garder ; fonctionne tant qu'une session graphique répond à l'invite).

### MAC-10 [MOYENNE] Limites WKWebView de `aphrody-tauri-wrap` / web-to-tauri
- `window.rs:96-103` : `Decision::Allow` → `NewWindowResponse::Allow`. Sous macOS wry crée alors (`wry_web_view_ui_delegate.rs:212-275`) un `NSWindow` nu contenant un
  `WKWebView` construit avec la `configuration` fournie : pas de `WryNavigationDelegate` (donc `on_navigation`/`allow_navigation` ne s'appliquent plus à la popup),
  pas de handler de téléchargement, pas de `UIDelegate` (les `window.open` imbriquées échouent), fenêtre hors du modèle Tauri (pas de label, de capacité, de
  `window-state`). Sur Linux/Windows la popup est une fenêtre gérée. Le flux OAuth/paiement « garde son opener » mais échappe à la politique d'origine.
- `user_agent` : wry l'applique par `setCustomUserAgent` sur l'instance du WKWebView (`wkwebview/mod.rs:871-875`), pas sur la configuration : la popup n'hérite pas
  de l'UA personnalisé (`window.rs:115-117`), alors que `signals.ts:36` détecte le sniffing d'UA.
- `zoom_hotkeys_enabled(true)` (défaut `plan.ts:662`) : sous macOS/Linux Tauri injecte un polyfill qui exige `core:webview:allow-set-webview-zoom`
  (`webview_window.rs:1185-1195`) ; ce droit n'est pas dans `core:webview:default` (`permissions/webview/autogenerated/reference.md`) et le shell généré
  n'accorde aucune permission (`generate.ts:188` `permissions: []`, « No IPC »). Sous WebView2 le zoom est natif. Réglage donc inopérant hors Windows [V].
- Service workers : `plan.ts:225-240` signale correctement que WKWebView les limite aux domaines liés à l'app (`WKAppBoundDomains` dans Info.plist) ; le générateur ne
  produit pas cette clé. Notifications Web absentes (`plan.ts:251-252`, signalé). `csp: null` (`scaffold/src/tauri.ts:~121`) : CSP du site distant seule.
- `on_download` : wry macOS (`wkwebview/download.rs`) renomme déjà les collisions « nom (n).ext » avant d'appeler le handler (WKDownload, macOS 11.3+) ;
  `unique_path` de tauri-wrap re-vérifie : redondant mais inoffensif. `additional_browser_args` : « macOS: Unsupported » (non utilisé ici).
- Les écarts (popups, UA, zoom) ne sont pas dans la liste de risques de `plan.ts` ; à ajouter pour la plateforme macOS.

### MAC-11 [MOYENNE] Secrets : fichiers au lieu du Trousseau
- `aphrody-secrets` (`Cargo.toml:12` : « env + plaintext file + AES-256-GCM/Argon2id encrypted file ») n'a aucun backend d'OS : ni Keychain, ni DPAPI/Credential Manager, ni
  Secret Service. `FileSecretStore::save` (`lib.rs:371-385`) écrit en clair (base64) sans mode 0600 (OS-09). Sous macOS le répertoire personnel est `0755` par défaut
  (≠ Ubuntu 21.04+ : 0750) : un fichier 0644 sous `~/.aphrody` est lisible par tout autre compte local ; l'aggravation est propre à macOS. Aucun consommateur
  first-party aujourd'hui (rg `FileSecretStore::new` hors crate = 0) : latent.
- Jetons Antigravity : `auth.rs:168-190` ne lit que des fichiers sous unix (`~/.config/aphrody/antigravity-token.json`, `~/.gemini/antigravity-cli/antigravity-oauth-token`) ;
  le Credential Manager n'existe que sous Windows (`auth.rs:180-183`). `oauth.rs:425-440` persiste en JSON 0600 sous `~/.config/aphrody/` (XDG sur macOS). Le mode
  « sans clé » (relecture du magasin du client `agy` pour rafraîchir) ne fonctionne donc pas sur macOS si `agy` y range ses jetons dans le Trousseau [P].
- Remplaçant déjà présent : `keyring 4.2.0` + `apple-native-keyring-store` + `security-framework 3.7.0` sont dans Cargo.lock (dépendants : `koharu-secrets`,
  importé). `koharu-secrets` ne configure `linux-keyutils` qu'en Linux et utilise le magasin natif ailleurs (`lib.rs:63-76`) : modèle à reprendre dans un backend
  `KeychainSecretStore` d'`aphrody-secrets`.
- `ai/mcp-oauth/src/registration.rs:226-244` écrit le cache d'enregistrement OAuth avec `tokio::fs::write` (mode par défaut) : même remarque (hors axe).

### MAC-12 [BASSE] Chemins de données et environnement des apps GUI
- `apps/cli/src/platform.rs:20` documente `$HOME/Library/Application Support` mais `:30-32` renvoie `$HOME/Library/Preferences` (dossier des plists) ; fonction `#[allow(dead_code)]`
  (aucun appelant) : piège latent.
- Conventions concurrentes sous macOS : `~/.aphrody` (`aphrody-models/paths.rs`, état, modèles de plusieurs Go : non exclus de Time Machine/Spotlight, pas de
  `com.apple.metadata:com_apple_backup_excludeItem`), `~/.config/aphrody` (mcp.json, jetons, vpn), `~/.local/share/aphrody` + `~/.local/bin` (`package_cmd.rs:165-176`),
  `~/.local/state/aphrody/coord` (`winclean/coordination.rs:41-46`), `~/Library/Application Support/<identifier>` et `~/Library/Caches/<identifier>` (Tauri :
  `ui/app/src/runtime.rs:38-39`, store `desktop.json`), `~/.gemini`, `~/.codex`. Un seul usage native Apple correct : `ide_cmd.rs:635-655` (`dirs::config_dir`).
- PATH des apps lancées depuis le Finder/Dock/LaunchAgent : `/usr/bin:/bin:/usr/sbin:/sbin`. `broker::resolve_aphrody_bin` (`broker.rs:117-130`) retombe sur le nom nu `aphrody`
  (introuvable) si le sidecar n'est pas à côté de l'exécutable ; `compat/dotnet.rs:26-29` ne teste que `/usr/bin/dotnet` et `/usr/share/dotnet` (pas
  `/usr/local/share/dotnet`, pas Homebrew) ; `terminal-backend/lib.rs:80-96` : `$SHELL` sinon `/bin/bash` (3.2) et pas de shell de connexion (donc pas de `brew shellenv` de `.zprofile`).
- `ide_cmd.rs:247-253` : `/Applications/Antigravity IDE.app/Contents/Resources` ; correct pour un `.app` standard.

### MAC-13 [BASSE] Différences de comportement
- Politique de chemins de `aphrody-sandbox` (`sandbox/policy.rs:163,168`, `patch_guard.rs:19` : comparaison octet par octet de `.git`/`.aphrody`, normalisation lexicale `policy.rs:188`) :
  sur APFS (insensible à la casse par défaut, NFC/NFD équivalents) elle ne reconnaît pas `.GIT` ni un nom Unicode décomposé. **Classé « voulu (YOLO) » / « revendication à aligner »** :
  aucune politique restrictive n'est souhaitée et la bibliothèque n'est branchée nulle part (OS-02). Aucun durcissement n'est proposé ; si le crate reste comme vérificateur déclaratif,
  sa documentation (`is_path_writable`, policy.rs:140-150) doit dire qu'il est sensible à la casse et ne canonise pas, pour ne pas laisser croire à une garantie.
- RLIMIT_NOFILE (fiabilité, borne anti-crash) : jamais relevé (`rg RLIMIT_NOFILE|raise_fd_limit` = 0, seul `RLIMIT_CORE` dans `guard/harden.rs:159-163`). La limite douce par défaut des processus macOS est 256 ;
  le noyau accepte des connexions sans plafond (OS-07) et `aphrody-terminal` ouvre 3 fils + fds par session (T-05) : `EMFILE` précoce (échecs de `accept`, de `spawn`, de pty). Relever la limite douce au démarrage (`setrlimit`, jusqu'à `OPEN_MAX`/limite dure) et borner les connexions. `notify 8.2.0` : la feature par défaut `macos_fsevent`
  (FSEvents, pas de fd par fichier) est active (`Cargo.toml:200` n'a pas désactivé les défauts) : bon ; ne pas passer à `macos_kqueue`.
- `fork` : `proc/unix.rs:22,39` et `sandbox/unix.rs:73` utilisent `pre_exec` ⇒ `fork`+`exec` (pas `posix_spawn`). Les fermetures n'appellent que `setsid` (rustix, async-signal-safe), pas
  d'allocation : acceptable dans un hôte multi-thread (Bun/tokio/V8). Aucun `fork()` direct ni `daemon()` (rg).
- `guard/harden.rs:116-135` (`harden_macos`) : `ptrace(PT_DENY_ATTACH)`, `RLIMIT_CORE=0`, suppression de `DYLD_*` : correct et compilable (libc 0.2.189 `apple/mod.rs:2161,4681`) ; effet : `lldb`/`sample`/Instruments ne
  s'attachent plus (voulu) ; sous un débogueur déjà attaché le processus se termine. Activé seulement avec `APHRODY_GUARD=1` et jamais dans la cdylib (bon).
- obscura-cdp : `mallopt`/`malloc_trim` sont derrière `target_env = "gnu"` (`server.rs:652-690`, `Cargo.toml:34`) : sans objet sous macOS (libmalloc), correct.
- `mimalloc` (CLI, ffi, app) : `local_dynamic_tls` ; `libmimalloc-sys` compile du C avec Xcode CLT requis ; sans autre incidence relevée.

### MAC-14 [BASSE] `aphrody-native`, modèles et ONNX Runtime sous macOS
- `topology.rs:100-103` : `probe_memory()` → `None` hors Windows/Linux/Android : `memory_total_mb = memory_available_mb = 0`, `cuda` : repli `None` (`cuda.rs:171`) : aucun chiffre Apple
  (ni mémoire unifiée, ni GPU). `native self-test` passe en affichant « 0 MiB memory » (`pillars_cmd.rs:75-77`). `ui/app/models.rs:281-284` traduit 0 en `null` (bon).
- `ai/models/accel.rs:243-245` annonce `Accelerator::Metal` pour tout macOS, sans sonde ; `gpus` reste vide (seul `nvidia-smi` est interrogé) ; les recommandations de modèles
  n'ont donc ni VRAM ni RAM sur Apple Silicon.
- `ort =2.0.0-rc.12` : `ort-sys/build/download/dist.txt` ne fournit de binaire préconstruit que pour `aarch64-apple-darwin` (variantes `none`, `wgpu`) ; aucun `x86_64-apple-darwin`. Les
  fonctions `magika` (défauts `ort` = `download-binaries`) échoueraient à la construction pour la cible `x86_64-apple-darwin` listée dans `rust-toolchain.toml:16`. `aphrody-infer`
  active `cuda`, `directml` mais pas `coreml` (`infer/Cargo.toml:32`).
- `native` est `publish = true` (`Cargo.toml:15`) : le contrat publié ne documente pas l'absence de mémoire sous macOS.

### MAC-15 [BASSE] Pont Swift de `aphrody-drive` (code dérivé Spacedrive, FSL, non compilé)
- `ui/drive/build.rs` : `#[cfg(target_os = "macos")]` y teste l'hôte, pas la cible, alors que `Cargo.toml:30-31` conditionne `swift-rs` en `[target.'cfg(target_os = "macos")'.build-dependencies]`
  (évaluation sur la cible dans les builds croisés) ; en croisé Linux→apple le pont Swift n'est pas lié, en croisé macOS→Linux le build script ne compile pas. `MACOSX_DEPLOYMENT_TARGET`
  par défaut 11.0 (build.rs) alors que Rust vise 10.12 pour `x86_64-apple-darwin` [P] : avertissements d'éditeur de liens.
- `service.rs:228-231` : `launchctl unload`/`load` (interfaces historiques ; `bootstrap`/`bootout` recommandés) ; le plist échappe correctement le XML (`xml_escape`) : à garder.

## 4. Ce qui est correct et à garder (vérifié)

- Compilables sous macOS (libc/rustix relus) : `aphrody-proc` (`unix.rs` : setsid/killpg/kill-0 via rustix ; PDEATHSIG sous `target_os="linux"`), `aphrody-guard` (`harden_macos`),
  `aphrody-stdio-capture` (dup/dup2 POSIX), `aphrody-kernel`/`kernel-client` (UnixListener tokio), `aphrody-search`/`fsindex` (stubs hors Windows), `aphrody-capture` (stubs `Unsupported`),
  `aphrody-winclean` (procfs sous `target_os="linux"` + stub), `aphrody-coreutils`, `aphrody-compat`, `aphrody-systemd` (émulation), `aphrody-base`, `aphrody-native` (repli), `aphrody-terminal-backend` (portable-pty).
- `web-bridge/resolve.rs:66-91` : noms `.dylib` via `target_vendor = "apple"` ; `infer/runtime.rs:28-33` : `libonnxruntime.dylib`.
- Stockage temporaire par utilisateur : `std::env::temp_dir()` + modes 0700/0600 (`web-bridge/actors.rs:162-215`, `tauri-wrap/debug.rs:178-198`) : bon modèle pour le socket noyau.
- `rookie-cookies` : Trousseau natif, échéance bornée. `notify` : FSEvents. `autostart` : LaunchAgent. `global-hotkey` : Carbon sans TCC.
- Politique `computer_use` : repli `Browser` ; pas d'image vide en cas d'API absente.
- `tokio::net::UnixStream::peer_cred()` fonctionne sous macOS (tokio 1.53.1 `ucred.rs:294-325`) : remplaçant direct de `SO_PEERCRED`.
- Voulu (YOLO), non traité comme défaut : exposition de `tauri_execute_js`/`tauri_interact`/`clipboard_*` par l'app ; `harden_macos` opt-in (`APHRODY_GUARD=1`, jamais dans la cdylib) ;
  `SandboxMode::DangerouslyBypass` ; absence de toute confinement/approbation sous macOS.

## 5. Matrice des crates tierces (item 8)

| Crate (usage dans le dépôt) | État Cargo.lock | Support macOS (source lue) | Remarque |
|---|---|---|---|
| arboard 3.6.1 (tauri-plugin-clipboard-manager, nu-command) | présent | oui (objc2-app-kit, NSPasteboard) | invite pasteboard possible macOS 15.4+ [P] |
| global-hotkey 0.8.0 (tauri-plugin-global-shortcut) | présent | oui (Carbon ; CGEventTap pour touches média) | fil principal obligatoire ; pas de TCC pour touches ordinaires |
| tray-icon 0.25.1 + muda 0.20.0 (tauri) | présent | oui (NSStatusItem, fil principal) | `icon_as_template` non utilisé (MAC-07) |
| rfd 0.16.0 / 0.17.2 (tauri-plugin-dialog fork `upstream/`, koharu) | présent | oui (NSOpenPanel) | dialogues bloquants à ne pas lancer depuis le fil principal |
| notify-rust 4.17.0 + mac-notification-sys 0.6.9 (tauri-plugin-notification) | présent | oui (NSUserNotification, déprécié) | identifiant de bundle requis |
| portable-pty 0.8.1 (terminal-backend) | présent | oui | pas de PDEATHSIG (T-12/T-15) ; shell non-login |
| interprocess | ABSENT | — | non nécessaire : tokio UnixListener / pipes nommés directs |
| directories | ABSENT (dirs 4.0.0, 5.0.1, 6.0.0, 7.0.0 présents) | oui (`Library/Application Support`) | 4 versions de `dirs` ; non utilisé pour l'état (`~/.aphrody`) |
| sysinfo 0.38.0 / 0.39.6 | présent | oui (mach/IOKit) | aucun entitlement nécessaire |
| cpal | ABSENT | — | aucune capture/sortie audio native : pas de clé micro côté Rust |
| notify 8.2.0 / 9.0.0-rc.5 | présent | oui (FSEvents par défaut) | garder les features par défaut |
| keyring 4.2.0 (+ apple-native-keyring-store, security-framework 3.7.0) | présent (koharu-secrets) | oui | pas utilisé par `aphrody-secrets` (MAC-11) |
| trash, ctrlc, xcap, scrap, enigo, rdev, accessibility, screencapturekit | ABSENT | — | aucun backend de capture/entrées macOS |
| ort 2.0.0-rc.12 | présent | aarch64-apple-darwin seulement (dist.txt) | pas de binaire x86_64-apple-darwin (MAC-14) |
| whisper-rs 0.16.0 (aphrody-voice, optionnel) | présent | CPU (`metal`/`coreml` non activés) | [P] |
| wry 0.57.0 / tao 0.37.1 / tauri 3.0.0-alpha.3 | présent | oui (WKWebView, objc2) | limites MAC-07/MAC-10 |
| wgpu 29.0.3 + 30.0.1, wgpu-hal metal, raw-window-metal 1.1.0 | présent | oui (Metal) | MAC-06 |
| rookie-cookies 0.6.0 | présent | oui (Trousseau « Safe Storage ») | à garder |

## 6. Recommandations priorisées (cadre YOLO : aucune ne demande confinement, approbation ou politique restrictive)

1. **MAC-01 (authenticité du canal)** : retirer `/tmp` comme défaut sous macOS ; socket dans un répertoire 0700 par utilisateur (`$TMPDIR` ou Application Support) ; `peer_cred()` (tokio)
   comparé à `geteuid()` côté client ET côté serveur avant `initialize`/`register_subsystem` ; l'app ne « rejoint » un noyau que s'il appartient à l'utilisateur courant (le moyen d'éviter un
   faux noyau qui récupérerait les outils de l'app). Même correctif pour single-instance (chemin sous `$TMPDIR` ou verrou fichier dans le répertoire de données).
2. **MAC-05 (portabilité, chaîne d'approvisionnement)** : trancher la politique macOS. Non-objectif : retirer `aarch64-apple-darwin`/`x86_64-apple-darwin` de `rust-toolchain.toml:15-16`
   et le dire dans ARCHITECTURE.md. Objectif : gate `cargo check --workspace --target aarch64-apple-darwin` sur runner macos-14, puis `aphrody-ops tauri` macOS avec `bundle.macOS`
   (entitlements de fonctionnement : `allow-jit`, `disable-library-validation` ; `Info.plist` ; `.icns` ; signature stable ; notarisation ; sidecars `aphrody-<triple>`).
3. **MAC-09 (lacune fonctionnelle)** : s'il faut que l'agent pilote un Mac, ajouter un backend macOS (ScreenCaptureKit, `CGEvent`, `AXUIElement`) avec des erreurs distinctes
   « non supporté » / « permission TCC refusée » et les clés `Info.plist` correspondantes ; sinon documenter que macOS n'a que le mode `Browser`. Générer `Info.plist`/entitlements
   pour caméra/micro dans web-to-tauri quand le signal `media-devices` est détecté.
4. **MAC-04 (provenance du chargeur)** : dans `bun-native.ts`, ajouter `codesign --verify --strict` et l'identité/empreinte de signature au manifeste, la liste `otool -L`/`LC_RPATH`, un
   build natif par architecture (hôte Intel ou `--target` explicite), la documentation `xattr -d com.apple.quarantine`, et un test `dlopen` sous un Bun signé en Hardened Runtime (JIT V8).
5. **MAC-06 (fonction inutilisable)** : sur Metal choisir `PostMultiplied` (le rendu prémultiplié est ce que CoreAnimation attend) ; placer la sous-couche sous le WKWebView ou rendre dans
   une fenêtre fille ; garder la création de surface sur le fil principal (`run_on_main_thread`) quand G8 sera corrigé ; valider sur machine (alpha, ordre, HiDPI).
6. **MAC-02 / MAC-03 (exactitude des revendications)** : garder `prctl` sous `target_os = "linux"` pour que `aphrody-sandbox` compile ; `probe()` doit renvoyer `Unavailable` sous macOS ;
   corriger la description du crate et docs/ecosystem. Ne pas porter seatbelt.
7. MAC-07/08/10 (fiabilité et parité) : `ActivationPolicy::Accessory` pour `--autostart`, gestion de `RunEvent::Reopen`/`Opened` (via `classify_args`), `icon_as_template`, raccourci par
   défaut macOS, popups de tauri-wrap documentés ou remplacés par une fenêtre Tauri gérée sous macOS ; MAC-11 : backend `KeychainSecretStore` (keyring + apple-native) et 0600/`create_new`
   pour `FileSecretStore` ; MAC-13 : relever `RLIMIT_NOFILE` au démarrage et plafonner les connexions.

## 7. À vérifier sur une machine macOS (non exécutable ici)

`cargo check --workspace --target aarch64-apple-darwin` (attendu : échec `aphrody-sandbox` seul dans le périmètre) ; `codesign -dvvv --entitlements -` et `spctl` sur la dylib et sur Bun ;
`otool -L`/`-l` de `libaphrody_ffi.dylib` ; lancement de `aphrody-model-view` (alpha, ordre des couches) ; `lsof -U` du socket `/tmp/aphrody-os-*.sock` et permissions ; clic Dock après fermeture
de la fenêtre principale ; ouverture d'un `.md` par « Ouvrir avec » ; `Alt+Space` sous macOS 14/15/26 ; `launchctl print` du LaunchAgent d'autostart.

## 8. NON EXAMINÉ

- Aucune exécution : pas de compilation croisée, pas de Mac ; tous les [P] restent à confirmer (ordre des couches CALayer, comportement dyld, Gatekeeper/quarantaine, TCC pasteboard,
  RegisterEventHotKey sous macOS 15, install_name rustc).
- Binaire Bun officiel (entitlements réels), `libaphrody_ffi.dylib` (inexistante), Info.plist généré par Tauri, `.app`/`.dmg`.
- Code Swift de `crates/ui/drive/macos/{desktop,file-opening}` et `src/drag`, `src/file_opening/macos.rs`, `src/files.rs` macOS ; `crates/os/drive` (exclu du workspace) ; `crates/koharu/*` (importé, seuls
  `tauri.macos.conf.json`, `Entitlements.plist` et `koharu-secrets` lus) ; `upstream/*` ; runtime CEF (`tauri-runtime-cef`, non qualifié selon PLAN.md).
- `tauri-plugin-dialog` (fork `upstream/`), `tauri-plugin-updater` sous macOS (signature `.app.tar.gz`), `tauri-plugin-store`/`window-state` sous macOS.
- `aphrody-voice`/whisper-rs (Metal/CoreML), shaders WGSL → MSL (limites Naga/Metal), `llama.cpp` (Metal), `ffmpeg`, `aphrody-ocr`.
- `crates/ai/*` hors fichiers cités (stockage de jetons mcp-oauth, gemini-web), `crates/web/*` hors web-chromium/web-bridge/obscura-cdp, `crates/infra/*` (ssh, vpn : `vpn_cmd.rs` macOS lu en grep seulement),
  `apps/shenron`, `apps/rg`, scripts de déploiement.
- Windows et Linux (axes des vagues 1 et 2 parallèles) ; Spotlight/Time Machine/iCloud ; Rosetta ; macOS 26 (Tahoe) : aucun comportement propre à cette version n'a pu être confirmé hors ligne.
