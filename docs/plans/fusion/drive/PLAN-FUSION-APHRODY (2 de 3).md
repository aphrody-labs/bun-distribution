# Plan de fusion Obscura × Bun — partie 2 de 3

> Suite de la partie 1. Rappel : la section « Décision finale » (partie 1) prime : cible `aphrody-labs/yolo`, binaire `yolo` (alias `bun`), `yolo:*` (alias `bun:*`). Les sections ci-dessous qui parlent d'`aphrody` comme cible se lisent comme la description de `yolo` ; le nettoyage d'`aphrody` est un one shot à part.

> **Mise à jour du 5 octobre (soir)** : la partie 4 (« audits et contexte vérifiés ») corrige les états et chiffres de cette partie (branche `main` unique du fork Bun à `c439b6fbd`, nom `aphrody-labs/yolo` déjà pris, fork Obscura à 107 commits de l’amont avec une branche `yolo` propre, V8 déjà présent dans `aphrody`, base glibc) et liste les décisions ouvertes. Elle ne change pas la Décision finale.

## Plan d'exécution one shot (2 jours, 200 €, Opus 5.5)

Trois vagues : J0, deux heures d'orchestrateur seul qui prépare le terrain par scripts ; J1, cinq chantiers en parallèle dans des worktrees séparés, un agent chacun, périmètre d'une à deux crates ; J2, intégration dans un ordre fixe, compilation complète, fumigation, gel et `BROKEN.md`. Le résultat est livré à l'heure, pas à la qualité.

Ajustements imposés par la cible `aphrody` et son `CLAUDE.md` (caducs depuis la Décision finale, conservés pour mémoire) : le dépôt de travail est `aphrody-labs/aphrody` (branche autorisée, checkout existant, pas de worktree ni de clone) ; les agents J1 réservent des chemins disjoints dans `.coord/claims` et **ne lancent jamais Cargo** ; l'orchestrateur-intégrateur exécute `scripts/build/rust/cargo-serial.sh check -p <crate>` après chaque lot et renvoie les erreurs au chantier concerné ; les commits sont signés `aphrody-dev <contact@aphrody.com>` sans co-auteur ; le J0 comprend en plus le passage du dépôt au nightly `2026-09-15`, l'import des crates Bun sous `crates/bun/*`, le port de `scripts/build.ts` + `rust.ts` de Bun dans `scripts/build/bun/` et le cache WebKit `autobuild`. `default-members` du workspace exclut `aphrody-tauri-runtime-cef`, les exemples et les plugins mobiles pour que `cargo check --workspace` reste tenable.

