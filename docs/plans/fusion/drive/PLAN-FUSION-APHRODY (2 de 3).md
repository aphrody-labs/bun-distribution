# Plan de fusion Obscura × Bun — partie 2 de 3

> Suite de la partie 1. Rappel : la section « Décision finale » (partie 1) prime : cible `aphrody-labs/yolo`, binaire `yolo` (alias `bun`), `yolo:*` (alias `bun:*`). Les sections ci-dessous qui parlent d'`aphrody` comme cible se lisent comme la description de `yolo` ; le nettoyage d'`aphrody` est un one shot à part.

> **Mise à jour du 5 octobre (soir)** : la partie 4 (« audits et contexte vérifiés ») corrige les états et chiffres de cette partie (branche `main` unique du fork Bun à `c439b6fbd`, nom `aphrody-labs/yolo` déjà pris, fork Obscura à 107 commits de l’amont avec une branche `yolo` propre, V8 déjà présent dans `aphrody`, base glibc) et liste les décisions ouvertes. Elle ne change pas la Décision finale.

## Plan d'exécution one shot (2 jours, 200 €, Opus 5.5)

Trois vagues : J0, deux heures d'orchestrateur seul qui prépare le terrain par scripts ; J1, cinq chantiers en parallèle dans des worktrees séparés, un agent chacun, périmètre d'une à deux crates ; J2, intégration dans un ordre fixe, compilation complète, fumigation, gel et `BROKEN.md`. Le résultat est livré à l'heure, pas à la qualité.

Ajustements imposés par la cible `aphrody` et son `CLAUDE.md` (caducs depuis la Décision finale, conservés pour mémoire) : le dépôt de travail est `aphrody-labs/aphrody` (branche autorisée, checkout existant, pas de worktree ni de clone) ; les agents J1 réservent des chemins disjoints dans `.coord/claims` et **ne lancent jamais Cargo** ; l'orchestrateur-intégrateur exécute `scripts/build/rust/cargo-serial.sh check -p <crate>` après chaque lot et renvoie les erreurs au chantier concerné ; les commits sont signés `aphrody-dev <contact@aphrody.com>` sans co-auteur ; le J0 comprend en plus le passage du dépôt au nightly `2026-09-15`, l'import des crates Bun sous `crates/bun/*`, le port de `scripts/build.ts` + `rust.ts` de Bun dans `scripts/build/bun/` et le cache WebKit `autobuild`. `default-members` du workspace exclut `aphrody-tauri-runtime-cef`, les exemples et les plugins mobiles pour que `cargo check --workspace` reste tenable.

```text
 heures agent    0   2                  10                 18   20
 Orchestrateur   [J0]                   [fusion B→C→A→E→D · 25 €][gel]
 A · Transport       [2h→8h · 30 €]
 B · Runtime JSC     [2h→10h · 60 € · chemin critique]
 C · Navigation      [2h→8h · 25 €]
 D · Surfaces        [2h→8h · 25 €]
 E · DOM et rendu    [2h→6h · 15 €]
 2 agents intégr.                       [10h→18h · lots d'erreurs, fumigation]
                 |─── J1 · chantiers parallèles ───|─── J2 · intégration et gel ───|
```

Le chantier B (runtime de page sur JSC) est le chemin critique : il consomme 30 % du budget et c'est lui qui décide si la fumigation passe. Les heures sont du temps d'agent, pas du temps calendaire : les cinq chantiers J1 tournent en même temps.

Ordres de travail et budget :

