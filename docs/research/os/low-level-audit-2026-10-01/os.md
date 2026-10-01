# Audit axe « os » — couche système bas niveau (crates/os)

Date : 2026-10-01. Niveau de preuve global : P1 (statique, lecture seule, aucun cargo/rustc/bun).
Tags : [V] vérifié dans le code lu, [P] plausible / non reproduit. `drive/` (FSL, hors workspace) exclu.

Note de méthode : une étape de ma lecture (crates/os/base : le module de manipulation de processus
distants et les helpers de déchiffrement de profils) a été interrompue par un classifieur de sécurité.
Je ne l'ai pas poursuivie et ne la décris pas : elle est listée dans NON EXAMINÉ. Seuls `Vfs` et
`ProcessManager` de `base/src/lib.rs` ont été analysés.

---------------------------------------------------------------------------------------------------

## 0. Périmètre réellement lu

| Crate | Fichiers / lignes lus |
|---|---|
| kernel | `transport.rs` 1-282, `rpc.rs` 1-439, `lib.rs` 1-511, `auth.rs` 1-148, `policy.rs`, `audit.rs`, `remote.rs` 1-190, `client.rs` 1-268, `main.rs` 1-392, `mcp_proxy.rs` 18-300 et 415-436, `infra.rs` 76-150 et 340-420, `cloud_gcs.rs` 1-160 (+ greps `cloud*.rs`, `admin.rs`) |
| kernel-client | `src/lib.rs` 1-363 |
| proc | `lib.rs`, `group.rs`, `unix.rs`, `windows.rs`, `lock.rs`, `port.rs` (entiers) ; `lease.rs` par grep |
| sandbox | `lib.rs`, `unix.rs`, `windows.rs`, `runner.rs`, `capability.rs`, `policy.rs`, `patch_guard.rs` (entiers) ; `denial.rs` non lu |
| execpolicy | `lib.rs`, `policy.rs` 1-200, `rule.rs` 1-140, `parser.rs` 1-200, `decision.rs` 1-50 |
| guard | `harden.rs`, `lib.rs` 1-45, `command_safety.rs` 1-640 |
| secrets | `src/lib.rs` 1-700 |
| stdio-capture | `src/lib.rs` (entier) |
| systemd | `manager.rs` (entier), `lib.rs` 1-60, greps `unit.rs`/`subsystem.rs` |
| jobs | `lib.rs`, `log.rs` 60-140, `store.rs` 120-175 + greps |
| events | `lib.rs` 396-486 + greps ; settings, cron, task-runner, telemetry, fsindex (hors Everything) : greps ciblés seulement |
| backend | `src/lib.rs` (entier) |
| coreutils | `subsystem.rs` 1-420 |
| compat | `wine_proton.rs` 60-146, `pwsh.rs` 40-85, `dotnet.rs` 60-94 |
| search / fsindex | `search/everything.rs` 296-420, 470-520, 630-700 ; `fsindex/everything.rs` par grep |
| re | échantillons ciblés `minidump.rs` (parsing borné), `golang.rs`, `electron.rs` |
| capture (hors liste) | `capture_impl.rs` 96-445 |
| winclean (hors liste) | sites `from_raw_parts` (services, tcp, clipboard) |
| a2a-* | sous-agent fork (voir sa liste dans la section 8) + relectures personnelles : `a2a-server/env.rs` 140-185, `a2a-coord/listener.rs` 55-90 et 125-155, `executor.rs` 55-110, `peer.rs` 250-312, `apps/cli/src/commands.rs` 244-247 |
| docs | `ARCHITECTURE.md`, `ARCHITECTURE-GAPS.md`, `ARCHITECTURE-GAPS-STATUS.md` (entiers) |
| état machine (ls/stat/proc, lecture seule) | `/run/user/1000` (sockets), `/proc/net/unix`, modes de `~/.aphrody` (aucun contenu de secret lu) |

Grille : agents `security-engineer`, `rust-architect`, `asm-lowlevel-engineer`, `cargo-auditor`, `win32-expert` ;
skills `rust-best-practices-2026`, `rust-async-patterns`, `a2a-protocol`, `winclean`.

---------------------------------------------------------------------------------------------------

## 1. Tableau des constats (les plus graves d'abord)

