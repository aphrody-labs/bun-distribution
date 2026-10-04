<!-- SPDX-License-Identifier: Apache-2.0 -->
# GOAL — Aphrody

Directive propriétaire du 2026-10-04, réécrite et vérifiée contre l'état réel du poste
(commandes citées en fin de document). Pendants : [Yolo](../yolo/GOAL.md) pour la bibliothèque
partagée et [aphrody-py](../aphrody-py/GOAL.md) pour la surface Python IA/ML.

## 1. Rôle

Aphrody est la couche **produits** : IA, interface, applications, web. Il consomme
Yolo comme bibliothèque partagée native et ne recopie aucun moteur.

Axes prioritaires :

- **Windows 11** : cible MSVC native (Visual Studio Build Tools 2026), Windows SDK, .NET 10 ;
- **GUI et Tauri** : applications de bureau et intégration système ;
- **V8** : moteur JavaScript des surfaces applicatives, conservé jusqu'à la parité Obscura/JSC ;
- **UI** : `packages/ui/app-ui` et `crates/ui/*` restent canoniques ;
- **IA** : agents, passerelle compatible OpenAI, MCP, A2A, inférence locale.

La surface Python IA/ML vit dans `aphrody-py`, pas dans le code Rust ou Bun d'Aphrody.

## 2. Produit aphrody.com

aphrody.com est le point d'entrée de développement et de déploiement de :

- le web, le serveur MCP, A2A et le serveur d'applications ;
- le crawl, CDP avec Obscura, `obscura serve` et `Bun.serve` ;
- un point d'accès compatible OpenAI, GraphQL et un serveur OAuth privé.

## 3. Sécurité et authentification

- **Appareil de confiance** : authentification d'appareil en un clic, liée à l'IP du poste du propriétaire.
- **Validation mobile** : second facteur depuis une application mobile, par QR code.
- **CLI, requêtes IA et serverless** : jeton fourni par variable d'environnement.
  - D'agent à agent : jeton généré par l'agent.
  - De code à code : jeton généré par le code.
- Aucun privilège Bun ou hôte implicite pour une page distante ; vérifications côté natif.

## 4. Synchronisation avec Yolo

- Importer et synchroniser les crates, paquets et applications communs à Aphrody et Yolo.
- Aligner les systèmes de documentation, de scripts, de tests et le paquet Infra.
- Dédupliquer strictement : une capacité, un propriétaire.
  - Aphrody pour les produits ; Yolo pour le cœur, le runtime et les compilateurs.
- Maximiser WASM et FFI (zéro copie), réduire les dépendances externes.
- Nettoyer automatiquement le code remplacé ; aucune archive ni sauvegarde « par précaution ».

## 5. Build et installation

- **Builds lourds sur les hôtes SSH** :
  - paquets Bun sur `dbfr` ;
  - Rust et C++ sur l'usine de compilation (voir préalables) ;
  - aucune surcharge sur WSL.
- **WSL Ubuntu 24.04** : Aphrody complet, binaires, bibliothèques et dépendances installés.
- **Windows 11** : binaires, bibliothèques et dépendances installés via `aphrody-ops system-packages`.
  - Tests natifs MSVC avec `scripts/dev/windows-cargo.ps1`.
  - Tests Bun avec `scripts/dev/windows-bun-test.ps1`.
- Les binaires d'Aphrody et de Yolo peuvent être construits dans la même passe.

## 6. Famille IECODE sur Windows

- RG, NIE, IEVR, Inagle et IECODE sont regroupés sous `C:\iecode`.
- Ils sont installés entièrement, avec les permissions d'administration de Windows 11.
- Les variables d'environnement sont reconfigurées pour le téléchargement et le chargement.
- Le VFS IEVR est chargé comme plugin Bun natif, via la bibliothèque partagée Yolo.

## 7. Ordre d'exécution et fin

