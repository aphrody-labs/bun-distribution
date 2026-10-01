# Axe ai-runtime : surface privilégiée de la couche agent (crates/ai, 62 crates)

Date : 2026-10-01. Niveau de preuve global : P1 (statique, aucun cargo, aucun test lancé).
Marqueurs : [V] vérifié dans le code lu, [P] plausible / non reproduit.

## 0. Cadrage retenu (correction du propriétaire, docs/reference/os/YOLO-AUTHORITY.md)

Après lecture de `docs/reference/os/YOLO-AUTHORITY.md` : l'autorité totale de l'agent authentifié
(shell-exec, apply_patch, computer_use sans approbation, `AutonomyMode::FullAuto` par défaut,
`approval_policy=never`, garde `APHRODY_GUARD` désactivée par défaut, absence de jail de chemins)
est VOULUE. Je ne la rapporte pas comme défaut et ne recommande ni approbation, ni sandbox, ni
liste d'interdits. Le point (1) « injection de prompt -> autorité d'outil » est donc recadré :

- Fait structurel (pas un défaut) : le graphe (/tmp/stack-dedup/metadata-after.json) montre que
  `aphrody-engine`, `aphrody-agent-runtime`, `aphrody-app-server` ne dépendent NI de `aphrody-sandbox`,
  NI de `aphrody-execpolicy`, NI du moteur de permissions (`aphrody-skills::permissions`, utilisé
  seulement par `aphrody-chat`/`aphrody-sdk`). Seul `aphrody-agent-tools -> aphrody-guard`
  (opt-in `APHRODY_GUARD`, `crates/os/guard/src/lib.rs:40-45`). Cohérent avec la doctrine.
- Ce qui reste légitime et est audité ci-dessous : (a) qui peut parler à l'agent (authentification
  du principal sur chaque listener), (b) secrets de fournisseurs (stockage, journaux, Debug),
  (c) intégrité/provenance des modèles et bibliothèques natives chargés, (d) fiabilité (OOM, panics,
  deadlocks, tâches orphelines, apply_patch non atomique), (e) exactitude des revendications,
  (f) lacunes fonctionnelles, (g) briques mûres à réutiliser.

Constats que j'avais préparés puis RETIRÉS ou RECLASSÉS (transparence) :
- `shell`/`apply_patch`/`read_file` sans confinement de chemin, `cwd` arbitraire, environnement
  hérité : voulu (autorité du principal). Non rapporté.
- `ToolSafety::Escalate` jamais honoré (`engine/src/turn.rs:701` ne teste que `Refuse`), requête
  d'approbation qui ne porte que le nom d'outil (`turn.rs:799`) : sans objet sous YOLO ; conservé
  uniquement comme exactitude de revendication (AIR-09), sans recommandation d'implémenter.
- `project-doc` qui suit les symlinks vers le prompt (`project-doc/src/lib.rs:45-47`) : documenté et
  assumé. Non rapporté.
- Corps de page web / sortie MCP / fichier renvoyés tels quels au modèle (`agent-tools/src/web_tools.rs`
  `ToolOutput::ok(body)`) : conséquence de la doctrine.

## 1. Périmètre réellement lu

