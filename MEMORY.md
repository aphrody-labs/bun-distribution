<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody — mémoire factuelle

Relevé : 2026-10-03, sections datées 2026-10-05 ci-dessous. [PLAN.md](PLAN.md) est l'autorité architecture/queue ;
[AGENTS.md](AGENTS.md) contient les règles. Ce fichier conserve les preuves
consommateur, sans recopier les décisions ni les jalons producteur.

| Livraison | Preuve et portée | Limite |
| --- | --- | --- |
| Supervision Web | `22f0c8f06` : engine/service utilisent le propriétaire SDK partagé ; sorties binaires, stderr, exit, abort et timeout préservés ; budget 64 MiB/stream ; 50 tests agent-browser | Qualification du lot Linux, pas activation produit complète |
| Suites aval | FUT 148 pass/27 skip ; cron 174/1 ; webtest 41/0 ; total avec agent-browser : 413 pass, 28 skip, 0 fail | Skips et commandes dans le [reçu](docs/migration/runtime-web-consumer-2026-10-03.json) |
| SDK bootstrap | `73609d0f5` : producteur existant ou cache vérifié ; aucun clone/fetch/checkout/copie de script ; script comparé au pin, SHA-256 et provenance contrôlés | Pas acquisition native sur une nouvelle machine |
| Gates bootstrap | 5 tests, Workspace TypeScript, lint strict scoped, format, cache vérifié et docs consistency pass | Pas nouveau build moteur |
| Synchronisation native | `bb0cfd33f` : ingestion avec contrôle du domaine, conversations dans leur store protégé, métadonnées seules exposées | Transport livré ; activation et backfill non établis |
| Interpréteurs inline | `9d4b90565`, `e23c57e57` : `automation-inventory --inline` (JSON/Markdown) et ratchet `config/inline-interpreters.baseline.json` ; 97 → 93 invocations, 51 → 47 fichiers ; `cargo-serial.sh` 18,7 → 7,4 ms (n=20) | Scripts hôte gardés en CPython (Bun absent du VPS) ; deux scripts hôte appellent le Bun VPS supprimé |
| Sous-système MCP Workspace | `6891c3a3c`, `fb0b4a6b6` : 7 outils en lecture seule ; `aphrody-workspace-subsystem.service` actif ; appels MCP identiques à la CLI, retrait à l'arrêt | Poste WSL uniquement ; pas d'API HTTP |
| CI ratchet | `421dca18d` : workflow `inline-interpreters.yml`, sans installation de dépendances | 2026-10-03 : aucun job GitHub Actions ne démarre (facturation du compte), RG compris |
| Chemins propres à l'hôte | `6e5a3faf3`…`b7ca3ae0d` : `path-audit --repository` (8 familles, zones, ratchet `config/host-paths.baseline.json`) ; 14 197 → 148 occurrences ; racine des sources amont `.cache/upstream` ; outils distants via `SHENRON_REMOTE_HOME`/`APHRODY_REMOTE_HOME`/`SHENRON_SYNC_PEER`/`IECODE_VPS_REPO` | Reste 148 : 29 catalogue VPS/CI importée, 95 prose historique sans équivalent unique, 15 code, 5 relevés ; `aphrody-wsl`/`diagnostics`/`ovh` compilés et testés (check/test ciblés) ; test du déploiement Shenron exige root ; exécuté : CLI `aphrody-ops` et `yolo` compilés pour Windows x64 et lancés sous wine (version, parcours de chemins `Z:\...`) ; compilés seulement pour macOS arm64/x64 et Linux arm64 ; `aphrody-wsl` vérifié (`cargo check`) pour windows-msvc et apple-darwin, `aphrody-diagnostics`, `aphrody-ovh` et `aphrody-command` compilent via `cargo zigbuild` pour aarch64-apple-darwin, les deux premières aussi pour x86_64-pc-windows-gnu (`aphrody-command` échoue sur la build de `v8` pour windows-gnu) ; Windows 11 réel (Bun 1.4.2 natif, depuis `\\wsl.localhost`) : 9 tests pass (host-paths, inline-interpreters, paths) et parité des archives IECODE octet pour octet ; `build-factory.test.ts` exige les `node_modules` Linux, donc un checkout Windows avec son installation (refusé par le propriétaire le 2026-10-04) ; aucun macOS réel |
| Windows 11 natif (MSVC) | `248a65ad7`, `38ad193d8` : `aphrody-ops system-packages` (apt et winget depuis `config/system-packages.json`, pwsh 7.6.6 en un processus, module `Microsoft.WinGet.Client` sous Windows natif, `winget export` depuis WSL) ; Build Tools 2022 désinstallés, Build Tools 2026 18.10 (MSVC 14.51) installés ; Windows SDK 10.0.26100, .NET SDK 10.0.401 ; `scripts/dev/windows-cargo.ps1` (vswhere, Launch-VsDevShell, aucun réglage machine) ; tests natifs MSVC sur Windows 11 : `aphrody-winclean` (36+7+3+5), `aphrody-diagnostics` 38, `aphrody-a2a-coord` 5, `aphrody-a2a-pb` 63+4, `aphrody-wsl` 3 ; bogues trouvés et corrigés par ces exécutions : `winclean` (tests Windows jamais compilés, hash du registre périmé), `a2a-pb/build.rs` (dépendait du répertoire courant), `automation-inventory` (séparateurs) | Build Tools 2026 : `isComplete=0` après code 1603, toolset présent ; le dépôt est lu via `W:` (`net use W: \\wsl.localhost\Ubuntu-24.04`) car `protoc` ne lit pas les chemins UNC ; pas de checkout Windows séparé ; aucun macOS |

