<!-- SPDX-License-Identifier: Apache-2.0 -->
# GOAL — Aphrody

Directive propriétaire du 2026-10-04, réécrite et vérifiée contre l'état réel du poste
(commandes citées en fin de document). Pendants : [Yolo](GOAL.md) pour la bibliothèque
partagée et aphrody-py pour la surface Python IA/ML.

## 1. Rôle

Aphrody est la couche **produits** : IA, interface, applications, web. Il consomme
Yolo comme bibliothèque partagée native et ne recopie aucun moteur.

Précision propriétaire du 2026-10-05 : décharger la compilation lourde d'Aphrody
vers **Yolo**. Obscura/V8, Tauri/Wry/Tao, Bun/JSC/WebKit et leurs dépendances
moteur appartiennent au producteur Yolo. Aphrody conserve le code métier, les
interfaces et les intégrations produit ; il consomme le runtime précompilé, le
SDK léger et les plugins Bun versionnés. Le focus GUI ci-dessous désigne le
produit, pas la propriété des sources des moteurs. Cette directive autorise les
migrations de sources nécessaires, au-delà du précédent périmètre maintenance.
Un simple déplacement de dépendances Cargo ne satisfait pas l'objectif : modifier
le produit ne doit plus reconstruire les moteurs.

Axes prioritaires :

- **Windows 11** : cible MSVC native (Visual Studio Build Tools 2026), Windows SDK, .NET 10 ;
- **GUI et Tauri** : applications de bureau et intégration système ;
- **V8** : moteur JavaScript des surfaces applicatives, conservé jusqu'à la parité Obscura/JSC ;
- **UI** : `m3/packages/app-ui` et `crates/ui/*` restent canoniques ;
- **IA** : agents, passerelle compatible OpenAI, MCP, A2A, inférence locale.

La surface Python IA/ML vit dans `aphrody-py`, pas dans le code Rust ou Bun d'Aphrody.

Langages (directive du 2026-10-04) :

- **MCP, CLI, UI et API d'Aphrody** : entièrement en Rust (Yolo porte les mêmes surfaces en Bun).
- **IA, LLM, RAG et agents** : Rust, Bun et Python (uv) uniquement.
- **.NET, C++, C, Go et autres** : aucune règle ; on choisit le meilleur outil pour le cas d'usage.
  - Installation, compilation depuis les sources, CLI ou FFI, selon les blocages et limites d'Aphrody et de Yolo.

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

## 5. Moteurs commutables et paquets

