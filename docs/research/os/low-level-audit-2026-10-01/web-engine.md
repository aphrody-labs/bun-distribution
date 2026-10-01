# Audit web-engine (vague 3) : moteur Obscura + couche web d'Aphrody OS

Date : 2026-10-01. Niveau de preuve global : P1 (statique, aucun cargo/rustc/bun test). [V] = vérifié dans le code lu ; [P] = plausible, non reproduit.
Grille : agents web-engineer / security-engineer / performance-engineer / cpp-c-engineer, skills web, web-frames, web-x-client, web-xcom, web-grok-xai, rust-best-practices-2026.

## 0. Cadre YOLO appliqué (message du propriétaire, docs/reference/os/YOLO-AUTHORITY.md)

Aphrody est un OS YOLO : pas de sandbox, pas d'approbations. Je ne propose donc **aucun** sandbox, seccomp, politique restrictive, systemd durci, ni consentement pour : V8 sans isolation de fichiers, extraction de cookies par l'agent (web-chromium / FFI, F-11 d'abi.md), `--allow-file-access`, URL choisie par l'agent. Ces points sont classés « voulu » (§6) et ne sont pas des défauts.
Restent rapportés : authentification/Origin des listeners (un site ne doit pas piloter le moteur), SSRF seulement quand un tiers non authentifié déclenche la requête, fiabilité (mémoire, DoS accidentel, panics, handles V8), exactitude des revendications, lacunes fonctionnelles, réutilisation de briques mûres.

Limite d'outillage : le dossier ~/.cargo/registry/src est devenu vide à 08:17 (opération extérieure à cet audit). Les sources tierces citées (pbkdf2 0.13, cipher 0.5.2, ctr 0.10.1, rookie-cookies 0.6.0) ont été lues avant ; le comportement de deno_core 0.412 / v8 150.4 (limite de tas par défaut) n'a pas pu être relu : marqué [P].

## 1. Périmètre réellement lu

- crates/web/obscura-cdp : server.rs 1-1130 et 1940-2135 (listener, accept, Origin/Host/jeton, WS, connexions) ; dispatch.rs 770-830 ; domains/dom.rs 260-330 et 860-935.
- crates/web/obscura-js : runtime.rs 40-300, 370-500, 500-810, 1095-1130, 2272-2300, 3056-3100 ; ops.rs 1185-1225, 2400-2600, 2800-3450, 3960-4030, 4650-4700, 4960-5310 ; module_loader.rs 55-314 ; js/bootstrap.js 1-110, 13968-14010, 14735-14790, 14943-15012 ; build.rs 1-80.
- crates/web/obscura-net : lib.rs, client.rs 255-300, 575-830, 873-915, 1090-1230, 1285-1440, 1590-1760 ; dns.rs ; wreq_client.rs (grep ciblé).
- crates/web/obscura-browser : context.rs 1-140 ; page.rs 96-160, 1780-1830, 1930-1960, 2220-2260, 2820-2860, 3000-3200, 3997-4020.
- crates/web/obscura-mcp : lib.rs 1-140, 975-1070, 1176-1190, 1881-1900, 2135-2200 ; http.rs 1-646 ; aphrody.rs 1-60.
- crates/web/obscura-render : Cargo.toml ; paint.rs 55-100, 470-520, 7150-7270 (grep ciblé ailleurs).
- crates/web/obscura-dom (grep profondeur/itératif), web-engine (main.rs 1-980, worker.rs, crawl.rs 1-420), web-crawl (runner.rs, robots.rs, sitemap.rs, frontier.rs 1-120), web-service (lib.rs entier), web-bridge (fetch.rs 1-520, native_session.rs, ffi.rs 100-214, resolve.rs en-tête), web-detect (lib.rs 160-235), web-extract (media/resolver.rs en grep), web-index (persist.rs 340-586, buf.rs, kernels.rs 60-260, graph.rs 485-506, ffi_api.rs 1-60), web-chromium (lib.rs entier), x (session.rs entier, client.rs 1-60/105-345, runtime_query_ids.rs 60-330, store.rs 40-120), drive-server (main.rs 1-215, 355-530, Cargo.toml).
- crates/interop/ffi/src/web : cookies.rs, native_http.rs 1-120, media.rs 1-80, mod.rs 185-230.
- config/web.json ; config/systemd/user/aphrody-web.service ; docs/apis/web/WEB-SERVICE-CONTRACT.md 50-80 ; packages/web/agent-browser/src : service.ts, engine.ts, cdp.ts 1-130, config.ts 1-120, tauri.ts 1-235 ; scripts/audit/web-verify.ts 1-200, web-smoke.ts 1-80 ; apps/rg/website/next.config.ts 365-459 + middleware.ts ; apps/shenron/site/next.config.ts 336-430 ; nginx/ (grep exposition).

## 2. Tableau des constats

| ID | Sév. | Chemin:ligne | Constat | Preuve |
|---|---|---|---|---|
| W-01 | HAUTE | obscura-js/src/ops.rs:571-576, 3373-3375, 3394-3413 ; obscura-net/src/client.rs:225, 255-261 ; config/web.json:92 | Une page tierce épuise la RAM du processus : `fetch()` sans plafond de concurrence, 100 MiB par réponse par défaut, ~5 copies par réponse | [V] code, [P] exploit |
| W-02 | HAUTE | obscura-js/src/runtime.rs:2272-2281, 1095-1102, 3056-3062 ; obscura-browser/src/page.rs:3997-4019 ; obscura-mcp/src/lib.rs:1059,1180 (26 sites) ; web-bridge/src/native_session.rs:46-70 ; web-engine/src/worker.rs:97 | `Page::evaluate` sans watchdog V8 : un gestionnaire/prototype hostile fige à jamais le serveur MCP / la session native partagée ; le timeout tokio n'est pas préemptif | [V] code, [P] exploit |
| W-03 | HAUTE | packages/web/agent-browser/src/cdp.ts:55 ; engine.ts:57-70, 100-108 ; docs/apis/web/WEB-SERVICE-CONTRACT.md:61 ; config/web.json:93 | Le jeton CDP est documenté mais aucun client first-party ne l'envoie : l'authentification du listener est inutilisable, donc non posée | [V] |
| W-04 | MOYENNE | web-engine/src/main.rs:343-470, 357-372, 380, 401-402 ; obscura-cdp/src/server.rs:152-156, 318-336 | `launch --workers N>1` : 403 systématique (Host), répartiteur bloqué par une connexion silencieuse, tué par un `?` | [V] code, [P] exploit |
| W-05 | MOYENNE | obscura-js/src/module_loader.rs:174-314 ; obscura-net/src/client.rs:736-745, 1428-1433 ; obscura-browser/src/page.rs:123-133 | `import("file:///…")` depuis une page http(s) lit un fichier local : seule voie de sous-ressource sans garde de schéma | [V] code, [P] exploit |
| W-06 | MOYENNE | interop/ffi/src/web/media.rs:25-71 ; web-bridge/src/fetch.rs:56-60, 225-330 ; web-detect/src/lib.rs:193-206 ; obscura-render/src/paint.rs:7183-7251 | Clients HTTP sans garde SSRF ni borne de corps, déclenchés par du contenu tiers (sauts d'iframe, redirections) alors que `SsrfGuardResolver` existe | [V] |
| W-07 | MOYENNE | obscura-js/src/ops.rs:4975-5308, 3960-4030 ; obscura-cdp/tests/structured_clone_crypto_parity.rs:125-136 | Ports `op_subtle_*` (hmac 0.13, aes 0.9, aes-gcm 0.11, cbc 0.2, ctr 0.10, pbkdf2 0.13, hkdf 0.13, sha2 0.11) sans vecteur de test : AES-GCM/CBC/CTR 0 test, HMAC/PBKDF2/HKDF par longueur seule | [V] |
| W-08 | MOYENNE | obscura-js/src/runtime.rs:112-128, 567-572 ; web-engine/src/main.rs:223-226 ; config/systemd/user/aphrody-web.service:17 | Aucune limite de tas V8 par isolat ; garde « near heap limit » à la limite par défaut +64 MiB à chaque déclenchement | [V] absence de `heap_limits`, [P] valeur par défaut |
| W-09 | MOYENNE | web-engine/src/main.rs:38-39 ; obscura-browser/src/context.rs:131 ; web-crawl/src/runner.rs:259-263, 265-284 ; web-engine/src/crawl.rs:47-49 ; config/web.json:42-52 | Revendications robots/crawl fausses : `--obey-robots` global mort, 5xx/erreur = « tout autorisé » (RFC 9309), domaines vides = tout domaine, défauts CLI ≠ config | [V] |
| W-10 | MOYENNE | obscura-js/js/bootstrap.js:14943-14972, 13968-14010 | `WebSocket` factice (s'ouvre, jette `send`, ne livre jamais de `message`) ; `Worker` exécuté dans le realm de la page | [V] |
| W-11 | MOYENNE | obscura-net/src/client.rs:1124-1145 ; wreq_client.rs:247-250 ; ops.rs:2461-2464 | Proxy invalide ignoré silencieusement (connexion directe) dans le client de navigation et le client stealth, alors que `fetch()` de page le refuse | [V] |
| W-12 | BASSE | obscura-mcp/src/http.rs:269-327 ; lib.rs:245 ; web-service/src/lib.rs:181-205 ; config/web.json:94 | Transport MCP HTTP/stdio d'obscura-mcp = code mort (aucun appelant) ; son durcissement n'est pas exercé et il sérialise tout dans la boucle d'accept | [V] |
| W-13 | BASSE | x/src/session.rs:28, 68-86 ; x/src/client.rs:110 ; x/src/main.rs:148 | `XSession`/`XClient` dérivent `Debug` avec `auth_token`/`ct0` en clair ; fichier de session lu sans contrôle de mode ; `--cookie-string` en argv | [V] |
| W-14 | BASSE | web-chromium/src/lib.rs:160-182 ; interop/ffi/src/web/cookies.rs:25-47 ; packages/fut/fut/src/recon/network.ts:82-110 | Filtre d'hôte par sous-chaîne (`x.com` ⊂ `box.com`) ; `profile`/`user_data_path` non normalisés | [V] |
| W-15 | BASSE | apps/rg/website/next.config.ts:385-387 ; crates/web/drive-server/src/main.rs:362-366, 445-452 ; Cargo.toml:5-9 | Expositions de bordure : CORS `*` + credentials sur /api/public ; drive-server (importé, exclu du workspace) lie `::` et accepte l'absence d'auth en debug | [V] |

## 3. Détail des constats

### W-01 — HAUTE — Mémoire non bornée déclenchée par une page (`op_fetch_url`)

- Lu : `ops.rs:571-576` (`fetch_max_body_bytes` : défaut 100 MiB, la variable d'environnement ne peut que changer ce plafond) ; `3373-3375` (`read_body_capped` → `String::from_utf8_lossy` → `BASE64.encode` : trois représentations) ; `3394-3413` (copie stockée dans `network_response_bodies`) ; `3434-3447` puis sérialisation JSON de `body` + `bodyBase64` : deux copies supplémentaires avant retour à V8. `page_in_flight` (`ops.rs:2906-2907`) n'est qu'un compteur : aucune limite de requêtes simultanées. Navigation : plafond 64 MiB en dur (`client.rs:225`).
- Faux : `Promise.all(Array(100).fill(0).map(() => fetch(urlGros)))` depuis une page tierce alloue de l'ordre de 100 × (100 MiB × ~5) côté tas Rust, hors tas V8 donc hors garde de tas. Le service systemd a `MemoryMax=4G` (aphrody-web.service:17) : un onglet hostile fait tuer tout le moteur et ses autres connexions (≤128). La revendication `config/web.json:92` (« Cap on a fetched response body ») est inexacte : la valeur par défaut de `fetch()` (100 MiB) dépasse celle de la navigation (64 MiB) et la variable ne gouverne que `fetch()`/XHR/modules.
- Observation voisine : `obscura-cdp/src/server.rs:741` et `~1977` (`mpsc::unbounded_channel` entre lecteur WS, processeur et émetteur) : un client CDP qui ne lit plus fait croître la file sans borne (seul le tampon d'écriture WS est borné à 64 MiB, `server.rs:1972`).
- À garder : `read_body_capped` (streaming, refus sur Content-Length), `read_reqwest_body_limited` (`client.rs:873-896`, borne les octets décompressés : pas de bombe gzip), plafonds PBKDF2/HKDF/random.
- Reco : sémaphore de requêtes `op_fetch_url` par page (p. ex. 6-8), budget d'octets cumulés en vol par isolat, ne pas calculer `bodyBase64` et `body` ensemble (renvoyer un seul), canal de réponses CDP borné.

### W-02 — HAUTE — `evaluate` synchrone sans watchdog (MCP, session native, worker)

- Lu : `runtime.rs:2272-2281` (`evaluate` → `execute_runtime_script` → `execute_script`, aucun `arm_watchdog`) ; `runtime.rs:3056-3062` (`execute_script_guarded` ne borne que les sources ≥10 000 octets) ; `page.rs:3997-4019` ; `obscura-mcp/src/lib.rs:1059` (`tool_click` → `el.click()` → gestionnaires de la page) et 25 autres `.evaluate(` ; `native_session.rs:46-70` (`tokio::time::timeout` sur un thread `current_thread` : sans point d'attente, le timeout ne s'exécute jamais) ; `worker.rs:97`, `main.rs:564`.
- Contraste : le serveur CDP borne chaque commande (`dispatch.rs:786-796`, 60 s, `cdp_watchdog.rs`) et le chargement de page arme un watchdog (`page.rs:2092`, `3389`).
- Faux : un `onclick="for(;;);"` ou un prototype piégé suffit à figer le thread MCP (HTTP ou in-process) ou la session native unique `aphrody-web-native-session`, c'est-à-dire tous les outils `aphrody_browser_*` du processus et les appels FFI web, jusqu'au kill. Le contrat annonce « 180 s call timeout » (WEB-SERVICE-CONTRACT.md §3) : inexact dans ce cas. [P] pour l'exploit (nécessite que l'agent interagisse avec la page).
- Reco : armer `spawn_watchdog` autour de `Page::evaluate` (la brique existe : runtime.rs:294) ; faire exécuter la session native dans un thread dont le délai est imposé par `IsolateHandle::terminate_execution`.

### W-03 — HAUTE — Authentification CDP documentée, inutilisable par les clients first-party

- Lu : serveur correct (`server.rs:59-65, 86-93`, jeton ≥32 octets, comparaison à temps constant, obligatoire hors loopback `337-344`). Client : `cdp.ts:55` `new WebSocket(endpoint)` sans en-tête ; `engine.ts:57-70` sonde `/json/version` par `fetch` sans `Authorization`, et `engine.ts:100-108` hérite de `process.env` (donc de `OBSCURA_CDP_TOKEN`) pour le moteur enfant ; aucune occurrence de `OBSCURA_CDP_TOKEN`/`Bearer` dans packages/web/agent-browser. L'unité systemd laisse le jeton « optionnel, hors dépôt » (aphrody-web.service:13).
- Faux : poser le jeton casse `AgentBrowser`, `WebCdpPage`, `aphrody-web-test` et `startEngine` (401) ; en pratique il reste absent et le listener loopback est ouvert à tout processus local (WSL2 : y compris côté hôte Windows). La doctrine YOLO suppose un agent authentifié : la protection existe mais l'agent ne peut pas s'authentifier.
- Reco : lire `OBSCURA_CDP_TOKEN` dans `WebCdpPage.connect` (Bun accepte `new WebSocket(url, { headers })`), dans la sonde `waitForHttp`, et dans `AgentBrowser` ; test d'intégration CDP avec jeton, avec Origin (403) et avec Host étranger (403) ; générer un jeton aléatoire par défaut dans `startEngine`.

### W-04 — MOYENNE — `launch --workers N>1`

- Lu : `main.rs:357-372` lance `launch --port worker_port` sans `OBSCURA_CDP_FORWARDED_HOST/PORT` ; chaque requête passe par le répartiteur avec `Host: 127.0.0.1:<port répartiteur>` ; `server.rs:152-156` + `host_matches_bind` (95-132) exigent le port du worker → `403 ForeignHost`. Aucune occurrence de `FORWARDED` hors server.rs, docs ou tests (rg).
- Lu : `main.rs:401-402` `client_stream.peek(&mut peek_buf).await?` **dans** la boucle d'accept : une connexion TCP silencieuse bloque tous les clients suivants ; `?` sur erreur de `peek`/`accept` (reset) fait sortir `run_multi_worker_serve` et `WorkerGuard` tue les workers. Le serveur mono-worker a déjà corrigé exactement ce défaut (server.rs:381-397, issue #715).
- Autres : bind en dur 127.0.0.1 (`380`, `--host` ignoré), `allow_file_access` non propagé, `port + 1 + i` en `u16` (débordement possible), `launch [chrome_path]` exporte `APHRODY_WEB_CHROME_BIN` (`244-248`) que rien ne consomme.
- Défaut `workers: 1` (config/web.json:22) : le mode est donc rarement exercé ; aucun test ni smoke.
- Reco : poser `OBSCURA_CDP_FORWARDED_*` sur les workers ; faire du pré-routage une tâche spawnée avec délai ; ou retirer l'option tant que non testée.

### W-05 — MOYENNE — `import()` de modules vers `file://` sans garde

- Lu : les voies `<script src>` (`page.rs:2232-2244`), `<link rel=stylesheet>` (`1793-1805`), `@import` (`1817`, `1943`), images (`3574`) et navigations JS (`cross_scheme_to_file`, `108-115`, usage ~3077) refusent `file:` depuis un document non-file (`subresource_allowed`, `123-133`). Le chargeur de modules (`module_loader.rs:142-314`) n'a aucun test de schéma ; il appelle `fetch_resource_with_callbacks` → `fetch_with_profile_uncached` → `validate_url` qui **accepte `file`** (`client.rs:736-745`) → `fetch_file_url` (`1431-1433`, `784-821`). `ModuleType::JavaScript` est imposé quelle que soit l'extension (`module_loader.rs:304-310`).
- Impact : un tiers (page http/https) peut lire un fichier local qui s'analyse comme module JS (exports lisibles) et obtenir un oracle d'existence/taille (erreurs « Failed to read file » / « too large » / SyntaxError). Contenu arbitraire : fuite limitée au premier jeton d'erreur de syntaxe. Aucun test ne couvre `import("file:…")` (rg). C'est la frontière que le code veut tenir (commentaire page.rs:2233-2238).
- Reco : appliquer `subresource_allowed` (ou un paramètre « document file ? ») dans `ObscuraModuleLoader::load`, ou refuser `file` dans `validate_url` sauf contexte file.

### W-06 — MOYENNE — Clients HTTP sans garde SSRF ni borne, déclenchés par contenu tiers

La garde de référence est correcte (§5). Quatre clients la contournent :
1. FFI `media.rs:25-71` : `resolve_embed` suit `next_hop` (web-extract `media/resolver.rs:165-233`) calculé sur le HTML d'une page tierce ; redirections 8, méthode/en-têtes/corps pilotés par `MediaRequest`, `response.text()` sans plafond (`media.rs:68`). Un embed hostile vise 169.254.169.254 ou localhost. (Confirme et précise F-14 d'abi.md.)
2. `web-bridge/src/fetch.rs:225-257` (`client()` : redirections par défaut) et `280-330` : `fetch_direct` lit **tout** le corps (`response.text()`) puis tronque à 2 MiB ; la doc (`fetch.rs:56-60`) promet qu'une URL vers une image disque « cannot exhaust memory ». L'URL initiale choisie par l'agent est voulue ; les redirections du site tiers vers loopback/métadonnées ne le sont pas. Outil exposé au modèle : `universal_web_fetch` (crates/ai/mcp/src/main.rs:711-742).
3. `web-detect/src/lib.rs:193-206` (`detect_url`) : redirections libres ; le corps, lui, est borné à 1 MiB (bien).
4. `obscura-render/src/paint.rs:7183-7251` : agent `ureq` (5 redirections, `read_to_end` sans borne, `proxy(None)` ignore le proxy configuré) ; **latent** : le chargeur synchrone est actif par défaut (`paint.rs:196`) et désactivé par `set_http_client` (`runtime.rs:1120-1127`, `page.rs:1708`) ; atteignable seulement pour un embarqueur sans transport de page (binaire `paint_file`).
- Brique à réutiliser : `obscura_net::SsrfGuardResolver` + `is_forbidden_ip` sont `pub` (`obscura-net/src/lib.rs:20-23`) ; un `reqwest::ClientBuilder` préconfiguré (`dns_resolver`, `redirect(Policy::custom(...))`, plafond de corps) évite quatre copies.

### W-07 — MOYENNE — Ports RustCrypto sans test d'intégration

- Lu : 6 ops `op_subtle_*` + `op_random_bytes` (`ops.rs:4975-5308`). Tests : `pbkdf2_derives_within_limits` (3989-3995), `hkdf_derives_within_limits` (4009-4014) ne vérifient que la **longueur** ; `structured_clone_crypto_parity.rs:125-136` vérifie `sigLen==32` ; aucune occurrence de `op_subtle_aes`/`subtle.encrypt`/`subtle.decrypt`/`deriveBits` dans les tests (rg) ; aucun vecteur connu pour le digest.
- Sources tierces lues : pas de panique atteignable : `apply_keystream` ne panique qu'en fin de flux (ctr 0.10.1 : 2^32 blocs pour Ctr32BE, inatteignable) ; `pbkdf2` 0.13 avec 0 itération équivaut à 1 (WebCrypto exige une erreur) ; AES-CTR n'accepte que `length` ∈ {32, 64, 128} et AES-GCM que 128 bits de tag (`bootstrap.js:14744-14756`) : écarts de conformité, rejetés explicitement.
- Reco : vecteurs RFC 4231 (HMAC), NIST SP 800-38D (GCM), RFC 3686 (CTR), NIST SP 800-38A (CBC), RFC 6070 (PBKDF2-SHA1), RFC 5869 (HKDF), FIPS 180-4 (SHA) au niveau de l'op et un test `crypto.subtle` bout en bout par algorithme.

### W-08 — MOYENNE — Pas de limite de tas V8 explicite

- Lu : `runtime.rs:567-572` `RuntimeOptions { extensions, module_loader, startup_snapshot, ..Default::default() }` : pas de `create_params`/`heap_limits`. `install_heap_limit_guard` (112-128) répond par `current_limit + 64 MiB` à chaque déclenchement. `--v8-flags` (main.rs:223-226) n'est jamais fourni par le service systemd. Le commentaire de `server.rs:36-46` documente 33,2 GiB d'espace réservé (sandbox V8 actif).
- [P] : la limite par défaut dépend de la RAM et peut atteindre plusieurs GiB par isolat ; 128 connexions × pages. Avec `MemoryMax=4G`, une page suffit à faire tuer le service.
- Reco : `CreateParams::heap_limits` (p. ex. 512 MiB-1 GiB) à la construction, exposé en option.

### W-09 — MOYENNE — Revendications robots / crawl

- `main.rs:38-39` : `--obey-robots` global déclaré, jamais lu ; `context.rs:131` : `obey_robots: false` en dur, jamais mis à vrai hors tests ; `--user-agent` global ignoré dans le bras par défaut (`main.rs:322`).
- `runner.rs:274-280` : statut ≥400, erreur réseau ou corps >1 MiB → règles vides = tout autorisé. RFC 9309 §2.3.1.4 : 5xx / injoignable ⇒ disallow ; corps >500 KiB ⇒ analyser le début, pas ignorer.
- `runner.rs:259-263` : `allowed_domains` vide ⇒ `domain_allowed` vrai pour tout domaine ; `config/web.json:51` promet « seed hosts only ». Seule la CLI remplit les hôtes de départ (`crawl.rs:344-349`) ; l'API bibliothèque `CrawlOptions::default()` ne le fait pas.
- Défauts CLI (`crawl.rs:47-49` `--obey-robots` faux, `delay-ms` 0) ≠ config (`obeyRobots: true`, `delayMs: 250`) : cohérent seulement via le client TS (`service.ts:151`).
- Frontière : frontier en mémoire dans la CLI (`crawl.rs` `Frontier::memory`), alors que config/web.json:34-38 décrit `frontier.sqlite` ; pages ×10 000 conservées en mémoire avec markdown (`runner.rs:230-237`), 64 MiB max par document.
- Reco : robots 5xx ⇒ disallow ; `texting_robots` à évaluer (§7) ; défaut sûr dans `CrawlOptions`.

### W-10 — MOYENNE — WebSocket et Worker factices

- `bootstrap.js:14943-14972` : `new WebSocket("wss://…")` passe à OPEN au microtask suivant, `send()` ne fait rien (« drop; no real socket »), aucun `message`/`close` réseau. Les sites croient à une connexion vivante (chat, cours, auth temps réel) et perdent silencieusement les données. `Worker` (13968-14010) évalue le code dans le realm de la page (pas d'isolat) ; `navigator.sendBeacon() { return true }` (7151) jette la requête.
- Pas de risque SSRF (rien n'est ouvert) ; c'est une lacune fonctionnelle et une revendication implicite fausse.
- Brique : `tokio-tungstenite 0.26.2` (MIT) déjà lié par obscura-cdp ; une op `op_ws_*` avec la même garde SSRF.

### W-11 — MOYENNE — Proxy invalide ignoré (fail-open)

- `client.rs:1124-1145` : `if let Ok(p) = reqwest::Proxy::all(...) { builder.proxy(p) }` ; `wreq_client.rs:247-250` idem. Une faute de frappe sur `--proxy`/`OBSCURA_PROXY` envoie le trafic en direct (IP réelle) sans avertissement. Le chemin de `fetch()` de page, lui, renvoie une erreur (`ops.rs:2461-2464`), d'où une divergence. `paint.rs:7239` (`proxy(None)`) ignore le proxy pour les images (latent, cf. W-06).
- Reco : propager l'erreur à la construction du client.

### W-12 — BASSE — Transport MCP HTTP/stdio d'obscura-mcp sans appelant

- `obscura_mcp::http::run` (`http.rs:269`) et `obscura_mcp::run` (`lib.rs:245`) : aucun appelant (rg sur tout le dépôt) ; seuls `BrowserState` et `aphrody::{tools,call}` sont utilisés (`web-service/src/lib.rs:181-205`). `OBSCURA_MCP_TOKEN` / `OBSCURA_MCP_ALLOWED_ORIGINS` sont pourtant listés (`config/web.json:94`).
- Si un jour activé : défaut loopback exigé sans jeton seulement pour loopback (`http.rs:278-283`), Origin refusé sans liste blanche (`232-255`, bon) mais **pas de contrôle de Host** ; tout est servi dans la boucle d'accept (`296-326`) : un outil de 30 s bloque accepts et réponses ; le POST navigateur envoie toujours Origin, donc le rebinding est neutralisé par la règle Origin (tests `http.rs:556-645`).
- Brique : `axum 0.8.9`/`hyper 1.11.1` + `tower-http 0.6.11` (déjà dans Cargo.lock) remplaceraient l'analyseur HTTP maison (645 lignes) ; ou supprimer le module.

### W-13 — BASSE — Secrets X dans `Debug`, fichier et argv

- `session.rs:28` `#[derive(Debug, Clone, Serialize, Deserialize)]` sur `XSession` (auth_token, ct0) ; `client.rs:110` `#[derive(Debug)]` sur `XClient` qui contient `session`. Contraste : `web-chromium/src/lib.rs:27-41` masque `value` et `aphrody-secrets::SecretValue` (crates/os/secrets) existe (Debug/Display `***REDACTED***`, zeroize).
- `session.rs:68-86` : `~/.aphrody/x-session.json` lu sans vérifier le mode ; `main.rs:148` `--cookie-string` visible dans `/proc/<pid>/cmdline`. Non-zeroïsé.
- Le jeu d'URL est borné à x.com / abs.twimg.com (`runtime_query_ids.rs:259-262`, regex ancrée) : bien.

### W-14 — BASSE — web-chromium : filtre et chemins

- `lib.rs:176-180` : `cookie.domain.contains(host_key_like)` : `x.com` correspond à `box.com`, `fedex.com`, `dropbox.com` ; `""` renvoie tout. Un client qui prend `auth_token` par nom (X) ou `remid`/`sid` (`packages/fut/fut/src/recon/network.ts:82-110`, premier gagnant par nom) peut choisir le cookie d'un autre domaine. Correction : domain-match RFC 6265 (égalité ou suffixe précédé d'un point).
- `lib.rs:168-170` : `user_data_path.join(profile)` : un `profile` absolu ou `..` remplace/échappe la racine ; le FFI accepte un `user_data_path` arbitraire (`ffi/src/web/cookies.rs:25-47`). Sans conséquence sous YOLO ; relève de l'exactitude.
- `lib.rs:197-203` : sous Linux `browser_id` ne distingue que chrome/chromium (Brave/Edge/Vivaldi → mauvaise clé, échec de déchiffrement).
- À garder : rookie-cookies 0.6.0 (dossier temporaire privé, clés zéroïsées, D-Bus libsecret/kwallet) ; licence non déclarée dans le manifeste (metadata : None), LICENSE.md présent : à vérifier.

### W-15 — BASSE — Expositions de bordure (sites, drive-server)

- `apps/rg/website/next.config.ts:385-387` : `/api/public/:path*` → `Access-Control-Allow-Origin: *` avec `Access-Control-Allow-Credentials: true` : combinaison invalide (les navigateurs refusent les requêtes avec identifiants), donc inoffensive mais révèle une intention ; pas de CSP/XFO/nosniff dans ce fichier (nginx peut les ajouter, non vérifié). apps/shenron/site : en-têtes présents (`next.config.ts:399-421`), `poweredByHeader: false` ; pas de limitation de débit côté application (nginx : `limit_req` présent pour bot/api, nginx/bot.dragonballfr.com.conf.example:57).
- `crates/web/drive-server` : exclu du workspace (`Cargo.toml:5-9`), donc non construit ; si l'on le construit : liaison par défaut `::` (`main.rs:362-366`), build debug sans `SD_AUTH` autorisé (`445-452`), Basic en clair, `/rpc` relayé vers le démon 127.0.0.1:6969 (`431-435`) sans authentification, `Access-Control-Allow-Origin: *` sur les sidecars (jeton Basic non transmissible cross-origin). Importé (FSL) : à signaler, non à corriger ici.

## 4. Comparaison avec T-01 (terminal.md) : le serveur CDP est la référence à porter

| Contrôle | obscura-cdp (`server.rs`) | terminal-backend (T-01) |
|---|---|---|
| Liaison par défaut | 127.0.0.1 (`main.rs:64`, `server.rs:214`) | `--addr` quelconque, 0.0.0.0 accepté |
| Hors loopback sans jeton | refusé au démarrage (`337-344`) | accepté |
| Origin | tout `Origin` refusé en 403 (`149-151`) : un navigateur envoie toujours Origin sur WebSocket → détournement inter-sites bloqué | aucun contrôle |
| Host (anti DNS rebinding) | comparé à la liaison / à l'autorité relayée (`95-132`, tests 2066-2101) | aucun |
| Jeton | Bearer ≥32 octets, temps constant (`59-93`) | aucun |
| Tête HTTP | pré-lecture bornée à 4 KiB, 431 au-delà (`856-909`) | `accept_async` direct |
| Connexions silencieuses | parquées, TTL 10 s, ≤256 (`861-871`) | un spawn par pair, sans limite |
| Connexions vivantes | plafond 128, 503 explicite (`46`, `579-588`) | aucun |
| Message WS | défaut tungstenite (64 MiB), tampon d'écriture 64 MiB (`1962-1975`) | défaut |

Reco : extraire `control_refusal`/`host_matches_bind`/`bearer_authorized` (≈70 lignes, déjà testées) dans une petite crate partagée et l'appliquer à `terminal-backend` (T-01) ; unifier `tokio-tungstenite 0.24.0` (terminal-backend) et `0.26.2` (obscura-cdp), seuls consommateurs des deux versions.
Lacune de test : aucune vérification de bout en bout du 403 Origin / Host / 401 sur une vraie poignée de main (tests unitaires `server.rs:2061-2132` seulement ; web-smoke.ts n'en teste aucune).

## 5. Ce qui existe et est correct (à garder)

1. Garde SSRF `obscura-net` : ensemble interdit complet (loopback, RFC1918, lien-local dont 169.254.169.254, CGNAT 100.64/10, 198.18/15, ≥240, multicast, IPv6 ULA/lien-local, v4-mappé/compatible, NAT64 64:ff9b::/96, 6to4, documentation) `client.rs:606-685` ; vérification **à la résolution** donc sur les adresses réellement jointes (rebinding fermé) `698-731` ; redirections manuelles revalidées à chaque saut (`1679`, ops.rs:3292) ; même résolveur dans le client stealth (`wreq_client.rs:210`) ; `file:` et `ftp:` refusés dans `fetch()`/XHR (`ops.rs:4650-4658`, test 4155-4163) ; schémas limités à http/https/file.
2. Surface d'ops V8 minimale : 57 `#[op2]` dans ops.rs, **aucune** op fs, processus ou socket ; le seul réseau est `op_fetch_url` (HTTP via reqwest garde SSRF) ; table d'ops retirée du global avant tout script (`runtime.rs:673-704`, test `4119`) ; frames cross-origin opaques (`frame.rs:1198-1217`, test).
3. Un seul `unsafe` autour de V8 (entrées/sorties d'isolat `runtime.rs:393-447, 463-496`, alias d'emplacements deno_core 748-770) : documentés ; **aucun** `unsafe impl Send/Sync` dans les crates web (rg) ; `PhantomData<Rc<()>>` sur `EnteredRuntimeFuture`.
4. Fiabilité : watchdog par commande CDP, garde de tas, marches DOM itératives avec test de chaîne profonde (`obscura-dom/src/tree.rs:2264-2280`), plafonds PBKDF2/HKDF/random, plafond de connexions et file d'accept bornée, `catch_unwind` autour de `op_url_parse`.
5. `file://` refusé par défaut dans CDP (`page.rs:1113-1124`, `target.rs:74-78`, `dom.rs:280-289` pour `setFileInputFiles`, avec test 866-907).
6. web-index : chargement mmap validé (somme xxh64 non cryptographique mais structure vérifiée : bornes de sections, offsets alignés, invariants de niveaux/voisins/tombstones, `MAX_SLOTS`) `persist.rs:341-586`, `buf.rs` ; noyaux AVX2 avec détection à l'exécution et `min(len)` `kernels.rs:195-240`. Limite connue : SIGBUS si un tiers tronque le fichier mappé (documenté).
7. Politique d'exposition de `config/web.json` (loopback, `allowFileAccess:false`, `allowPrivateNetwork:false`) cohérente avec le code du serveur CDP.

## 6. Classe « voulu » sous YOLO (non rapportée comme défaut)

V8 sans confinement de fichiers (d'ailleurs aucune op fs) ; extraction de cookies Chromium déchiffrés (web-chromium, `aphrody_web_get_chromium_cookies`, usage FUT/X) ; `browser_tab_new`/worker/`fetch --dump original` pouvant ouvrir `file://` (note d'exactitude seulement : `tool_navigate` refuse `file:` `lib.rs:991-993`, `tool_tab_new` `1881-1897` ne le fait pas ; `WebSession::call` ne valide que `browser_navigate`, `web-service/src/lib.rs:197-205`) ; URL choisie par l'agent dans `fetch_direct` ; `--v8-flags` bruts ; absence de durcissement systemd (seul `MemoryMax=4G` est relevé comme risque de fiabilité) ; DnsRecon qui envoie le domaine à crt.sh/hackertarget (`obscura-net/src/dns.rs`).

## 7. Natif first-party vs enrobage, et briques à réutiliser

Par domaine :
- **Moteur de navigateur** : Obscura est **importé** (h4ckf0r0day/obscura, Apache-2.0 ; manifestes « Vendored upstream code », lints relâchés) avec des ajouts Aphrody (`dns.rs`, `obscura-mcp/src/aphrody.rs`, chargeur de modules « Fork » stealth). Natif Rust : DOM (arène `obscura-dom` sur html5ever 0.39/selectors 0.38/cssparser 0.37), serveur CDP (~20 k lignes), client réseau + CookieJar (1 657 lignes) + robots/encodage, mise en page (css.rs + taffy 0.12 + athena-text 0.14.2 + tiny-skia/resvg). **Enrobage** : le moteur JS est Google V8 (rusty_v8 150.4.0 / deno_core 0.412.0), TLS = rustls (ring) / BoringSSL via wreq 6.0.0-rc.29 + btls (pré-version épinglée `=`).
- **Chromium** : non enrobé. `aphrody-web-chromium` ne lit que le magasin de cookies (rookie-cookies) ; le « navigateur headless » est Obscura ; `chrome_path` est accepté mais inerte.
- **Couche first-party Aphrody** : web-service (contrat), web-bridge, web-crawl (frontier SQLite, robots, sitemaps), web-extract, web-index (HNSW maison, sain), web-detect, x.

Briques déjà dans Cargo.lock (licence déclarée par les métadonnées ; « à évaluer » partout) :
- `tokio-tungstenite 0.26.2` (MIT) : WebSocket réel pour la page (W-10) ; supprimer la version 0.24.0.
- `axum 0.8.9` (MIT), `hyper 1.11.1` (MIT), `tower-http 0.6.11` (MIT), `tower 0.5.3` (MIT) : remplacer les analyseurs HTTP maison (obscura-mcp/http.rs 645 lignes ; `peek_request_head` du CDP) et fournir limite de corps/timeout.
- `cookie_store 0.22.1` (MIT/Apache-2.0) + `publicsuffix 2.3.0`/`psl 2.1.238` : alternative au CookieJar maison de 1 657 lignes ; à comparer sur SameSite/partitionnement.
- `ipnet 2.12.2` (MIT/Apache-2.0) : exprimer l'ensemble interdit de `is_forbidden_ip` en table de CIDR.
- `scraper 0.27.0` (ISC) est utilisé par `aphrody` alors que le reste du web utilise obscura-dom : deux piles DOM ; `kuchikiki` + html5ever 0.29.1 + selectors 0.24 + cssparser 0.29.6 (tauri-utils, tauri-runtime-cef) forment une seconde chaîne servo.
- `aphrody-secrets` (workspace, Apache-2.0) : `SecretValue` pour XSession/cookies.
- `rookie-cookies 0.6.0` : déjà utilisé, bon choix (licence à confirmer).
- `reqwest 0.13.5` partout sauf `update-informer` (0.12.28) ; `ureq 3.3.0` dans obscura-render : retirer au profit du client gardé.
Absents de Cargo.lock : `texting_robots` (MIT/Apache-2.0, RFC 9309) pour robots.txt ; `usearch`/`hnsw_rs`/`instant-distance` pour l'index (inutile : l'implémentation maison est validée) ; `boa_engine` (inutile : V8 déjà présent).

## 8. Recommandations priorisées

1. W-03 : brancher `OBSCURA_CDP_TOKEN` dans tous les clients TS (WebSocket, sonde, `AgentBrowser`) et en générer un par défaut ; ajouter un test d'intégration Origin/Host/jeton ; porter `control_refusal` à terminal-backend (T-01).
2. W-02 + W-01 + W-08 : watchdog sur `Page::evaluate`, limites mémoire (tas V8 explicite, sémaphore + budget d'octets pour `op_fetch_url`, canaux CDP bornés).
3. W-05 : refuser `file:` dans le chargeur de modules d'un document non-file ; test `import("file:…")`.
4. W-06 + W-11 : un constructeur de client gardé unique (`SsrfGuardResolver`, redirections revalidées, plafond de corps, erreur sur proxy invalide) pour media, bridge, detect, render.
5. W-07, W-09, W-10, W-04 : vecteurs de test crypto ; robots RFC 9309 et défauts alignés sur config/web.json ; vrai WebSocket ; réparer ou retirer `--workers`.

## 9. NON EXAMINÉ

- Aucune exécution : tous les [P] restent à reproduire ; limite de tas V8 par défaut non vérifiée (registre vidé).
- obscura-js/runtime.rs hors des zones citées (≈19 000 lignes, surtout tests), bootstrap.js hors des zones citées (16 331 lignes), `op_dom_inner` (≈1 000 lignes de commandes DOM : risque de double emprunt `RefCell` → panique → abort, 38 `borrow_mut` dans ops.rs), canvas/WAAPI/layout ops.
- obscura-render (68 802 lignes : CSS, mise en page, peinture, décodage d'images/polices/SVG via image/resvg/wuff) : seuls Cargo.toml et le chargeur d'images lus ; fuzzing des décodeurs non évalué.
- obscura-cdp domaines page/network/fetch/emulation/pdf/input/accessibility (≈8 000 lignes) ; obscura-browser pdf.rs/context au-delà de 140 ; wreq_client.rs au-delà du grep ; empreinte TLS/stealth (JA3/JA4, HTTP/2) non mesurée.
- web-extract (hors media/resolver en grep), web-crawl frontier/scoring/revisit, web-detect rules/challenge, web-bridge cli.rs/actors.rs/error.rs, x api/parse/media/archive, interop/ffi web/{dom,extract,index,jobs,net,embed,text}.rs (déjà couverts côté ABI).
- packages/web/x, aphrody-web-test, client.ts ; apps/shenron/site et apps/rg/website hors en-têtes/CORS/middleware ; routes API Next, limitation de débit applicative, nginx au-delà du grep.
- drive-server au-delà de main.rs 1-215/355-530 ; sd-core (importé FSL).
- Windows/macOS : build de wreq (`prefix-symbols` Linux seulement, Cargo.toml obscura-net), tauri.ts bridge côté serveur (aphrody-tauri-wrap), non lus.
- Interaction V8 embarqué ↔ JSC/Bun dans libaphrody_ffi (déjà listée NON EXAMINÉ de abi.md) : handlers de signaux (trap handler wasm), isolats multiples dans le même processus.