Pin SDK : [config/sibling-checkouts.json](config/sibling-checkouts.json) ;
catalog et [bun.lock](bun.lock). SDK 0.1.0, archive `155af9d2`, producteur
`1e9b76e199b6c07d8ad55aefc4fd080e6ee85911`, runtime ABI 1.4 (relevé du pin le
2026-10-05 ; l'ancien relevé `b2d69b27`/`ad2ec0d2` était périmé). Artefact natif et matrice :
[mémoire Yolo](../yolo/MEMORY.md). Révision SDK et révision native sont distinctes.

Obligations conservées : contrats Shenron/RG/Koharu, UI canonique Aphrody,
stores séparés et assets servis. RG : release/activation non démontrées par ce lot. Shenron DBFR : données persistantes observées ;
site/MCP/bot non qualifiés comme activés par ce relevé.

Les scans lexicaux et anciens états Git ne prouvent pas le graphe résolu,
les profils panic, la release courante ou un gain. Vérifier la surface sélectionnée.
Mémoire fichier uniquement ; aucune synchronisation de mémoire fournisseur revendiquée.

## Bun au centre — 2026-10-05

`5ba61608c` : contrat `config/bun-absorb.json`, ratchet `scripts/audit/workspace/bun-absorb.ts`
(4 tests), 50 entrées de catalogue mortes retirées, `bun.lock` régénéré. 1 352 fichiers non suivis du
monorepo base-ui (racine `test/`, `playground/`, `examples/`, `netlify/`, `docs/src`, workflows) supprimés.
Fork `8b5badd2` (`aphrody-labs/bun`, `yolo`) : `picocolors`, `tiny-invariant`, `dotenv`, `dotenv/config`,
`uuid` résolus en modules intégrés ; comparaison différentielle aux paquets npm (picocolors 1.1, dotenv
17.4.2, tiny-invariant 1.3.3, uuid 11.1.1) : 670 assertions identiques sur les sources et sur la sortie
release du codegen `bundle-modules.ts`. Limites : aucun build ni `bun bd test` du fork (le `cargo check`
local échoue faute des dépendances natives `vendor/lolhtml` du build Bun) ; runtime installé = Bun 1.4.2
officiel, donc absorption non active.

Synchro amont 2026-10-05 : `aphrody-labs/bun:main` avancé de 31 commits sur `oven-sh/bun` (`9bd19c98e`,
API `merge-upstream`, avance rapide) ; `yolo` avait 5 commits propres et 7 de retard (base `aa8307619`) ;
aucun fichier commun, fusion `c439b6fbd` (aphrody-dev) poussée sans forcer → `yolo` 6 devant, 0 derrière.
Amont intégré : mimalloc 3.5.3, WebKit (mémoire des threads JSC inactifs), TLS fetch par connexion,
correctifs SQL postgres/mysql. Limites : non qualifié (`yolo forge build` pas encore lancé sur le VPS) ;
pin `config/vendor.json` laissé à `954db0c03` jusqu'à qualification.
Branche unique (demande propriétaire « merge tout sur main », 2026-10-05) : `main` du fork avancé
rapidement sur `c439b6fbd`, branche par défaut GitHub `yolo` → `main`, `yolo` supprimée ; `bun-forge`
(`config/bun-forge.json`), `yolo.just` et le moteur `scripts/tools/vendor/bun_upstream_sync.ts` suivent `main`
(fusion de `upstream/main` dans `main`). Monorepo : `dedup/single-surface`, `wip/pre-consolidation-20261005`
et `yolo` fusionnés (`13b20f268`, contenu de `main` conservé : déjà déplacé ou remplacé), seuls manques
récupérés (`af891361f` : `deny.toml`, frontends des exemples Tauri m3, index des templates) ; toutes les
autres branches locales et distantes supprimées, il ne reste que `main`.

## M3 and app transport — 2026-10-05

Owner-directed relocation: `m3/` replaces `design/aphrody-m3/`. Git history,
working edits and the seven nested fork revisions were preserved; manifests,
imports, build paths and current documentation follow the new location.
[Architecture and application owners](docs/architecture/workspace/M3-LOCATION.md).

App UI: 216 tests / 991 assertions, TypeScript and scoped strict lint/format pass;
build produces 641 files / 63,030,159 bytes. Eight transport/proxy tests pass.
The web server now uses the M3 proxy and actual app-server RPC/SSE instead of
simulated Tauri commands or invented runtime data. An isolated installed native
CLI probe acknowledged initialization and ten tools; its RAG extension is
disabled (`aphrody=false`, method error `-32601`). No inference or private
conversation/index was used. Browser appearance is qualified at 1280×832 and
800×560; native Tauri rendering and full domain backend activation remain open.

Normal Bun install succeeds; frozen install still reports lock changes.
Migration-only parent checks retain pre-existing lint/format debt and a failing
live RAG preload guard. Serialized Rust gates are routed to the VPS factory,
so no new Rust build result is claimed. Old workers stopped at the owner's request.

## Extraction Shenron / Koharu — 2026-10-05

| Sujet | Preuve | Limite |
| --- | --- | --- |
| Dépôt produit | `aphrody-labs/shenron` (privé) créé et poussé : 169 commits filtrés par `git-filter-repo` (4 325 fichiers, blobs identiques à HEAD, 0 collision), historique du plugin `plugin-shenron` sous `plugin/`, `@aphrody/media` importé avec historique ; `node_modules` purgé de l'historique | Ouverture publique après nettoyage des trailers IA hérités et du corpus local `data/rag/massive-training-triplets-full.jsonl` (audit : 9 030 objets, 0 secret réel, 35 faux positifs de fixtures) |
| Retiré d'Aphrody | apps/packages Shenron et Koharu, `m3/packages/{shenron-ui,admin-ui}`, 16 crates de traduction Koharu, `aphrody-manga`, `aphrody-rag::{dragonball,shenron}`, outils MCP `dragonball.*`/`dbfr_*`, CLI `shenron`/`manga`/`ocr shenron`/`ocr dbfr`/`rag ingest-shenron`, exports FFI `shenron_*`/`manga_*`, Studio et réglages Koharu du bureau, chaîne JP→FR de `aphrody-translate` ; 32 dépendances de workspace orphelines et 79 entrées de catalogue Bun retirées | Restes documentaires et générés : lots de l'agent purge-aphrody |
| Conservé à l'Infra | unités systemd/nginx/privoxy Shenron, `atomic-deploy-shenron.sh`, sauvegardes, passerelle `/api/v1/shenron/*` (cache Redis sous la feature `gateway-cache`, défaut), pair A2A `shenron`, profil `dbfr`, socle ML `koharu-*` | Le bot se compile depuis `SHENRON_ROOT` ou le checkout voisin |
| État privé | `data/shenron/home` (not in repo) (3 Gio, identifiants, modèles), `bot.db`, caches et sorties de build déplacés vers `~/shenron` (6 181 fichiers, SHA-256 vérifiés avant/après) ; unité utilisateur `shenron-rag-sync` repointée | Rechargement systemd non relancé (timer déjà en échec avant) |
| Gates | `cargo check`, `clippy -D warnings` et tests ciblés verts (`aphrody-{translate,config,rag,discord-compiler,command,mcp,ffi,embed}`, `aphrody`, `aphrody-app`) ; Bun : typecheck de 5 paquets, app-ui 207 tests, `@aphrody/workspace` 292, `@aphrody/bun` 7 ; lots d'erreurs préexistantes corrigés (clippy 1.98, `simdutf`, fork Tauri, OCR resume portable, préchargement app-ui, test d'isolation natif, contrat Discord) | Diagnostic local `APHRODY_LOCAL_CARGO=1` ; assets d'icônes d'`aphrody-bun` absents du dépôt depuis `c2d7bbd32` (restaurés localement pour vérifier, non commités) |
| Production dragonballfr.com | Hors ligne depuis le nettoyage du vps du 2026-10-03 : ni vhost ni unité Shenron sur le vps (cible DNS 51.77.147.152, certificats présents), TLS refusé par `ssl_reject_handshake`. Médias conservés sur dbfr (`/srv/shenron/shared` : wiki 20 Gio / 21 067 fichiers, assets du bot 11 Gio / 66 690), release `749cc9dd` sans lien `current`, SQLite et secrets préservés sous `/home/ubuntu/preserved` du vps | Bascule vers dbfr inachevée : dbfr sans vhost Shenron, disque à 93 % ; décision serverless du 2026-10-04 non exécutée |
| CDN statique Shenron (vps) | Vhosts `dragonballfr.com`, `cdn.` et `bot.` installés : fichiers servis depuis `/srv/shenron-cdn`, puis Next ou le bot, puis maintenance (503 HTML de marque, API en 503 JSON). `shenron-cdn-sync.timer` (horaire) tire wiki, assets et `public-extra` de dbfr par WireGuard avec une clé `rrsync -ro` limitée à 10.8.0.1 (shell et écriture refusés, vérifiés), au plus 2 000 suppressions par arbre ; `public/` et chunks Next de `749cc9dd` amorcés (35 Mo, 16 Mo). Vérifié : chunk Next 200 brotli immuable, police et image `public/` 200, manifest typé, `.env` 410, fichiers d'une copie en cours 404, `/_next/image` sans Next → 302 vers le CDN ; `nginx -t` vert, sauvegarde `/var/backups/nginx-shenron-*` ; copie initiale terminée (21 067 + 66 690 + 286 fichiers, comptes égaux à dbfr) ; HTTP/3 vérifié de l'extérieur (curl 8.22 ngtcp2 : h3 200 CDN, 503 maintenance, 301 www), sockets QUIC `reuseport` portés par le serveur par défaut partagé, nom inconnu refusé en h3, `Alt-Svc`, UDP 443 ouvert dans ufw, TLS 1.3 `X25519MLKEM768` négocié, 0-RTT sur le CDN (GET/HEAD), `brotli_static`/`gzip_static` | Les chunks d'une nouvelle release s'ajoutent au déploiement ; HSTS preload non demandé (engagement de domaine) |
| Optimiseur CDN sans perte | `scripts/release/cdn-optimize.ts` (Bun, TS 7.0.2 strict 0 erreur, oxlint propre) : JPEG `jpegtran` (pixels djpeg identiques), PNG `oxipng`/`zopflipng` (RGBA 16 bits identiques, APNG intact), GIF `gifsicle -O3` (images et délais identiques), WebP sans perte `cwebp -z 9 -exact`, MP4 faststart (framemd5 identiques), texte `.br`/`.gz` vérifiés, doublons en hardlinks, manifeste SQLite incrémental, refus d'une source vide ; 11 tests de bout en bout verts sur le vps avec les vrais outils (7 + 4 ignorés en local) ; essais à blanc : PNG −13 à −20 %, JPEG −1,7 à −3,3 %, WebP avec perte −0,1 %, texte br −95 % ; binaire `aphrody-cdn-optimize` dans l'unité de synchro du vps, miroir source en hardlinks (0 octet ajouté), `oxipng` 10.2.1 par cargo-binstall (`hostTools.vps`) | Premier passage complet lancé le 2026-10-05 10:58 UTC ; WebP et JPEG avec perte ne gagnent presque rien sans perte |