> **Écart constaté (2026-10-05)** : `aphrody` n'a aujourd'hui aucun `default-members` : les 235 membres du workspace sont tous par défaut et la recette `check` du `Justfile` lance `--workspace --all-targets --locked`, donc `aphrody-tauri-runtime-cef` est compilé ; l'exclusion décrite vaut pour `yolo`. Existent bien : `.coord/claims`, `scripts/build/rust/cargo-serial.sh`, l'identité `aphrody-dev <contact@aphrody.com>`. Le workspace du fork Bun est en `resolver = "2"` (edition 2024), celui d'`aphrody` en `resolver = "3"`. Le cache WebKit `autobuild` du J0 reste cohérent avec le fork : `webkit: "prebuilt"` par défaut (`config.ts:1295`, `profiles.ts`, `WEBKIT_VERSION` `5718a6ec`) ; l'affirmation de la partie 4 (§10.3, JSC/ICU compilés depuis les sources par défaut) n'est pas confirmée par la source locale `c439b6fbd`.

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
| J1 | B · Runtime de page JSC | `aphrody-page-runtime` : realm JSC par page (global object dédié), objet `Deno.core.ops` servi par `aphrody-jsc` avec les 73 ops en fonctions hôtes (`ops.rs` 8 362 lignes après la remise à niveau v0.2.4 → signatures `host_fn`), `execute_script`/`evaluate`/`run_event_loop` sur l'event loop du Worker, timers et microtâches, watchdog par interruption JSC, `crypto.subtle` déléguée à WebCrypto de Bun, chargeur de modules sur celui de Bun, `bootstrap.js` évalué au démarrage du realm | `cargo check -p aphrody-page-runtime` vert ; `evaluate("1+1")`, `document.title` après `set_html`, `setTimeout` qui tire | 60 € ou 8 h ; ops non portés = `throw` explicite listé dans `BROKEN.md` | 60 € |
| J1 | C · Moteur de navigation | `aphrody-browser` : fusion `obscura` + `obscura-browser`, retrait de tokio (`async fn` → fonctions bloquantes sur le thread du Worker, `tokio::sync` → `aphrody-threading`), cycle de vie, interception, capture ; thread Worker par `Browser`, réponses par `ConcurrentTask` | `cargo check -p aphrody-browser` vert avec les stubs A et B | 25 € ou 6 h | 25 € |
| J1 | D · Surfaces | `aphrody-browser-jsc` (`Browser.classes.ts`, `Page.classes.ts`, `Element.classes.ts`, `bun:browser`, `Bun.Browser`) ; sous-commande `bun browser {fetch,serve,scrape,mcp}` dans `aphrody-cli` ; `aphrody-cdp` sur `aphrody-uws` (domaines Target, Page, Runtime, DOM, Network d'abord) ; `aphrody-browser-mcp` sur `Bun.serve` | `cargo check` vert ; `bun browser fetch` et `Browser.launch()` câblés jusqu'au moteur | 25 € ou 6 h ; Fetch/IO/Storage/Input CDP et MCP HTTP en option | 25 € |
| J1 | E · DOM et rendu | `aphrody-dom` : cssparser 0.36, selectors 0.33 ; `aphrody-render` : `ureq` → `aphrody-http`, encodage PNG/JPEG par libspng/libjpeg-turbo (`image` toléré si le temps manque), vendors `taffy` et `cosmic-text` déplacés dans `vendor/` | `cargo check -p aphrody-dom -p aphrody-render` vert | 15 € ou 4 h | 15 € |
| J2 | Intégration (orchestrateur + 2 agents) | Fusion dans l'ordre J0 → B → C → A → E → D ; `just build` complet ; correction par lots d'erreurs (un agent par lot de crates) ; fumigation : `bun browser fetch https://example.com --dump text`, `Browser.launch` depuis un script, `puppeteer.connect` sur `bun browser serve` ; `BROKEN.md` et tag `oneshot-1` | Binaire qui démarre et rend `example.com` ; liste exhaustive de ce qui est cassé | 25 € ou 8 h ; à l'échéance on livre l'état tel quel | 25 € |
| — | Réserve | Reprise d'un chantier interrompu | — | — | 5 € |

> **Écart constaté (2026-10-05)** : (1) J0, étapes Obscura : la remise à niveau est déjà faite (commit `d21e0f54a`) ; fork `aphrody-labs/obscura` : `main` = amont `1fccab2` (v0.2.4), branche `yolo` à `dbea8a7c1` (commit SSRF `43ae887` + fusion amont). Le fork Bun n'a plus de branche `yolo` (l'API renvoie 404) : la source est `main` `c439b6fbd`. (2) Chantier B : `ops.rs` 8 362 lignes, 73 ops selon la partie 4 (76 attributs `#[op2]` comptés dans le fichier), `bootstrap.js` 17 932 lignes, `obscura-js` 36 121 lignes `.rs`. (3) Chantier E : `obscura-dom` est déjà en `cssparser 0.37` / `selectors 0.38` (la copie y est adaptée, voir `OBSCURA-UPSTREAM.txt`), le fork Bun en `0.36` / `0.33` : l'alignement demandé est une rétrogradation. Dans la copie, `taffy` vient d'un fork privé git (`[patch.crates-io]`, rev `4cd8b38`) et `cosmic-text` du crate `athena-text 0.14.2` : aucun `vendor/` à déplacer (`vendor/taffy` et `vendor/cosmic-text` sont ceux du dépôt amont Obscura) ; `ureq` 3 est optionnel (feature `paint` d'`obscura-render`). (4) Les crates Obscura sont en edition 2021 (le reste du workspace en 2024) et `obscura-ssrf` (125 lignes) s'ajoute aux huit autres.

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

`aphrody-labs/aphrody` contient déjà presque tout : 266 manifests Cargo (235 membres du workspace ; 373 avec `vendor/`, checkout non suivi du fork Bun), ~1,19 million de lignes de Rust hors `vendor/`, resolver 3, edition 2024 (`rust-version` 1.97), les crates Obscura (`crates/web/obscura-*`, 9 crates, paquet racine `aphrody-obscura`), Tauri 3.0.0-alpha.4 complet (`aphrody-tauri`, `aphrody-tauri-runtime`, `-runtime-wry`, `-runtime-cef`, `aphrody-wry`, `aphrody-tao`, 30 plugins, CLI, bundler) et les crates d'indexation `aphrody-web-*`. Il ne lui manque que Bun ; il a en trop V8 et un stable incompatible avec Bun.

| Composant | État dans `aphrody` au 5 octobre | Action | Quand |
| --- | --- | --- | --- |
| Obscura | Copie remise à niveau le 5 octobre sur l'amont `1fccab2` (v0.2.4) par fusion trois voies via la branche `yolo` du fork (`dbea8a7c1`), commit `d21e0f54a` ; l'état « copie plus ancienne, 144 entrées différentes, `obscura-js` 29 500 lignes » est périmé ; `obscura-js` 36 121 lignes ; tokio 1.53.1, reqwest 0.13.5 | 1) fast-forward du fork sur `h4ckf0r0day/obscura` (`1fccab2`, aucun commit local : `merge --ff-only`) ; 2) diff trois voies copie / commit d'import / fork à jour, les hunks Aphrody vont dans `patches/obscura/` ; 3) la copie est remplacée par le fork à jour + patches rejoués (`git apply --3way`), renommage `aphrody-browser`, `aphrody-page-runtime`, `aphrody-dom`, `aphrody-render`, `aphrody-browser-transport`, `aphrody-cdp`, `aphrody-browser-mcp` | J0 (étapes 1-2), J1 (étape 3 par chantier) |
| Bun-Rust | Absent ; vit dans `aphrody-labs/bun`, branche `main` `c439b6fbd` (la branche `yolo` n'existe plus ; 99 membres de workspace plus la racine, nightly `2026-09-15`, `-Zbuild-std`, lien ninja + WebKit) | Devient la base du dépôt `yolo` (renommage `aphrody-*`, `[workspace.dependencies]` fusionnées, `scripts/build.ts` + `rust.ts` + `deps/*.ts` conservés) ; le binaire est produit par ce script (profil `panic = "abort"` injecté par variables `CARGO_PROFILE_*`) | J0 |
| Toolchain | Stable 1.98.1, `profile = "minimal"`, composants rustfmt, clippy, rust-src, rust-analyzer, cibles Linux x86_64, Windows MSVC, macOS (2), wasm32 (2) ; `rust-version` du workspace 1.97 | `yolo` : nightly `2026-09-15` avec `rust-src`, `miri`, `llvm-tools` et les 11 cibles de Bun ; `aphrody` reste sur stable | J0 |
| V8 / deno_core | Dans `obscura-js` (snapshot au build) et, selon `GOAL.md`, « moteur des surfaces applicatives, conservé jusqu'à la parité Obscura/JSC » | Retrait par le chantier B (runtime de page sur `aphrody-jsc`) ; `GOAL.md` et `PLAN.md` d'`aphrody` amendés (voir `GOAL-FUSION.md`) ; aucune autre crate d'`aphrody` ne dépend de `v8` ou `deno_core` (à confirmer par `cargo tree -i v8`) | J1 · B |
| Tauri 3 alpha | Complet, y compris `aphrody-tauri-runtime-cef` (20 400 lignes, build CEF lourd) et 30 plugins | Pins git sur les forks `aphrody-labs/{tauri,wry,tao}` ; `aphrody-tauri-runtime` devient l'abstraction du mode graphique (section suivante) ; copie supprimée d'`aphrody` au one shot de nettoyage | One shot 3 / nettoyage |
| Crates d'indexation `aphrody-web-*` | Présentes (`web-crawl` 4 795 lignes avec `crawl_daemon` 24/7 et frontier SQLite, `web-extract` 6 767, `web-index` HNSW 4 234, `web-detect`, `web-frames`, `web-chromium`, `x`, plus `web-service` 264 lignes non citée) ; tokio, reqwest, rusqlite selon la crate (voir l'écart ci-dessous) | Inchangées pendant le one shot 1 ; leur bascule sur `aphrody-http`, `aphrody-event-loop` et les stores natifs de Bun est le one shot 2 (section Service d'indexation) ; `web-engine` et `web-bridge` sont supprimées à la fin du one shot 1 (remplacées par `bun browser` et `bun:browser`) | One shot 2 |
| `aphrody-sql` (`crates/infra/sql`) | 2 268 lignes ; Postgres (feature par défaut) par tokio-postgres + deadpool + rustls + pgvector, SQLite (feature `sqlite`) par rusqlite avec `VACUUM INTO`, checkpoint et `sqlite-vec` | Collision de nom avec `bun_sql` renommée : la crate de Bun (`Bun.sql`, native) prend `aphrody-sql` dans `yolo`, `infra/sql` devient `aphrody-sql-legacy` puis disparaît au one shot 2 | J0 (renommage), one shot 2 (retrait) |
| Lints | `[workspace.lints]` d'Aphrody ; Bun apporte `clippy.toml` (interdits `std::fs`, `HashMap`, `println!`…) et `unreachable_pub`/`dead_code` en `deny` | `yolo` garde le `clippy.toml` de Bun ; les crates Obscura importées restent en `#![allow(clippy::all)]` jusqu'à adoption | J0 |

> **Écart constaté (2026-10-05)** : (a) V8 : seule `obscura-js` dépend directement de `deno_core` (`^0.412`, lock `deno_core 0.412.0`, `deno_v8 0.4.0`, `v8 150.4.0`), mais V8 entre transitivement dans `aphrody-mcp`, `aphrody-web-engine` et `aphrody_ffi` (partie 4, §1) : « aucune autre crate ne dépend de V8 » est vrai des dépendances directes seulement. (b) Indexation : `web-crawl` = tokio + rusqlite (reqwest via `obscura-net`) ; `web-detect`, `web-frames`, `aphrody-x` = reqwest + tokio (`web-frames` et `x` aussi rusqlite) ; `web-index` et `web-chromium` n'utilisent ni tokio, ni reqwest, ni rusqlite. `web-engine` (2 437 lignes) et `web-bridge` (3 771) existent et tirent `obscura-js`. (c) `aphrody-sql` a déjà `pgvector` et `VACUUM INTO` : à reprendre dans la migration vers `Bun.sql`/`bun:sqlite`. Le fork Bun a bien les crates `sql`, `sql_jsc` et `valkey`.

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

> **Écart constaté (2026-10-05)** : (a) `Frontier` est aujourd'hui une struct concrète rusqlite (`enqueue*`, `lease_next`, `mark_done`, `mark_failed`, `mark_rejected`, `recover_stale`, `promote_due_revisits`, `stats`) : le trait `FrontierStore` n'existe pas. Le schéma réel est `requests`, `hosts`, `pages` (colonnes `content_hash`, `simhash`, bandes `band0..3`) ; `crawl_daemon` prend un `watch::Receiver` d'arrêt ; `CrawlDaemonOptions` : `idle_poll_ms` 1 000, `maintenance_interval_ms` 10 000. (b) `aphrody-web-api.service` est en `Type=simple`, `Restart=on-failure`, sans watchdog ; il est déclaré dans `config/host/catalog.json` (36 unités, drop-ins `run-as-ubuntu` + `sandbox-base`) mais `config/service-catalog.json` le marque `retired` (2026-09-25) et le binaire `aphrody-web-api` n'a pas de source dans le workspace (non vérifiable ici). Le drop-in `run-as-ubuntu.conf` impose `User=ubuntu` : `DynamicUser` est à arbitrer face à ce drop-in. Une unité se déclare par entrée `service`/`unit`/`path`/`dropIns`/`ownerRepo`/`targetHost` de `catalog.json`. (c) `sd_notify` existe déjà : `aphrody-systemd` (`crates/os/systemd`, 1 360 lignes, sans dépendance) fournit `notify`, `notify_ready`, `notify_watchdog`, `notify_stopping` sur `NOTIFY_SOCKET` (socket abstrait compris). (d) `127.0.0.1:9333` n'est réservé dans aucun fichier de `config/` ; `config/web.json` réserve 9222. Les services catalogués exposent `/health`, pas `/healthz`. (e) `bun:sqlite`, `Bun.sql` et `Bun.redis` sont typés dans le fork (`sqlite.d.ts`, `sql.d.ts`, `redis.d.ts`). (f) État live des hôtes : non vérifiable ici.

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

> **Écart constaté (2026-10-05)** : `Page.startScreencast` et `Input.dispatchMouseEvent` existent dans `obscura-cdp` (`domains/page.rs`, `domains/input.rs`, `server.rs`). Les 7 plugins retenus existent (3.0.0-alpha.2) ; 30 plugins sont membres du workspace, donc 23 non retenus. `aphrody-tauri-runtime-cef` fait 20 445 lignes (alpha.5). `BUN_INTERNAL_WEBVIEW_HOST` et `ipc_protocol.h` existent dans le fork (`src/bun_core/env_var.rs`, `src/runtime/webview/HostProcess.rs`, `src/runtime/webview/ipc_protocol.h`). Le `tauri.d.ts` du fork déclare bien `IpcMessage`. `just build --gui`, `bun crawl --gui` : à créer (le `Justfile` d'`aphrody` n'a que `check`, `clippy`, `test` et `mod yolo`).

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

> **Écart constaté (2026-10-05)** : `mirror_site` est une fonction `async` (`web-crawl/src/mirror.rs:205`) ; `aphrody-tauri-wrap` (`crates/ui/tauri-wrap`, 1 622 lignes) a trois modes (`remote`, `bundle`, `sidecar`) et sa feature par défaut `bundle` tire axum, reqwest, rustls et tokio (serveur loopback) : à désactiver dans l'hôte si tokio doit rester hors noyau ; il n'accorde aucun IPC à une origine distante. `aphrody-create-tauri-app` 4.7.4, `aphrody-tauri-bundler` 10 329 lignes, `aphrody-tauri-macos-sign` 877 lignes, les huit plugins cités et `Bun.secrets` (`bun.d.ts`) existent.

Limites assumées : les sites qui exigent une connexion gardent la session dans la jarre à cookies chiffrée de l'app (`stronghold` ou `Bun.secrets`), pas dans le miroir ; les contenus sous DRM ou pay-wall ne sont pas capturés ; les termes d'utilisation du site restent à la charge de l'utilisateur et `respect_robots` reste actif par défaut. Place dans le temps : one shot 3 bis, après le mode graphique (il en réutilise la feature `gui` et l'IPC).