| Vague | Chantier (agent) | Périmètre | Produit attendu | Condition d'arrêt | Budget |
| --- | --- | --- | --- | --- | --- |
| J0 | Orchestrateur | Création du dépôt `yolo` depuis la branche `yolo` du fork bun ; fast-forward du fork Obscura et patches Aphrody extraits ; script de renommage `bun_x` → `aphrody-x` (`Cargo.toml`, `use`, scripts de build, codegen) ; import d'Obscura sous `crates/browser/*` ; `[workspace.dependencies]` fusionnées, une version par crate ; `default-members` = noyau ; `[lints] workspace = false` + `#![allow(clippy::all)]` sur les crates importées ; `tracing::*` → macros `aphrody_output` par script ; squelette `crates/plugins/obscura`, `aphrody-io`, `aphrody-realm-host` ; `FUSION.md` (conventions, interdits, stubs) lu par chaque agent ; cache WebKit `autobuild` et codegen générés une fois | Workspace qui résout (`cargo metadata` sans erreur), noyau reconstruit avec démarrage mesuré = base, cinq worktrees créés, base commune poussée | 2 h ou 15 € | 15 € |
| J1 | A · Transport | `aphrody-browser-transport` sur `aphrody-http` : trait `Transport` (navigation, sous-ressources, `fetch()` de page), décompression par les piles C, jarre à cookies, robots, traqueurs ; SSRF dans `aphrody-dns` ; profil ClientHello Chrome sur BoringSSL (suites, ALPN, GREASE) ; SOCKS5 = stub explicite | `cargo check -p aphrody-browser-transport` vert, 3 tests unitaires (cookies, SSRF, décompression) | 30 € ou 6 h ; au-delà, stubs + `BROKEN.md` | 30 € |
| J1 | B · Runtime de page JSC | `aphrody-page-runtime` : realm JSC par page (global object dédié), objet `Deno.core.ops` servi par `aphrody-jsc` avec les 70 ops en fonctions hôtes (`ops.rs` 7 900 lignes → signatures `host_fn`), `execute_script`/`evaluate`/`run_event_loop` sur l'event loop du Worker, timers et microtâches, watchdog par interruption JSC, `crypto.subtle` déléguée à WebCrypto de Bun, chargeur de modules sur celui de Bun, `bootstrap.js` évalué au démarrage du realm | `cargo check -p aphrody-page-runtime` vert ; `evaluate("1+1")`, `document.title` après `set_html`, `setTimeout` qui tire | 60 € ou 8 h ; ops non portés = `throw` explicite listé dans `BROKEN.md` | 60 € |
| J1 | C · Moteur de navigation | `aphrody-browser` : fusion `obscura` + `obscura-browser`, retrait de tokio (`async fn` → fonctions bloquantes sur le thread du Worker, `tokio::sync` → `aphrody-threading`), cycle de vie, interception, capture ; thread Worker par `Browser`, réponses par `ConcurrentTask` | `cargo check -p aphrody-browser` vert avec les stubs A et B | 25 € ou 6 h | 25 € |
| J1 | D · Surfaces | `aphrody-browser-jsc` (`Browser.classes.ts`, `Page.classes.ts`, `Element.classes.ts`, `bun:browser`, `Bun.Browser`) ; sous-commande `bun browser {fetch,serve,scrape,mcp}` dans `aphrody-cli` ; `aphrody-cdp` sur `aphrody-uws` (domaines Target, Page, Runtime, DOM, Network d'abord) ; `aphrody-browser-mcp` sur `Bun.serve` | `cargo check` vert ; `bun browser fetch` et `Browser.launch()` câblés jusqu'au moteur | 25 € ou 6 h ; Fetch/IO/Storage/Input CDP et MCP HTTP en option | 25 € |
| J1 | E · DOM et rendu | `aphrody-dom` : cssparser 0.36, selectors 0.33 ; `aphrody-render` : `ureq` → `aphrody-http`, encodage PNG/JPEG par libspng/libjpeg-turbo (`image` toléré si le temps manque), vendors `taffy` et `cosmic-text` déplacés dans `vendor/` | `cargo check -p aphrody-dom -p aphrody-render` vert | 15 € ou 4 h | 15 € |
| J2 | Intégration (orchestrateur + 2 agents) | Fusion dans l'ordre J0 → B → C → A → E → D ; `just build` complet ; correction par lots d'erreurs (un agent par lot de crates) ; fumigation : `bun browser fetch https://example.com --dump text`, `Browser.launch` depuis un script, `puppeteer.connect` sur `bun browser serve` ; `BROKEN.md` et tag `oneshot-1` | Binaire qui démarre et rend `example.com` ; liste exhaustive de ce qui est cassé | 25 € ou 8 h ; à l'échéance on livre l'état tel quel | 25 € |
| — | Réserve | Reprise d'un chantier interrompu | — | — | 5 € |

Règles du workflow dynamique, écrites dans `FUSION.md` et dans le prompt de chaque agent :

- Un agent, un worktree, une ou deux crates ; il ne touche pas aux autres, il consomme leurs API via des stubs déclarés en J0 (`aphrody-browser-transport::Transport`, `aphrody-page-runtime::PageRuntime`).
- Boucle de vérification = `cargo check -p <crate>` ; jamais `cargo build` complet, jamais de build WebKit (l'`autobuild` précompilé est dans le cache dès J0), jamais de tests de bout en bout avant J2.
- Interdits : importer tokio, reqwest, hyper, rustls, ring, wreq, tungstenite, tracing, clap, deno_core, v8 ; réécrire `bootstrap.js` (seul l'alias `Deno.core` compte) ; reformater des fichiers non modifiés.
- Ce qui ne passe pas dans le budget devient un stub qui renvoie `Err("non porté : <quoi>")` ou un `throw` JS explicite, plus une ligne dans `BROKEN.md` (quoi, où, pourquoi, piste). Pas de `todo!()` ni de `unimplemented!()` : ils sont `deny` dans les lints de Bun et abortent en `panic = "abort"`.
- Un commit par heure au moins, message préfixé par le chantier ; l'orchestrateur relève les plafonds, pas les agents.
- Les tests Obscura sont copiés mais placés sous `#[cfg(feature = "legacy-tests")]` : ils ne bloquent ni la compilation ni le budget ; leur réactivation est le premier travail d'après one shot.

Fumigation minimale qui définit « livré » :

1. `bun browser fetch https://example.com --dump text` affiche le texte de la page.
2. `bun -e 'const b = await Bun.Browser.launch(); const p = await b.newPage(); await p.goto("https://example.com"); console.log(await p.evaluate("document.title"))'` affiche `Example Domain`.
3. `bun browser serve --port 9222` accepte `puppeteer.connect` et `page.goto` + `page.evaluate` sur une page statique.
4. `bun browser fetch https://news.ycombinator.com --dump links` renvoie des liens (scripts inline exécutés).
5. Capture d'écran PNG d'`example.com` non vide (si E a abouti ; sinon dans `BROKEN.md`).

## Le dépôt `aphrody` comme cible : remise à niveau d'Obscura, ajout de Bun, retrait de V8

*(Section antérieure à la Décision finale : à lire comme l'inventaire de ce qu'`aphrody` contient et de ce qui en sort vers `yolo`.)*

`aphrody-labs/aphrody` contient déjà presque tout : 265 manifests Cargo, ~1,17 million de lignes de Rust, resolver 3, edition 2024, les crates Obscura (`crates/web/obscura-*`, paquet racine `aphrody-obscura`), Tauri 3.0.0-alpha.4 complet (`aphrody-tauri`, `aphrody-tauri-runtime`, `-runtime-wry`, `-runtime-cef`, `aphrody-wry`, `aphrody-tao`, 30 plugins, CLI, bundler) et les crates d'indexation `aphrody-web-*`. Il ne lui manque que Bun ; il a en trop V8 et un stable incompatible avec Bun.

| Composant | État dans `aphrody` au 5 octobre | Action | Quand |
| --- | --- | --- | --- |
| Obscura | Copie plus ancienne que l'upstream et patchée localement : 144 entrées différentes par rapport au fork `aphrody-labs/obscura`, `obscura-js` 29 500 lignes contre 36 200 upstream ; tokio 1.53, reqwest 0.13 | 1) fast-forward du fork sur `h4ckf0r0day/obscura` (`1fccab2`, aucun commit local : `merge --ff-only`) ; 2) diff trois voies copie / commit d'import / fork à jour, les hunks Aphrody vont dans `patches/obscura/` ; 3) la copie est remplacée par le fork à jour + patches rejoués (`git apply --3way`), renommage `aphrody-browser`, `aphrody-page-runtime`, `aphrody-dom`, `aphrody-render`, `aphrody-browser-transport`, `aphrody-cdp`, `aphrody-browser-mcp` | J0 (étapes 1-2), J1 (étape 3 par chantier) |
| Bun-Rust | Absent ; vit dans `aphrody-labs/bun` branche `yolo` (105 crates, nightly `2026-09-15`, `-Zbuild-std`, lien ninja + WebKit) | Devient la base du dépôt `yolo` (renommage `aphrody-*`, `[workspace.dependencies]` fusionnées, `scripts/build.ts` + `rust.ts` + `deps/*.ts` conservés) ; le binaire est produit par ce script (profil `panic = "abort"` injecté par variables `CARGO_PROFILE_*`) | J0 |
| Toolchain | Stable 1.98.1, `profile = "minimal"`, cibles Windows/macOS/wasm | `yolo` : nightly `2026-09-15` avec `rust-src`, `miri`, `llvm-tools` et les 11 cibles de Bun ; `aphrody` reste sur stable | J0 |
| V8 / deno_core | Dans `obscura-js` (snapshot au build) et, selon `GOAL.md`, « moteur des surfaces applicatives, conservé jusqu'à la parité Obscura/JSC » | Retrait par le chantier B (runtime de page sur `aphrody-jsc`) ; `GOAL.md` et `PLAN.md` d'`aphrody` amendés (voir `GOAL-FUSION.md`) ; aucune autre crate d'`aphrody` ne dépend de `v8` ou `deno_core` (à confirmer par `cargo tree -i v8`) | J1 · B |
| Tauri 3 alpha | Complet, y compris `aphrody-tauri-runtime-cef` (20 400 lignes, build CEF lourd) et 30 plugins | Pins git sur les forks `aphrody-labs/{tauri,wry,tao}` ; `aphrody-tauri-runtime` devient l'abstraction du mode graphique (section suivante) ; copie supprimée d'`aphrody` au one shot de nettoyage | One shot 3 / nettoyage |
| Crates d'indexation `aphrody-web-*` | Présentes (`web-crawl` 4 795 lignes avec `crawl_daemon` 24/7 et frontier SQLite, `web-extract` 6 767, `web-index` HNSW 4 234, `web-detect`, `web-frames`, `web-chromium`, `x`) ; tokio, reqwest, rusqlite | Inchangées pendant le one shot 1 ; leur bascule sur `aphrody-http`, `aphrody-event-loop` et les stores natifs de Bun est le one shot 2 (section Service d'indexation) ; `web-engine` et `web-bridge` sont supprimées à la fin du one shot 1 (remplacées par `bun browser` et `bun:browser`) | One shot 2 |
| `aphrody-sql` (`crates/infra/sql`) | Postgres par tokio-postgres + deadpool + rustls, SQLite par rusqlite | Collision de nom avec `bun_sql` renommée : la crate de Bun (`Bun.sql`, native) prend `aphrody-sql` dans `yolo`, `infra/sql` devient `aphrody-sql-legacy` puis disparaît au one shot 2 | J0 (renommage), one shot 2 (retrait) |
| Lints | `[workspace.lints]` d'Aphrody ; Bun apporte `clippy.toml` (interdits `std::fs`, `HashMap`, `println!`…) et `unreachable_pub`/`dead_code` en `deny` | `yolo` garde le `clippy.toml` de Bun ; les crates Obscura importées restent en `#![allow(clippy::all)]` jusqu'à adoption | J0 |

## Service d'indexation 24/7 (one shot 2)

Le binaire `bun` fusionné tourne en service système autonome, `bun crawl daemon`, qui indexe le web en continu vers SQLite, Postgres ou Redis par les API natives de Bun (`bun:sqlite`, `Bun.sql`, `Bun.redis`), sans autre processus (Bun.sql parle aussi MySQL, en bonus) : avec SQLite il n'a besoin de rien d'autre que le disque (« full serverless ») ; Postgres et Redis sont des URL optionnelles. Le cœur existe déjà dans `aphrody-web-crawl` (`crawl_daemon`, frontier, revisites, robots, sitemaps) ; le one shot 2 le débranche de tokio, reqwest et rusqlite et le branche sur le moteur fusionné et les stores de Bun.

| Couche | Aujourd'hui (`aphrody-web-*`) | Cible | Travail |
| --- | --- | --- | --- |
| Transport des pages | `CrawlTransport` implémenté par `ObscuraTransport` sur `obscura-net` + reqwest | `CrawlTransport` sur `aphrody-browser` : mode statique (HTTP seul, `aphrody-http`) et mode rendu (realm JSC, scripts exécutés) choisi par règle d'hôte ou détection `aphrody-web-detect` | A2 |
| Boucle | `crawl_daemon` async tokio (`idle_poll_ms` 1 s, maintenance 10 s) | Même algorithme, exécuté par un script TS interne compilé dans le binaire (`src/js/crawl/daemon.ts`, comme les modules internes de Bun) qui orchestre N Workers `bun:browser` ; les fonctions Rust (score de frontier, revisite, robots, sitemaps, extraction de liens) sont exposées dans un module natif `bun:web` | B2 |
| Frontier et pages | Tables `requests`, `hosts`, `pages` dans SQLite via rusqlite (second SQLite embarqué) | Trait `FrontierStore` (`lease`, `complete`, `fail`, `add`, `stats`, `maintenance`) avec trois implémentations TS : `bun:sqlite` (même schéma, WAL, `VACUUM INTO` pour les sauvegardes), `Bun.sql` (Postgres, `SKIP LOCKED` pour les baux, `pgvector` pour les plongements), `Bun.redis` (listes triées par score, `SET NX` pour les baux, hash par page) | C2 |
| Extraction et index | `aphrody-web-extract` (Markdown, chunks, SimHash), `aphrody-web-index` (HNSW int8 mmap) | Inchangés, exposés dans `bun:web` ; l'index HNSW reste un fichier mmap à côté de la base, Postgres garde en plus `pgvector` | B2 |
| Service système | `config/host/systemd/aphrody/aphrody-web-api.service` existe pour l'API ; rien pour le crawl | Unité `aphrody-crawl.service` : `Type=notify` (sd_notify par écriture directe sur `NOTIFY_SOCKET`), `Restart=always`, `WatchdogSec=120`, `MemoryMax`, `IOWeight`, `DynamicUser`, `StateDirectory=aphrody-crawl` ; arrêt propre sur SIGTERM (baux rendus, WAL checkpoint) ; déclarée dans le catalogue Infra (`config/host/`), pas à la main | D2 |
| Gouvernance | `CrawlOptions` (concurrence, profondeur, nofollow) | Budget par hôte (délai de politesse, `Crawl-delay`), plafonds globaux (requêtes/s, bande passante, pages/jour, octets sur disque), quotas par famille de domaines, liste de refus SSRF partagée, `User-Agent` déclaré avec URL de contact ; tout dans `bunfig.toml` `[crawl]` et surchargeable par variables d'environnement | B2 |
| Observabilité | logs | `Bun.serve` local (`127.0.0.1:9333`) : `/healthz`, `/metrics` (format Prometheus : pages/s, taille de frontier, erreurs par classe, latence par hôte), `/frontier/top` ; journal structuré via `aphrody-output` | D2 |
| Reprise et intégrité | Verrous périmés récupérés par la maintenance | Idempotence par `content_hash` + SimHash, baux avec expiration, redémarrage sans perte (SQLite WAL, transactions Postgres, `AOF` conseillé côté Redis), sauvegarde périodique `VACUUM INTO` vers `StateDirectory/backups` | C2 |

Commande et configuration visées :

```bash
# SQLite seul, aucun service externe
bun crawl daemon --store sqlite:///var/lib/aphrody-crawl/frontier.db --seeds seeds.txt --workers 16

# Postgres ou Redis par URL
bun crawl daemon --store postgres://crawl@db/aphrody --render auto
bun crawl daemon --store redis://127.0.0.1:6379/2

# Installation comme service (écrit l'unité depuis le catalogue Infra)
bun crawl install-service --user aphrody-crawl
```

```toml
[crawl]
store = "sqlite:///var/lib/aphrody-crawl/frontier.db"
workers = 16
render = "auto"            # static | render | auto (détection SPA)
max_pages_per_day = 2_000_000
max_bandwidth_mbps = 200
max_disk_gb = 500
per_host_delay_ms = 1_000
user_agent = "AphrodyBot/1.0 (+https://aphrody.com/bot)"
respect_robots = true
allow_private_network = false
```

Format du one shot 2 : même méthode (J0 + 4 chantiers A2–D2 + intégration), budget à fixer (ordre de grandeur 100 à 150 € : les crates existent, c'est un rebranchement), fumigation = 1 h de crawl continu sur 50 domaines de test avec SQLite, redémarrage brutal au milieu, aucune page perdue ni dupliquée, `/metrics` cohérent avec la base. Prérequis : one shot 1 livré (le `CrawlTransport` rendu dépend du realm JSC).

## Mode crawl graphique (one shot 3)

Le même binaire bascule en `bun crawl --gui` : une fenêtre Tauri (`tauri-runtime` + `tauri-runtime-wry` + wry + tao par pins sur les forks `aphrody-labs`) affiche en direct ce que le moteur Obscura/JSC crawle, avec les commandes du daemon. Règle de sélection stricte : **un seul moteur de page, un seul système de fenêtres, aucun second moteur de rendu web**, pour que le mode graphique n'ajoute aucun build lourd.

| Brique | Retenue | Écartée (et pourquoi) |
| --- | --- | --- |
| Moteur de page | Obscura sur JSC, dans le process, le même qu'en mode service | `aphrody-tauri-runtime-cef` (20 400 lignes, téléchargement et lien de CEF : le build lourd par excellence) ; Chrome externe (`ChromeBackend`) |
| Fenêtre et webview | `tauri-runtime-wry` : WKWebView, WebView2, webkit2gtk (bibliothèques système, aucune compilation de moteur) | Toute webview embarquée ; `Bun.WebView` WKWebView en process hôte reste pour l'automatisation macOS seulement |
| Affichage des pages crawlées | Flux `Page.startScreencast` d'`aphrody-cdp` (JPEG/PNG par frame) affiché dans une page locale de la webview ; pas de rendu de la page distante par la webview système | Charger l'URL distante dans la webview (second moteur, seconde pile réseau, fuite de cookies hors de la jarre Obscura) |
| IPC | Commandes Tauri (`invoke`) vers le daemon : pause, reprise, priorité d'un hôte, injection de graines, inspection d'une page (DOM, Markdown extrait, liens), capture ; forme `IpcMessage` du `tauri.d.ts` existant | Serveur HTTP local pour l'UI (une seconde surface à sécuriser) |
| Interface | `m3/packages/app-ui` (canonique selon le `CLAUDE.md` d'Aphrody), servie en `bun://localhost` par le bundler du binaire | Un nouveau front ou un framework supplémentaire |
| Plugins Tauri | `window-state`, `single-instance`, `dialog`, `opener`, `os`, `log`, `process` | Les 23 autres ne sont pas épinglés ; plugins mobiles jamais compilés |
| Build | Feature `gui` du binaire, **off par défaut** ; `just build --gui` ajoute wry/tao et les plugins retenus ; le service 24/7 est livré sans | Lier wry/tao dans le binaire serveur (dépendances GTK sur un serveur Linux sans affichage) |

Architecture d'exécution : le daemon ne change pas (Workers `bun:browser`, `FrontierStore`), la GUI est un client de plus. Le process hôte de webview existant (`BUN_INTERNAL_WEBVIEW_HOST`) exécute la boucle tao sur son thread principal ; le script `bun crawl --gui` lance le daemon puis l'hôte, et les deux parlent par le protocole `ipc_protocol.h` étendu aux `invoke`. Sur un poste sans webkit2gtk (Linux minimal), `--gui` échoue proprement avec le message d'installation au lieu de retomber sur un moteur embarqué : c'est le prix de la règle « aucun build lourd ».

Ce que l'utilisateur voit : grille des Workers avec la frame courante de chaque page (screencast à 2 images/s, réglable), file de frontier par hôte avec scores, courbes `/metrics` (pages/s, erreurs, latence), inspecteur d'une page (Markdown extrait, liens, SimHash, voisins HNSW), boutons pause/reprise/priorité, et un mode « pilotage » où un clic dans la frame envoie `Input.dispatchMouseEvent` à la page (le même CDP que Puppeteer).

Format du one shot 3 : même méthode, budget à fixer (ordre de grandeur 100 à 200 €), prérequis : one shot 1 (CDP in-process) et one shot 2 (daemon). Fumigation : `bun crawl --gui` ouvre une fenêtre sur Linux x86_64 avec webkit2gtk, affiche 4 Workers en direct, une pause/reprise, un clic piloté ; taille du binaire `--gui` mesurée contre le binaire serveur (attendu : quelques Mo d'écart, pas des dizaines).

## Tout site crawlé devient une app Tauri complète

`bun crawl app <domaine>` transforme ce que le daemon a déjà indexé en application de bureau Tauri installée, signée et empaquetée, sans ligne de code écrite par l'utilisateur. Tout le nécessaire existe : `mirror_site` et la frontier de `aphrody-web-crawl` (contenu et graphe de liens), `aphrody-web-extract` (Markdown, médias), `aphrody-web-index` (recherche locale), `create-tauri-app` (génération de projet, pin), `tauri-bundler` (installateurs, pin), `aphrody-tauri-wrap` (plugin web-to-tauri existant : fenêtre Tauri 3 autour d'un site avec politique de navigation, téléchargements, serveur loopback et sidecar) et les plugins Tauri épinglés.

| Étape du générateur | Source dans le workspace | Résultat dans l'app |
| --- | --- | --- |
| Capture du site | `mirror_site` + table `pages` de la frontier (HTML, Markdown, `content_hash`, SimHash), médias résolus par `web-extract` | Miroir hors ligne servi en `bun://localhost`, mis à jour par le daemon selon la politique de revisite |
| Identité | `<title>`, manifeste web, favicon et icônes `apple-touch-icon`, couleur de thème, langue | `tauri.conf.json` généré (`productName`, `identifier` dérivé du domaine, icônes converties par les codecs de Bun, fenêtre initiale aux dimensions observées) |
| Mode d'exécution | Choix par site, modifiable : **hors ligne** (miroir seul), **hybride** (miroir + rafraîchissement par le moteur Obscura/JSC avec la jarre à cookies et le mode stealth), **en direct** (navigateur dédié au site, type « site-specific browser », navigation confinée au domaine et à sa liste d'autorisation) | Toujours le même moteur de page ; la webview système n'affiche que le miroir local ou le screencast, jamais le site distant directement |
| Fonctions natives | Plugins Tauri épinglés : `window-state`, `single-instance`, `deep-link` (le domaine devient un schéma ou un gestionnaire d'URL), `notification` (changement détecté par la revisite), `global-shortcut`, `clipboard-manager`, `opener`, `updater` | Fenêtre persistante, instance unique, ouverture des liens du domaine dans l'app, notifications, raccourcis, mises à jour de l'app elle-même |
| Recherche et lecture | `aphrody-web-index` (HNSW) sur les chunks du site, Markdown de `web-extract` | Recherche instantanée hors ligne, mode lecture, historique local, tout en `bun:sqlite` dans le dossier de l'app |
| IPC et permissions | Commandes `invoke` (`search`, `refresh`, `open`, `history`, `export`) ; liste `commands` dans la config générée, `allow-*`/`deny-*` implicites comme Tauri 3 ; CSP restreinte au domaine et à `bun://localhost` | Pages distantes sans accès privilégié à Bun ou à l'hôte (règle du `CLAUDE.md` d'Aphrody) |
| Empaquetage | `tauri-bundler` appelé dans le process (`.deb`, `.rpm`, AppImage, `.msi`/NSIS, `.dmg`/`.app`), `tauri-macos-sign` si certificat | Installateur par plateforme ; sans toolchain Rust côté utilisateur : l'app embarque le binaire `bun --gui` précompilé et le miroir, le générateur n'invoque jamais `cargo` |

Le point qui évite les builds lourds : une app générée n'est pas compilée, elle est **assemblée**. Le binaire `bun --gui` (wry/tao, feature `gui`) est le même pour toutes les apps ; seuls changent le miroir, la configuration, les icônes et l'identifiant. `create-tauri-app` sert de modèle de projet pour ceux qui veulent ensuite personnaliser l'app en vrai projet Tauri (`bun crawl app <domaine> --eject` écrit le projet Rust + `m3/packages/app-ui`).

```bash
bun crawl app docs.example.com --mode hybrid --out ./apps/docs-example
bun crawl app news.example.com --mode live --allow "*.example.com" --notify changes
bun crawl app wiki.example.org --mode offline --bundle deb,appimage
```

Limites assumées : les sites qui exigent une connexion gardent la session dans la jarre à cookies chiffrée de l'app (`stronghold` ou `Bun.secrets`), pas dans le miroir ; les contenus sous DRM ou pay-wall ne sont pas capturés ; les termes d'utilisation du site restent à la charge de l'utilisateur et `respect_robots` reste actif par défaut. Place dans le temps : one shot 3 bis, après le mode graphique (il en réutilise la feature `gui` et l'IPC).

## Plugins natifs : un noyau `bun` léger, les chaînes lourdes à côté

Le binaire fusionné ne contient que ce qui doit tourner 24/7 : runtime JSC, hôte de realm, chargeur de plugins, stores natifs. Tout ce qui est une **chaîne de build** (Tauri complet, Next.js 16 avec Turbopack et SWC, CEF, signature macOS…) et tout moteur optionnel (Obscura, crawl) vit dans des plugins natifs versionnés, chargés à la demande par le même binaire, sans jamais le saturer. Aphrody a déjà le précédent : `aphrody-bun` (`crates/ui/bun`, rendu M3, SVG, polices) est un plugin Rust pour Bun via `bun:ffi`, avec sa façade TS dans `packages/interop/native`.

| Décision | Choix | Pourquoi |
| --- | --- | --- |
| Frontière noyau / plugin | Dans le noyau : ce qui sert à l'exécution. En plugin : toute chaîne de compilation, tout moteur optionnel, toute intégration tierce lourde | Taille et temps de build du binaire serveur constants ; un plugin cassé ne casse pas le daemon |
| ABI de plugin | N-API (modules `.node` produits par `napi-rs`), que Bun charge nativement, plutôt que `bun:ffi` | ABI stable entre versions de Bun, types riches (promesses, buffers, callbacks), même mécanisme que l'écosystème Node ; `bun:ffi` reste pour les petites fonctions C comme aujourd'hui dans `aphrody-bun` |
| Forme d'un plugin | Une crate `crates/plugins/<nom>` (`cdylib` + `napi`) et un paquet `@aphrody/plugin-<nom>` (façade TS, types, binaire par plateforme en `optionalDependencies`, comme `bun-build-mdx-rs` déjà présent dans le fork Bun) | Distribution par le registre npm privé d'Aphrody ou par fichier ; versionné indépendamment du noyau |
| Chargement | `bun plugin add tauri` télécharge l'artefact signé (Ed25519, clé Aphrody) dans `~/.yolo/plugins/<nom>/<version>/` ; `bun tauri …` et `import { build } from "@aphrody/plugin-tauri"` le chargent ; mode hors ligne par cache local ou `--plugin-dir` | Pas d'installation système, pas de dépendance externe au binaire ; vérification d'intégrité avant `dlopen` |
| Contrat | `aphrody_plugin_manifest()` : nom, version, ABI (`v1`), version minimale du noyau, commandes CLI exposées, permissions demandées (réseau, fichiers, sous-processus) | Le noyau refuse un plugin dont l'ABI ou les permissions ne correspondent pas ; même logique `allow-*`/`deny-*` que Tauri 3 |
| Build | `crates/plugins/*` hors `default-members` ; chaque plugin a sa recette `just plugin <nom>` et son cache sccache ; jamais compilé par `just build` | Un `cargo check` qui reste tenable ; les chaînes lourdes (Turbopack, CEF) ne se construisent que quand on les publie |

Premiers plugins, par ordre de valeur :

| Plugin | Contenu | Ce qu'il apporte | Poids évité dans le noyau |
| --- | --- | --- | --- |
| `@aphrody/plugin-obscura` | `crates/browser/*` (Obscura sur JSC) | `bun browser …`, `bun:browser`, `Bun.Browser`, CDP, MCP | DOM, rendu, transport, CDP (~170 000 lignes) |
| `@aphrody/plugin-crawl` | `crates/plugins/crawl` + `web-crawl`, `-extract`, `-index`, `-detect` | `bun crawl daemon / --gui / app`, `bun:web` | Frontier, extraction, HNSW |
| `@aphrody/plugin-tauri` | Pins : `tauri-cli` (27 900 lignes), `tauri-build`, `-codegen`, `-bundler` (10 300), `-macos-sign`, `-schema-generator`, `create-tauri-app` | `bun tauri init / dev / build / bundle / sign`, `bun crawl app … --eject` ; construit une app Tauri complète depuis un projet Bun sans Rust installé côté utilisateur (runtime wry précompilé fourni par le plugin) | ~45 000 lignes et leurs dépendances (handlebars, zip, signature, icns) |
| `@aphrody/plugin-next` | Turbopack + SWC depuis le fork `aphrody-labs/next.js` (crates `turbopack-*`, `swc_core`), `aphrody-oxc-bridge` pour le pont avec le transpileur de Bun | `bun next dev / build` pour Next.js 16 avec Turbopack natif, sans `node_modules/@next/swc-*` | Turbopack et SWC comptent parmi les plus gros graphes Rust de l'écosystème ; jamais dans le noyau |
| `@aphrody/plugin-cef` | `tauri-runtime-cef` (20 400 lignes, pin) + téléchargement de CEF | Runtime Chromium embarqué pour les apps qui l'exigent | Le build CEF, exclu partout ailleurs |
| `@aphrody/plugin-ml` | `crates/ml/*`, `crates/ai/*` d'`aphrody` (inférence locale, plongements pour `aphrody-web-index`) | Plongements et classification des pages crawlées, en option | Modèles et noyaux d'inférence |
| `@aphrody/plugin-x`, `@aphrody/plugin-discord` | `aphrody-x`, `crates/discord/*` | Connecteurs spécialisés | Clients d'API tiers |

Le schéma se répète à l'identique pour toute nouvelle chaîne : une crate `cdylib` N-API sous `crates/plugins/`, une façade `@aphrody/plugin-*`, une recette `just plugin <nom>`, une entrée dans le manifeste. Le noyau n'apprend rien de nouveau : il charge, vérifie, expose la commande. Place dans le temps : le chargeur minimal entre dans le one shot 1 (chantier D) ; le mécanisme complet (signature, `bun plugin add`) dans le one shot 2 ; `plugin-tauri` dans le one shot 3 ; `plugin-next` quand le fork `next.js` est aligné sur le nightly de Bun.

### Plugin `@aphrody/plugin-wgpu` : rendu 3D web et desktop depuis un seul fichier Bun

Un plugin N-API complet autour de wgpu, pour qu'un unique `scene.ts` exécuté par `bun` rende la même scène 3D dans une fenêtre native, hors écran (image, vidéo, serveur) ou dans un navigateur par WebGPU. Aphrody a déjà la base : `wgpu 30.0.1` en `workspace.dependencies`, `aphrody-gpu-backend` (instance, adaptateur, device et configuration de surface partagés), la feature `gpu` d'`aphrody-render` (pipeline wgpu hors écran), `glam`, et `aphrody-wry` qui traîne un `wgpu 23` à aligner.

| Aspect | Choix | Détail |
| --- | --- | --- |
| API exposée à JS | **L'API WebGPU standard** (`navigator.gpu`, `GPUDevice`, `GPUBuffer`, `GPUShaderModule` en WGSL, `GPURenderPipeline`, `GPUCanvasContext`), implémentée sur wgpu | Le même fichier tourne tel quel dans Chrome/Safari (WebGPU natif) et dans `bun` (plugin) ; pas d'API propriétaire à apprendre ; les bibliothèques three.js/Babylon en mode WebGPU fonctionnent sans adaptateur |
| Surfaces | `GPUCanvasContext` branché sur : une fenêtre tao (`raw-window-handle`, via `tauri-runtime` ou direct), une texture hors écran (lecture en `Uint8Array`, encodage PNG/JPEG/WebP par les codecs de Bun, flux vidéo), ou une webview Tauri par partage de texture quand la plateforme le permet (DMA-BUF, IOSurface, DXGI) sinon par blit | Un seul code de scène ; la cible est un paramètre (`createSurface({ kind: "window" | "offscreen" | "webview" })`) |
| Noyau commun | `aphrody-gpu-backend` devient l'unique point de création d'instance/device, partagé par le plugin, `aphrody-render --features gpu`, `aphrody-wry` (bump 23 → 30) et IECODE | Une seule version de wgpu dans le workspace, un seul device par process, adaptateurs énumérés une fois |
| Boucle de rendu | `requestAnimationFrame` fourni par le plugin, cadencé sur la vsync de la fenêtre ou sur une horloge fixe hors écran ; entrées (souris, clavier, redimensionnement) remontées comme `Event` DOM standard | Les scènes écrites pour le navigateur gardent leur boucle |
| Shaders | WGSL natif (naga dans wgpu) ; SPIR-V et GLSL acceptés par naga en entrée ; compilation et validation hors ligne : `bun wgpu check shader.wgsl` | Mêmes erreurs que le navigateur, plus tôt |
| Calcul | `GPUComputePipeline` complet : plongements pour `aphrody-web-index`, traitement d'images des pages crawlées, inférence légère avec `plugin-ml` | Le GPU sert aussi au crawl, pas seulement à l'affichage |
| Backends | Vulkan, Metal, DX12, GL (repli), et le backend WebGPU de wgpu pour la cible wasm des mêmes crates | Linux serveur sans GPU : repli logiciel lavapipe si présent, sinon erreur claire ; jamais de blocage du daemon |
| Poids et build | Hors du noyau : wgpu + naga + backends pèsent plusieurs Mo et compilent longtemps ; crate `crates/plugins/wgpu` (`cdylib` N-API), hors `default-members` | Le binaire serveur n'embarque rien du GPU ; `bun plugin add wgpu` suffit |

Un seul fichier, trois cibles :

```ts
// scene.ts — tourne dans bun (plugin wgpu) et dans un navigateur WebGPU
import { createSurface } from "@aphrody/plugin-wgpu"; // no-op dans le navigateur : renvoie le <canvas>

const surface = await createSurface({ kind: Bun.argv.includes("--window") ? "window" : "offscreen", width: 1280, height: 720 });
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const ctx = surface.getContext("webgpu")!;
ctx.configure({ device, format: navigator.gpu.getPreferredCanvasFormat() });

const pipeline = device.createRenderPipeline({ layout: "auto", vertex: { module: device.createShaderModule({ code: wgsl }), entryPoint: "vs" }, fragment: { module: device.createShaderModule({ code: wgsl }), entryPoint: "fs", targets: [{ format: ctx.getCurrentTexture().format }] } });

function frame() {
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store" }] });
  pass.setPipeline(pipeline); pass.draw(3); pass.end();
  device.queue.submit([enc.finish()]);
  requestAnimationFrame(frame);
}
frame();
// bun scene.ts --window        → fenêtre native
// bun scene.ts > frame.png     → hors écran (surface.readPixels())
// bun build scene.ts --target=browser → WebGPU dans la page
```

Liens avec le reste du plan : la GUI du crawl (`bun crawl --gui`) peut afficher ses frames de screencast dans une texture wgpu au lieu d'une balise `<img>`, et `aphrody-render --features gpu` donne à Obscura un chemin de peinture GPU pour les captures lourdes. Place dans le temps : plugin propre (one shot « wgpu », ordre de grandeur 100 à 150 €), après le mécanisme de plugins du one shot 2 ; prérequis technique à régler en premier : une seule version de wgpu dans le workspace (bump d'`aphrody-wry`).