- **V8, JSC, Tauri, WebGPU** : chaque moteur est un interrupteur (variable d'environnement, configuration, binaire).
  - Aphrody se compile avec ou sans V8, avec ou sans JSC/WebKit (API directe hors V8), avec ou sans Tauri, avec ou sans WebGPU.
  - Sans Tauri : interface native de l'OS et pile d'interface Rust (wgpu).
  - Avec V8 et Tauri : installation optimisée pour un usage humain réel, comme un ChromeOS où Obscura et les crates Rust remplacent Chromium.
- **Paquets** : Obscura, Turbopack, Tauri et les autres moteurs sont des paquets optionnels et interchangeables au build, au packaging, au lint et aux tests, comme dans un système POSIX.
  - Le gestionnaire unifié (Bun, uv, Cargo) vit dans le cœur de Yolo.

## 6. Hôtes et hébergement

- **Les deux VPS** sont dédiés à la compilation, aux VFS très lourds, aux bases de données lourdes (Redis, SQL) et à l'IA sur CPU.
  - Exemple : Gemma 4 E2B via aphrody-py, l'IA Rust d'Aphrody et l'interface IA en Bun.
  - Les anciens plans, documents et usages RG des VPS sont abandonnés.
- **RG et Shenron** deviennent entièrement serverless : Vercel, Fly.io, Docker ou Coolify, choisi après benchmark comparatif.
  - Yolo les transforme, les lint, les formate et les compile (serveur natif et web selon les guides 2026).
  - Aphrody fournit un « Vercel open source » : nos IA et nos interfaces les gèrent pour l'utilisateur, comme Vercel, Coolify ou Hostinger.
- **WSL** est purgé progressivement (consommation mémoire instable).
  - Une fois les objectifs d'Aphrody et de Yolo bouclés : image Docker ou WSL propre, issue d'une distribution Linux minimale préconfigurée pour Aphrody, Yolo et IECODE.
- **Distribution Linux** : quand Yolo, Aphrody, Windows, WSL et les deux VPS sont prêts, recherche approfondie de la distribution libre la plus adaptée.
  - Critères : Rust, Bun ou agents ; noyau le plus récent (kernel.org) ; compatibilité avec Aphrody et Yolo.
  - On la forke pour exploiter son gestionnaire de paquets et combler l'écart entre winclean et la pile Linux (noyau, shell, OS, runtime, computer use, coreutils).

## 7. Build et installation

- **Builds lourds sur les hôtes SSH** :
  - paquets Bun sur `dbfr` ;
  - Rust et C++ sur l'usine de compilation (voir préalables) ;
  - aucune surcharge sur WSL.
- **WSL Ubuntu 24.04** : Aphrody complet, binaires, bibliothèques et dépendances installés.
- **Windows 11** : binaires, bibliothèques et dépendances installés via `aphrody-ops system-packages`.
  - Blocages (Build Tools 2026, etc.) : documentation Microsoft Learn via le MCP Aphrody, winclean au complet, PATH utilisateur et système, profil pwsh et WSL synchronisés.
  - Installer le plus de SDK, toolkits et CLI utiles, sans doublon et à jour, sur Windows comme sur les VPS de build.
  - Tests natifs MSVC avec `scripts/dev/windows-cargo.ps1`.
  - Tests Bun avec `scripts/dev/windows-bun-test.ps1`.
- Les binaires d'Aphrody et de Yolo peuvent être construits dans la même passe.

## 8. Famille IECODE sur Windows

- RG, NIE et IEVR vivent dans le monorepo IECODE (déplacement d'Aphrody du 2026-10-04).
  - Les dépendances `@aphrody/*` d'IECODE sont des archives épinglées par contenu (`aphrody-ops aphrody-packages`).
- RG, NIE, IEVR, Inagle et IECODE sont regroupés sous `C:\iecode`.
- Ils sont installés entièrement, avec les permissions d'administration de Windows 11.
- Les variables d'environnement sont reconfigurées pour le téléchargement et le chargement.
- Le VFS IEVR est chargé comme plugin Bun natif, via la bibliothèque partagée Yolo.

## 9. Ordre d'exécution et fin

1. Valider ce GOAL et celui de [Yolo](GOAL.md).
2. Effectuer un scan complet de `main`, sous-modules compris, sur du code entièrement commité.
3. Compiler et installer réellement les binaires et dépendances.
4. Mettre à jour ensuite seulement, une fois vérifiés : README, PLAN, AGENTS.md, docs, scripts, configuration MCP et plugins d'Aphrody et de Yolo.

Une étape n'est close qu'avec sa preuve (révision, commande, résultat) dans [MEMORY.md](MEMORY.md).

## 10. État vérifié (2026-10-04)

| Élément | Constat | Source |
| --- | --- | --- |
| CLI | `aphrody 1.0.0-canary` | `aphrody --version` |
| Domaines | crates : ai, compat, contracts, discord, google, infra, interop, koharu, native, os, shell, ui, web ; apps : cli, koharu, rg, shenron | `ls crates apps` |
| IA | passerelle compatible OpenAI (`aphrody-gateway`), `aphrody-llama-server`, client OAuth 2.1 MCP (`aphrody-mcp-oauth`) | `docs/ecosystem/ECOSYSTEM.md` |
| MCP | sous-système `workspace` (7 outils) servi par `aphrody-workspace-subsystem.service` | `docs/ecosystem/MCP-TOOLS.md` |
| Windows 11 | Visual Studio Build Tools 2026 (v18.10, MSVC 14.51), Windows SDK 10.0.26100, .NET SDK 10.0.401, PowerShell 7.6.6, module WinGet 1.29.380, Bun 1.4.2, uv, Rust 1.98.1 MSVC | `system-packages plan --host windows`, `vswhere`, `dotnet --list-sdks` |
| Tests MSVC natifs | `aphrody-winclean`, `-diagnostics`, `-a2a-coord`, `-a2a-pb`, `-wsl` : verts | `scripts/dev/windows-cargo.ps1` |
| WSL | Ubuntu 24.04, glibc 2.39, gcc 13.3, clang 18.1.3, cmake 3.28.3, ninja 1.11.1, MinGW gcc 13, zig 0.16.0, cargo-zigbuild 0.23.4, cargo-xwin 0.23.1, uv 0.12.22, TypeScript 7.0.2 | versions des outils |
| Hôtes | `vps` hôte de production, `dbfr` hôte secondaire, `wsl-ubuntu-24.04` hôte de build de référence | `yolo/config/host/inventory/targets.json` |

## 11. Écarts et préalables

- **Usine de compilation** : `vps` est runtime-only depuis le 2026-10-03.
  - Ni toolchains, ni `~/.bun`, ni `/srv/aphrody-build` ; `config/build-factory.json` le désigne pourtant encore.
  - Décision du 2026-10-04 : les deux VPS seront réprovisionnés comme usine ; d'ici là, pas de compilation Rust/C++ sur SSH.
- **Répartition des moteurs — arbitrage clos le 2026-10-05, migration ouverte** :
  Yolo possède les moteurs et leur compilation ; Aphrody possède les produits.
  - Constat du 2026-10-05 : `aphrody-command` dépend encore directement d'Obscura
    et `aphrody-web-bridge` active le rendu via `aphrody-web-service`.
  - `yolo runtime info --json` expose ABI 1.4, `system.stats`, `bench.compute`,
    `process.supervise`, `http.probe` ; aucune capacité browser/desktop installée.
  - Qualifier R3/R4, réconcilier les patches Obscura, livrer les artefacts et
    migrer les consommateurs avant de retirer les moteurs locaux. Préserver les
    implémentations concurrentes et les contrats produit pendant cette transition.
  - Mesurer séparément graphe de compilation, durée, taille et mémoire ; aucun
    gain ni migration complète n'est établi par ce seul arbitrage.
- **Authentification** : appareil de confiance, 2FA mobile par QR et jetons agent/code n'existent pas encore.
  - Seuls des clients OAuth existent.
- **IECODE sous Windows** : `C:\iecode` n'existe pas encore ; le checkout IECODE est dans le home WSL.
  - Tout déplacement exige une sauvegarde vérifiée par checksum ([AGENTS.md](AGENTS.md)).
- **Moteurs commutables** : aucun interrupteur V8/JSC/Tauri/WebGPU n'existe encore au build.
- **Build Tools 2026** : `vswhere` rapporte `isComplete=0` (installation 1603, réparation sans effet).
  - Le toolset MSVC fonctionne quand même.
- **MSYS2 et Cygwin** : absents (`C:\msys64`, `C:\cygwin64`) ; la directive vise des équivalents Rust natifs.
- **macOS** : aucune exécution réelle disponible ; seulement des compilations croisées.