## Plugins natifs : un noyau `bun` léger, les chaînes lourdes à côté

Le binaire fusionné ne contient que ce qui doit tourner 24/7 : runtime JSC, hôte de realm, chargeur de plugins, stores natifs. Tout ce qui est une **chaîne de build** (Tauri complet, Next.js 16 avec Turbopack et SWC, CEF, signature macOS…) et tout moteur optionnel (Obscura, crawl) vit dans des plugins natifs versionnés, chargés à la demande par le même binaire, sans jamais le saturer. Aphrody a déjà le précédent : `aphrody-bun` (`crates/ui/bun`, rendu M3, SVG, icônes et polices ; crate `rlib` `bun_rs`, pas un `cdylib`) est exposé à Bun par le `cdylib` unique `aphrody_ffi` (`crates/interop/ffi`) via `bun:ffi`, avec sa façade TS `@aphrody/bun` (`packages/interop/native`, v3.3.4).

| Décision | Choix | Pourquoi |
| --- | --- | --- |
| Frontière noyau / plugin | Dans le noyau : ce qui sert à l'exécution. En plugin : toute chaîne de compilation, tout moteur optionnel, toute intégration tierce lourde | Taille et temps de build du binaire serveur constants ; un plugin cassé ne casse pas le daemon |
| ABI de plugin | N-API (modules `.node` produits par `napi-rs`), que Bun charge nativement, plutôt que `bun:ffi` | ABI stable entre versions de Bun, types riches (promesses, buffers, callbacks), même mécanisme que l'écosystème Node ; `bun:ffi` reste pour les petites fonctions C comme aujourd'hui dans `aphrody_ffi` |
| Forme d'un plugin | Une crate `crates/plugins/<nom>` (`cdylib` + `napi`) et un paquet `@aphrody/plugin-<nom>` (façade TS, types, binaire par plateforme en `optionalDependencies`, comme `bun-build-mdx-rs` déjà présent dans le fork Bun, publié sous `@aphrody/bun-mdx-rs` avec un sous-paquet `npm/<plateforme>` par cible) | Distribution par le registre npm privé d'Aphrody ou par fichier ; versionné indépendamment du noyau |
| Chargement | `bun plugin add tauri` télécharge l'artefact signé (Ed25519, clé Aphrody) dans `~/.yolo/plugins/<nom>/<version>/` ; `bun tauri …` et `import { build } from "@aphrody/plugin-tauri"` le chargent ; mode hors ligne par cache local ou `--plugin-dir` | Pas d'installation système, pas de dépendance externe au binaire ; vérification d'intégrité avant `dlopen` |
| Contrat | `aphrody_plugin_manifest()` : nom, version, ABI (`v1`), version minimale du noyau, commandes CLI exposées, permissions demandées (réseau, fichiers, sous-processus) | Le noyau refuse un plugin dont l'ABI ou les permissions ne correspondent pas ; même logique `allow-*`/`deny-*` que Tauri 3 |
| Build | `crates/plugins/*` hors `default-members` ; chaque plugin a sa recette `just plugin <nom>` et son cache sccache ; jamais compilé par `just build` | Un `cargo check` qui reste tenable ; les chaînes lourdes (Turbopack, CEF) ne se construisent que quand on les publie |