1. Valider ce GOAL et celui de Yolo (ce fichier).
2. Effectuer un scan complet de `main`, sous-modules compris, sur du code entièrement commité.
3. Compiler et installer réellement les binaires et dépendances.
4. Mettre à jour ensuite seulement, une fois vérifiés : README, PLAN, AGENTS.md, docs, scripts, configuration MCP et plugins d'Aphrody et de Yolo.

Une étape n'est close qu'avec sa preuve (révision, commande, résultat) dans [MEMORY.md](MEMORY.md).

## 8. État vérifié (2026-10-04)

| Élément | Constat | Source |
| --- | --- | --- |
| CLI | `aphrody 1.0.0-canary` | `aphrody --version` |
| Domaines | crates : ai, compat, contracts, discord, google, infra, interop, koharu, native, os, shell, ui, web ; apps : cli, koharu, rg, shenron | `ls crates apps` |
| IA | passerelle compatible OpenAI (`aphrody-gateway`), `aphrody-llama-server`, client OAuth 2.1 MCP (`aphrody-mcp-oauth`) | `docs/ecosystem/ECOSYSTEM.md` |
| MCP | sous-système `workspace` (7 outils) servi par `aphrody-workspace-subsystem.service` | `docs/ecosystem/MCP-TOOLS.md` |
| Windows 11 | Visual Studio Build Tools 2026 (v18.10, MSVC 14.51), Windows SDK 10.0.26100, .NET SDK 10.0.401, PowerShell 7.6.6, module WinGet 1.29.380, Bun 1.4.2, uv, Rust 1.98.1 MSVC | `system-packages plan --host windows`, `vswhere`, `dotnet --list-sdks` |
| Tests MSVC natifs | `aphrody-winclean`, `-diagnostics`, `-a2a-coord`, `-a2a-pb`, `-wsl` : verts | `scripts/dev/windows-cargo.ps1` |
| WSL | Ubuntu 24.04, glibc 2.39, gcc 13.3, clang 18.1.3, cmake 3.28.3, ninja 1.11.1, MinGW gcc 13, zig 0.16.0, cargo-zigbuild 0.23.4, cargo-xwin 0.23.1, uv 0.12.22, TypeScript 7.0.2 | versions des outils |
| Hôtes | `vps` hôte de production, `dbfr` hôte secondaire, `wsl-ubuntu-24.04` hôte de build de référence | `config/infra/inventory/targets.json` |

## 9. Écarts et préalables

- **Usine de compilation** : `vps` est runtime-only depuis le 2026-10-03.
  - Ni toolchains, ni `~/.bun`, ni `/srv/aphrody-build` ; `config/build-factory.json` le désigne pourtant encore.
  - Il faut réprovisionner une usine (vps ou autre hôte) avant la compilation Rust/C++ sur SSH.
- **Répartition des moteurs** : [PLAN.md](PLAN.md) attribue encore V8, Obscura et Tauri précompilés à Yolo.
  - Yolo embarque aujourd'hui 47 crates Tauri ainsi que `vendor/tauri`, `wry`, `tao` et `obscura`.
  - La directive donne le focus V8, Tauri et GUI à Aphrody.
  - Le nouveau propriétaire de ces sources reste à trancher avant toute migration.
- **Authentification** : appareil de confiance, 2FA mobile par QR et jetons agent/code n'existent pas encore.
  - Seuls des clients OAuth existent.
- **IECODE sous Windows** : `C:\iecode` n'existe pas ; IECODE et RG sont dans le home WSL.
  - NIE et IEVR n'ont pas de checkout séparé.
  - Tout déplacement exige une sauvegarde vérifiée par checksum ([AGENTS.md](AGENTS.md)).
- **Build Tools 2026** : `vswhere` rapporte `isComplete=0` (installation 1603, réparation sans effet).
  - Le toolset MSVC fonctionne quand même.
- **MSYS2 et Cygwin** : absents (`C:\msys64`, `C:\cygwin64`) ; la directive vise des équivalents Rust natifs.
- **macOS** : aucune exécution réelle disponible ; seulement des compilations croisées.