| ID | Sév. | chemin:ligne | Constat | Niveau |
|---|---|---|---|---|
| OS-01 | CRITIQUE | `a2a-coord/src/listener.rs:71-92,134-139` ; `executor.rs:60-75` ; `peer.rs:265-306` | Listener HTTP A2A/coord sans aucune authentification : un message choisit le pair et devient le prompt d'un CLI d'agent lancé avec `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` / `--permission-mode bypassPermissions`. stdout/stderr renvoyés à l'appelant. | [V] |
| OS-02 | HAUTE | `sandbox/src/unix.rs:14-84` ; `capability.rs:356-382` ; `runner.rs:167-175` | Sandbox Linux nominal : ni Landlock ni seccomp, seulement `PR_SET_NO_NEW_PRIVS` + `setsid`. `probe()` annonce néanmoins `Enforced` pour filesystem ET réseau. Aucun consommateur dans le dépôt. Ne compile pas sur macOS/BSD (`libc::prctl`). | [V] |
| OS-03 | HAUTE | `kernel/src/transport.rs:62-82,238-276` ; `auth.rs:38-44` | Aucune authentification de pair (ni `SO_PEERCRED`, ni DACL de pipe) ; auth désactivée par défaut = scope `*` + enregistrement + publication ; repli `/tmp/aphrody-os-<user>.sock` prévisible, et aucun client ne vérifie le propriétaire du socket (usurpation du noyau, jeton envoyé à un faux serveur). | [V] |
| OS-04 | HAUTE | `guard/src/command_safety.rs:97,291-315,633-634` | Classifieur de commandes contournable (quand activé) : `env` allow-listé sans contrôle d'arguments (`env <cmd>` = Allow), répertoire du binaire ignoré (`./cat` = `cat`), PowerShell jugé sur le seul premier jeton. Garde désactivée par défaut (`APHRODY_GUARD`). | [V] |
| OS-05 | HAUTE (latent) | `a2a-server/src/rest.rs:109..328`, `jsonrpc.rs:37`, `handler.rs:532,637` ; `push/sender.rs:32-51` ; `task_store/inmemory.rs:88-97` | Auth a2a-server jamais branchée (ServiceParams vide, `user: None`) ; push notifications : SSRF (aucune validation d'URL, redirections suivies, N configs lentes bloquent la tâche) ; panique distante `pageToken` dans `InMemoryTaskStore::list`. | [V] |
| OS-06 | MOYENNE | `execpolicy/src/parser.rs:113,139-141,53-58` ; `policy.rs:94-99` ; `kernel/src/policy.rs:164-171` ; `kernel/src/lib.rs:414-417` | Politique fail-open au parsing (clé inconnue ignorée, `decision` omis ou mal orthographié = Allow ; `#` coupe les chaînes) ; le noyau n'évalue que le NOM de l'outil (argv à 1 élément) ; correspondance exacte sur `argv[0]` (pas de basename, chemins, `.EXE`, ordre des flags, `sh -c`). | [V] |
| OS-07 | MOYENNE | `transport.rs:135,238-276` ; `main.rs` (aucun signal) | Connexions illimitées et sans délai d'inactivité (64 MiB × N) ; `bind` puis `chmod 0600` (fenêtre) ; stale-cleanup supprime n'importe quel fichier existant au chemin ; aucun nettoyage à l'arrêt : 17 sockets orphelins observés dans `/run/user/1000`, aucun écouteur (`/proc/net/unix`). | [V] |
| OS-08 | MOYENNE | `rpc.rs:319-323,397-409,53-59` ; `audit.rs:204-218` ; `events/src/lib.rs:466-481` | « Audit durable » = événements du bus seulement : `tools/call`, `skills/run`, refus de scope/policy, échecs d'auth ne sont jamais publiés. `system/subscribe` sans contrôle de scope (lecture inter-principaux, payload complet des résultats d'`a2a/message`, aussi écrits dans l'audit). Fichier d'audit 0644, sans rotation ni chaînage. | [V] |
| OS-09 | MOYENNE | `secrets/src/lib.rs:371-385,581-616` | `FileSecretStore` : JSON base64 (pas chiffré) écrit via `tokio::fs::write` sans mode 0600, tmp prévisible suivant les symlinks, pas de fsync, fichier vide ⇒ magasin vide (perte silencieuse après crash) ; verrou par instance seulement ; pas de backend DPAPI/keyring. Observé : `~/.aphrody/credentials/antigravity.gm.token` en mode 777 (parent 700). | [V] / obs. |
| OS-10 | MOYENNE | `coreutils/src/subsystem.rs:287-340` ; `kernel/src/infra.rs:85-96,395-401` ; `mcp_proxy.rs:226-238` ; `sandbox/runner.rs:196` ; `a2a-coord/executor.rs:197-206` | Cycle de vie des processus : kill du seul chef (pas du groupe) sur timeout/annulation ; `coreutils_run` attend `read_capped` jusqu'à EOF après le kill (un petit-fils garde le pipe ⇒ blocage) ; `run_infra_cli` sans timeout ni `kill_on_drop` ; environnement hérité intégralement partout (aucun `env_clear`). | [V] / [P] |
| OS-11 | MOYENNE | `kernel-client/src/lib.rs:212-244` ; `kernel/src/transport.rs:117-120` | Client sériel : une notification (`tools/list_changed`, envoyée à toutes les sessions) reçue pendant l'attente d'une réponse provoque « response id does not match request » ; un timeout laisse la réponse non lue ⇒ flux décalé de façon permanente. Le `Client` Rust du noyau lit avec `.lines()` sans limite (`client.rs:97-100`). | [V] |
| OS-12 | MOYENNE | `search/src/everything.rs:642-660` ; `fsindex/src/everything.rs:301-313` | Windows : `Everything64.dll` chargée par nom nu (ordre de recherche standard : répertoire de l'application, CWD, PATH) avant le chemin `%ProgramFiles%` ; deux copies divergentes (`EVERYTHING_DLL` vs `APHRODY_EVERYTHING_DLL`). | [V] |
| OS-13 | MOYENNE | `stdio-capture/src/lib.rs:45-130` ; couverture SAFETY | `with_captured_stdio` : fn sûre qui redirige fd 1/2 globalement, sans verrou interne (le verrou est dans ffi seulement ; `apps/cli/src/lib.rs:2389` sans verrou) ; `dup` sans CLOEXEC. 211/385 sites `unsafe` de crates/os sans commentaire SAFETY voisin (heuristique). Invariants faux : `a2a-server/env.rs:160-162`. | [V] |
| OS-14 | BASSE | `sandbox/unix.rs:33` ; `capability.rs:319-362` ; `guard/harden.rs:71-94` ; `compat/*` | Portabilité : appels Linux-only sous `cfg(unix)` ; syscall 444 sur BSD ; `try_pre_main_hardening` sans bras pour les autres unix ; `which` manuel (`split(':')`). | [V] |
| OS-15 | BASSE | `systemd/src/manager.rs:187-258` ; `base/src/lib.rs:46-58` ; `backend/src/lib.rs:20-66` | `systemd` : start/stop ne font que changer un drapeau (aucun processus) ; `Vfs::resolve` ne neutralise pas `..` ni la frontière de point de montage ; `backend` télécharge `main` non épinglé sans empreinte. | [V] |

---------------------------------------------------------------------------------------------------

## 2. Promesses documentées vs code

| Promesse (docs/architecture/os) | Constat |
|---|---|
| GAPS-STATUS 1 : « sessions authentifiées configurables » | Existe et correct pour les sessions de `Client`/`KernelClient` (jeton dans `initialize`). Faux par défaut (`AuthPolicy::Disabled` ⇒ `SessionScope::unrestricted`, `auth.rs:18-25`). Le relais `aphrody-kernel mcp` copie stdin→socket sans injecter `APHRODY_OS_AUTH_TOKEN` (`main.rs:238-244`) : un client MCP standard ne peut pas s'authentifier (le jeton n'est lu que par `Client::initialize`, `client.rs:203-207`). Comparaison de jeton non constante (`auth.rs:132`) ; fichier de politique sans contrôle de permissions (`auth.rs:55-62`). |
| ARCHITECTURE : « `/tmp/aphrody-os-<user>.sock` (mode 0600) » | Vrai après coup seulement : `bind` (mode 0777 & ~umask) puis `set_permissions(0o600)` (`transport.rs:269-270`). Observé : `/run/user/1000/aphrody-os.sock` en `srw-------` (umask 0022). |
| ARCHITECTURE : « Windows … remote clients rejected » | `reject_remote_clients(true)` + `first_pipe_instance(true)` présents (`transport.rs:250-257`). Aucun `SECURITY_ATTRIBUTES` : DACL par défaut du pipe (lecture pour Everyone/anonymous selon la doc Win32 de `CreateNamedPipe`) ; l'affirmation « per-user » repose sur le nom `aphrody-os-<user>` [P]. |
| GAPS-STATUS 2 : « Restricted sandbox requests fail closed » | Vrai pour `SandboxedCommandRunner` (`runner.rs:167-175`). Mais `probe()` annonce `Enforced` et le crate décrit « Landlock/seccomp, Low-IL/Job Objects, seatbelt » : rien de tel n'est implémenté (`unix.rs`, `windows.rs:19-33`). `SandboxJob` (job KILL_ON_JOB_CLOSE) n'est jamais utilisé par le runner. Aucun consommateur de `aphrody-sandbox` ; `run_helper_if_requested` n'est appelé nulle part ; `aphrody-guard` consommé par `apps/cli/src/main.rs:25` et `agent-tools`, pas par le noyau (GAPS 2 reste vrai). |
| GAPS-STATUS 2 : « tool names évalués via execpolicy avant dispatch » | Vrai (`lib.rs:414-417`, `call_target:452-454`) et fermé par défaut (`Policy::new()` = Prompt ⇒ Forbidden sous `Never`). Limites : nom seulement ; politique optionnelle ; voir OS-06. |
| GAPS-STATUS 3 : backpressure | Implémenté par connexion (`transport.rs:21-25`) : 64 MiB, file de 8, 16 requêtes, 300 s. Manque : plafond de connexions, délai d'inactivité/auth. Le `Client` Rust n'a pas de limite de ligne. |
| GAPS-STATUS 5 : « pont NDJSON durable » | Pont réel (`audit.rs`). Contenu limité à 4 familles d'événements (OS-08) ; `flush()` tokio sans `sync_data`. |
| ARCHITECTURE : systemd « Ring-3 session supervisor … restart policy » | Simulation en mémoire : aucun `spawn`, `Restart=` parsé mais jamais appliqué (`manager.rs:187-258`, `unit.rs:151-158`). `resolve_order` = BFS inversé, pas un tri topologique (`manager.rs:166-203`). |
| ARCHITECTURE : infra « Global PATH → env → workspace → cargo run » | Le code est plus strict que la doc : `cargo run` seulement avec `APHRODY_INFRA_BUILD_FROM_SOURCE=1` (`infra.rs:98-103`). Mais `aphrody-ssh` est résolu par PATH avant le binaire voisin (`infra.rs:85-96`). Hôtes bornés à `vps`/`dbfr` (`infra.rs:382-387`) : à garder. |
| GAPS 9 : `backend` « succès malgré erreurs » | Corrigé : erreur agrégée (`backend/lib.rs:54-59`). |
| ARCHITECTURE : « Windows … Job Objects » | `proc/windows.rs` : réel et correct (voir section 4). |

---------------------------------------------------------------------------------------------------

## 3. Constats détaillés

### OS-01 [CRITIQUE] a2a-coord : exécution d'agents sans authentification [V]
- `listener.rs:71-92` : `jsonrpc_router`, `rest_router`, `/ping`, `/msg`, `/coord`, `a2a_router` fusionnés sans middleware.
- `executor.rs:60-75` : `resolve_peer` lit `metadata.aphrody_peer|peer` ou un préfixe `@pair` dans le texte ; `prompt_from_message` (77-102) fait du texte le prompt.
- `peer.rs:276-306` (lu) : `agy -p <prompt> --dangerously-skip-permissions`, `claude -p … --dangerously-skip-permissions`, `codex exec --dangerously-bypass-approvals-and-sandbox … <prompt>` ; `peer.rs:258-270` : `grok --prompt-file … --always-approve --permission-mode bypassPermissions`.
- Bind : `TcpListener::bind(cfg.bind)` (`listener.rs:134-139`), valeur par défaut loopback `127.0.0.1:8788`, aucune garde contre `--bind 0.0.0.0` (`commands.rs:244-247`). Un TCP loopback est joignable par TOUS les utilisateurs locaux (contrairement au socket 0600 du noyau) ; pas de contrôle de `Host` ⇒ DNS rebinding [P] (les routes JSON exigent `Content-Type: application/json`, pas de CORS).
- Impact : exécution de code avec les droits de l'utilisateur et fuite de ce que l'agent imprime. Prompt de grok écrit dans `temp_dir()/aphrody-grok-<pid>.txt` (0644, jamais supprimé, `fs::write` suit les symlinks) : `peer.rs:258-260`.
- Correct : pairs choisis dans un `enum` fermé, `Command` sans shell, prompt en argument unique (`peer.rs`).

### OS-02 [HAUTE] Sandbox : nominal, mal rapporté, non branché [V]
- `unix.rs:33-37` : seul `prctl(PR_SET_NO_NEW_PRIVS)` puis `execvp` (53-55) ; `configure_command` (68-84) = `setsid` ; `_policy` ignoré. Les blocs `unsafe` n'ont pas de SAFETY.
- `capability.rs:356-382` : `syscall(444, NULL, 0, 0)` ; EFAULT ⇒ `Enforced` pour filesystem ET network avec le détail « Landlock + seccomp filter supported ». La détection du noyau est exacte (le noyau renvoie EFAULT quand `attr` est NULL après le contrôle d'initialisation), mais rien n'applique de règle. Tout appelant qui se fie à `is_enforced()` croit à une isolation inexistante. Le test `sandbox_invariants.rs:14-16` n'asserte que `is_available()`.
- `windows.rs:19-33` : seulement `CREATE_NEW_PROCESS_GROUP` ; `probe_windows` annonce « Restricted Token + Low-IL + Job Object » sans token restreint, sans niveau d'intégrité bas, et le job n'est pas assigné.
- `policy.rs:187-203` : `normalize_path` ne résout pas les symlinks (documenté) ⇒ un lien dans la racine pointant dehors est « inscriptible » ; racine relative : `..` écrasé sans sortir (`out.pop()` sur vide) ⇒ `../../etc/x` accepté sous la racine `.` ; comparaisons sensibles à la casse (`.GIT` sur Windows), pas de normalisation 8.3/ADS/point final.
- Portabilité : `libc::prctl`/`PR_SET_NO_NEW_PRIVS` n'existent que pour Linux/Android/Fuchsia/L4Re (libc 0.2.189 source) alors que le module est sous `cfg(all(unix, not(wasm32)))` ⇒ erreur de compilation sur macOS/*BSD.
- Mise en œuvre actuelle correcte : le runner refuse tout mode restreint (`runner.rs:167-175`) ; fail-closed à garder.

### OS-03 [HAUTE] IPC noyau : pas d'authentification de pair [V]
- Aucune occurrence de `peer_cred`, `SO_PEERCRED`, `GetNamedPipeClientProcessId`, `SECURITY_ATTRIBUTES` dans crates/os (rg).
- `auth.rs:38-44,126-136` : `Disabled` par défaut ⇒ chaque connexion reçoit `SessionScope::unrestricted()` (outils `*`, `register_subsystems`, `publish_events`). Tout processus du même utilisateur accède à `admin` (166 outils WinClean), `infra_exec` (commande arbitraire sur la production `vps`/`dbfr`), `coreutils_run`, `compat_*`. Documenté (GAPS 1), mais le défaut reste « tout autorisé ».
- `transport.rs:76-81` / `kernel-client/src/lib.rs:104-108` : si `XDG_RUNTIME_DIR` est absent, `/tmp/aphrody-os-<user>.sock`. Dans un `/tmp` collant, un autre utilisateur peut créer le chemin en premier. Le serveur légitime refuse alors de démarrer (`AddrInUse`, 241-246) ; les clients (`Client::connect`, `KernelClient::connect`) se connectent au faux serveur sans vérifier propriétaire/mode : ils lui envoient `APHRODY_OS_AUTH_TOKEN` (`client.rs:203-207`) et acceptent des résultats d'outils falsifiés (injection de prompt). `USER` est lu depuis l'environnement, pas l'uid.
- Windows : `ServerOptions::…create(endpoint)` sans descripteur de sécurité explicite (`transport.rs:250-257`).
- Observé sur la machine : `XDG_RUNTIME_DIR=/run/user/1000` (0700), socket en 0600 ⇒ la configuration actuelle est saine ; le défaut est dans le repli et dans l'absence de vérification côté client.

### OS-04 [HAUTE] guard : contournements (quand `APHRODY_GUARD=1`) [V]
- `command_safety.rs:97` : `"env"` dans la liste de lecture seule sans contrôle des arguments ⇒ `["env","rm","-rf","/"]` : `exec_is_dangerous` ne regarde que `cmd0` (409-455) et `is_safe_to_call_with_exec` renvoie `true` ⇒ `Allow`. Même famille : `sort --compress-program=…`, `sort -o`, `uniq in out`, `date -s`, `hostname X` (écritures/exécution), `printenv`/`ps e` (fuite d'environnement).
- `633-634` : `rsplit(['/','\\'])` supprime le répertoire : `./cat`, `/tmp/x/git status` sont traités comme les outils sûrs (binaire du dépôt exécuté).
- `291-315` : `["pwsh","-Command","Get-ChildItem",";","Remove-Item",…]` ⇒ `rest.first()` = `Get-ChildItem` ⇒ sûr ; pwsh concatène les arguments ⇒ exécute les deux. L'outil `shell` d'agent-tools passe l'argv tel quel (`crates/ai/agent-tools/src/shell.rs:195-225`).
- Posture par défaut : `classify_command_enforced` renvoie `Allow` pour tout si `APHRODY_GUARD` n'est pas défini (`command_safety.rs:59`, test 760 : `rm -rf /` ⇒ Allow). Cohérent avec la doctrine « autonome », mais = aucune garde par défaut.
- `harden.rs` : correct pour les enfants ; le retrait de `LD_*` après le démarrage ne protège pas le processus lui-même (le chargeur a déjà traité `LD_PRELOAD`) alors que la doc dit « us or our children » (`harden.rs:12-13`). Le commentaire SAFETY de `remove_var` est valide : appelé en première instruction de `main` (`apps/cli/src/main.rs:25`). Windows : no-op.

### OS-05 [HAUTE latent] a2a-server [V] (relevé par le fork, confirmé en partie)
- Auth : `ServiceParams::new()` vide dans `rest.rs` (109,124,142,186,210,243,276,287,300,317,328) et `jsonrpc.rs:37` ; `user: None` (`handler.rs:532,637`) ; `AuthUserBuilder` sans appelant ; `InterceptedHandler` n'implémente pas `RequestHandler`. Un jeton inconnu donne `Ok(None)` (anonyme), pas un rejet (`auth.rs:111`).
- SSRF : `push/sender.rs:50-51` `client.post(&config.url)` ; `push/store.rs:49-51` vérifie « non vide » ; client avec timeout seul (`sender.rs:32-35`) ⇒ redirections suivies, pas de blocage loopback/RFC1918/169.254.169.254, pas de contrôle post-DNS. Envoi inline et séquentiel (`handler.rs:166-181`) ; nombre de configs non borné. Non exposé aujourd'hui : le listener a2a-coord n'appelle pas `with_push_config_store`.
- `inmemory.rs:88-97` : `tasks[start..end]` sans garde sur `start` issu de `pageToken` ⇒ panique atteignable depuis le listener (OS-01). `fs.rs:209` a la garde.
- Chemin de tâche (`fs.rs:43-47,71-76`) : regex `^[A-Za-z0-9_-]{1,128}$` à chaque entrée ⇒ pas de traversée (à garder). Pas de fsync, pas de 0600, un fichier corrompu fait échouer `list`.
- `env.rs:149-168` (relu) : `load_environment` applique un `.env` trouvé en remontant l'arborescence ; seules 4 clés `APHRODY_*` sont protégées ; `PATH`, `LD_PRELOAD`, `HTTPS_PROXY` écrasables. Commentaire SAFETY « single-threaded startup » faux : appel depuis `#[tokio::main]` (`crates/ai/mcp/src/main.rs:3546,3588-3591`, hors périmètre).
- a2a-client : `factory.rs:89-90` suit `iface.url` de la carte ; `AuthInterceptor` (`auth.rs:175-177`) joint le jeton à tout hôte ; `reqwest::Client::default()` sans timeout ni limite de corps. a2a-grpc : seulement un `GrpcHandler`, ni serveur ni auth ni TLS serveur ; pas de consommateur hors tests.
- a2a-coord : `mailbox.rs:42-50` (`inbox-from-{peer_short}.jsonl`, `peer_short` issu du réseau, non validé) : traversée possible sous Windows [P] (Linux la bloque par accident : ENOENT) ; `claims.rs:238-268` (composants `Normal`, rejet des symlinks, noms hexadécimaux) : à garder.

### OS-06 [MOYENNE] execpolicy [V]
- `parser.rs:111-141` : `decision` par défaut `Allow` (113) ; clé inconnue ignorée silencieusement (139-141). `prefix_rule(pattern=["infra_exec"], decison="forbidden")` ⇒ règle Allow. Aucun avertissement.
- `parser.rs:53-58` : `strip_comments` coupe à `#` même dans une chaîne.
- Le noyau évalue `[tool]` (`kernel/policy.rs:165`) : seules les règles à 1 jeton peuvent correspondre (`rule.rs:56-58`).
- Pour un usage argv futur : `policy.rs:94-99`/`rule.rs:63` ne comparent que `argv[0]` exact (après suppression de `.exe` minuscule) : `/bin/rm`, `RM.EXE`, `env rm`, `rm -fr` vs `rm -rf`, `sh -c` passent.
- À garder : défaut `Prompt`→`Forbidden` sous `ApprovalPolicy::Never` (fail-closed), règle « plus sévère gagne » (`policy.rs:111-123`), validation des exemples.

### OS-07 [MOYENNE] Cycle de vie du socket / DoS local [V]
- `transport.rs:272-275` : `tokio::spawn(serve_connection(...))` sans limite ; `read_line_limited` accepte jusqu'à 64 MiB par connexion (`Vec` à doublement ⇒ jusqu'à 128 MiB transitoires) ; aucune expiration pour une session non authentifiée.
- `266-270` : `path.exists()` puis `remove_file` : supprime tout fichier (non-socket compris) au chemin de `--socket`/`APHRODY_OS_SOCKET` si personne ne répond ; deux noyaux lancés simultanément peuvent se supprimer le socket (pas de fichier verrou : `aphrody_proc::FileLock` existe).
- Aucun nettoyage à l'arrêt : pas de `Drop`, ni `ctrl_c`/`signal` dans le crate (rg). Observé : `/run/user/1000/aphrody-os.sock` (05:03) et 16 `aphrody-os.sock-test-<pid>` orphelins, `grep -c aphrody-os /proc/net/unix` = 0.
- À garder : la limite de ligne vérifiée avant l'ajout, 16 requêtes en vol, file sortante de 8, timeouts 300 s/10 s, annulation à la déconnexion, réponses aux appels du noyau traitées hors permis (`transport.rs:149-153`).

### OS-08 [MOYENNE] Audit et diffusion [V]
- Publications sur le bus : `rpc.rs:319` (`a2a/message`), `429` (`system/publish`), `lib.rs:320,333,356` seulement.
- `rpc.rs:319-323` : `payload: {"target","tool","result"}` ⇒ résultat complet d'outil (captures d'écran, secrets affichés) copié sur le bus et dans le NDJSON. `source` fourni par l'appelant (`rpc.rs:292`) : l'audit ne porte pas le principal.
- `rpc.rs:397-409` + `53-59` : tout principal authentifié s'abonne à `kinds: []` (tout) sans contrôle de scope ; un principal limité à `get_` lit donc les résultats d'`a2a/message` d'un autre.
- `events/src/lib.rs:466-481` : ouverture/fermeture par événement, `create(true).append(true)` sans mode, `flush` (pas `sync_data`), pas de rotation.

### OS-09 [MOYENNE] secrets [V]
- Positif : `SecretValue` zeroize-on-drop, `Debug`/`Display` rédigés, AES-256-GCM + Argon2id (19 MiB, t=2, p=1), sel et nonce frais à chaque écriture ⇒ pas de réutilisation de nonce, `Zeroizing` pour la clé dérivée ; `KernelClient` `ClientOptions` masque le jeton dans `Debug`.
- `lib.rs:377-385` (`FileSecretStore::save`) et `581-616` (`save_map`) : `tokio::fs::write(&tmp)` sans `mode(0o600)` ni `create_new`, puis `rename` sans `sync_all` ; `tmp` = `<fichier>.json.tmp` / `.enc.tmp` prévisible ; répertoire parent créé avec l'umask.
- `lib.rs:371` : `bytes.is_empty()` ⇒ magasin vide ; un `rename` après crash sans fsync peut produire un fichier vide, et le `set` suivant écrase tout.
- Verrou `tokio::Mutex` par instance : deux processus ou deux instances sur le même chemin perdent des mises à jour (`aphrody_proc::FileLock` non utilisé).
- Valeurs en clair non zeroizées : `BTreeMap<String,String>` base64 de `load()`/`load_map()`, `Vec` du déchiffrement ; `expose_secret()` renvoie `""` pour des octets non UTF-8 (`lib.rs:~155`) ; `constant_time_eq` sans barrière de compilation et longueur tronquée à u32 ; paramètres KDF lus dans le fichier avant authentification (DoS mémoire par `m_cost`).
- Aucun backend DPAPI / trousseau dans les crates audités (rg `CryptProtectData|keyring|libsecret|SecretService` : seul `base/src/lib.rs`, non examiné).
- Observé (modes seulement) : `~/.aphrody` 0700 mais `credentials/` 777, `credentials/antigravity.gm.token` 777, `secrets/` 777, `drive/secrets.redb` 777 ; la protection ne tient que par le parent 0700 (perdue par copie, sauvegarde ou exposition \\wsl$). L'origine (outil externe) n'est pas dans crates/os.

### OS-10 [MOYENNE] Processus enfants [V sauf mention]
- `coreutils/subsystem.rs:287-299` : `tokio::process::Command` + `kill_on_drop(true)` : tue le seul PID. Sur timeout (321), `child.kill()` ne tue pas les descendants ; `stdout_task`/`stderr_task` (`read_capped`, lecture jusqu'à EOF, 70-86) sont attendus ensuite (334-345) ⇒ un descendant détaché garde le pipe ouvert et la requête dure jusqu'au timeout de 300 s du noyau [P]. `coreutils_run` expose aussi `env`, `xargs`, `timeout`, `nohup`, `chroot` du multicall : exécution arbitraire sans filtre d'argv, `cwd` libre, environnement hérité. Le filtrage se limite au nom d'outil via execpolicy.
- `infra.rs:395-401` : `Command::new(program).output()` sans timeout ni `kill_on_drop` : l'annulation par le noyau (300 s) abandonne le futur sans arrêter `aphrody-ssh`. `aphrody-ssh` résolu par PATH en premier (`infra.rs:85-96`).
- `mcp_proxy.rs:226-238` : plugins et `aphrody-mcp` : `kill_on_drop(true)` seul (pas de groupe), `stderr` hérité, environnement complet ; recherche PATH → répertoire de l'exe → `~/.local/bin` → `~/.cargo/bin` (`417-433`) ; un plugin qui annonce un outil `skill_*` fait échouer `kernel.register(plugin).await?` (`main.rs:168`) et donc le démarrage.
- `sandbox/runner.rs:196-211` : timeout ⇒ futur abandonné ⇒ SIGKILL du seul chef.
- `a2a-coord/executor.rs:197-206` : `cancel()` ne tue ni n'attend l'enfant ; `peer.rs:353` `wait_with_output()` sans timeout (hors agy) ; `spawn_blocking` sans plafond.
- `compat/pwsh.rs:53-54`, `wine_proton.rs:90-116`, `dotnet.rs:71-72` : `-Command <script>` arbitraire, `custom_env` libre (`PATH`, `LD_PRELOAD` possibles).
- Correct : `proc` (section 4) fournit exactement ce qu'il faut (`spawn_group`, `kill_tree`, Job Object) mais n'est utilisé par aucun de ces sites (rg : `spawn_group` n'est appelé que par `ui/app` broker/koharu et `llama-server/daemon.rs` ; `FileLock` par `llama-server`, `train` et `a2a-coord/claims.rs`).

### OS-11 [MOYENNE] kernel-client : désynchronisation [V]
- `lib.rs:213-227` : le verrou du flux est pris, une ligne est lue, `response.get("id").as_u64() != Some(id)` ⇒ erreur. Or `transport.rs:117-120` envoie `notifications/tools/list_changed` à CHAQUE session à chaque (dés)enregistrement de sous-système ; si la notification précède la réponse, la requête échoue et la vraie réponse reste dans le tampon : la requête suivante lit la précédente, etc.
- `tokio::time::timeout` englobe lecture+écriture : une annulation après l'écriture a le même effet.
- `from_stream` lit avec `read_frame` borné (bon) ; `kernel/src/client.rs:97-100` utilise `.lines()` non borné et des canaux non bornés (`71-72`).

### OS-12 [MOYENNE] DLL Everything (Windows) [V]
- `search/everything.rs:642-660` : candidats `EVERYTHING_DLL`, puis `Everything64.dll`, `Everything.dll` (noms nus), puis `%ProgramFiles%` ; `LoadLibraryW` (348) sans `LOAD_LIBRARY_SEARCH_*`. Le code d'une DLL plantée s'exécute dans le processus (noyau/CLI). `fsindex/everything.rs:12-14,301-313` : même schéma avec une autre variable.
- Autres : `load_symbol` en `transmute_copy` (342) sans contrôle de taille de `T` ; tampon `[u16; 1024]` (chemins longs tronqués silencieusement) ; `max_results as u32` tronque.

### OS-13 [MOYENNE] stdio-capture et couverture SAFETY [V]
- `stdio-capture/src/lib.rs:45-70,102-117` : voir tableau. Deux appels concurrents : B sauvegarde le fd 1 déjà redirigé par A ; à la restauration, stdout reste lié à un fichier temporaire supprimé. `libc::dup` sans `F_DUPFD_CLOEXEC` : le fd sauvegardé fuit dans les enfants lancés pendant la capture [P]. Le verrou existe dans `ffi` (`capture_lock()` : `aphrody_run_captured`) mais pas pour `run_captured` de la CLI (`apps/cli/src/lib.rs:2384-2389`).
- Couverture SAFETY (voir section 5) ; blocs sans commentaire notables : `search/everything.rs` 56/58, `fsindex/everything.rs` 20/30, `winclean/memory.rs` 27/27, `winclean/system.rs` 18/23, `winclean/windows_search.rs` 21/36, `capture_impl.rs` 36/72, `sandbox/*` 8/10, `kernel/tests.rs` 2/2.
- Invariants faux ou invérifiables : `a2a-server/env.rs:160-162` (« single-threaded startup » faux) ; `sandbox/capability.rs:359-363` (commentaire de syscall, noyau non vérifié hors Linux x86_64/aarch64) ; `sandbox/windows.rs:90-92` (`unsafe impl Send/Sync` pour `HANDLE` : exact pour un handle de job, comme `proc/windows.rs:76-80`, mais sans fondement écrit côté sandbox).
- Invariants vérifiés exacts : `proc/unix.rs:211-225` (`pre_exec` n'utilise que `setsid`/`prctl` via rustix, sans allocation) ; `guard/harden.rs:100,160,172` ; `stdio-capture` Unix/Windows ; `winclean/services.rs`, `tcp.rs:171-176`, `clipboard.rs:99-103` (tampons u64 alignés, longueurs bornées) ; `capture_impl.rs` (`w`,`h` validés > 0 par les appelants, `GetDIBits` sur un tampon `w*h*4`).

### OS-14 [BASSE] Portabilité [V]
- `sandbox/unix.rs:33` : `libc::prctl` sous `cfg(unix)` ⇒ compilation impossible hors Linux/Android.
- `capability.rs:319-321,359-362` : `cfg(all(unix, not(macos)))` inclut *BSD où le syscall 444 n'est pas Landlock.
- `guard/harden.rs:71-94` : aucune branche pour solaris/illumos/redox/haiku ⇒ corps vide ⇒ erreur de type.
- `compat/*.rs` : `PATH` découpé à la main (`split(':')`/`';'`) au lieu de `split_paths` ; non-UTF-8 ignoré.
- `proc/unix.rs:211-225` : `PR_SET_PDEATHSIG` protégé par `cfg(target_os="linux")` : bon. `kernel/transport.rs` : branches unix/windows/autres complètes : bon.
- `stdio-capture` Unix : `dup` sans CLOEXEC (OS-13).

### OS-15 [BASSE] systemd / base / backend [V]
- `systemd/manager.rs:187-258` : `start_unit`/`stop_unit`/`restart_unit` ne font que muter l'état et le journal ; `systemd_stop_unit aphrody-kernel.service` répond succès, met `main_pid=None` sans rien arrêter ; les unités par défaut ont `main_pid = std::process::id()` (84-100). `.expect("units … lock")` sur verrous empoisonnés.
- `base/src/lib.rs:46-58` (`Vfs::resolve`) : `starts_with(mount_point)` sans frontière de composant (`/var/mirror-x` correspond à `/var/mirror`) et `..` non neutralisé ; seul consommateur : `backend` avec des constantes. `ProcessManager::spawn` sans groupe ni `kill_on_drop`.
- `backend/src/lib.rs:20-66` : téléchargements depuis `main` non épinglé, aucune empreinte, écriture sans permissions explicites ; `reqwest` avec timeout 30 s (bon).
- `jobs` : `#![forbid(unsafe_code)]`, `path_for` assainit l'id (collisions `a/b` et `a_b` possibles), WAL SQLite ; à garder. `cron` : descripteurs sans exécution ; `events`/`telemetry` : `forbid(unsafe_code)`.

---------------------------------------------------------------------------------------------------

## 4. proc — ce qui est correct et à garder [V]

- `group.rs:41-72,176-193` : `GroupChild` tue le groupe au `Drop`, une seule fois (flag `swept`) pour éviter la réutilisation de pgid ; leader reapé même en erreur ; `spawn_group` tue l'enfant si l'adoption échoue.
- `unix.rs:209-226` : `setsid` + `PDEATHSIG` optionnel (limité au thread parent, documenté) ; `release_detached` lance un thread pour reaper et éviter le zombie qui répondrait au signal 0.
- `windows.rs:90-141` : Job Object `KILL_ON_JOB_CLOSE`, fenêtre d'évasion avant assignation documentée ; `terminate_process`/`process_alive` : réutilisation de PID possible (documenté dans `group.rs:92-95`) ; `llama-server/supervisor.rs:363-364` appelle `terminate_process` sur un PID de fichier d'état après un simple `process_alive` (hors périmètre).
- `lock.rs` : `flock`/`LockFileEx`, attente bornée seulement, libération à la mort du processus. `FileLock::open` suit les symlinks et crée le répertoire parent (chemins sous `~/.aphrody`, pas `/tmp` : acceptable).

---------------------------------------------------------------------------------------------------

## 5. Inventaire `unsafe`

Chiffres (rg `\bunsafe\b`, hors `crates/os/drive`) : 71 fichiers de crates/os contiennent le mot (commentaires et
`forbid(unsafe_code)` inclus) ; 33 contiennent du code `unsafe` ; hors os : 24 fichiers avec le mot, 22 avec du code
(sous-agent). Les « ~109 » du brief incluent `os/drive` (34 fichiers, 764 sites dans `whisper-rs-sys/bindings.rs` seul) : non examiné.

### crates/os (33 fichiers de code, 385 sites ; heuristique : SAFETY dans les 6 lignes précédentes ou 2 suivantes)

| Crate | Fichiers | Sites | Sans SAFETY voisin | Raison principale |
|---|---|---|---|---|
| winclean | 14 | 171 | 81 | FFI `windows` (services, registre, presse-papier, WMI, tcp, mémoire) |
| capture | 1 | 72 | 36 | FFI GDI/User32 (BitBlt, GetDIBits, EnumWindows, SendInput) |
| search | 1 | 58 | 56 | `LoadLibraryW`/`GetProcAddress`/`transmute_copy`, pointeurs de fonctions Everything |
| fsindex | 1 | 30 | 20 | idem (`transmute` de `FARPROC`, `fsindex/everything.rs:330`) |
| proc | 2 | 11 | 0 | `pre_exec` (rustix), Job Objects, `unsafe impl Send/Sync` (`windows.rs:78,80`) |
| sandbox | 3 | 10 | 8 | libc `prctl`/`execvp`/`syscall`, Job Objects, `unsafe impl Send/Sync` (`windows.rs:91-92`) |
| stdio-capture | 1 | 7 | 0 | libc `dup`/`dup2`/`close`, `SetStdHandle` |
| guard | 2 | 6 | 0 | `prctl`, `setrlimit`, `env::remove_var` |
| a2a-server | 3 | 6 | 0 | `env::set_var` (1 en production : `env.rs:165` ; le reste en tests) |
| base | 2 | 5 | 3 | non examiné (voir NON EXAMINÉ) |
| secrets / settings / kernel | 3 | 9 | 7 | tests (`set_var`) |

Par raison (crates/os, hors drive) : FFI Win32 ≈ 330 sites ; FFI libc ≈ 25 ; `unsafe impl Send/Sync` : 4 (handles de jobs, corrects) ;
`transmute`/`transmute_copy` : 3 hors `base` (`search/everything.rs:342`, `fsindex/everything.rs:330`) ; `from_raw_parts` : surtout winclean (services/tcp/clipboard, corrects) ;
`static mut` : 0 ; `mmap` : 0 (hors drive : `memmap2` dans `drive/core/.../arena.rs`) ; `env::set_var/remove_var` : 2 en production (`guard`, `a2a-server`).

### Hors os (sous-agent, `crates/native`, `shell`, `interop/ffi`, `ui/app`, `ui/bun`)

22 fichiers : 107 exports `#[unsafe(no_mangle)]` (ffi 85, bun_rs 22) ; 160 blocs hors tests ; 51 lectures de chaîne C ; 21 `slice::from_raw_parts`
(host ptr+len) ; 18 écritures par pointeur de sortie ; 8 FFI Win32/libloading ; `unsafe impl`, `transmute`, `static mut`, `MaybeUninit`,
`set_len`, `get_unchecked`, `from_utf8_unchecked` : 0. SAFETY manquant : ffi ≈ 101/159 blocs ; ui/bun, native, ui/app : 0 manquant.

Constats de ce périmètre (détail dans le rapport du sous-agent, reportés ici) :
- U1 `ffi/src/web/dom.rs:55-70,86-100` handle `Box<DomTree>` brut (RefCell, `!Sync`) sans registre : double destroy/UAF/threads = UB hors wrapper TS [V design, P exploitation].
- U2 `ui/app/src/desktop.rs:401-413` et `apps/cli/src/commands.rs:405-411,778-781` : SAFETY faux sur `set_var`/`remove_var` (processus multi-thread) ; `env_set` sans liste blanche [V].
- U3 `ui/bun/src/render.rs:20-62` : `Scene` 2D sans borne de `width/height` ⇒ OOM/abort (le 3D a `MAX_EDGE=16384`) [V absence de borne].
- U4 `ui/bun/src/lib.rs:291-396` : doc « every entry point catches panics » fausse (22 `bun_rs_*`, 2 gardés partiellement) ; `unwrap()` hors `catch_unwind` ⇒ abort de l'hôte [V doc, P déclencheur].
- U5 capture stdio : voir OS-13 (verrou seulement dans ffi, tenu pendant tout `block_on`).
- U6 `closeNativeLibrary()` fait `dlclose` d'une cdylib avec runtime tokio statique [P].
- U9 dérive de header : 22 `bun_rs_*`, 3 `manga_scanlate_*`, 7 `web_internal_*` exportés mais absents des headers ; `bun_rs_free_string` mal documenté [V].
- Correct : registre u64 `Arc<Handle>` des index (pas d'UAF), `guard()` autour de `web_internal_*`, `collect_args`, `Box<[u8]>+len` de `bun_rs_render_free`, `unsafe_op_in_unsafe_fn = deny`.

---------------------------------------------------------------------------------------------------

## 6. Correct et à garder (résumé)

- Noyau : limite de ligne vérifiée avant allocation (`transport.rs:28-49`), 16 requêtes en vol, file sortante de 8, timeouts, annulation à la déconnexion, `PendingCall` libère le slot, noms de sous-systèmes/outils validés, `skill_` réservé, refus des doublons ; politique d'outils fermée par défaut ; hôtes infra bornés à `vps`/`dbfr` ; `git_status_command` échappe les arguments (`infra.rs:~366-380`) ; `cloud_gcs` utilise l'API JSON sans sous-processus.
- `ClientOptions` masque le jeton dans `Debug` ; `read_frame` borné côté kernel-client.
- `proc` (Job Object, `killpg` unique, reaper), `jobs` (bail de location, assainissement d'id), `re/minidump.rs` (arithmétique vérifiée, plafonds `MAX_*`, `forbid(unsafe_code)`), `winclean` (tampons alignés), `capture` (dimensions validées), `a2a-server/fs.rs` (regex d'id), `claims.rs`, `run_trace.rs` (0600 + `sync_all`), `secrets` (AES-GCM + Argon2id, nonce frais).
- Sandbox : refus des politiques restreintes (fail-closed) en attendant l'implémentation.

---------------------------------------------------------------------------------------------------

## 7. Recommandations priorisées

1. Fermer a2a-coord : exiger un jeton (en-tête `Authorization`, comparaison à temps constant) ou lier l'écouteur à un socket Unix 0600 / pipe nommé ; refuser les binds non loopback sans jeton ; valider `Host` ; retirer les flags `--dangerously-*` des pairs lancés par le réseau ou les subordonner à une politique explicite ; borner la concurrence et tuer l'arbre à l'annulation.
2. Rendre le sandbox réel ou le déclarer absent : `probe()` doit rendre `Unavailable`/`BestEffort` tant que Landlock/seccomp/token restreint ne sont pas appliqués ; garder le refus fail-closed ; protéger `unix.rs` par `cfg(target_os = "linux")`.
3. IPC noyau : `SO_PEERCRED` (uid identique) à l'`accept`, DACL explicite (propriétaire seul) pour le pipe, répertoire dédié 0700 à la place de `/tmp`, vérification du propriétaire/mode du socket côté clients, `umask` restreint avant `bind`, plafond de connexions et délai d'authentification, nettoyage du socket à l'arrêt, verrou de démarrage ; documenter ou changer le défaut « auth désactivée ».
4. Durcir les décideurs : `execpolicy` rejette les clés inconnues et exige `decision` ; `guard` retire `env` (et `sort`, `uniq`, `date`, `hostname`) de la liste sûre, compare le chemin complet résolu, analyse tous les jetons PowerShell ; étendre l'audit noyau aux appels (`tools/call`, refus, échecs d'auth) avec principal, sans y copier les résultats, avec mode 0600 et rotation.
5. Secrets et processus : fichiers 0600 + `create_new` + fsync + verrou inter-processus pour `FileSecretStore`, backend DPAPI/trousseau, zeroize des cartes en clair ; passer tous les sites d'exécution (coreutils, infra, plugins, runner) par `aphrody_proc::spawn_group` avec `env_clear` + liste blanche et timeouts ; corriger le client noyau (ignorer les notifications, corréler par id, resynchroniser après timeout).

Compléments : chargement Everything en chemin absolu avec `LOAD_LIBRARY_SEARCH_*` (une seule implémentation) ; verrou interne ou API `&mut`-exclusive pour `with_captured_stdio` et `F_DUPFD_CLOEXEC` ; `// SAFETY:` sur les 211 sites (`clippy::undocumented_unsafe_blocks` dans `[workspace.lints]`) ; garde `start <= total` dans `InMemoryTaskStore::list`.

---------------------------------------------------------------------------------------------------

## 8. NON EXAMINÉ

- `crates/os/base` hors `Vfs`/`ProcessManager` (module de manipulation de processus distants `injector.rs` et helpers de déchiffrement) : lecture interrompue par un classifieur de sécurité, non poursuivie.
- `crates/os/winclean` hors 6 sites `from_raw_parts` et inventaire de comptes : en particulier les outils de mémoire de processus distant du catalogue (`memory.rs`, 27 sites sans SAFETY) ; seul fait établi : ils sont exposés par le noyau sans filtre autre que la politique par nom d'outil. Recommandation : règles `forbidden` explicites dans la politique d'exécution de production.
- `crates/os/drive` (hors périmètre), `crates/os/capture` hors `capture_impl.rs` 96-445, `crates/os/telemetry`, `settings`, `task-runner`, `cron` (greps seulement), `fsindex` hors Everything, `sandbox/denial.rs`, `kernel/admin.rs` (corps), `cloud_git.rs`, `proc/lease.rs` (corps), `compat/subsystem.rs`.
- `a2a-server` : `handler.rs` 760-1519, `rest.rs` 345-911, `jsonrpc.rs` 140-562 ; `a2a-client` : `client.rs`, `middleware.rs`, `transport.rs`, `push_config_compat.rs`, `rest.rs` hors 50-100, `jsonrpc.rs` 260-1477 ; `a2a-grpc` : `errors.rs` ; `a2a-coord` : `proxy.rs` 330-494, `manifest.rs`, tests ; crates `aphrody-a2a`/`a2a-pb`.
- Côté Bun : `packages/os/kernel-client` (limite de tampon de réception), `packages/os`.
- Aucun test dynamique, Miri, ASAN, fuzz ; `cargo deny/audit` (cargo-auditor) non exécutés ; la version de `libc` consultée dans le registre (0.2.189) peut différer du `Cargo.lock`.
- Les assertions d'effet réel (DNS rebinding, traversée Windows de la mailbox, blocage de `coreutils_run` avec petit-fils, DACL par défaut du pipe, `dlclose`) restent [P].
