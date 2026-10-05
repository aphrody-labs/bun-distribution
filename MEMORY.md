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