## Base commune du monorepo : scripts, CI, Docker, documentation

Le monorepo `yolo` prend à chacun des quatre dépôts ce qu'il fait le mieux : à Bun le système de build et de dépendances épinglées (déjà en place puisque `yolo` est créé depuis le fork Bun), à Obscura la CI de PR en trois étages et l'image Docker distroless, à Tauri la gestion des versions multi-crates, à wgpu la tâche unique `xtask` et la matrice par backend. Aphrody n'a aujourd'hui que deux workflows (`update.yml` hebdomadaire, `inline-interpreters.yml`), aucun Dockerfile, des scripts par domaine et une doc riche mais dispersée.

| Brique | Pris à | Ce qui est repris | Où dans `yolo` |
| --- | --- | --- | --- |
| Build natif | Bun | `scripts/build.ts` + `scripts/build/{config,profiles,flags,rust,deps/*.ts}` : chaque dépendance C/C++ épinglée par commit et récupérée au build, profils `debug`/`release`/`release-asan`, `--lto`, `--pgo-*`, plan cargo par `--unit-graph`, ninja pour le lien | `scripts/build/` (noyau, inchangé) et `scripts/build/plugins/` (une entrée par plugin) |
| Dépendances vendorisées | Bun | `vendor/` hors `members`, scripts `deps/*.ts`, bots `update-<dep>.yml` qui ouvrent une PR par bump | `vendor/{lolhtml,taffy,cosmic-text,…}` |
| Toolchain | Bun | `rust-toolchain.toml` nightly épinglé, fork `rust` `nightly-2026-09-15-bun` PGO/BOLT (`BUN_TOOLCHAIN_RUST`), `rust:check-all` sur toutes les cibles | Un seul `rust-toolchain.toml` à la racine |
| Lints | Bun + Obscura | `clippy.toml` (interdits), `rust-lints.yml`, `source-lints.yml`, `format.yml` (oxfmt/oxlint/clang-format) ; `deny.toml` d'Obscura (licences, advisories, doublons) | `clippy.toml`, `deny.toml`, `oxlint.json` à la racine ; `just check` les enchaîne |
| Tâche unique | wgpu | `cargo xtask` : une crate `xtask/` qui porte `tiers`, `deny`, `docs`, `bench`, au lieu de scripts shell épars | `xtask/` ; les six recettes `just` délèguent à `xtask` et à `scripts/build/` |
| CI de PR | Obscura | Trois étages : `PR / Policy` (règles de PR), `PR / Core` (build + tests), `PR / Performance` (`perf_smoke`, comparaison d'obstacles avec artefacts et commentaire de PR) | `.github/workflows/ci.yml` ; Performance publie taille du binaire (`binary-size.ts` de Bun), temps de démarrage (`hyperfine`), latence `fetch` |
| Matrice de release | Obscura + Bun | Obscura : matrice `x86_64/aarch64 linux`, `x86_64/aarch64 macOS`, `x86_64 windows`, variantes par features, profil `release-dist`, archives + checksums ; Bun : signature GPG, publication npm par plateforme (`packages-ci.yml`), `freebsd-smoke.yml` | `release.yml` : noyau par cible + un artefact par plugin et par cible + installateur `install.sh`/`install.ps1` déjà décrit dans `docs/DISTRIBUTION.md` d'`aphrody` (vérification SHA-256, `~/.yolo`) |
| Versions multi-crates | Tauri | Changesets `covector` : un fichier par changement, versions et changelogs par crate générés, publication groupée | `.changes/` + `covector.config.json` |
| Docker | Obscura + Bun | Obscura : builder `rust:1-slim-bookworm` avec cache des manifests (stubs `lib.rs`), image finale `distroless/cc:nonroot` (~57 Mo, uid 65532, port publié sur loopback) ; Bun : variantes `debian`, `debian-slim`, `alpine`, `distroless` avec `docker-entrypoint.sh`, publication buildx multi-arch (`docker.yml`, QEMU) | `docker/` (ex `dockerhub/`) : `Dockerfile.build` (noyau + plugins), images `aphrody/yolo` (noyau), `aphrody/crawl` (noyau + plugins obscura et crawl, `StateDirectory` montée), `aphrody/gui` jamais (desktop hors Docker) |
| Documentation | Bun + Obscura | Bun : `docs/` en MDX avec `docs.json`, guides par tâche, `AGENTS.md`/`CLAUDE.md` à la racine ; Obscura : `SUMMARY.md` GitBook, un fichier par tâche (`Your-first-fetch.md`, `Use-with-Puppeteer.md`), `Architecture-overview.md`, `Environment-variables.md` | `docs/` unique en MDX : `docs/runtime` (Bun), `docs/browser` (Obscura), `docs/crawl`, `docs/desktop` (Tauri), `docs/gpu` (wgpu), `docs/architecture`, `docs/decisions` |
| Agents et conventions | Les quatre | `AGENTS.md`, `CLAUDE.md`, `REVIEW.md` de Bun ; `AGENTS.md` d'Obscura | `CLAUDE.md` ≤ 100 lignes qui référence `AGENTS.md`, `REVIEW.md`, `FUSION.md`, `BROKEN.md` |

Arborescence cible (`yolo`) :

```text
yolo/
├─ Cargo.toml                 # workspace unique, default-members = noyau
├─ rust-toolchain.toml        # nightly-2026-09-15 (fork rust de Bun)
├─ clippy.toml  deny.toml  oxlint.json  covector.config.json
├─ Justfile                   # build / plugin <nom> / check / smoke / bench / tiers
├─ xtask/                     # tiers, deny, docs, bench
├─ crates/
│  ├─ core/       aphrody-runtime, -jsc, -realm-host, -plugin-abi, -io, -http, -event-loop, … (ex src/*)
│  ├─ browser/    aphrody-browser, -page-runtime, -dom, -render, -browser-transport, -cdp, -browser-mcp
│  ├─ web/        aphrody-web-crawl, -extract, -index, -detect (niveau 0/1, venus d'aphrody)
│  └─ plugins/    obscura, crawl, tauri, next, cef, wgpu, ml … (cdylib N-API, hors default-members)
├─ vendor/                    # pins récupérés par scripts/build/deps/*.ts, hors members
├─ patches/obscura/           # hunks Aphrody rejoués sur l'import
├─ scripts/
│  ├─ build/       build.ts, config.ts, profiles.ts, flags.ts, rust.ts, deps/*.ts (Bun, inchangé)
│  ├─ build/plugins/<nom>.ts
│  ├─ fusion/      rename.ts, import-obscura.ts, stubs.ts (idempotents)
│  ├─ ci/          pr_policy, perf_smoke, compare_obstacle, binary-size, startup-time
│  └─ release/     sign, checksums, install.sh, install.ps1
├─ docker/        Dockerfile.build, yolo/, crawl/ (debian, slim, alpine, distroless), entrypoint.sh
├─ .github/workflows/  ci.yml  rust-lints.yml  source-lints.yml  format.yml  release.yml  docker.yml  packages-ci.yml  update-vendor.yml  freebsd-smoke.yml
├─ .claude/prompts/   oneshot-1.md …
├─ .changes/      changesets covector
├─ docs/          runtime/ browser/ crawl/ desktop/ gpu/ architecture/ decisions/ bench/ (MDX + docs.json)
└─ AGENTS.md  CLAUDE.md  REVIEW.md  FUSION.md  BROKEN.md  GOAL.md
```

*(Suite dans la partie 3 : workflows retenus, convergence de la logique pure, plan définitif des six one shots, points techniques délicats, WebView et desktop, risques, validation, checklist, sources.)*