Lu (fichiers, lignes approximatives) :
- app-server : `lib.rs` 1-780, 1520-1830 ; `config.rs` 1-227 ; `web.rs` ; `Cargo.toml` ; `apps/cli/src/app_server_cmd.rs`.
- engine : `turn.rs` 1-849, `actor.rs` 1-260, `approval.rs`, `config.rs`, `lib.rs`.
- agent-tools : `shell.rs` 1-470, `apply_patch.rs` 1-229, `read_file.rs`, `search_text.rs`, `web_tools.rs` 1-330 ; lib.rs.
- patch : `fs.rs`, `apply.rs`, `parser.rs` 1-140 (+ grep).
- agent-runtime : `tools.rs` 1-500, `factory.rs` 1-200, `managed_provider.rs` 60-300, `repair.rs` 1-120.
- gateway : `server.rs` ; `apps/cli/src/gateway_cmd.rs` 40-150.
- mcp : `main.rs` 748-800, 2320-2362, 3160-3420, 3560-3700 ; `http_rest.rs` 1-260, 850-975, 1520-1560, 1657-1860 ; `photoshop_bridge.rs` 1-200 ; `tauri_tools.rs` 1-80 (+ grep des autres modules).
- rmcp-3.4.1 (registre) `streamable_http_server/tower.rs` : défauts `allowed_hosts`/`allowed_origins`.
- mcp-client : `transport/stdio.rs`, `client.rs` 80-140.
- antigravity : `auth.rs` (entier), `oauth.rs` 1-560, `local_ls.rs` 150-310, 395-520, `client.rs` 40-80 ; `apps/cli/src/antigravity_cmd.rs` (grep des sorties).
- session : `lib.rs` 136-200, 530-635 ; `external/sync.rs` 285-460 ; rollout : `lib.rs` 95-200, 380-470.
- config : `provider.rs` 1-130, `resolve.rs` 205-245, `policy.rs` 78-112, `shenron.rs`.
- llama-server : `state.rs` (entier), `supervisor.rs` 280-389, `spec.rs` 100-260 ; `os/proc/src/unix.rs` 55-160.
- models : `fetch.rs` 1-330, `id.rs` 150-260, `store.rs` (path_for/adopt), `inspect.rs` 1-60 + grep bornes ; `catalog.rs` 540-556.
- embed : `server.rs` 1-130, `bin/aphrody-embed/main.rs`, `native/download.rs` 1-200 ; infer : `runtime.rs` 1-260, `session.rs` 100-260.
- train : `runner.rs` 56-335, `promote.rs` 1-140.
- agent-home : `guard.rs`, `home.rs` 100-160, `mmap.rs` 80-110, `sync.rs` 1-40, `git.rs` 1-60.
- project-doc : `discover.rs` 60-160 ; prompts : `unified_system_prompt.rs` ; `apps/cli/src/exec_cmd.rs` 140-260.
- tools (pile d'outils alternative) : `permissions.rs`, `write_file.rs` 120-175, `web_fetch.rs` 1-120 ; skills : `permissions.rs` (en-tête).
- ocr-vlm `server.rs` 50-170 ; jev `bin/aphrody-jev.rs` ; web-bridge `cli.rs` 130-330, `fetch.rs` 215-360 ; translate `shenron.rs` 1-200 ; marketplace (grep) ; memory (grep) ; mcp-oauth (grep).

## 2. Constats (les plus graves d'abord)

### AIR-01 | HAUTE | Gateway : CORS `*`, aucune authentification, bind non contraint, jetons du fournisseur de l'utilisateur
- `crates/ai/gateway/src/server.rs:57-70` (`serve_gateway` : `TcpListener::bind(addr)` sans test `is_loopback`, malgré le doc `/// ... over the given loopback address`), `:224-236` (`add_cors_headers` : `Access-Control-Allow-Origin: *`, méthodes et en-têtes permissifs, y compris sur le preflight `cors_preflight`), `:82-95` routes `/v1/chat/completions` sans aucune vérification de principal, d'Host ni d'Origin.
- `apps/cli/src/gateway_cmd.rs:51-62` : `--addr` est seulement parsé en `SocketAddr` (défaut `127.0.0.1:8795`) ; `0.0.0.0:8795` est accepté. `:105-125` `resolve_adapter` : l'adaptateur emploie `GoogleAntigravityAdapter::from_env()` ou le jeton Antigravity du Gestionnaire d'identifiants (`token_from_credential_manager`), `OPENAI_*`, `gemini-cli`.
- Lu : le service dépense les identifiants de l'utilisateur pour tout appelant. Une page web quelconque peut faire `fetch("http://127.0.0.1:8795/v1/chat/completions")` (preflight accepté par `*`) et lire la réponse ; un processus local ou un hôte du réseau (si bind élargi) idem. Effet navigateur [P] : Chrome récent demande une permission « réseau local » (Private Network Access / Local Network Access), Firefox/Safari non vérifiés.
- Comparer : `aphrody-jev` fait bien (loopback par défaut, clés `APHRODY_JEV_SERVER_KEYS` obligatoires hors loopback, `bin/aphrody-jev.rs:42-58`), `aphrody-mcp http` refuse le non-loopback (`mcp/src/main.rs:3629`).

### AIR-02 | HAUTE | aphrody-mcp HTTP : la barrière de jeton Shenron est nominale ; routes REST sans principal ni contrôle Host
- `mcp/src/http_rest.rs:136-153` `shenron_auth` exige `Authorization: Bearer <HTTP_TOKEN>` pour `/api/v1/shenron/*` (ex. `:853-858` ingest). Mais `:1526-1532` `mcp_shenron_rag_ingest` / `mcp_shenron_llm_chat` appellent directement `shenron_rag_ingest_core` / `shenron_llm_chat_core` SANS `shenron_auth`, et `mcp/src/main.rs:2330-2362` les expose comme outils MCP sur `/mcp` (`:3638-3644` `http_app()` : `StreamableHttpService` sans authentification de principal). Un client `/mcp` écrit donc dans le corpus `shenron` (RAG alimentant un produit public) et consomme le LLM sans jeton. Écriture : upsert `aphrody_rag_documents` (`http_rest.rs:860-940`), `url` http(s) arbitraire stockée comme citation.
- `http_rest::router()` (`:109-132`) est fusionné hors du service rmcp : l'allow-list `Host` par défaut de rmcp (`rmcp-3.4.1/src/transport/streamable_http_server/tower.rs:195` : `localhost`, `127.0.0.1`, `::1`) ne s'applique qu'à `/mcp`. Les routes `/v1/chat/completions` (`:1657`), `/api/v1/rag/query` (`:1760`), `/api/v1/rag/stats` ne vérifient ni Host, ni Origin, ni jeton : DNS rebinding depuis un navigateur lit le RAG privé (réponse `Cache-Control: public, max-age=60`, `:1814`, `:1860`) et utilise le LLM local. Origine : rmcp ne valide pas `Origin` tant que `allowed_origins` est vide (`tower.rs:~935-940`).
- Mineur : comparaison de jeton non constante (`:150`), `reqwest::Client::new()` par requête (`:189,201,1088,1203,1330,1675,1718`), connexion Postgres neuve et `NoTls` par requête (`:1747-1750`) : cleartext si `APHRODY_MCP_DATABASE_URL` est distante.

### AIR-03 | HAUTE | app-server : aucun principal ; les surcharges `config` du client sont une primitive d'exfiltration de secrets
- `app-server/src/lib.rs:1627-1646` `serve_http` : loopback imposé (bon), mais `:1655` et `:725` publient `authentication_required: false` ; tout processus local passant `trusted_headers` (`:1756-1790`) pilote l'agent (autorité complète). `:1744-1751` : `Access-Control-Allow-Origin: *` sur toutes les réponses (health, preflight, rpc, events). Bon point : Host loopback + `Sec-Fetch-Site != cross-site` + Origin `tauri` ou même hôte bloquent le navigateur et le DNS rebinding [V].
- `app-server/src/config.rs:97-114` : `thread/start` accepte `params.config` (objet arbitraire) en couche `CliOverride` ; `agent-runtime/src/factory.rs:100-120` `provider_credential` lit `std::env::var(info.env_key)` et `provider_runtime` l'envoie en `Authorization: Bearer` à `info.base_url` (tous deux issus de cette surcharge). Un client RPC choisit donc n'importe quelle variable d'environnement du serveur et l'URL de destination. Même vecteur pour `mcp_servers.*.command`, `rag.db_path`, `llama.extra_args`.
- Recommandation de principal, pas de sandbox : jeton porteur optionnel obligatoire hors Tauri (modèle jev), et provenance : `env_key`/`base_url` ne viennent que de `config.toml` utilisateur, pas des paramètres RPC.

### AIR-04 | MOYENNE | Pont Photoshop : WebSocket sans authentification ni Origin, « dernière connexion gagne », nettoyage qui écrase la nouvelle connexion
- `mcp/src/photoshop_bridge.rs:94-107` accept sans filtre, `:113` `accept_async` sans contrôle d'Origin (un navigateur n'applique pas la SOP aux WebSocket), `:123` `*sender = Some(tx)` remplace la connexion légitime : une page web peut devenir « le plugin », recevoir les commandes `eval`/`batchPlay` et répondre des résultats forgés (`:150-200` `call`).
- Fiabilité [V] : `:145` `*bridge().sender.lock().await = None` s'exécute à la fin de TOUTE connexion, y compris une ancienne : après reconnexion du plugin, la fin de l'ancienne tâche efface l'émetteur de la nouvelle (bridge « non connecté »). `unbounded_channel`, pas de limite de connexions.
- Collision de ports [V] : `DEFAULT_BRIDGE_PORT = 8765` (`:43`) et l'app-server HTTP par défaut `127.0.0.1:8765` (`apps/cli/src/lib.rs:1055`) ; le bind du pont échoue « non fatal » (`:107`) et le plugin parle alors au serveur JSON-RPC. Voir aussi T-13 (8788).

