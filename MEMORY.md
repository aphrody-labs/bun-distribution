<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody — mémoire factuelle

Relevé : 2026-10-03. [PLAN.md](PLAN.md) est l'autorité architecture/queue ;
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
catalog et [bun.lock](bun.lock). SDK 0.1.0, archive `b2d69b27`, producteur
`ad2ec0d2263e6d3291d068e9794bf05fb4efde3d`. Artefact natif et matrice :
[mémoire Yolo](../yolo/MEMORY.md). Révision SDK et révision native sont distinctes.

Obligations conservées : contrats Shenron/RG/Koharu, UI canonique Aphrody,
stores séparés et assets servis. RG : release/activation non démontrées par ce lot. Shenron DBFR : données persistantes observées ;
site/MCP/bot non qualifiés comme activés par ce relevé.

Les scans lexicaux et anciens états Git ne prouvent pas le graphe résolu,
les profils panic, la release courante ou un gain. Vérifier la surface sélectionnée.
Mémoire fichier uniquement ; aucune synchronisation de mémoire fournisseur revendiquée.