Premiers plugins, par ordre de valeur :

| Plugin | Contenu | Ce qu'il apporte | Poids évité dans le noyau |
| --- | --- | --- | --- |
| `@aphrody/plugin-obscura` | `crates/browser/*` (Obscura sur JSC) | `bun browser …`, `bun:browser`, `Bun.Browser`, CDP, MCP | DOM, rendu, transport, CDP (~164 000 lignes `.rs` mesurées dans `crates/web/obscura*`, tests compris) |
| `@aphrody/plugin-crawl` | `crates/plugins/crawl` + `web-crawl`, `-extract`, `-index`, `-detect` | `bun crawl daemon / --gui / app`, `bun:web` | Frontier, extraction, HNSW |
| `@aphrody/plugin-tauri` | Pins : `tauri-cli` (27 900 lignes), `tauri-build`, `-codegen`, `-bundler` (10 300), `-macos-sign`, `-schema-generator`, `create-tauri-app` | `bun tauri init / dev / build / bundle / sign`, `bun crawl app … --eject` ; construit une app Tauri complète depuis un projet Bun sans Rust installé côté utilisateur (runtime wry précompilé fourni par le plugin) | ~46 000 lignes (cli, bundler, build, codegen, macos-sign, schema-generator, create-tauri-app) et leurs dépendances (handlebars, zip, signature, icns) |
| `@aphrody/plugin-next` | Turbopack + SWC depuis le fork `aphrody-labs/next.js` (crates `turbopack-*`, `swc_core`), `aphrody-oxc-bridge` pour le pont avec le transpileur de Bun | `bun next dev / build` pour Next.js 16 avec Turbopack natif, sans `node_modules/@next/swc-*` | Turbopack et SWC comptent parmi les plus gros graphes Rust de l'écosystème ; jamais dans le noyau |
| `@aphrody/plugin-cef` | `tauri-runtime-cef` (20 400 lignes, pin) + téléchargement de CEF | Runtime Chromium embarqué pour les apps qui l'exigent | Le build CEF, exclu partout ailleurs |
| `@aphrody/plugin-ml` | `crates/ml/*`, `crates/ai/*` d'`aphrody` (inférence locale, plongements pour `aphrody-web-index`) | Plongements et classification des pages crawlées, en option | Modèles et noyaux d'inférence |
| `@aphrody/plugin-x`, `@aphrody/plugin-discord` | `aphrody-x`, `crates/discord/*` | Connecteurs spécialisés | Clients d'API tiers |

