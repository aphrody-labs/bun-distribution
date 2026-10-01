# Audit axe « os-services » — noyau Aphrody OS et services système (vague 3)

Date : 2026-10-01. Niveau de preuve global : P1 (statique, lecture seule, aucun cargo/rustc/bun).
Tags : [V] vérifié dans le code lu, [P] plausible / non reproduit. Périmètre : crates/os/kernel
(tous fichiers listés dans la consigne), crates/contracts/subsystem, crates/os/systemd,
crates/os/events, crates/os/telemetry, crates/os/settings, crates/os/cron, crates/os/jobs,
crates/os/task-runner, crates/os/fsindex, crates/os/search, crates/os/base, crates/os/backend,
crates/os/execpolicy (reste), crates/os/coreutils, frontière crates/os/drive, packages/os/kernel-client,
docs/architecture/os/{ARCHITECTURE,ARCHITECTURE-GAPS,ARCHITECTURE-GAPS-STATUS}.md,
docs/reference/os/YOLO-AUTHORITY.md.

Ce rapport complète `/tmp/audit-low-level/os.md` (vague 1, OS-01..OS-15) : il ne répète pas ce qui a
déjà été lu entièrement là-bas (transport.rs, auth.rs, cloud_gcs.rs 1-160, sandbox/*, guard/*,
secrets/*, stdio-capture, proc, a2a-*) sauf pour confirmer/corriger avec de nouveaux éléments.
Note de méthode : une analyse plus poussée du module Windows `crates/os/base/src/injector.rs`
(injection de DLL dans un processus distant) a été interrompue par un classifieur de sécurité ;
je n'ai pas reproduit son contenu et je le liste seulement comme NON APPROFONDI plus bas, avec le
fait établi (il existe, il est compilé sous `cfg(target_os="windows")`, personne dans le dépôt ne
l'appelle d'après `rg`).

---------------------------------------------------------------------------------------------------

## 0. Périmètre réellement lu

| Fichier | Lignes |
|---|---|
| `crates/os/kernel/src/lib.rs` | 1-511 (entier) |
| `crates/os/kernel/src/rpc.rs` | 1-439 (entier) |
| `crates/os/kernel/src/transport.rs` | 1-282 (entier) |
| `crates/os/kernel/src/auth.rs` | 1-148 (entier) |
| `crates/os/kernel/src/remote.rs` | 1-338 (entier) |
| `crates/os/kernel/src/policy.rs` | 1-24 (entier) |
| `crates/os/kernel/src/audit.rs` | 1-448 (entier) |
| `crates/os/kernel/src/main.rs` | 1-392 (entier) |
| `crates/os/kernel/src/client.rs` | 1-268 (entier) |
| `crates/os/kernel/src/mcp_proxy.rs` | 1-677 (entier) |
| `crates/os/kernel/src/infra.rs` | 1-576 (entier) |
| `crates/os/kernel/src/admin.rs` | 1-260 (dispatch + tests), `call_rust` via `winclean/dispatch.rs` |
| `crates/os/kernel/src/cloud.rs` | 1-322 (entier) |
| `crates/os/kernel/src/cloud_git.rs` | 255-459 (`ingest`, tests) + greps |
| `crates/os/kernel/src/runtimes.rs` | 1-167 (entier) |
| `crates/os/kernel/Cargo.toml`, `build.rs` | entiers |
| `crates/contracts/subsystem/src/lib.rs` | 1-306 (entier) |
| `crates/os/systemd/src/{lib,manager,subsystem,unit,journal}.rs` | entiers |
| `crates/os/events/src/lib.rs` | 1-460 (entier pour `EventBus`/`NdjsonSinkSubscriber`) |
| `crates/os/jobs/src/{lib,store,worker,log}.rs` | lib entier, store 1-700, worker entier, log 40-120 |
| `crates/os/task-runner/src/lib.rs` | 1-60, 486-700 (scheduler, exécution) |
| `crates/os/cron/src/lib.rs` | entier |
| `crates/os/telemetry/src/lib.rs` | 1-60, 505-545, 755-810 |
| `crates/os/settings/src/lib.rs` | 1-70 + greps ciblés |
| `crates/os/fsindex/src/{lib,google}.rs` | lib entier, google 1-120 |
| `crates/os/search/src/lib.rs` | 1-80, 330-420, 545-600 |
| `crates/os/execpolicy/src/{parser,policy,rule,decision}.rs` | compléments : parser 200-396, policy 180-265, rule 140-206, decision entier |
| `crates/os/coreutils/src/subsystem.rs` | 1-135, 270-345 |
| `crates/os/base/src/lib.rs` | 1-159 (entier) ; `injector.rs` lecture interrompue (voir note de méthode) |
| `crates/os/kernel-client/src/lib.rs` | 1-363 (entier) |
| `packages/os/kernel-client/src/index.ts` | 1-225 (entier) |
| `crates/ui/drive/src/service.rs` | 1-90 (frontière daemon/systemd réel) |
| `crates/ui/app/src/lib.rs`, `window.rs`, `desktop.rs` | greps ciblés (`host_remote`, `register_subsystem`) |
| docs | `ARCHITECTURE.md`, `ARCHITECTURE-GAPS.md`, `ARCHITECTURE-GAPS-STATUS.md`, `YOLO-AUTHORITY.md` (entiers) |
| graphe de dépendances | `/tmp/stack-dedup/metadata-after.json` via python3 (qui dépend de quoi, hors cargo) |
| état machine | `~/.aphrody` (ls/stat seulement, modes de fichiers, aucun contenu secret) |

Grille : agents `rust-architect`, `security-engineer`, `asm-lowlevel-engineer`, `cargo-auditor` ;
skills `rust-async-patterns`, `rust-best-practices-2026`, `a2a-protocol`.

---------------------------------------------------------------------------------------------------

## 1. Tableau des constats (les plus graves d'abord)

| ID | Sév. | chemin:ligne | Constat | Niveau |
|---|---|---|---|---|
| OS-16 | HAUTE (nouveau) | `kernel/src/lib.rs:259-339` (`insert`) ; `rpc.rs:376-396` (`system/register_subsystem`) ; `ui/app/src/lib.rs:51-58` | Aucune liaison d'identité entre un nom de sous-système/outil et le principal autorisé à le détenir : premier arrivé, premier servi. N'importe quel processus du même utilisateur OS (le socket est un domaine de confiance unique par défaut, OS-03) peut appeler `system/register_subsystem` avec `name:"window"` (ou `"browser"`, `"aphrody_web"`) et des outils `window_focus`/`clipboard_read`/`desktop_notify` avant que le vrai processus Tauri (`aphrody-app`, `host_remote`, connecté **après** le démarrage du noyau) ne s'enregistre — qui reçoit alors `DuplicateSubsystem`. Le squatteur répond ensuite aux appels de tous les agents à la place du vrai sous-système (résultats falsifiés, interception de `clipboard_read`, faux `window_open`). Aucune liste de noms réservés hors le préfixe `skill_`. | [V] code lu ; scénario de course [P] |
| OS-11 | HAUTE (confirmé + détaillé) | `kernel-client/src/lib.rs:212-244` ; `transport.rs:109-123` | Confirmé avec le mécanisme exact : une notification kernel (`notifications/tools/list_changed`, envoyée à **toutes** les sessions dès qu'un sous-système s'enregistre/se désenregistre, y compris un plugin stdio ou un pair distant) n'a pas de champ `id`. `KernelClient::request` lit une seule trame par appel et compare `response.get("id")` à l'id attendu ; une notification interposée produit `None != Some(id)` → `Protocol("response id does not match request")`, et la vraie réponse reste non lue dans le flux. Comme l'accès est sérialisé par un seul `Mutex<BufReader>`, l'appel **suivant** sur la même connexion lira cette réponse orpheline au lieu de la sienne : désynchronisation permanente, pas de resynchronisation automatique, il faut reconnecter le processus. Consommateurs réels : `aphrody-nu` (shell Nushell) et `aphrody-yolo` (automatisation infra) selon le graphe de dépendances — un `nu_eval` concurrent à l'enregistrement/désenregistrement d'un plugin MCP (fréquent au démarrage) peut donc casser silencieusement la session shell. | [V] mécanisme ; [P] fréquence en production |
| OS-03 | VOULU (YOLO) sauf un point | `transport.rs:62-82` ; `auth.rs:18-30,126-136` | `AuthPolicy::Disabled` (défaut) ⇒ domaine de confiance unique par utilisateur OS : **conforme à la doctrine** (`YOLO-AUTHORITY.md` : « single OS-user trust domain by default », agent authentifié supposé, pas de sandbox voulu). **Revendication à aligner** : quand un opérateur active explicitement `--auth-file` pour la production (le cas que la doctrine prévoit), le relais `aphrody-kernel mcp` (`main.rs:238-244`) copie stdin→socket sans jamais appeler `initialize` avec un jeton pour un client MCP tiers qui parlerait au process — seul `Client::initialize` (client.rs:203-207) lit `APHRODY_OS_AUTH_TOKEN`. Un opérateur qui a opté pour l'authentification via ce relais se retrouve donc avec un canal qui ne s'authentifie pas, contrairement à son intention explicite. | [V] |
| OS-06 | REVENDICATION À ALIGNER | `execpolicy/parser.rs:113,139-141` ; `rule.rs` tests 140-150 ; `kernel/policy.rs:1-24` | `--exec-policy` est un mécanisme optionnel, opt-in, pour un opérateur qui veut déclarer explicitement des interdictions (pas un sandbox ni une approbation humaine — cohérent avec YOLO). Le gap n'est pas « il faudrait plus de restriction » mais une incohérence interne : une règle sans clé `decision` reste silencieusement `Allow` dans le parseur (`parser.rs:113`), alors que `Decision::default()` vaut `Prompt` (`decision.rs`) — deux défauts différents selon le point d'entrée, donc un opérateur qui écrit une règle incomplète obtient un résultat différent de celui que le type `Decision` suggère par ailleurs. Le noyau n'évalue que `&[tool]` (`kernel/src/policy.rs:16`) : une politique écrite par un opérateur pour distinguer par arguments ne peut matériellement pas s'appliquer — c'est une lacune fonctionnelle de ce que l'opérateur peut exprimer, pas un manque de confinement par défaut. | [V] |
| OS-07 | MOYENNE (confirmé) | `transport.rs:135,238-276` | Confirmé : pas de limite de connexions, pas de timeout d'inactivité avant `initialize`, nettoyage du socket par suppression inconditionnelle de tout fichier existant au chemin cible, aucun signal d'arrêt propre (pas de `ctrl_c`/`SIGTERM` dans le crate). | [V] |
| OS-08 | MOYENNE (confirmé) | `rpc.rs:319-324,397-409` ; `audit.rs:396-418` | Confirmé : le pont d'audit NDJSON (`AuditBridge::start`) ne fait que relayer ce qui est déjà publié sur `AgentBus` — 4 sites de publication seulement (`tools/list_changed`, `a2a/message`, `subagent/failed`, `system/publish` client). `tools/call`, les refus de policy/scope et les échecs d'authentification ne sont jamais publiés, donc jamais audités, quelle que soit la configuration de `--audit-log`. `append_event` (`events/src/lib.rs`) ouvre en `append(true)` sans mode explicite et sans rotation. | [V] |
| OS-10 | MOYENNE (confirmé) | `coreutils/src/subsystem.rs:270-345` | Confirmé avec le code exact : au timeout, `child.kill().await` ne tue que le processus direct (pas de groupe) ; `stdout_task`/`stderr_task` (`read_capped`, lisent jusqu'à EOF) sont ensuite attendues **sans timeout propre** — un petit-fils qui hérite du pipe (ex. `xargs`, `find -exec`, `tar` lançant un filtre) peut faire pendre la requête jusqu'au timeout de 300 s du noyau (`transport.rs:REQUEST_TIMEOUT`), le sous-processus orphelin continuant de tourner après. Bornes correctes par ailleurs : `MAX_TIMEOUT_MS=300_000`, `MAX_OUTPUT_BYTES=8MiB`, validation du nom d'utilitaire (`utility_name`). | [V] |
| OS-15 | BASSE/MOYENNE (confirmé + comparatif) | `systemd/src/manager.rs:219-259` ; `ui/drive/src/service.rs:1-90` | Confirmé (cf. ART-11) : `start_unit`/`stop_unit`/`restart_unit` ne font que muter un `HashMap<String, Unit>` en mémoire (aucun `Command::spawn`, `ExecStart` jamais exécuté, `Restart=`/`RestartSec` parsés par `Unit::parse_ini` mais jamais appliqués). **Contraste informatif** : `crates/ui/drive` (hors périmètre kernel, mais même dépôt) installe `sd-daemon` comme une **vraie** unité systemd utilisateur (`systemd_unit()` génère `ExecStart=`, `Restart=on-failure`, `RestartSec=5s`, installée via `systemctl --user`), un agent launchd sur macOS et une tâche planifiée sur Windows — la supervision réelle existe déjà ailleurs dans le dépôt, mais n'est pas réutilisée par `aphrody-systemd`. | [V] |

---------------------------------------------------------------------------------------------------

## 2. Fidélité doc (ARCHITECTURE.md) ↔ code

| Promesse | Verdict | Preuve |
|---|---|---|
| O(1) dispatch (`dispatch: HashMap<String, Arc<dyn SystemSubsystem>>`) | **Tenue** | `lib.rs:89,430-436` : `Kernel::call` fait un seul `HashMap::get` après libération du verrou de lecture. |
| `cached_mcp_tools` O(1) pour `tools/list` | **Tenue** | `lib.rs:94-129,385-390` : `Arc<Vec<Value>>` reconstruit à chaque `insert`/`unregister`, cloné (pointeur) à la lecture. Mais `rpc.rs:253-269` refiltre ensuite cette liste par `scope.allows_tool` à CHAQUE requête `tools/list` (O(n) sur le nombre de tools, pas O(1) une fois l'authentification activée) — la doc ne mentionne pas ce coût additionnel, mineur en pratique. |
| 64 MiB / 16 requêtes / file de 8 / 300 s | **Tenue** | `transport.rs:21-25` : `MAX_LINE`, `MAX_IN_FLIGHT`, `OUTBOUND_CAPACITY`, `REQUEST_TIMEOUT` correspondent exactement aux valeurs documentées. |
| Audit NDJSON durable (`--audit-log`) | **Nominale** | Le pont existe et ne bloque pas le dispatch (vrai), mais ne couvre que 4 types d'événements (OS-08) : la doc dit « bridges future bus events », ce qui est littéralement vrai mais trompeur sur la complétude de l'audit. |
| `--auth-file` : sessions authentifiées et scopées | **Tenue pour le chemin `Client`/`KernelClient`**, **fausse par défaut** | `auth.rs` : sans fichier, `Disabled` ⇒ accès `*` complet. Documenté dans YOLO-AUTHORITY.md (« single OS-user trust domain by default »), donc la doc ne ment pas, mais ARCHITECTURE.md présente le trust boundary de façon plus discrète que le comportement réel. |
| `--exec-policy` : politique d'outils avant dispatch | **Tenue mais étroite** | `kernel/policy.rs` + `lib.rs:414-417,452-454` : appliqué sur RPC, A2A et skills comme documenté. Étroit : seul `argv[0]`/nom d'outil, jamais les arguments (OS-06). |
| Sous-systèmes distants (`system/register_subsystem`) | **Tenue mais sans vérification d'identité** | Fonctionne comme documenté, mais voir OS-16 : rien n'empêche l'usurpation d'un nom de sous-système privilégié par un pair plus rapide. |
| « Le noyau refuse les collisions » (noms d'outils) | **Tenue littéralement, incomplète en pratique** | `insert()` refuse un `DuplicateTool`/`DuplicateSubsystem` — vrai — mais ne distingue pas un sous-système légitime en retard d'un usurpateur arrivé en premier (OS-16). |
| systemd « Ring-3 session supervisor … restart policy » | **Fausse** (confirmé ART-11) | Voir OS-15 : aucun processus n'est jamais lancé par `aphrody-systemd`. |
| `infra` : résolution dynamique sans chemin codé en dur | **Tenue, plus stricte que documenté** | `infra.rs:84-142` : `cargo run` seulement sous `APHRODY_INFRA_BUILD_FROM_SOURCE=1`, cinq stratégies de résolution dans l'ordre documenté. |

---------------------------------------------------------------------------------------------------

## 3. Durabilité et intégrité des états persistants (SQLite)

- **`aphrody-jobs`** (`crates/os/jobs/src/store.rs:160-191`) : `PRAGMA journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`. Claim atomique par `UPDATE … WHERE id = (SELECT … LIMIT 1) RETURNING id` dans une transaction implicite : deux workers ne peuvent pas gagner la même ligne [V, à garder]. Reprise après crash par bail (`lease_expires_at`), pas par drapeau booléen — invariant documenté et vérifié par les tests (`recover_at`). Chemin par défaut `~/.aphrody/jobs/jobs.db` (`lib.rs:95-105`) ; observé sur la machine : `jobs.db` en mode `-rwxrwxrwx` (777, umask WSL/drvfs), aucun `PRAGMA` ni ouverture ne force `0600` — cohérent avec l'absence générale de durcissement de permissions déjà notée côté `secrets` (OS-09 de `os.md`). Pas de borne de taille/rotation : `purge_before` existe mais n'est appelée par aucun chemin automatique trouvé (recherche limitée, voir NON EXAMINÉ) — une file jamais purgée grossit indéfiniment.
- **`aphrody-fsindex`** (`crates/os/fsindex/src/lib.rs:94-131`) : `PRAGMA journal_mode=WAL` seul (pas de `synchronous`/`busy_timeout`). Un seul triggers FTS5 content-linked (`files_fts` sur `files`), cohérent. `build()` est **idempotent** par `ON CONFLICT(path) DO UPDATE` — pas de doublons — mais ne supprime jamais les entrées de fichiers disparus depuis la dernière exécution (pas de `DELETE … WHERE path NOT IN (…)`) : l'index dérive silencieusement du système de fichiers réel au fil des reconstructions partielles. Chemin par défaut `~/.aphrody/fsindex.db` (`apps/cli/src/index_cmd.rs:46-50`), créé sans mode explicite (hérite de l'umask du process SQLite, pas de `0600` comme promis par la doctrine « privacy-bounded » du commentaire d'en-tête). **Fuite entre utilisateurs** : l'index ne contient que des métadonnées (chemin, nom, extension, taille, mtime, jamais le contenu — vrai et vérifié), mais ces métadonnées elles-mêmes (noms de fichiers, arborescence complète d'un `--root` qui peut inclure `/home/<autre-utilisateur>` si le process tourne avec des droits suffisants) sont lisibles par quiconque peut lire le fichier `.db` — même modèle de confiance « un seul utilisateur OS » que le reste du noyau, mais sans la moindre protection de fichier dédiée.
- **`GoogleFilesDb`** (`fsindex/src/google.rs:40-47`) : ouverture `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX` + `PRAGMA query_only=ON` — lecture seule réelle et correcte [V, à garder]. C'est un adaptateur vers un fichier **tiers** (Google Desktop sur Windows), pas une base écrite par Aphrody.
- **`aphrody-search`** (`InvertedIndex::save`/`load`, `crates/os/search/src/lib.rs:559-581`) n'est **pas** SQLite : JSON sérialisé entier en mémoire, écrit par `tmp + flush + sync_all + rename` (atomique, correct), mais `save()` réécrit l'**intégralité** du JSON à chaque appel (pas de journal incrémental) — pour un index volumineux, chaque sauvegarde double temporairement l'usage disque et mémoire (JSON pretty-printed). Pas de borne de taille documentée.
- **`aphrody-cron`** (`JsonFileJobStore::save_jobs`, `crates/os/cron/src/lib.rs:213-224`) : même motif atomique `tmp + rename`, mais **sans** `sync_all`/`flush` explicite avant le `rename` (contrairement à `search`/`telemetry`) — fenêtre de perte de données plus large en cas de coupure brutale juste après le `rename` si le répertoire parent n'est pas aussi synchronisé (`fsync` du dossier manquant partout dans ces trois crates, risque générique de renommage non durable après un crash matériel, P).
- **`aphrody-telemetry`** (`NdjsonSpanExporter::export`, `telemetry/src/lib.rs:762-800`) : lit le fichier existant intégralement en mémoire puis le réécrit avec les nouveaux spans concaténés (pas un simple append) — **coût O(n²)** sur de longues sessions (chaque export relit et réécrit tout l'historique) ; `sync_all()` présent (bon). Aucune borne de taille, aucune rotation.
- **`aphrody-settings`** : couches fusionnées en mémoire à chaque `load()` (`SettingsLayer::Env/Local/Project/User`), pas de persistance SQLite — hors du périmètre « intégrité SQLite » mais partage le motif `read_json_if_exists` sans validation de schéma stricte au-delà du sous-ensemble JSON Schema documenté.

**Synthèse** : aucune des bases SQLite du périmètre (`jobs`, `fsindex`) ne force de permissions de fichier restrictives à la création, contrairement à l'intention documentée pour `fsindex` (« privacy-bounded ») et à ce que `secrets` tente (et rate, OS-09) de faire. Le mode WAL est utilisé correctement partout où c'est pertinent (jobs, fsindex) pour séparer lecteurs/écrivain. Aucune limite de taille/rétention automatique n'est appliquée par défaut à aucune des deux.

---------------------------------------------------------------------------------------------------

## 4. Concurrence (verrous, canaux, arrêt)

- **Kernel transport** (`transport.rs`) : aucun verrou tenu à travers un `.await` dans le chemin chaud — les sections critiques (`Mutex`/`RwLock` de `Registry`, `Session.pending`) sont des `std::sync::Mutex`/`tokio::sync::RwLock` libérés avant tout appel async (`lib.rs:267-332` prend le verrou d'écriture, construit tout, le relâche, **puis** publie sur le bus). [À garder.]
- **`RemoteSubsystem::call`** (`remote.rs:282-316`) : `PendingCall` (garde `Drop`) retire l'entrée `pending` même si le futur est annulé avant la fin — évite une fuite de slot. [À garder, confirmé par le test `cancelled_call_releases_pending_response_slot`.]
- **`McpProxySubsystem`** (`mcp_proxy.rs:308-374`) : un seul `tokio::sync::Mutex<ProcessState>` protège tout l'aller-retour stdin/stdout d'un plugin MCP ; le lock est tenu **à travers** `read_frame().await` (plusieurs `.await` potentiellement longs) — un appel concurrent au même plugin attend donc la fin du précédent, ce qui est le comportement voulu (sérialise les requêtes vers un process stdio qui ne multiplexe pas) mais signifie qu'un plugin lent bloque tous les appelants de ce sous-système, y compris pour des outils différents du même plugin. Documenté implicitement par le commentaire (« Preserve partial framing »), pas explicitement comme une limite de débit.
- **`JobStore`** (rusqlite, `crates/os/jobs`) : pas de `Mutex` Rust — la concurrence est déléguée entièrement à SQLite (WAL + `busy_timeout`). Correct pour multi-process, mais `JobStore` n'est pas `Clone`/`Sync`-partagé explicitement : chaque `Worker` ouvre sa propre connexion (cohérent avec le modèle multi-processus documenté).
- **Canaux non bornés** : `kernel/src/client.rs:71-72` (`mpsc::unbounded_channel` pour `outbound` et `incoming`) — un pair qui écrit plus vite qu'il n'est lu (ou un abonné `incoming` jamais consommé, cf. commentaire `client.rs:111-113` « Nobody reads requests or notifications ») peut accumuler indéfiniment en mémoire. Documenté comme acceptable par le commentaire mais sans borne configurable, contrairement au transport serveur (`transport.rs`) qui borne tout à 8/16.
- **Arrêt gracieux du noyau** : confirmé absent (OS-07 vague 1) — aucun `tokio::signal::ctrl_c()` dans `crates/os/kernel`. `main.rs` lance `serve_endpoint` en boucle infinie (`loop { accept… }`) sans jamais sortir normalement ; le process se termine par signal OS brut, laissant le socket Unix sur disque (pas de `Drop`/handler pour `remove_file`). Sur Windows, la boucle `ServerOptions::new().create(endpoint)` recrée une instance de pipe à chaque connexion — même absence de nettoyage à l'arrêt.
- **Sous-systèmes distants à la déconnexion** : `Session::close()` (`rpc.rs:80-88`) vide `pending` (échoue tout appel du noyau en cours vers ce pair) et désenregistre ses sous-systèmes **avant** que le `events_task`/`writer_task` ne soient abortés (`transport.rs:182-187`) — ordre correct (pas de fuite de tâche après `requests.abort_all()`).
- **Tâches orphelines** : `lib.rs:314-327` — `tokio::spawn` du sous-agent (`subsystem.run(bus)`) stocké dans `Entry.agent` et `abort()`-é explicitement dans `unregister()` [à garder]. En revanche, les tâches internes des sous-agents eux-mêmes (ex. `systemd/subsystem.rs:250` `tokio::spawn` à l'intérieur de `run()`) ne sont **pas** suivies par le `JoinHandle` que le noyau garde — si `SystemdSubsystem::run` retourne après avoir spawné sa boucle d'écoute du bus, le noyau pense le sous-agent terminé/géré alors qu'une tâche enfant tourne encore indépendamment ; `unregister("systemd")` n'abortera que la tâche externe (déjà terminée), pas la boucle interne, qui continue à consommer le bus indéfiniment après la désinscription du sous-système. [V code, P impact (fuite mineure, le bus continue d'exister par ailleurs)]

---------------------------------------------------------------------------------------------------

## 5. systemd Rust : init réel ou tableau d'états ?

Réponse confirmée (ART-11, approfondie) : **un tableau d'états**, pas un init.

- `ServiceManager::start_unit`/`stop_unit`/`restart_unit` (`manager.rs:219-270`) ne font que muter `unit.state`/`sub_state`/`main_pid`/`started_at_usec` et écrire dans le journal en mémoire. Aucun `std::process::Command`/`tokio::process::Command` n'apparaît dans tout `crates/os/systemd` (grep confirmé).
- `Unit::parse_ini` (`unit.rs:101-180`) lit correctement `ExecStart`, `ExecStop`, `Restart`, `RestartSec`, `Environment`, `WorkingDirectory`, `After`/`Requires`/`Wants`/`WantedBy` — mais ces champs ne sont **jamais lus** par `manager.rs` au moment de démarrer/arrêter une unité. Un `systemd_load_unit_file` suivi d'un `systemd_start_unit` sur un service avec un `ExecStart` invalide ou dangereux renverra `success:true` sans jamais avoir tenté de l'exécuter — silencieux et potentiellement trompeur pour un agent qui croit avoir démarré un vrai processus.
- `resolve_order` (`manager.rs:179-217`) est un parcours BFS inversé suivi d'un `.reverse()`, **pas** un tri topologique de Kahn : il ne détecte pas les cycles (une boucle `After=` fait juste `visited.insert` échouer silencieusement sur le doublon et continue) et ne garantit l'ordre topologique que par accident de structure (BFS puis inversion n'est pas équivalent à Kahn pour un graphe à plusieurs branches convergentes). [V, confirme/précise ART-11 qui ne citait que le non-lancement de processus]
- Watchdog : aucune occurrence de `WatchdogSec`/heartbeat dans `unit.rs`/`manager.rs` — la doc parle de « process watchdog » (Cargo.toml description) mais rien ne vérifie qu'un `main_pid` est réellement vivant. `main_pid` des unités par défaut (`kernel_svc`, `shell_svc`) est toujours `std::process::id()` du process **courant** (`manager.rs:80,93`), donc toujours « vivant » par définition — aucun test n'est possible de la détection de crash.
- `journal.rs` est un vrai journal en mémoire borné (`VecDeque`, `max_entries.max(100)`, éviction FIFO) — fonctionnellement correct pour ce qu'il prétend être (un tampon circulaire interrogeable), mais ne persiste rien sur disque (contrairement à journald réel) : un redémarrage du noyau perd tout l'historique.
- **Comparatif réutilisation** (cf. section 7) : `crates/ui/drive/src/service.rs` montre que le dépôt sait déjà générer de vraies unités systemd utilisateur/launchd/tâches planifiées avec `Restart=`/`KeepAlive` appliqués par le véritable gestionnaire de l'OS hôte — ce chemin n'est pas branché à `aphrody-systemd`.

---------------------------------------------------------------------------------------------------

## 6. Modèle d'autorité YOLO

`docs/reference/os/YOLO-AUTHORITY.md` est lu intégralement et son contenu est cohérent avec le code :

- `APHRODY_YOLO`, `APHRODY_NHITL`, `APHRODY_AGENT_AUTHENTICATED`, `APHRODY_AUTHORITY_SCOPE` : confirmé par grep (`rg APHRODY_YOLO crates/os/kernel` → aucune occurrence) que le noyau ne lit ni ne vérifie ces variables [V, la doc le dit explicitement et le code le confirme par absence]. Elles sont donc exactement ce que la doc dit : des métadonnées auto-déclarées par le lanceur d'agent, sans portée d'application dans `aphrody-kernel`.
- La vraie frontière d'autorité du noyau reste `AuthPolicy` (`auth.rs`) : un seul domaine de confiance par utilisateur OS par défaut, un fichier `--auth-file` optionnel pour des scopes par principal. Documenté fidèlement (« Neither control separates agents running under the same OS account »).
- Révocation : aucun mécanisme de révocation de jeton à chaud trouvé — `AuthPolicy::Required` est chargée une fois au démarrage (`from_file`, appelé uniquement dans `Kernel::with_authentication_file`) ; changer le fichier de politique n'a aucun effet sur un noyau déjà démarré (pas de rechargement, pas de `SIGHUP` géré). Cela n'est pas explicitement contredit par la doc (qui ne promet pas de rechargement à chaud) mais mérite d'être noté comme limite opérationnelle : révoquer un jeton compromis exige un redémarrage complet du noyau.
- Journalisation de la portée YOLO : puisque le noyau ne voit jamais ces variables, aucun événement d'audit ne peut les corréler — un `system/audit_status` ne pourra jamais distinguer un appel « autorité YOLO » d'un appel ordinaire du même principal. Cohérent avec la doc mais confirme que l'« autorité YOLO » est un concept de couche agent, invisible et non auditable côté noyau.

---------------------------------------------------------------------------------------------------

## 7. Réutilisation : briques mûres vs fonctionnalité native réelle

| Brique du périmètre | Verdict | Détail |
|---|---|---|
| `aphrody-systemd` (supervision de services) | **Enrobage incomplet, pas une vraie supervision** | Voir section 5. Brique mûre déjà présente dans le même dépôt pour la remplacer : `crates/ui/drive/src/service.rs` (génération d'unités systemd/launchd/Task Scheduler réelles, licence FSL-1.1-ALv2 dérivée de Spacedrive, déjà dans `Cargo.lock` comme `aphrody-drive`). À évaluer : brancher `aphrody-systemd::ServiceManager::start_unit` sur un vrai `tokio::process::Command` + le motif `systemd_unit()`/`launchd_plist()` déjà écrit, plutôt que de réinventer un init complet. |
| `aphrody-jobs` (scheduler persistant) | **Fonctionnalité native réelle et solide** | Lease-based claim, reprise après crash, WAL — conception correcte et testée (`tests/crash_recovery.rs`), pas un enrobage. |
| `aphrody-fsindex` (index FTS5) | **Fonctionnalité native réelle, mais réinvente ce qu'un outil mûr fait déjà mieux** | FTS5 + BM25 fait à la main (tokenizer maison dans `aphrody-search`, séparé). Brique mûre à évaluer : `tantivy` (licence MIT, présent dans `~/.cargo/registry/src` ? à vérifier — pas trouvé dans Cargo.lock du dépôt lors de ce passage) donnerait un classement BM25 complet, de la tokenisation Unicode correcte et des facettes, pour un coût de dépendance qu'il faut mesurer face à la philosophie « dependency-light » revendiquée par le commentaire d'en-tête de `aphrody-search`. Marqué « à évaluer » : pas de gain évident si le besoin reste une recherche de noms de fichiers simple. |
| `aphrody-cron` (scheduler cron) | **Fonctionnalité native réelle, minimale** | Parseur cron 5 champs fait main, correct pour les cas simples ; pas de support `@reboot`/`@daily`/listes `L`/`W` (cron Vixie étendu). Brique mûre à évaluer : crate `cron` (MIT, très répandu) si le besoin dépasse 5 champs simples — actuellement suffisant pour l'usage documenté (triggers `cron:` de `aphrody-skills-runtime`). |
| `aphrody-events`/kernel `audit.rs` (bus + sink NDJSON) | **Fonctionnalité native réelle, redondante avec elle-même** | `aphrody-events::EventBus` et `aphrody-subsystem::AgentBus` sont deux bus en mémoire distincts et non reliés sauf via le pont explicite du noyau (confirmé par GAPS #5) — ni l'un ni l'autre n'est un enrobage d'un outil externe, mais la duplication de concept entre les deux crates (tous deux `tokio::broadcast` + abonnés) n'a pas de justification technique trouvée dans le code lu ; `ARCHITECTURE-GAPS.md` lui-même documente cet état comme une question ouverte, non résolue à ce jour. |
| `aphrody-coreutils` (adaptateur uutils) | **Enrobage correct d'un outil mûr** | `uutils/coreutils` est l'upstream réel ; le crate est un adaptateur fin et borné (timeouts, tailles de sortie, validation du nom d'utilitaire) — exactement ce qu'un adaptateur doit être, pas une réimplémentation. Le risque n'est pas l'enrobage mais l'absence de filtrage d'arguments en amont (OS-10/OS-06). |
| `aphrody-search` (index inversé BM25-lite) | **Fonctionnalité native, duplique un besoin déjà couvert ailleurs par fsindex (FTS5)** | Les deux crates existent pour des corpus différents (fichiers vs documents/mémoire), ce qui est justifié dans le commentaire d'en-tête, mais aucun partage de tokenizer entre les deux n'a été trouvé — deux tokenizers distincts à maintenir pour un besoin conceptuellement proche. |

---------------------------------------------------------------------------------------------------

## 8. Correct et à garder (résumé, hors ce qui est déjà dans `os.md` section 6)

- `Kernel::insert`/`unregister` : verrou d'écriture pris puis relâché avant toute opération asynchrone, cache précalculé reconstruit atomiquement (`rebuild_cache`), notification `tools/list_changed` publiée après libération du verrou.
- `RemoteSubsystem` : `PendingCall::Drop` nettoie le slot en attente même sur annulation — protège contre les fuites de mémoire sur des appels A2A annulés.
- `aphrody-jobs` : conception lease-based complète et testée ; `purge_before` protège explicitement les jobs `queued`/`running` de toute purge, quelle que soit leur ancienneté.
- `GoogleFilesDb::open` : lecture strictement read-only (`SQLITE_OPEN_READ_ONLY` + `PRAGMA query_only=ON`), bon réflexe pour un fichier tiers non écrit par Aphrody.
- `packages/os/kernel-client` (Bun) : `#receive` vérifie la taille du message **avant** de l'ajouter au tampon (comme `transport.rs::read_line_limited`), contrairement à la crainte documentée dans `ARCHITECTURE-GAPS.md` #3 — ce point précis de la doc historique est **obsolète/corrigé** dans le code actuel [V].
- `aphrody_search::InvertedIndex::save`/`aphrody_telemetry::NdjsonSpanExporter::export` : motif `tmp + flush + sync_all + rename` correctement implémenté (contrairement à `cron::JsonFileJobStore::save_jobs` qui omet le `sync_all`).
- `infra_exec`/`infra_git_status` : hôtes bornés à une énumération fermée (`vps`/`dbfr`), `git_status_command` échappe correctement les chemins contenant des quotes/opérateurs shell (test `git_status_handles_literal_paths_and_home_shorthand` couvre l'injection).
- `crates/ui/drive/src/service.rs` : génération XML correctement échappée (`xml_escape`), quoting systemd correct pour les chemins contenant des espaces (testé).

---------------------------------------------------------------------------------------------------

## 9. Recommandations priorisées

Sous doctrine YOLO (`YOLO-AUTHORITY.md`) : aucune recommandation ci-dessous ne propose de sandbox, d'approbation humaine ou de politique restrictive par défaut. L'agent authentifié reste pleine autorité ; ce qui suit vise l'intégrité du canal et des états, et la fiabilité (pas de blocage/fuite/tâche orpheline), conformément à ce que la doctrine elle-même déclare légitime.

1. **Intégrité du canal d'enregistrement de sous-système** (OS-16) : sous un domaine de confiance à un seul utilisateur OS, deux processus authentifiés du même utilisateur peuvent légitimement vouloir des identités différentes (le vrai `window` de l'app Tauri vs un agent qui teste). Le problème n'est pas qu'il faille les empêcher de s'enregistrer, mais que « premier arrivé » peut faire taire silencieusement le bon processus (`DuplicateSubsystem`) sans jamais alerter l'opérateur ni l'agent floué. Faire échouer bruyamment (log, événement bus) toute tentative de ré-enregistrement d'un nom déjà pris par `builtin_kernel`, pour que l'intégrité du canal reste observable même sans confinement.
2. **Corriger la désynchronisation du client Rust** (OS-11, fiabilité) : faire boucler `KernelClient::request` sur `read_frame` jusqu'à trouver l'`id` attendu (mettre de côté les notifications au lieu de les traiter comme une réponse), ou démultiplexer par une tâche de lecture dédiée comme le fait déjà `packages/os/kernel-client` (séparation lecture continue / promesses en attente par id) — ce dernier n'a pas ce bug. C'est un bug de protocole qui casse une session légitime, pas une question d'autorisation.
3. **Aligner la revendication `aphrody-systemd` sur ce qu'il fait réellement** : soit brancher `start_unit` sur un vrai `tokio::process::Command` (réutiliser `aphrody_proc::spawn_group`, cf. `os.md` section 4, et le motif déjà écrit dans `crates/ui/drive/src/service.rs` pour une vraie intégration systemd/launchd), soit corriger `ARCHITECTURE.md` pour dire « modèle d'état en mémoire », pas « Ring-3 session supervisor … restart policy ». Un agent YOLO qui agit sur la foi d'un `systemd_start_unit` réussi doit pouvoir faire confiance à ce que ce succès signifie.
4. **Étendre l'audit NDJSON** (OS-08, confirmé) aux refus de policy/scope, aux échecs d'authentification et à `tools/call` lui-même (sans dupliquer les payloads volumineux), avec mode de fichier `0600` et rotation. L'audit sert la traçabilité d'un agent déjà autorisé à tout faire, pas un filtre — mais `system/audit_status` qui annonce un pont actif alors que l'essentiel des événements n'y transite jamais est une revendication à corriger.
5. **Fermer la fenêtre de blocage `coreutils_run`** (OS-10, anti-blocage) : appliquer un timeout indépendant sur `read_capped` après le `kill()`, ou passer par un groupe de processus (`aphrody_proc::spawn_group`/`kill_tree`, déjà disponible ailleurs dans le dépôt) pour que le timeout tue réellement l'arbre de processus — pas pour restreindre ce qu'un agent peut lancer, mais pour que le noyau ne reste pas bloqué à attendre un pipe hérité par un petit-fils.

Compléments (intégrité/fiabilité, pas confinement) : purge automatique périodique pour `aphrody-jobs`/`aphrody-fsindex` (actuellement manuelle, risque de croissance non bornée) ; mode `0600` explicite à la création des fichiers `.db` de `jobs`/`fsindex` (cohérence avec l'intention « privacy-bounded » déjà documentée pour fsindex) ; `fsync` du répertoire parent après `rename` dans `cron`/`search`/`telemetry` pour une durabilité réelle après coupure brutale ; borner les canaux `unbounded_channel` de `kernel/src/client.rs` (anti-fuite mémoire, pas un filtre de contenu).

---------------------------------------------------------------------------------------------------

## 10. NON EXAMINÉ

- `crates/os/base/src/injector.rs` au-delà de sa signature générale : lecture interrompue par un classifieur de sécurité ; fait établi seulement : le fichier existe, compile sous `cfg(target_os="windows")`, et `rg` ne trouve aucun appelant dans le dépôt (code mort apparent, non confirmé en profondeur).
- `crates/os/kernel/src/admin.rs` : seul le dispatch de tête et les tests ont été lus ; le corps complet de `aphrody_winclean::dispatch::call_rust` appartient au périmètre `winclean` déjà couvert par `os.md` (OS-04 et section 5 là-bas) — non re-détaillé ici.
- `crates/os/kernel/src/cloud_gcs.rs` au-delà des lignes 1-160 déjà lues en vague 1 : non relu ; `crates/os/kernel/src/cloud_git.rs` lignes 1-254 (`status`/`branches`/`tree`) : non relu dans cette vague (lu partiellement en vague 1, section 76-150/340-420 d'`infra.rs` cette fois).
- `crates/os/task-runner/src/lib.rs` lignes 60-486 et 700-1040 (types `TaskGraph`/`TaskSpec` complets, `cascade_skips`, `execute_task_with_retries` en détail) : lus par échantillonnage (scheduler central), pas ligne à ligne.
- `crates/os/settings/src/lib.rs` au-delà de la structure de couches (`SettingsLayer`, `read_json_if_exists`) : la validation JSON Schema (`validate_against_schema`) et `env_to_json` n'ont pas été relues en détail.
- `crates/os/search/src/everything.rs`, `crates/os/fsindex/src/everything.rs` : déjà couverts intégralement par OS-12 (`os.md`), non relus.
- `crates/os/drive` (workspace imbriqué FSL, 240k lignes) : hors périmètre par construction (mandat : seulement sa frontière). Seule `crates/ui/drive/src/service.rs` (1-90) a été lue côté frontière ; le reste de `crates/ui/drive` (bridge macOS/Swift, protocole IPC avec `sd-daemon`, gestion des événements) n'a pas été lu.
- `crates/os/execpolicy` : tests restants de `parser.rs`/`policy.rs`/`rule.rs` au-delà des extraits cités ; `error.rs` lu en entier mais sans détail rapporté (trivial : `thiserror` wrapper).
- `packages/os/winclean` (Bun) : hors périmètre explicite de cet axe (couvert par l'axe winclean/ART de la vague 1/2 si traité ailleurs).
- Comportement Windows réel de `transport.rs` (named pipe DACL) : relu mais non testé dynamiquement — déjà couvert et non reproduit en vague 1.
- Aucun test dynamique, Miri, ASAN, fuzz, ni `cargo deny/audit/clippy` exécutés (interdit par le brief).