### AIR-05 | HAUTE (fiabilité) | apply_patch non atomique : dépôt laissé à moitié patché, fichier tronqué, mode perdu
- `patch/src/apply.rs:58-59` (documenté : « hunks processed before the failure may already have been written »), boucle `:63-111` applique et écrit hunk par hunk sans phase de validation globale ; `patch/src/fs.rs:50-57` `StdFileSystem::write` = `create_dir_all` + `std::fs::write` (O_TRUNC puis écriture, ni tmp+rename, ni fsync) : un crash, ENOSPC ou une erreur en milieu de patch corrompt le fichier ou laisse le dépôt incohérent.
- `apply.rs:96-111` `Move to` : écrit la destination (mode par défaut, bit d'exécution perdu) puis supprime la source ; si `remove` échoue la destination existe en double. `Hunk::AddFile` teste `fs.exists(path)` (suit un symlink pendant, `fs.rs:62-64`) puis écrit (course).
- `derive_new_contents` (`apply.rs:~118-135`) ajoute toujours une ligne finale vide (réécrit un fichier sans newline final). `apply_replacements` (`:~190-205`) fait `lines.remove` en boucle : O(n·m) sur gros fichiers [P].
- Brique existante dans le dépôt : `aphrody-tools::write_file::write_atomic` (`tools/src/builtin/write_file.rs:125-165`, tmp + `sync_all` + `rename`) — l'autre pile d'outils l'a, la pile de production non (dérive). Défaut de cette version : nom tmp fixe `.<nom>.tmp.<pid>` et mode non recopié ; préférer `tempfile::NamedTempFile::new_in(dir)` + permissions + `persist`.

### AIR-06 | HAUTE (fiabilité) | read_file / search_text : lecture non bornée avant plafond, sortie `rg` bufferisée sans délai, argv `rg` injectable
- `agent-tools/src/read_file.rs:52-56` : `tokio::fs::read(&path)` charge TOUT le fichier avant de comparer à `MAX_READ_BYTES` (`:11`) ; pas de contrôle `is_file()` : `/dev/zero`, un fichier de plusieurs Go ou un FIFO épuisent la mémoire ou bloquent la tâche [V].
- `agent-tools/src/search_text.rs:56-64` : `command.output().await` accumule tout stdout en mémoire avant `truncate` (`:66-70`) ; aucun timeout, pas de `kill_on_drop` ; `.arg(&args.pattern)` sans `--`/`-e` : un motif commençant par `-` est lu comme option `rg` (comportement faux, y compris `--pre=<cmd>` qui exécute un programme : contourne l'exactitude d'une allow-list `ToolProfileSpec.builtin_tools` « exacte », `agent-runtime/src/tools.rs` `allows_builtin`). `--hidden` inclut `.env`, `rg` résolu par `PATH`.
- Correctif de fiabilité : `-e pattern -- path`, `--max-count`, `--max-filesize`, lecture en flux avec plafond, timeout ; ou crate `ignore` (déjà dans Cargo.lock) + `grep-searcher` (absent, à évaluer).

### AIR-07 | MOYENNE (fiabilité) | Interruption et arrêt : l'outil en cours n'est pas annulable ; timeout fixé par le modèle
- `engine/src/turn.rs:737-745` : `executor.handle(...).await` n'est pas mis en concurrence avec `interrupt.cancelled()` (le drapeau n'est lu qu'entre deux appels, `:~685`). `engine/src/actor.rs:231-254` : `Op::Interrupt`/`Op::Shutdown` ne font que `interrupt.trip()` ; `drive_turn` ne rend la main qu'à la fin du tour. `AppServer::shutdown` (`app-server/src/lib.rs:~455-470`) `join()` chaque session : bloqué tant qu'un `shell` tourne.
- `agent-tools/src/shell.rs:217` : `timeout_ms` vient de l'argument d'outil sans plafond ; défaut 30 s (`:13`) contournable par le modèle. Les enfants sont bien tués au timeout (`:346-366`, `killpg`), mais jamais sur interruption. Voir T-06 (signaux CLI).
- Brique : `aphrody-proc` (`os/proc`, `spawn_group`, `GroupChild`, `kill_tree`, déjà utilisé par llama-server `daemon.rs:24,155`) au lieu du `libc::killpg` local de `shell.rs:346-360`.

### AIR-08 | MOYENNE (lacune fonctionnelle) | Shell « en streaming » non câblé
- `agent-tools/src/shell.rs:25-27,113-118,403` : `OutputSink`/`with_sink` existent ; `rg "with_sink"` : appels uniquement dans `shell_tests.rs:175,192`. `agent-runtime/src/tools.rs:330-331` construit `ShellExecTool::with_config(...)` sans sink. Aucun producteur de `EventMsg::ExecCommandOutputDelta` dans engine/agent-runtime ; le consommateur existe (`shell/tui/src/state.rs:203`). La sortie live n'atteint jamais le TUI ni l'app-server [V].
- À câbler avec un canal borné : `shell.rs:403` envoie chaque chunk au sink sans limite (le plafond 64 Kio ne protège que le tampon final), et la troncature garde la tête, pas la queue (`:405-418`).

### AIR-09 | MOYENNE | Revendications inexactes (promesse nominale)
- `sandbox_mode` : défaut `WorkspaceWrite` documenté « Read-write confined to the resolved workspace roots » (`config/src/policy.rs:78-97`), affiché par `aphrody config` (`apps/cli/src/config_cmd.rs:123`), imposé par `--full-auto` (`config/src/resolve.rs:230-237`). `rg sandbox_mode` : aucun consommateur côté runtime/CLI hors affichage ; seul l'app-server le vérifie (`app-server/src/config.rs:126-133`, honnête : refuse tout sauf `danger-full-access`). Sous YOLO la correction est de dire la vérité (renommer, marquer inerte, ou afficher `danger-full-access`), pas d'ajouter un sandbox.
- `agent-runtime/src/tools.rs` doc : « do not depend on aphrody-guard » alors que `agent-tools` en dépend (`agent-tools/src/shell.rs:~262,~438`). `toolcall/src/lib.rs:~650` : `Escalate` « should be escalated for approval » ; `turn.rs:701` ne traite que `Refuse`.
- `agent-home/src/guard.rs:1-20,91-120` : « path-containment sandbox ... canonicalises » ; en réalité normalisation lexicale du candidat, seul le root est canonicalisé ; `read_to_string` (`:114-127`) et `home.rs:117-130` suivent un symlink interne. Les chemins voisins le font bien (`sync.rs:68` `symlink_metadata`, `git.rs:131` saute les symlinks) : incohérence [V].
- `embed/src/server.rs:98-106` : `load_model` documenté « fails its hash check » ; il appelle `require_installed` = taille seule (`native/download.rs:60-72`). Le SHA-256 est vérifié à l'installation (`:150-163`) et par `verify_model`, pas au chargement.
- Skill `aphrody-rag/SKILL.md` : `rag serve`, `rag status`, `rag eval` ; `apps/cli/src/rag_cmd.rs` n'a que `Index`, `WebIngest`, `Search`, `IngestShenron`, `Context`, `Stats` (aucun listener `rag serve`, port 8085 introuvable).

### AIR-10 | MOYENNE | Secrets de fournisseurs : `Debug`/`Serialize` en clair, clé dans l'URL, erreurs reqwest qui citent l'URL
- `derive(Debug)` sur types portant des secrets : `antigravity/src/auth.rs:80-90` (`OAuthToken` : access/refresh), `model-client/src/lib.rs:678-690` (`GeminiClient.api_key`), `model-client/src/openai_compat.rs:57-75` (`ProviderRuntime.bearer_token`, `headers`), `config/src/provider.rs:~66` (`ModelProviderInfo.experimental_bearer_token`, aussi `Serialize`), `gateway/src/openai_proxy.rs:54-58`, `google_antigravity.rs:95-98`, `vercel.rs:49-52` (`api_key`, `Debug` + `Serialize`), `mcp-oauth/src/flow.rs:23-35` (`TokenResponse`), `gemini-runtime/src/auth.rs:258-264`. Aucun site de log de ces structures trouvé : latent [P].
- Fuite effective probable : `model-client/src/lib.rs:714-716` place la clé Gemini dans la requête (`?alt=sse&key=...`) ; `ModelError::Http(#[from] reqwest::Error)` (`:53-54`) ; reqwest 0.12.28 `Display` ajoute ` for url (<url>)` (`error.rs:267-269`) ; `engine/src/turn.rs` émet `EventMsg::Error { message: err.to_string() }` -> sink, app-server, rollout sur disque. `without_url` n'est appelé nulle part. `GeminiClient` n'a pas d'appelant hors `model-client` (latent).
- `antigravity/src/client.rs:62` journalise un préfixe de 10 octets du jeton (tranche d'octets, panique possible sur UTF-8) ; faible.
- Bons exemples dans le dépôt : `firefly/src/auth.rs:42-47,99-103`, `gemini-web/src/auth.rs:43`, `jev/src/lib.rs:126`, `gemini-runtime/src/web_search.rs:322` (`scrub_api_key`), `config/src/shenron.rs` (présence seulement), `antigravity_cmd.rs:118-149` (jamais d'octets de jeton). Briques : `aphrody-secrets::SecretValue` (`os/secrets/src/lib.rs:3-6`, Debug rédigé, zeroize, comparaison constante), `secrecy 0.10.3` (déjà dans Cargo.lock), ou `.without_url()` sur les erreurs reqwest.

### AIR-11 | MOYENNE | Données sensibles au repos avec droits par défaut (umask) : sessions, miroirs, caches OAuth, états
- Seuls 3 sites de crates/ai fixent des droits : `memory/src/bin/aphrody-agent-home-memory.rs:18-25` et `antigravity/src/oauth.rs:485-501` (0600 à la création : à garder). Tout le reste hérite de l'umask : `rollout/src/lib.rs:132,140` (journaux de session = historique complet, sorties d'outils, images base64), `session/src/external/sync.rs:409-413` (miroirs des sessions Codex/Claude/agy copiés dans `~/.aphrody/sessions/<agent>/`), `mcp-oauth/src/registration.rs:238-244` (cache `mcp-oauth-clients.json` avec `client_secret`), `llama-server/src/state.rs:153-162` et `daemon.rs:147` (état, log), `ocr-vlm/src/server.rs:94` (log dans `temp_dir()/aphrody-llama-server-{port}.log`, nom prévisible, `File::create` suit un symlink).
- Aucun quota ni rotation des rollouts (`record_async` écrit tout) : croissance disque non bornée [V]. Reprise : `app-server/src/lib.rs:~537-560` lit tout le fichier en mémoire (`read_to_string`, `collect`).
- `session/src/lib.rs:147-152,552` : `SessionId::new` ne valide rien (« caller is responsible »), `file_for` = `dir.join("<id>.jsonl")` : traversée via `JsonlFileStore` (aucun appelant de production, latent).
- Briques : `os/secrets` (stockage chiffré `EncryptedFileSecretStore`, AES-GCM + Argon2id) ou `keyring 4.2.0` (MIT/Apache-2.0, dans Cargo.lock via `koharu-secrets`, importé, à évaluer) ; `OpenOptionsExt::mode(0o600)` comme `antigravity/oauth.rs:496`.

### AIR-12 | MOYENNE | Antigravity : écrasement du jeton d'un autre éditeur, accept unique, processus orphelin, secret en argv
- `antigravity/src/oauth.rs:425-430,511-545` : sous Windows `persist` ÉCRIT la cible `gemini:antigravity` (celle de l'application Antigravity d'un autre éditeur) avec `CRED_PERSIST_LOCAL_MACHINE` ; le contenu `{"token": token}` place `auth_method` à l'intérieur du jeton alors que le lecteur (`auth.rs:130-160`) l'attend au niveau supérieur (perte silencieuse) ; réutilise aussi l'identifiant client public Antigravity (`auth.rs:25`) et son User-Agent (`client.rs:70-80`) : risque de conformité [P].
- `oauth.rs:236-262` `accept_callback` : une seule connexion est acceptée ; un préchargement/une autre connexion locale la consomme, le `read` n'a pas de délai propre (seulement le délai global de 120 s `:214`) ; échange de jeton avec `reqwest::Client::new()` sans timeout (`:341`).
- `local_ls.rs:274-275` `--csrf_token <secret>` en argument (visible dans `/proc/<pid>/cmdline`), `:286` `stdout`/`stderr` en `piped()`, `:296,413-428` `read_port` consomme `ChildStdout` par valeur puis l'abandonne, `stderr` n'est jamais lu : le serveur de langage peut recevoir EPIPE/SIGPIPE ou se bloquer à 64 Kio de logs [P] ; résolution du binaire par `PATH` (`:182-232`). `LanguageServer::launch` n'a aucun appelant : API morte.
- À garder : PKCE S256, `state` vérifié (`oauth.rs:~205-220`), jamais d'octets de jeton imprimés par la CLI, 0600 à la création côté Unix (Unix : fichier tronqué puis écrit, non atomique `:489-501`).

### AIR-13 | MOYENNE | Provenance et intégrité des modèles et bibliothèques natives
- `models/src/fetch.rs:60,180` : `PullOptions.expected_sha256: Option<String>` ; `llama-server/src/managed.rs:270-295` et `models/src/lib.rs:160-175` : `Resolved::Direct(reference)` donne `None` -> aucun contrôle ; `models/src/id.rs:68,88` accepte `http://` (clair) ; `fetch.rs:258-268` aucune limite de taille ni vérification d'espace disque ; reprise `Range` sans `If-Range` (`:213-216`) peut recoller des versions différentes ; révision par défaut `main` (mutable). Ensuite le registre enregistre le hash calculé (TOFU) : `verify` détecte les dérives après installation. Poids exécutés par llama.cpp (analyseur GGUF natif) sans empreinte pour les références directes.
- `embed` : manifeste épinglé (revision + sha256 + taille, `embed/src/native/manifest.rs:176-181`), téléchargement tmp+rename+fsync, arrêt si plus gros que prévu (`download.rs:150-163`) : exemplaire ; mais le chargement ne revérifie que la taille (AIR-09) puis `mmap` (`candle_backend.rs:34`, `bert.rs:202`) : un fichier modifié ou tronqué pendant le mapping provoque SIGBUS [P].
- `infer/src/runtime.rs:93-105` et `session.rs:136-148` : `APHRODY_ORT_DYLIB`, `ORT_DYLIB_PATH`, `~/.aphrody/runtimes/onnxruntime-*/lib` ou, à défaut, recherche du chargeur (`SystemSearchPath` : nom nu `onnxruntime.dll`/`libonnxruntime.so`, ordre de recherche Windows) ; `colocate_cuda_libraries` (`runtime.rs:228-250`) lie ou copie `cublas64_*.dll`, `cudart64_*.dll` depuis `CUDA_PATH`, `runtimes/*` et `runtimes/cache/*` à côté d'ORT, sans empreinte ni signature [P]. Aucun installateur d'ORT/llama trouvé dans le code lu : provenance des runtimes hors périmètre vérifiable.
- `train/src/runner.rs:61-84` projet Python cherché via `APHRODY_PY_ROOT`, le dépôt ou un `../aphrody-py` voisin ; `:138-146` `uv run --project ... --package aphrody-train` sans `--frozen/--locked/--offline` (peut résoudre et télécharger) ; `:190-192` `stderr` vers `/dev/null` (échecs opaques) ; `:225` chemin d'artefact fourni par l'enfant (`PathBuf::from(path)`) sans confinement à `output_dir` ; `promote.rs:61-110` la porte de promotion consomme des métriques déclarées par le processus qui entraîne (le jeu or lui est passé `--gold-file`) : intégrité de l'évaluation non indépendante [P].
- À garder : test `catalog.rs:540-556` (tout poids du catalogue porte un SHA-256), jeton HF limité à `https://huggingface.co/` (`fetch.rs:~300-312`), assainissement des chemins de cache (`id.rs:233-246`), inspection d'en-têtes bornée (`inspect.rs:1-20,369-420`, arithmétique vérifiée), `.part` + rename + fsync.

### AIR-14 | MOYENNE | Superviseur llama-server : SIGKILL sur pid lu d'un fichier (confirme T-12) et port lu d'un fichier
- Confirme T-12 : `llama-server/src/supervisor.rs:359-366` `for pid in [state.daemon_pid, state.server_pid] { if process_alive(pid) { terminate_process(pid) } }` ; `os/proc/src/unix.rs:93-113` `kill_process(pid, KILL)` et `process_alive` compte `EPERM` comme vivant ; aucun contrôle d'identité (heure de démarrage, exe, groupe). Un `run/llama-server-<role>.json` obsolète après reboot/réutilisation de pid tue un processus étranger. `stop_all` est appelé avant l'entraînement (GPU lease).
- `state.rs:114-121` `base_url()` reconstruit l'URL depuis le port du fichier ; `discover_running` (`:~190-197`) ne vérifie que `process_alive(daemon_pid)` : les prompts partent vers le processus qui occupe ce port. `state.rs:153-162` tmp prévisible `<fichier>.<pid>.tmp`, droits par défaut.
- Brique : `GroupChild`/job object d'`aphrody-proc` pour tuer par groupe possédé plutôt que par pid brut ; enregistrer `starttime` (`/proc/<pid>/stat`) ou un jeton dans le fichier d'état.

### AIR-15 | MOYENNE (perf/fiabilité) | app-server : verrou global tenu pendant les awaits longs, flux d'événements destructif
- `app-server/src/lib.rs:1676` (`/rpc`) : `state.lock().await` puis `server.handle(&line).await` ; `thread/start` attend `prepare_managed_provider` (chargement llama, minutes) (`:~580-600`) : `/events` (`:1707`), `/notifications` (`:1727`) et tout le RPC sont bloqués. `drain_notifications` (`:~640-650`) fait `std::mem::take` : `/events` (SSE, tick 50 ms) et `/notifications` se partagent des évènements consommés une seule fois ; deux clients se volent les évènements [V]. `serve_stdio` sonde toutes les 10 ms.
- `engine/src/turn.rs:567` : `session.history().to_vec()` à chaque itération (avec `with_yolo` = `max_tool_iterations 0`, images base64 comprises) : O(n²) mémoire sur les longues sessions [P].
- `mcp-client/src/transport/stdio.rs:90-100,~120` : `lines().next_line()` sans limite de longueur (serveur MCP bavard = mémoire), stderr `null`, `shutdown` ne tue que le chef.

### AIR-16 | BASSE | Divers
- `agent-home/src/mmap.rs:91-99` : bootstrap files mappés (`SOUL.md`, etc.) alors que `agent-home/src/sync.rs` documente une réécriture externe (watcher Infra / transport Google) : SIGBUS [P].
- `translate/src/shenron.rs:61-100` : `proteger_termes` masque avec 16 jetons latins (« Zeta », « Nova », ...) ; `restaurer_termes` itère `table.keys()` d'un `HashMap` (ordre aléatoire pour jetons de même longueur) et `replace` global : un jeton présent dans la traduction ou un terme français contenant un autre jeton donne une sortie non déterministe [P].
- `marketplace/src/lib.rs:374,390,...` : index intégré avec SHA-256 factices `00...01..09` ; pas d'installateur dans le crate.
- `exec_cmd.rs`/`agy_provision.rs:121,229`/`codex_provision.rs:214,268` : réécriture non atomique (`fs::write`) de `~/.codex/config.toml`, `AGENTS.md`, `skills.json` d'outils tiers à chaque lancement.

## 3. À garder (correct)
- `app-server` : refus explicite de tout ce qu'il ne peut pas appliquer (`lib.rs:1523-1545`, `config.rs:126-133`), contrôle Host/Origin/Sec-Fetch (`:1756-1790`), loopback imposé (`:1627-1633`), identifiant de thread comparé à la méta (`:733-760`), marqueur d'archive en hex (`:~455`).
- `aphrody-jev` : loopback par défaut, clés obligatoires hors loopback ; `aphrody-mcp http` : loopback imposé (`main.rs:3629`) et allow-list Host de rmcp.
- `session/src/external/sync.rs:299-312` (assainissement du nom de miroir, préfixe `ext-`), `state.rs:91-105` (écriture atomique + fsync) ; `exec_cmd.rs:149-156` (`profile_conversations` canonicalise et contrôle l'appartenance).
- `models` (téléchargeur, store, inspection), `embed` (manifeste épinglé), `antigravity` (0600, jamais de jeton imprimé).

## 4. Natif first-party vs enrobage (point 7)
- Natif first-party (code propre) : boucle de tour `aphrody-engine`, outils `agent-tools` (shell, apply_patch Codex-format, read_file), `aphrody-patch`, clients `aphrody-model-client` (OpenAI-compat, Anthropic, Gemini SSE), `aphrody-rollout`, app-server JSON-RPC, `aphrody-models` (store, téléchargeur, analyseurs GGUF/safetensors/ONNX), encodeur BERT natif d'`aphrody-embed` (candle seulement en contrôle de parité), RAG SQLite FTS5.
- Enrobage d'un outil/binaire externe : llama.cpp `llama-server` (supervisé par `aphrody-llama-server`), ONNX Runtime (`ort` `load-dynamic`), `uv`+Python (`aphrody-train`), `rg` (`search_text`), serveur de langage Antigravity (API morte), Honcho/mem0/LanceDB (mémoire), moteur web Obscura/bxc (importé).

## 5. Briques mûres à réutiliser (nom, licence, Cargo.lock, statut « à évaluer »)
| Besoin | Brique | Licence | Cargo.lock | Note |
|---|---|---|---|---|
| Écriture atomique apply_patch | `tempfile::NamedTempFile::persist` (3.27.0) ; `aphrody-tools::write_atomic` (first-party) | MIT/Apache-2.0 | présent (dev-dep d'agent-tools) | copier mode et permissions |
| CORS en liste blanche, jeton porteur | `tower-http` 0.6.11 (`CorsLayer`, feature `cors` déjà activée au workspace ; `validate-request` non activée) | MIT | présent (`aphrody-a2a-server`) | à évaluer ; modèle first-party : jev |
| Comparaison constante, secrets | `aphrody-secrets::SecretValue` (first-party), `secrecy` 0.10.3, `subtle` 2.6.1 | Apache-2.0/MIT, BSD-3 | présents | remplace `String` des clés |
| Coffre de clés fournisseurs | `keyring` 4.2.0 (via `koharu-secrets`, importé) ; `os/secrets` chiffré | MIT/Apache-2.0 | présent | à évaluer |
| Groupe de processus / annulation | `aphrody-proc` (`spawn_group`, `GroupChild`) | first-party | présent | remplace `libc::killpg` local |
| Recherche texte en flux | `ignore` 0.4.33 (déjà utilisé par `aphrody-rag`) ; `grep-searcher`/`grep-regex` | Unlicense/MIT | `ignore` présent, `grep-*` absents | à évaluer |
| Vérif. de signature de runtimes | `minisign-verify` 0.2.5, `ed25519-dalek` 2.2.0 | MIT, BSD-3 | présents | pour ORT/CUDA/llama ; `authenticode`, `sigstore` absents |
| Téléchargement reprenable | `hf-hub` 1.1.0 (via `koharu-runtime`, `tokenizers`) | Apache-2.0 | présent | alternative ; le téléchargeur maison est déjà bon |

## 6. Recommandations priorisées (sans sandbox ni approbation)
1. Authentifier le principal sur gateway, `/mcp` + REST, app-server HTTP, pont Photoshop : jeton porteur obligatoire hors loopback (modèle `aphrody-jev`), CORS en liste blanche (`tower-http`), Host/Origin sur toute route, refus du bind non-loopback sans jeton ; faire passer les outils MCP Shenron par `shenron_auth`.
2. Rendre apply_patch atomique (validation globale puis tmp+rename, mode conservé, `Move` sans perte) ; borner `read_file`/`search_text` (taille avant lecture, `-e … --`, timeout, plafond de sortie).
3. Rendre les outils annulables (select sur `interrupt` + `aphrody-proc` pour tuer le groupe) ; plafonner `timeout_ms` ; câbler le sink de streaming avec un canal borné.
4. Secrets : types `SecretValue`/`secrecy` pour clés et jetons, `without_url()` sur les erreurs reqwest, clé Gemini en en-tête `x-goog-api-key`, droits 0600/0700 pour rollouts, miroirs, caches OAuth, états ; ne plus écraser `gemini:antigravity`.
5. Aligner les revendications sur le code (`sandbox_mode`, `WorkspaceGuard`, `load_model`, `rag serve`) et exiger SHA-256 pour toute référence directe ; vérifier le hash (ou au moins l'`mtime`+taille+hash) au chargement ; `uv run --frozen`.

## 7. NON EXAMINÉ
- Crates non lues ou seulement survolées par grep : `exec-events`, `vision`, `ocr`, `ocr-core`, `ocr-onnx`, `ocr-vlm` (hors `server.rs`), `google` (CLI, traduction, recherche), `gemini-runtime`, `gemini-web`, `notebooklm`, `firefly`, `voice`, `manga`, `messaging`, `marketplace` (installeur absent), `skills-forge`, `sdk`, `router`, `llm-infra`, `supervisor`, `summary`, `context`, `chat`, `ai`, `ecosystem`, `jev` (hors bin), `rag`, `rag-core`, `rag-eval`, `rag-python`, `toolcall` (hors `ToolSafety`), `toolcall-repair` (hors usage par `repair.rs`), `providers`, `http-error`, `mcp-smoke`.
- `mcp` : modules `browser_tools`, `bxc_tools`, `jobs_tools`, `x_tools`, `ocr_tools`, `stt_local_tools`, `vision_tools`, `dragonball_tools`, `dbfr_tools`, `public_web_tools`, `native_crawl_tools`, `winclean_tools`, `sync_tools` (grep seulement) ; `http_rest.rs` 260-850 et 975-1520 ; `mcp-client` transport HTTP, `registry.rs`, `executor.rs` ; `mcp-oauth` flux complet ; `memory` (LanceDB, Honcho, mem0, HNSW : grep) ; `agent-tools/computer_use.rs` (axe capture), `winclean.rs`, `jev.rs`.
- Aucune exécution : pas de test, pas de cargo, pas de Miri/ASAN/fuzz ; effets navigateur (CORS, PNA/LNA, DNS rebinding) non reproduits ; Windows (Credential Manager, ordre de recherche des DLL, hard-link CUDA) lu, non vérifié ; version de `reqwest`/`rmcp` lue dans le registre, supposée égale à celle du Cargo.lock.
- Provisionnement d'ONNX Runtime / llama.cpp / CUDA : aucun installateur trouvé dans le code audité ; provenance non évaluée. `aphrody-hooks` cité par des commentaires est absent du workspace (aucun crate) ; `aphrody-permissions` vit dans `aphrody-skills` et n'est pas câblé au chemin agent (conforme à la doctrine).
- Côté Bun (`packages/`), `py/aphrody-train`, `apps/shenron` : hors lecture.