Le schéma se répète à l'identique pour toute nouvelle chaîne : une crate `cdylib` N-API sous `crates/plugins/`, une façade `@aphrody/plugin-*`, une recette `just plugin <nom>`, une entrée dans le manifeste. Le noyau n'apprend rien de nouveau : il charge, vérifie, expose la commande. Place dans le temps : le chargeur minimal entre dans le one shot 1 (chantier D) ; le mécanisme complet (signature, `bun plugin add`) dans le one shot 2 ; `plugin-tauri` dans le one shot 3 ; `plugin-next` quand le fork `next.js` est aligné sur le nightly de Bun.

### Plugin `@aphrody/plugin-wgpu` : rendu 3D web et desktop depuis un seul fichier Bun

Un plugin N-API complet autour de wgpu, pour qu'un unique `scene.ts` exécuté par `bun` rende la même scène 3D dans une fenêtre native, hors écran (image, vidéo, serveur) ou dans un navigateur par WebGPU. Aphrody a déjà la base : `wgpu 30.0.1` en `workspace.dependencies`, `aphrody-gpu-backend` (instance, adaptateur, device et configuration de surface partagés), la feature `gpu` d'`aphrody-render` (pipeline wgpu hors écran), `glam`, et `aphrody-wry` qui traîne un `wgpu 23` à aligner (en réalité une `[dev-dependencies]` d'exemples, voir l'écart).

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

> **Écart constaté (2026-10-05)** : (a) `aphrody-gpu-backend` (`crates/native/gpu-backend`, 145 lignes, features `wgsl`, `native-backends`, `webgpu`, `webgl`) n'a aucun consommateur dans le workspace (déclaré seulement dans `[workspace.dependencies]`) ; `aphrody-render` appelle `wgpu` directement (feature `gpu` = `wgpu` + `pollster` + `bytemuck`, backends `vulkan`/`dx12`/`metal`/`webgpu`/`webgl`). (b) `aphrody-wry` : `wgpu = "23"` (avec `winit 0.30`) n'est qu'en `[dev-dependencies]` : le bump 23 → 30 ne touche pas le code livré, mais `Cargo.lock` contient bien deux versions de `wgpu`, `wgpu-core`, `wgpu-hal` (23.0.1 et 30.0.1) et de `naga` (23.1.0 et 30.0.1). (c) `glam` 0.33.9 est déclaré en `[workspace.dependencies]` mais aucun membre ne l'utilise et il est absent de `Cargo.lock`. (d) IECODE (autre dépôt), lavapipe, compatibilité three.js/Babylon : non vérifiable ici.

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