## Shenron / Aphrody shared implementation — 2026-10-05

Readers, their CSS and modal focus now delegate to M3; six desktop/mobile PNGs
are byte-identical before/after. API, compute and OCR use `@aphrody/http` in process;
domain policies, stores and personas remain separate. 158 focused tests pass,
two existing persona-source tests skip. Seven scoped TypeScript projects and UI
production build pass. Broader API/site/bot checks retain live-RAG, portability
and missing Discord artefact failures. [Scope and evidence](docs/architecture/workspace/SHENRON-DEDUP.md).

## Fusion monorepo, plan et outils — 2026-10-05

Relevé en lecture seule (aucun Cargo) avec `yolo`, `aphrody-workspace`, `gh` et git.

| Sujet | Constat | Limite |
| --- | --- | --- |
| Plan | `9625256fa` a réécrit [PLAN.md](PLAN.md) (monorepo unique, `libaphrody_ffi`) ; phase 1 cochée, phases 2-4 ouvertes. `crates/interop/ffi` définit 67 `aphrody_*` (= en-tête) ; `yolo_*` et `ffi_sum_squares` sont dans `crates/engine/yolo-runtime`, `bun_rs_*` dans `crates/ui/bun`, `aphrody_oxc_*` dans `crates/compat/oxc-bridge`, aucun `aphrody_n2b_*` | Comptes de tests de la phase 1 (135 TS, 37 Python) repris du plan, non rejoués |
| Contrats | ABI, permissions, unwind, directive JSC/V8/Tauri/Obscura du 2026-10-05 et queue R3-R8 n'existent plus que dans l'ancien plan : `git show adec4dd67:PLAN.md` | `AGENTS.md` renvoie encore aux contrats de PLAN |
| Fusion | `~/yolo` supprimé le 2026-10-05 après push de `dev` et `vendor` (`048886b`, `cb27145`) et sauvegarde SQLite dans `var/yolo-legacy/` ; `config/host`, `bin/yolo` et les crates `aphrody-*` (`crates/vendor/*`, 113 membres, 7 doublons retirés, `tauri-specta` vendoré) sont dans ce dépôt ; `YOLO_ROOT` pointe sur `~/aphrody` ; `cargo metadata --locked` passe, aucun build ni test Rust rejoué | Pins SDK/runtime (`rev`) référencent encore l'historique du producteur ; `aphrody-tauri-plugin-sql` exclu (conflit `links = sqlite3`) ; trois branches `backup/*-pre-rewrite` locales de `~/yolo` supprimées avec lui |
| Outils | `yolo doctor` : runtime 0.1.0 ABI 1.4 vérifié. `aphrody-workspace status`/`doctor` échouent (`config/infra/inventory/targets.json` absent : `aphrody-infra` 0.1.0 installé précède `01afd3b8d`, qui a déplacé le catalogue vers `config/host`) ; `plugins validate` et `workspace-git-audit` fonctionnent | Réinstallation d'`aphrody-infra` = build Cargo de l'intégrateur, non faite |
| CLI yolo | Source `apps/yolo/cli` ; deux imports relatifs périmés corrigés (`index.ts` desktop-release, `plugin.ts`) ; `scripts/tools/cli-help-sync.ts` pointe sur le nouveau chemin et `docs/cli/HELP.md` est régénéré ; `bun run cli:help` : 59 binaires, 942 pages, 21 échecs, 17 absents | Imports `packages/core` → `packages/engine/core` corrigés par une autre session, non commités au relevé |
| VPS | `yolo host audit --host vps` : Ubuntu 26.04.1, 12 CPU, 45,9 GiB RAM, `/srv` 286 GiB libres ; Bun et Cargo installés ; docker et nginx installés mais aucun service applicatif actif ; verrou `heavy.lock` tenu (fetch/checkout git) ; aucun build de fabrique pour `2f3293549` | « Bun absent du VPS » (ligne Interpréteurs inline) est périmé |
| CI | Les quatre derniers pushs `main` échouent en 2-4 s avec l'annotation de facturation (run 37254248413) | Blocage propriétaire, pas un défaut de code |
| Marketplace | `aphrody-user` enregistré dans Claude Code depuis `plugins/` (ignoré par la racine, `2f3293549`) ; chemins du store, lanceur MCP yolo et racine `vendor/bun` alignés sur le monorepo ; plugin `aphrody` laissé à son propriétaire (claim `native-integration`) | Échecs restants : skills du plugin `aphrody`, symlink `.mcp.json` d'`aphrody-m3` en mode strict |
| Plugins 2026-10-05 | Store fusionné en `aphrody` (privé : cœur, M3, Google, Web, IECODE), `shenron` et `yolo` (public, générique) ; Codex/agy retirés (plus d'abonnement), timer `aphrody-codex-sync` supprimé ; MCP sans doublon : `aphrody-kernel mcp` (329 outils, proxie `aphrody-mcp` 164 dont `dragonball.*`), `aphrody-m3`, `yolo mcp` (14) — tous connectés ; `aphrody plugins validate` : 0 problème, faits `current` | Dépôts `plugin-aphrody-m3`, `plugin-google-gemini`, `plugin-bxc`, `plugin-iecode` conservés sur leurs remotes, sans commit non poussé ; visibilité GitHub de `plugin-yolo` non modifiée (API 404 avec le jeton courant) |
| Fabrique 2026-10-05 | `build-factory run --install`, `run --detach --install` (attente du job) et `install --job` téléchargent les binaires dérivés de la commande Cargo, vérifient le SHA-256, sondent `--version` puis remplacent atomiquement dans `~/.local/bin` (précédent conservé, reçu `~/.local/state/aphrody/factory-installs.jsonl`) ; builds release routés installés automatiquement (`APHRODY_FACTORY_INSTALL=0` pour désactiver) | Le VPS (glibc 2.43) produit des binaires refusés par WSL (glibc 2.39) : `aphrody-mcp` 3f9f1cbe6 construit sur la fabrique puis refusé, reconstruit localement (`APHRODY_LOCAL_CARGO=1`, 3 min 46) et installé ; une cible glibc 2.39 (zigbuild ou conteneur) reste à déclarer |

## Purge des restes Shenron / Koharu (purge-aphrody) — 2026-10-05

| Lot | Preuve | Limite |
| --- | --- | --- |
| Icônes `aphrody-bun` | `0fa2673e3` : `build.rs` vérifie les polices `material-symbols@0.44.8` contre `m3-fonts/fonts.lock.json` (octets identiques à l'ancienne copie) et les embarque, sinon compile et répond `FontsUnavailable` ; fabrique : `check -p aphrody-bun -p aphrody-ffi -p aphrody` vert sur la révision poussée ; local : 8 tests de parité pixel avec polices, 1 test sans | La fabrique ne synchronise pas les polices : ses binaires n'embarquent pas les icônes tant que `bun m3/scripts/fonts-sync.ts` ne précède pas le build |
| Crates, M3, Python, Infra | `7d68a266e`, `f2e77273a`, `ca8dff37e`, `556963801`, `b69654a4f` : jeu d'évaluation Dragon Ball, presets `@aphrody/web-test`, `dragon-ball.css` et alias `DatabookReader` (renommé `CaptionedReader`), `relecture-ocr`, `shenron_ffi.py`, copies de skills, faux pairs A2A retirés ; pointeurs vers aphrody-labs/shenron ; fabrique : clippy `-D warnings` (`aphrody-rag-eval`, `aphrody-web-crawl`, `aphrody-app`) et tests `aphrody-rag-eval` verts | Contrats gardés : plan d'hôte, passerelle `/api/v1/shenron/*`, alias d'environnement `APHRODY_SHENRON_*`, pair A2A `shenron`, profil `dbfr`, `aphrody ocr databooks` |
| Docs | Notes produit retirées ; documents datés marqués `docs-links: external-paths` ; `docs/llms.txt` redevient l'index agent (1,2 Ko au lieu du vidage `aphrody-summary` de 22 Mo) ; `.env.example` ne se relit plus lui-même (400 noms retirés, encore cités ou lus gardés) ; `docs:check` vert | `docs:check-links` reste rouge pour des chemins hors Shenron (environ 460) ; `docs/reference/workspace/TOOLS.md` (relevé Agent Home du 2026-10-01) liste encore les outils `dragonball.*` du binaire `aphrody-mcp` installé tant qu'il n'est pas reconstruit |
| Garde-fou | `bun run audit:product-residue` (`scripts/audit/workspace/product-residue.ts`, 3 tests) : compte par fichier suivi les lignes nommant Shenron, Koharu, Dragon Ball ou les databooks ; la base `config/product-residue.baseline.json` (488 fichiers, 4 251 lignes après purge : plan d'hôte, passerelle, socle `koharu-*`, relevés datés) ne peut que baisser | Pas encore branché dans un workflow CI (les jobs ne démarrent pas, facturation) |

## Fusion de py et runtime vu — 2026-10-05

| Lot | Preuve | Limite |
| --- | --- | --- |
| Inventaire | `a90c757ee` : [inventaire](docs/plans/vu/INVENTORY-py-vs-aphrody.md) ; 4 groupes de blobs identiques, 26 fichiers de `py/` proches (30 % ou plus) d'un fichier du monorepo | Recouvrements de capacités Python/Rust listés, non portés |
| Crate native | `47d2681b5` : le dossier native de py/packages/aphrody supprimé, `crates/ai/rag-python` seul propriétaire de `aphrody-rust` (modules rag-core identiques octet à octet) ; VPS : vérification, clippy `-D warnings` et tests (rag-core, rag-python) verts ; roue construite par `uv build --wheel` (maturin 1.14.1) : 788 600 octets, vérificateur de roue installée : 514 tests passés, 31 ignorés, `qualify_aphrody.py` réussi | PyO3 fixé par le verrou du workspace (0.29.3, plus 0.29.0 exact) ; extension 1 161 480 octets contre 790 160 (fonctionnalités par défaut de rag-core) ; sdist autonome abandonné ; `py/tools/workspace` non rejouable sans installation Bun du workspace |
| Déduplication | `0e57c2a8c` : 42 fichiers suivis retirés (adaptateurs Drive copiés, `ovh.py` couvert par `aphrody ovh dns`, CI imbriquée, reçus d'exécution, deux README périmés), erreurs préexistantes corrigées (mypy `aphrody-train`, gate de roue isolée) ; pytest `py/` complet vert avec un environnement local complété | Câblage de l'ancien dépôt `aphrody-py` dans les catalogues hôte et fabrique non touché : liste en section 10 du plan |
| Nom et plan | `0cd1df3a8` : runtime `vu` (inverse littéral de `uv`), décision du propriétaire, une constante dans `docs/plans/vu/scaffold/vu.json` ; [plan](docs/plans/vu/PLAN.md) avec journal de vérification et décisions D1 à D10 | Dépôt `vu` non créé |
| Forks | `aphrody-labs/uv` `vu-pin-0.12.23` (`46b84fd0`), `aphrody-labs/ruff` `vu-pin-0.16.10` (`3265ed1f`), `aphrody-labs/pyo3` `vu-pin-0.29.3` (`451d99fd`) ; les paquets crates.io portent les mêmes commits ; les verrous de uv et ruff n'ont ni source git ni pyo3 ; `scripts/audit/workspace/vu-pins.ts` (6 tests, `--online` vert) ; entrées `vu-*` de `config/upstream-sources.json` | Forks publics (règle GitHub), aucun correctif Aphrody ; les crates `uv-*` et `ruff_*` sont des composants internes, l'interface publique est la CLI |
| Faisabilité | VPS, rustc 1.98.1, 4 jobs : vérification de uv 3 min 51, de ruff 1 min 32, d'un binaire d'essai uv + ruff + PyO3 dans un workspace de 804 paquets 3 min 29 | Pas de build release, pas d'édition de liens, glibc du binaire non mesurée (WSL 2.39, VPS 2.43) |
| Build et consommation (2026-10-06) | `vu` `df8a358` : reçu `7c3db189` vert (uv, ruff, vu, tests, clippy, assemble, smoke, audit glibc max 2.39), artefact 187 Mo ; `vps-cargo --repo vu` clippy `-D warnings` et tests verts ; aphrody `7284f8908` puis rebase : `yolo py status` vérifie l'artefact (rapide et complet, caches bytecode exclus), pytest py/ via l'uv du runtime 707 réussis, 18 ignorés, 3 échecs (roue `aphrody` non installable pendant l'édition du workspace Cargo par un autre lot) ; rag-python clippy et tests (rag-core 73) verts ; P6 tranché (D17), extension `_yolo_native` compilée détrackée | P5 (installation et activation via Infra) ouvert ; mémoire de pointe non mesurée |

## Foyer agent, base unique, pipeline unique (agent-home-pipeline) — 2026-10-06

| Lot | Preuve | Limite |
| --- | --- | --- |
| 0 Plan | [plan](docs/plans/agent-home-pipeline/PLAN.md) : inventaire mesuré (15 crates IA plus shell/session et sql, 16 bases SQLite et environ 735 transcripts JSONL sous ~/.aphrody, 4 chemins RAG divergents, 3 formats de mémoire, 4 magasins de vecteurs, 3 magasins d entraînement), graphe Graphify de ce dépôt (105 977 nœuds, 234 039 arêtes, 97 % EXTRACTED), cible une base `<foyer>/db/aphrody.sqlite` par foyer, crates `aphrody-store` et `aphrody-code-graph`, critères de parité P1 à P6, lots 1 à 8 | Aucun code ; `yolo train` n existe pas (délégué à créer) ; aucune base `vector/rag.sqlite` ni `rag/index.db` sur cette machine |
## Espace cloud Claude comme hôte de travail — 2026-10-05

Directive du propriétaire (session cloud, trois messages) : optimiser les projets, les configurer pour s'exécuter
dans l'espace cloud Claude, lever l'interdiction Cargo dans cet espace, installer les plugins, le MCP Aphrody, ses
clients et la toolchain, liberté d'action maximale, tout garder en mémoire. Les règles WSL/VPS restent valables
hors du cloud.

| Lot | Preuve | Limite |
| --- | --- | --- |
| Conteneur | 4 CPU, 15 Go de RAM, environ 30 Go de disque libre ; rustc/cargo 1.98.1 (installés par `rust-toolchain.toml`), clang, `ld.lld`, cmake, ninja, uv ; réseau : index crates.io, npm, PyPI et static.rust-lang.org joignables | `sccache`, `oxlint`, `oxfmt`, `aphrody` et `yolo` Rust absents ; builds du workspace complet, V8, Tauri, WebKit hors de portée du disque et des CPU |
| Cargo levé dans le cloud | `block-local-cargo.ts` (`isCloudSession` : `CLAUDE_CODE_REMOTE=true` ou `APHRODY_CLOUD=1`), `cargo-serial.sh` (pas de route factory, jobs = nproc plafonné à 6), `AGENTS.md` ; `bun test scripts/dev/hooks/block-local-cargo.test.ts` : 3 pass ; hook rejoué en cloud (sortie 0) et hors cloud (sortie 2) | Aucun `cargo check` réussi : voir ligne suivante |
| Blocage Cargo | `cargo fetch --locked` échoue : `Cargo.toml:462` dépend de `ssh://git@github-dev/aphrody-labs/taffy.git` (alias SSH de la machine du propriétaire) ; `aphrody-labs/taffy` ajouté à la session en lecture, mais le clone a été refusé par le classifieur d'auto-mode (« Untrusted Code Integration ») ; non contourné | Le workspace Rust ne se résout pas ici tant que ce fork n'est pas disponible ; décision du propriétaire attendue. Le propriétaire a ensuite autorisé tous les dépôts `aphrody-labs` : attachés en lecture (`add_repo`) `taffy`, `plugins`, `plugin-aphrody`, `shenron`, `yolo`, `aphrody-m3`, `fut` ; forks publics (`pyo3`, `ruff`, `uv`, `rusty_v8`, `WebKit`, `obscura`, `tao`, `wry`, `tauri`) lisibles anonymement ; `iecode` refusé par le classifieur ([Permission Grant]) et laissé de côté ; deuxième tentative de clone de `taffy` refusée aussi ; aucun clone effectué |
| Bun et MCP | Bun 1.4.2 (`packageManager`) installé dans `~/.bun-1.4.2`, lien `~/.local/bin/bun` ; `bun install --frozen-lockfile` : 732 paquets, verrou inchangé ; `yolo` : `yolo version` OK, serveurs MCP `yolo mcp` (initialize et `tools/list`) et `m3-mcp` (initialize) répondent en stdio ; `.mcp.json` les déclare ; `.claude/hooks/session-start.sh` (inscrit dans `.claude/settings.json`) rejoué : sortie 0, idempotent | Serveur `aphrody-mcp` et plugins Rust non installés (binaire `aphrody` à compiler, dépend du blocage ci-dessus) ; `.mcp.json` ne se charge qu'au prochain démarrage de session ; aucun plugin Claude packagé dans le dépôt (seul `docs/research/.../adobe-connector/plugin.json`) |
| Dépôt `bun` | PR draft aphrody-labs/bun#1 : fusion de l'amont `oven-sh/bun` (`13a98b0d`, spawnSync #44581), sans conflit | Ni build ni test (le build debug du fork dépasse ce conteneur) |

## Téléchargements publics (download-server) — 2026-10-06

`aphrody` (binaire unique, MCP `aphrody-mcp`), `yolo` et les plugins sont publiés sur https://downloads.aphrody.com (aussi aphrody.com) par `scripts/release/publish-downloads.ts` (`config/downloads.json`, [runbook](docs/operations/infra/DOWNLOADS.md)) : build fabrique de `8f891f0d4` (glibc max 2.39 vérifié), SHA-256 vérifié sur l'hôte puis depuis l'URL publique, `--version` et poignée de main MCP OK, releases GitHub sur dépôts privés existants. Limite : Windows (cargo-xwin installé sur la fabrique, build en cours), macOS et yolo Windows non publiés ; pas de signature (aucune clé définie).

## `@aphrody/x` import Bun sur `aphrody-x` — 2026-10-06

`crates/web/x` est l'implémentation unique de X : table d'opérations JSON (`ops`), batch avec checkpoint JSONL (`batch`), taxonomie d'erreurs partagée (`data/x-policy.json`). `aphrody-ffi` expose l'API job (Web ABI 5, `aphrody_web_x_*`), `@aphrody/bun/x` la marshalle, `@aphrody/x` n'est plus qu'un binding fin (`XClient`, `xBatch`, `Store`) plus l'orchestration (purges, radar, crawler). Gates : clippy `-D warnings`, 167 tests `aphrody-x` et 54 `aphrody-ffi` sur le VPS ; cdylib release (5 min 40) sans import au-delà de glibc 2.39, chargée sous WSL ; 172 tests Bun (`packages/interop/native`, `packages/web/x`, `packages/ai/xai`) via boucle locale. Non fait : paquet, installation, activation de l'artefact ; aucun appel réseau réel vers X.
| 1-2 Store | crate `aphrody-store` (`crates/ai/store`) : chemin par foyer `<foyer>/db/aphrody.sqlite`, migrations 0001-0006 (rag, noyau, graphe, mémoires, sessions, entraînement) via le runner `aphrody-sql`, empreintes de fichiers reprenables par étape, journal de runs, sauvegarde `VACUUM INTO` vérifiée par sha256 avec fichier `.sha256`, liste de refus des secrets, importeurs en lecture seule avec dry-run (graph.json en flux, mémoires, rag, index de sessions) ; VPS : 36 tests, clippy `-D warnings` verts ; entrée de provenance `graphify` (v8, `5c7b8479`, Apache-2.0) dans `config/upstream-sources.json` | Importation réelle pas encore exécutée ; `Cargo.lock` commité par extraction de la seule entrée du crate (le fichier de travail porte des changements d autres agents) |

## Un seul binaire, bxc et n2b en alias (bxc-n2b-unify) — 2026-10-06

| Lot | Preuve | Limite |
| --- | --- | --- |
| Unification | `bxc`, `bxc-mcp`, `n2b` sont des noms multicall du binaire `aphrody` (`bxc_compat`, table de parité), `aphrody package` réduit à catalog/status/doctor/install/uninstall ; `aphrody-web-bridge` supprimé, `aphrody-web-service` seul propriétaire de fetch, session et erreur ; [document](docs/migration/bxc-n2b-unification-2026-10-05.md) | Sous-commandes bxc sans équivalent Rust retirées avec message (exit 2) |
| 4 Graphe natif | crate `aphrody-code-graph` : graphe en mémoire chargé et sauvé dans les tables du foyer, export `graph.json` compatible, `query`, `path`, `explain`, rapport, communautés Louvain déterministes, nœuds dieux, extraction Rust tree-sitter 0.27 (ids et libellés au format Graphify, résolution des appels même fichier EXTRACTED puis définition unique INFERRED, fusion des stubs de types), construction incrémentale (étape scan du store, cache par fichier clé BLAKE3, reprise) ; store : étape scan (liste de refus, `.graphifyignore`, classification) et migration 0007 ; VPS : 26 + 40 tests, clippy `-D warnings` verts | Pas encore de mesure de parité contre Graphify ; Rust seulement ; binaires transitoires `aphrody-store` et `aphrody-graph` en attendant le câblage `aphrody graph` |