Le monorepo `yolo` prend à chacun des quatre dépôts ce qu'il fait le mieux : à Bun le système de build et de dépendances épinglées (déjà en place puisque `yolo` est créé depuis le fork Bun), à Obscura la CI de PR en trois étages et l'image Docker distroless, à Tauri la gestion des versions multi-crates, à wgpu la tâche unique `xtask` et la matrice par backend. Aphrody n'a aujourd'hui que deux workflows (`update.yml` hebdomadaire, `inline-interpreters.yml`), aucun Dockerfile de service (seul gabarit suivi : `m3/templates/base/Dockerfile`), des scripts par domaine (276 fichiers suivis sous `scripts/`) et une doc riche mais dispersée.

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

> **Écart constaté (2026-10-05)** : (a) Obscura : les trois étages `PR / Policy`, `PR / Core`, `PR / Performance` existent (`ci.yml` du fork), le profil `release-dist` et la matrice de release (Linux x86_64/aarch64, macOS x86_64/aarch64, Windows x86_64) aussi, mais `pr_policy`, `perf_smoke` et `compare_obstacle` y sont des scripts **Python** (`scripts/ci/*.py`) : à porter en TypeScript Bun, pas à reprendre tels quels. Dockerfile Obscura : builder `rust:1-slim-bookworm`, image `gcr.io/distroless/cc-debian12:nonroot`, uid 65532, ~57 Mo compressés (README du fork) confirmés. (b) Bun : il n'y a pas de `docker.yml` ; la publication Docker (QEMU, buildx, `build-push-action`), npm (`bun upload-npm`) et la signature GPG sont dans `release.yml` ; `packages-ci.yml` ne fait que lint, types et tests des paquets ; `format.yml` = prettier + clang-format (oxlint est dans `lint.yml` et `packages-ci.yml`) ; variantes Docker dans `dockerhub/{debian,debian-slim,alpine,distroless}` avec `docker-entrypoint.sh` pour debian ; 10 workflows `update-*.yml` ; `rust:check-all` (`package.json:70`) ; profils `debug`, `release`, `release-asan` (+ `release-local`, `release-assertions`). Le nom `nightly-2026-09-15-bun` (rev `2987ccd3`) n'est cité que par `docs/BUN-BUILD.md:16` d'`aphrody` ; le fork ne connaît que `BUN_TOOLCHAIN_RUST` (non vérifiable ici : existence du toolchain PGO/BOLT). (c) Aphrody : `deny.toml` à la racine (`.oxlintrc.json`, pas `oxlint.json`), pas de `clippy.toml` racine, pas de `xtask/` dans le workspace (seul `crates/os/drive/xtask`, hors workspace), pas de `covector` ; les installateurs sont `packages/engine/yolo/install.sh` et `install.ps1`, décrits dans `docs/DISTRIBUTION.md` (`~/.yolo`, SHA-256) et produits par `scripts/release/release.ts`. (d) `xtask` de wgpu, `covector` de Tauri, `hyperfine` : dépôts non clonés, non vérifiable ici.

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

## Journal de vérification (2026-10-05)

Statut : V = confirmé, C = corrigé, N = non vérifiable ici. Sources : monorepo `/home/aphro/aphrody` (manifests, `cargo metadata --no-deps --offline`, `Cargo.lock`, `config/`), fork Bun `vendor/bun` `c439b6fbd`, fork Obscura (clone de travail), `aphrody git api` (GET).

| Affirmation d'origine | Valeur vérifiée | Statut | Source |
| --- | --- | --- | --- |
| 265 manifests Cargo | 266 hors `vendor/`/`target`/`node_modules` (373 avec `vendor/`) ; 235 membres de workspace | C | `Bun.Glob`, `cargo metadata` |
| ~1,17 M lignes de Rust | ~1,19 M hors `vendor/` (1 193 116 lignes, 3 955 fichiers suivis par git) | C | `Bun.Glob` |
| resolver 3, edition 2024 | resolver 3, edition 2024, `rust-version` 1.97 ; crates Obscura en edition 2021 | V/C | `Cargo.toml`, manifests Obscura |
| Crates Obscura `obscura-*`, racine `aphrody-obscura` | 9 crates (avec `obscura-ssrf`) | C | `cargo metadata` |
| Tauri 3.0.0-alpha.4, `aphrody-tauri`, `-runtime`, `-runtime-wry`, `-runtime-cef`, `aphrody-wry`, `aphrody-tao`, 30 plugins, CLI, bundler | 55 membres ; `aphrody-tauri` 3.0.0-alpha.4, runtime 3.0.0-alpha.3, runtime-wry alpha.4, runtime-cef alpha.5, plugins alpha.2 ; 30 plugins | V | `cargo metadata` |
| Obscura : copie plus ancienne, 144 entrées différentes, `obscura-js` 29 500 lignes | Copie remise à niveau sur `1fccab2` (v0.2.4) ; `obscura-js` 36 121 lignes | C | `OBSCURA-UPSTREAM.txt`, `d21e0f54a`, `Bun.Glob` |
| Fork `aphrody-labs/obscura` : `merge --ff-only` sur `1fccab2`, « aucun commit local » | `main` = `1fccab2` ; `yolo` = `dbea8a7c1` (SSRF `43ae887` + fusion) | C | API GitHub `branches/main`, `branches/yolo`, clone du fork |
| tokio 1.53, reqwest 0.13 | tokio 1.53.1, reqwest 0.13.5 (0.12.28 aussi dans le lock) | V | `Cargo.lock` |
| Bun-Rust : 105 crates, branche `yolo` | 99 membres + racine ; branche `yolo` absente (404), `main` `c439b6fbd` | C | `vendor/bun/Cargo.toml`, API GitHub |
| Fork Bun : nightly `2026-09-15`, `-Zbuild-std`, 11 cibles, `rust-src`, `miri`, `llvm-tools` | Identique | V | `vendor/bun/rust-toolchain.toml` |
| `aphrody` : stable 1.98.1, `profile = "minimal"` | Identique ; composants rustfmt, clippy, rust-src, rust-analyzer ; 6 cibles | V | `rust-toolchain.toml` |
| V8/`deno_core` : « conservé jusqu'à la parité » (`GOAL.md`) | Texte présent (`GOAL.md:27`) ; dépendance directe seulement dans `obscura-js` (`deno_core 0.412.0`, `v8 150.4.0`) ; transitive ailleurs (partie 4) | V/C | `GOAL.md`, `cargo metadata`, `Cargo.lock` |
| `aphrody-tauri-runtime-cef` 20 400 lignes | 20 445 | V | `Bun.Glob` |
| `tauri-cli` 27 900 / `-bundler` 10 300 / ~45 000 | 27 866 / 10 329 / ~46 000 (7 crates) | V/C | `Bun.Glob` |
| `web-crawl` 4 795, `web-extract` 6 767, `web-index` 4 234 lignes | Identique | V | `Bun.Glob` |
| `web-detect`, `web-frames`, `web-chromium`, `x` présents ; `web-engine`, `web-bridge` à supprimer | Présents (1 132, 1 638, 283, 8 012 lignes) ; `web-engine` 2 437, `web-bridge` 3 771 ; `web-service` (264) non cité | V/C | `crates/web/*` |
| Indexation : tokio, reqwest, rusqlite | Variable par crate ; `web-index`, `web-chromium` sans aucun des trois | C | manifests |
| `crawl_daemon`, `idle_poll_ms` 1 s, maintenance 10 s ; frontier `requests`/`hosts`/`pages` SQLite | Identique ; `Frontier` est une struct, pas un trait `FrontierStore` | V/C | `runner.rs:281-360`, `frontier.rs` |
| `CrawlTransport` / `ObscuraTransport` sur `obscura-net` | Présents (`runner.rs:29,34`, `ObscuraHttpClient`) | V | `runner.rs` |
| `mirror_site` | `web-crawl/src/mirror.rs:205` | V | source |
| `aphrody-sql` `crates/infra/sql` : tokio-postgres + deadpool + rustls, rusqlite | Identique, features `postgres` (défaut) et `sqlite` ; 2 268 lignes | V | `Cargo.toml` de la crate |
| `aphrody-web-api.service` existe, rien pour le crawl | Vrai ; unité `Type=simple`, service `retired` depuis 2026-09-25 dans `service-catalog.json` ; source du binaire absente | V/C | `config/host/`, `config/service-catalog.json` |
| sd_notify par écriture directe sur `NOTIFY_SOCKET` | Déjà implémenté par `aphrody-systemd` (`notify.rs`) | C | `crates/os/systemd` |
| Unités existantes / catalogue Infra | 36 fichiers d'unités sous `config/host/systemd`, 36 entrées `units` dans `catalog.json` ; 15 services dans `service-catalog.json` ; `aphrody-infra validate` : 15 services, 15 routes | V | `config/`, `aphrody-infra` |
| Port `127.0.0.1:9333` | Non réservé ailleurs ; `config/web.json` réserve 9222 | V | `git grep` |
| `aphrody-tauri-wrap` : plugin web-to-tauri | Présent, 1 622 lignes, modes remote/bundle/sidecar, feature `bundle` par défaut (axum, reqwest, rustls, tokio) | V/C | `crates/ui/tauri-wrap` |
| `aphrody-bun` : plugin `bun:ffi`, façade `packages/interop/native` | `rlib`, exposé par `aphrody_ffi` (`cdylib`) ; façade `@aphrody/bun` 3.3.4 | C | `crates/ui/bun`, `crates/interop/ffi` |
| `bun-build-mdx-rs` dans le fork Bun | Présent, nom `@aphrody/bun-mdx-rs`, `npm/<plateforme>` | V | `vendor/bun/packages/bun-build-mdx-rs` |
| Plugins retenus (7) + deep-link, notification, global-shortcut, clipboard-manager, updater, stronghold ; 23 autres | Tous présents ; 30 − 7 = 23 | V | `cargo metadata` |
| `aphrody-gpu-backend` partagé | 145 lignes, aucun consommateur ; `aphrody-render` appelle `wgpu` directement | C | `cargo metadata` |
| `wgpu 30.0.1` en `workspace.dependencies` | Identique ; `Cargo.lock` : 23.0.1 et 30.0.1 | V | `Cargo.toml:443`, `Cargo.lock` |
| `aphrody-wry` « wgpu 23 » | `wgpu = "23"` en `[dev-dependencies]` (exemples), avec `winit 0.30` | C | `aphrody-wry/Cargo.toml:214` |
| `aphrody-render` feature `gpu` | `gpu = [dep:wgpu, dep:pollster, dep:bytemuck]` ; backends en sous-features | V | `crates/ui/render/Cargo.toml` |
| `glam` | Déclaré 0.33.9, aucun membre, absent du lock | C | `Cargo.toml:27`, `Cargo.lock` |
| `default-members` exclut cef | `aphrody` n'a pas de `default-members` | C | `Cargo.toml`, `Justfile` |
| Deux workflows (`update.yml`, `inline-interpreters.yml`) | Identique | V | `.github/workflows` |
| Aucun Dockerfile | Un gabarit suivi : `m3/templates/base/Dockerfile` | C | `git ls-files` |
| `Justfile` (« six recettes ») | `check`, `clippy`, `test` + `mod yolo` (`packages/engine/yolo/yolo.just`) | C | `Justfile` |
| Chantier E : `cssparser 0.36`, `selectors 0.33` | Copie en 0.37 / 0.38 ; fork Bun en 0.36 / 0.33 | C | manifests, `Cargo.lock` |
| `taffy`, `cosmic-text` vendorisés | `taffy` fork privé git (rev `4cd8b38`), `athena-text 0.14.2` ; `vendor/` seulement dans le dépôt amont | C | `Cargo.toml:473-477`, `obscura-render/Cargo.toml` |
| `ops.rs` 7 900 lignes, 70 ops | 8 362 lignes ; 73 ops (partie 4), 76 `#[op2]` | C | `Bun.Glob`, `rg` |
| ~170 000 lignes Obscura | ~164 000 lignes `.rs` (tests compris) | C | `Bun.Glob` |
| `clippy.toml` Bun (`std::fs`, `HashMap`, `println!`), `unreachable_pub`/`dead_code` deny, `todo`/`unimplemented` deny, `panic = "abort"` | Identique | V | `vendor/bun/clippy.toml`, `Cargo.toml` |
| Scripts Bun `scripts/build.ts`, `config`, `profiles`, `flags`, `rust`, `deps/*.ts`, `--unit-graph`, `--lto`, `--pgo-*`, profils `release-asan` | Présents | V | `vendor/bun/scripts/build` |
| Bots `update-<dep>.yml`, `rust-lints.yml`, `source-lints.yml`, `format.yml`, `freebsd-smoke.yml` | Présents (10 `update-*`) ; `format.yml` = prettier + clang-format | V/C | `vendor/bun/.github/workflows` |
| `packages-ci.yml` publie npm ; `docker.yml` | Faux : `packages-ci.yml` = lint/types/tests ; npm, Docker, GPG dans `release.yml` ; pas de `docker.yml` | C | `vendor/bun/.github/workflows` |
| Variantes Docker Bun `debian`, `debian-slim`, `alpine`, `distroless`, `docker-entrypoint.sh` | `dockerhub/` : 4 variantes ; entrypoint dans debian | V | `vendor/bun/dockerhub` |
| Obscura CI 3 étages, `release-dist`, matrice 5 cibles, Docker distroless ~57 Mo uid 65532 | Confirmé ; scripts CI en Python | V/C | clone du fork |
| `deny.toml` d'Obscura | Présent | V | clone du fork |
| `docs/DISTRIBUTION.md`, `install.sh`/`install.ps1`, `~/.yolo`, SHA-256 | Présents (`packages/engine/yolo/install.*`, `scripts/release/release.ts`) | V | `docs/DISTRIBUTION.md` |
| Fork rust `nightly-2026-09-15-bun` PGO/BOLT | `BUN_TOOLCHAIN_RUST` existe ; le nom du toolchain n'est cité que par `docs/BUN-BUILD.md` | N | `docs/BUN-BUILD.md:16`, `config.ts` |
| JSC compilé depuis les sources / WebKit précompilé périmé (partie 4) | Fork : `webkit: "prebuilt"` par défaut | C | `config.ts:1295`, `profiles.ts` |
| `Page.startScreencast`, `Input.dispatchMouseEvent` | Présents dans `obscura-cdp` | V | `obscura-cdp/src` |
| `BUN_INTERNAL_WEBVIEW_HOST`, `ipc_protocol.h`, `tauri.d.ts` `IpcMessage` | Présents dans le fork | V | `vendor/bun/src`, `packages/bun-types` |
| `m3/packages/app-ui`, `aphrody-oxc-bridge`, `crates/ml`, `crates/ai`, `aphrody-x`, `crates/discord`, fork `aphrody-labs/next.js` | Présents (`next.js` : fork public, branche `canary`) ; contenu en crates `turbopack-*` : non vérifié | V/N | `ls`, API GitHub |
| `xtask` de wgpu, `covector` de Tauri, `hyperfine`, lavapipe, three.js/Babylon, IECODE, état live des hôtes | Aucune source locale | N | — |

Décompte : 56 lignes de contrôle (chacune regroupe un ou plusieurs faits) : 23 confirmées (V), 30 corrigées ou confirmées avec correction (C, V/C), 1 confirmées avec une part non vérifiée (V/N), 2 non vérifiables (N). Les budgets, cibles, noms futurs `yolo:*` et séquence des one shots n'ont pas été modifiés.
