<!-- SPDX-License-Identifier: Apache-2.0 -->
# Plan du monorepo Aphrody — 2026-10-01

## Objectif et autorité

Shenron est le produit final. La qualification suit les fondations, leurs
adaptateurs, l’infrastructure, puis les consommateurs. Ce plan décrit l’état
observé et les travaux restant à exécuter ; une commande planifiée ne constitue
pas un résultat de validation.

Racines actives : `aphrody`, `aphrody-py`, `iecode` sous `/home/aphro`.
`~/src` est une archive legacy. Le checkout séparé `aphrody-ui` reste
sous la responsabilité de son agent. Les anciens plans importés sont des
preuves historiques : [ancien plan](docs/migration/PLAN-before-reorganization-2026-10-01.md)
(conserver la base racine pour ses anciens liens).

## État vérifié

- Inventaire des crates, packages et apps par domaine, exclusions du workspace et
  état du code : [STATE.md](docs/reference/workspace/STATE.md), généré par
  `bun run docs:gen` (vérifié par `bun run docs:check`). Aucun compte n'est tenu à la main.
- 27 déplacements de propriétaires puis 155 raccourcissements de chemins.
  Les identités publiques Cargo et les noms `@aphrody/*` sont conservés.
- CLI : `apps/cli` ; bindings : `crates/interop/ffi`,
  `packages/interop/native` ; Infra : `packages/infra/workspace`.
- Clients kernel : `crates/os/kernel-client`, `packages/os/kernel-client`.
  UI regroupée sous `packages/ui`. Adaptateur Python : `crates/ai/rag-python`.
- 45 dossiers générés supprimés, 525 971 639 842 octets de fichiers mesurés.
  Caches de développement supprimés : 10 336 726 022 octets supplémentaires.
  Les sources suivies et les exécutables installés ont été préservés.
- 81 copies de documentation de plugins renvoient à leur propriétaire canonique.
  Les autres groupes de doublons exacts sont inventoriés ; ils ne sont pas
  supprimés automatiquement lorsqu’ils portent des licences, des assets de
  consommateurs ou des sources tierces.
- Infra : 43 tests réussis, 1 test natif conditionnel ignoré. Contrôle Cargo des
  cinq composants déplacés réussi avant nettoyage ; métadonnées Cargo valides
  après raccourcissement. Aucun test produit complet n’est établi.
- Pipeline généré : 15 étapes, 222 commandes déclarées ; 69 packages manquent
  d’au moins un script de qualification. Le pipeline complet n’a pas été exécuté.

Preuves : [scan du dépôt](docs/migration/repository-state-2026-10-01.json),
[nettoyage](docs/migration/cleanup-2026-10-01.json),
[chemins courts](docs/migration/short-paths-2026-10-01.json),
[installation des exécutables](docs/migration/runtime-install-before-cleanup.json),
[pipeline](config/pipeline.json).
Les liens documentaires non résolus du scan restent des candidats à examiner :
routes de sites, exemples et snapshots historiques demandent une classification.

## Forks et packages — 2026-10-03

- [x] Aucun sous-module Git actif. Quatre packages AG-UI sans correctif runtime
  requis consomment npm ; la petite rustine Core préserve le contrat de
  réinitialisation des avertissements.
- [x] Extraire les forks AG-UI Client, MCP-UI et Material Web vers leurs dépôts
  privés `aphrody-labs/ag-ui-client`, `mcp-ui`, `material-web`, puis publier
  `@aphrody/ag-ui-client@1.0.1-aphrody.1`, `@aphrody/mcp-ui@7.1.1-aphrody.1`
  et `@aphrody/material-web@3.3.3` sur npm avec autorisation du propriétaire.
- [x] Consommer les forks publiés et Patreon 1.0.3 depuis npm ; retirer les
  copies du workspace. Sources intégrales conservées dans les sauvegardes
  privées et les dépôts autonomes. Codemods propres déplacés vers
  `packages/ui/m3-codemods` ; leurs cinq fixtures passent.
- [x] Installations des clones autonomes, builds et contrôles de types réussis ;
  132 tests consommateurs, puis 15/74/19 tests ciblés des clones réussis.
  API AG-UI : 80 exports conservés ; Patreon : 36 exports conservés.
  Les limites des suites upstream complètes et du plugin Sass natif sont
  consignées dans le rapport ; elles ne constituent pas une qualification produit.

- [x] Taffy : source modifiée extraite vers `aphrody-labs/taffy` privé, puis
  consommée via Cargo Git au commit exact. 379 tests du consommateur layout
  et 109 tests du clone autonome passent ; check/clippy Linux, puis check
  Windows MSVC et WASM réussis. Version 0.12.1 et features conservées.
  [Provenance Taffy](docs/migration/taffy-git-registry-2026-10-03.json).

Preuve et hashes : [migration des packages](docs/migration/package-registry-2026-10-03.json).

- [x] IECODE : retirer le sous-module Citro3D inutilisé, conserver son historique
  et vérifier workspace/licences/docs dans son dépôt canonique.
- [x] Python : extraire le SDK Antigravity modifié vers le dépôt privé
  `aphrody-labs/antigravity-sdk-python`. uv consomme son commit exact ;
  supprimer le chemin éditable vers le checkout Aphrody. Wheel validé et
  cinq tests du bridge consommateurs réussis. LangExtract reste sur PyPI.
  [Provenance SDK](docs/migration/python-sdk-registry-2026-10-03.json).

- [x] Audit final délégué : corriger les références opérationnelles Material Web
  et le manifeste Python imbriqué ; le gate Google installe le SDK depuis le
  lock uv. Auth npm globale vérifiée sur WSL, Windows et les deux VPS, sans
  secret dans les dépôts. Clones temporaires de validation retirés.

## Gestion documentaire unifiée — 2026-10-03

- [x] Auditer les Markdown suivis des trois racines : 5 711 documents,
  38 groupes identiques ; préserver les copies de distribution et notices.
- [x] Unifier les commandes documentaires sous `@aphrody/workspace docs`,
  avec politique privée, inventaire de provenance et index agents communs.
- [x] Générer les références déclarées depuis AST TypeScript/Python et
  commentaires Rust ; portée syntaxique annoncée, aucune qualification API
  complète ou runtime déduite de ces extraits.
- [x] Corriger la protection des fichiers modifiés et les vérifications de
  consolidation ; filtrer la traduction assistée et remonter ses échecs.
- [x] Préparer un export HTML/Markdown privé statique et déterministe, sans
  publication ; sources inchangées, copies exportées qualifiées par hashes.
- Contrôle global des liens : 5 757 liens cassés et 71 chemins obsolètes
  restent dans le corpus ; ce lot ne revendique pas un gate global vert.
- [ ] Adapter les références complètes TypeDoc/rustdoc/Sphinx si leurs
  consommateurs les nécessitent ; corriger le reste des liens du corpus.

Guide : [gestion documentaire](docs/guides/workspace/documentation.md).
Recherche : [pratiques documentaires](docs/research/workspace/documentation-practices.md).

## Plugins agents — 2026-10-03

- [x] À la demande du propriétaire, désinstaller les plugins Aphrody de Codex
  et agy ; Claude n'en avait plus d'installés. Retirer les marketplaces du
  dépôt, l'activation Codex locale et l'inscription MCP agy issue du plugin.
- [x] Déplacer les huit plugins propres vers `~/plugins`, avec les
  doublons, caches et inscriptions dans `_copies` et `_registrations`.
  Les 39 déplacements sont vérifiés par hashes dans le rapport local
  `~/plugins/relocation-2026-10-03.json`. Les autres plugins restent
  installés ; aucun plugin propre trouvé dans les profils Windows inspectés.
- Validation : contrôles Git et intégrité réussis. `bun run docs:check` reste
  en échec sur les catalogues ecosystem et documentation périmés ; aucune
  compilation Rust requise pour ce déplacement de fichiers de plugins.

## 0. Structure et hygiène

- [x] Séparer CLI, interop, clients OS et UI par propriétaires.
- [x] Retirer `aphrody-` des dossiers de crates et des packages Infra redondants.
- [x] Centraliser les commandes de scan, nettoyage et génération du pipeline
  dans `@aphrody/workspace` ; retirer l’exclusion globale `packages/**` d’Oxc.
- [x] Nettoyer les builds et caches ; sortir les exécutables et l’état du
  source-sync de `target` ; redémarrer les services avec les chemins actuels.
- [x] Purge et hygiène du monorepo Aphrody : purge de 2,65 Go d'artefacts de build et
  caches de développement via `workspace-clean --apply` ; suppression actée des dossiers
  redondants ; vérification du workspace (83 packages déclarés, 0 violation de layout,
  0 manifest orphelin) ; intégration des commits de consolidation.
- [x] Rose Griffon consolidé strictement sur **deux applications** : `apps/rg/website`
  (Next.js 16 frontend/web, build de production Turbopack validé à 100%) et `apps/rg/bot`
  (démon unifié backend : API ElysiaJS :8800 avec 153 routes, WebSockets natifs, moteur
  Colyseus Ranked, services in-process CDN/Realtime/Storage, et bot Discord multi-profils).
  Suppression complète des dossiers redondants (`cdn`, `realtime`, `storage`, `api`,
  `achillea-bot`, `azalee`).
- [x] Usine Inazuma IECODE : intégration complète des packages (`azalee`, `inagle`,
  `inagle-cross`), contrats binaires niveau 5 (`nie-bridge`), pipeline de crawlers Zukan,
  spécifications de formats et documentation (`docs/nie/`), et jeux de données de
  référence (`param_en.json`, `zukan-audit.json`). Workspace `iecode` synchronisé et
  validé (203 Rust, 6 Bun, compilation WASM `wasm32-unknown-unknown` à 0 erreur, 275 tests
  unitaires passants, 291 fichiers docs vérifiés).
- [x] Découplage complet de `patreon-bun` : repo autonome GitHub `rose-griffon/patreon-bun`
  désarchivé, mis à jour et poussé sur `main` (174 tests passants, build Bun natif).
  Audit NPM complété (version 1.0.3 publiée).
- [x] Qualifier chaque groupe de doublons restant : propriétaire, consommateurs,
  licence, nécessité de copie au packaging. Supprimer uniquement après mise à
  jour des consommateurs et vérification du packaging.
  Recensement 2026-10-03 (blobs git identiques) : 429 groupes — 271 assets
  (22,5 Mo), 51 fixtures, 38 code, 22 docs, 13 licences, 23 autres, 9 configs
  conventionnelles, 2 vides. 13 copies `scripts/` sans consommateur, doublons
  de leur paquet propriétaire, supprimées (liste dans
  [SCRIPTS-INVENTORY.md](docs/reference/workspace/SCRIPTS-INVENTORY.md)) ;
  `crates/ui/app/ui-dist/fonts` : 226 copies identiques à leurs sources
  canoniques (`packages/ui/assets`, `packages/ui/m3-fonts`, `crates/ui/bun`),
  déjà ignorées par `.gitignore` et recopiées par `build.rs` depuis
  `ui-dist.manifest` avant l’embarquement Tauri : retirées de l’index (≈ 20 Mo),
  fichiers conservés sur disque. Chaque groupe restant est qualifié dans
  [DUPLICATES-QUALIFICATION.md](docs/reference/workspace/DUPLICATES-QUALIFICATION.md) :
  conservés par rôle (URL publiques, bundles, licences, gabarits, sorties de
  build), ou copies documentaires UI/OS/Web à consolider par `docs-consolidate`.
  UI : consolidation exacte effectuée le 2026-10-03 (32 copies supprimées avec
  alias, 7 fichiers de liens réécrits, vérification sans constat) ; 13 copies
  divergentes restent à fusionner manuellement. Index d'import régénéré ; son
  gate global échoue encore sur 5 729 destinations absentes de la carte source.
  Les autres groupes UI résiduels sont conservés selon leur rôle/provenance.
- [x] Classer les documents historiques et corriger les liens réellement cassés
  dans la documentation active. Ne pas réécrire les preuves de migration.
  Clos 2026-10-03 : 4542 documents = 888 actifs vérifiés (liens et chemins) +
  3654 copies amont ignorées par règle ; historiques = preuves `docs/migration`
  et entrées datées de ce plan, seul document encore exempté du contrôle des
  chemins (raison consignée dans `config/docs/doc-path-check-deferred.json`) ;
  `docs/apis/infra/vps/APIS.md` réaligné sur les chemins du monorepo.
  `docs:check-links` : 0 lien cassé, 0 chemin mort.
- [x] Classer les scripts importés par commande utilisée, propriétaire et
  références entrantes ; supprimer ceux devenus inutilisés après preuve.
  Inventaire 2026-10-03 : [SCRIPTS-INVENTORY.md](docs/reference/workspace/SCRIPTS-INVENTORY.md),
  456 scripts, 175 sans référence entrante (dont 21 tests), dont 31 aux imports
  relatifs cassés ; sur tous les `.ts`, 55 scripts réparés (imports résolus par
  `bun build`), 17 restent cassés (sources bxc absentes, wasm généré, kit discord
  amont) dont 10 orphelins sans référence supprimés ; 5 tests Shenron exigent
  un workspace (`@shenron/*`, `postgres`) : décision propriétaire.
  Clos 2026-10-03 : tous les scripts `.ts` résolvent leurs imports ou ont été
  supprimés (10 orphelins, puis 7 cassés cités seulement par la doc) ; 13
  doublons de paquets supprimés ; les ~98 non référencés qui résolvent restent
  des outils manuels classés par catégorie dans SCRIPTS-INVENTORY.md.
- [x] Réduire les préfixes de fichiers qui ne décrivent aucun rôle, en conservant
  les conventions imposées (`Cargo.toml`, `package.json`, `index.ts`).
  Revue 2026-10-03 : les dossiers sont déjà sans `aphrody-` ; restent 19 fichiers
  `aphrody-*`/`aphrody_*` : binaires `src/bin` et `bin/` (noms de CLI publics, à
  préserver), pont Shenron → Aphrody (`aphrody-corpus`, `aphrody-web-scrape`,
  `aphrody-ocr-candidate`) et ajouts du fork material-web distingués de l’amont —
  préfixes porteurs de rôle. Les `_` marquent les helpers partagés des
  `scripts/` et les fichiers privés Next.js (`app/`). Aucun renommage requis.

Critères : installation Bun figée, métadonnées Cargo, layout, liens documentaires
actifs, aucun import vers une ancienne implantation déplacée.

### Liens actifs et docs générées — 2026-10-03

- `bun run docs:gen` a régénéré `docs/README.md` et `docs/ecosystem/*` (périmés) ;
  `bun run docs:check` : 0 échec.
- `bun run docs:check-links` : 885 documents actifs, 7715 liens locaux et 3258
  chemins `code` vérifiés, 0 cassé après correction du chemin
  `packages/os/drive-client/tests/integration` dans la qualification Drive.
- Reste ouvert : classement des documents historiques (non vérifiés par ce gate).

### Validation partielle des liens — 2026-10-01

- Contrôle exécuté : `bun packages/infra/workspace/src/docs-links.ts --scope repository --json`.
- 5 956 documents inventoriés, 8 904 liens locaux examinés ; 1 962 destinations
  non résolues avant correction. Les exclusions du vérificateur (notamment
  `docs/reference/`) ne sont pas couvertes par ces résultats.
- 19 occurrences corrigées dans l’audit d’architecture OS et son étude de
  recherche : chemins des propriétaires kernel, kernel-client, WinClean, jobs,
  events et backend, manifest racine et vue d’architecture. Les cibles existent.
- INCOMPLET : 1 943 liens non résolus restent à classer et traiter. Ce total
  contient des routes de sites importées et des chemins historiques ; il ne
  représente pas un nombre établi de défauts de documentation active.
- Les constats datés de l’audit OS ne sont pas requalifiés par une réparation
  de liens. Les preuves de migration restent intactes.

### Architecture du workspace — 2026-10-01

- FAIT : la [page canonique](docs/architecture/workspace/ARCHITECTURE.md)
  décrit les racines actives, les workspaces racine, les propriétaires actuels,
  les frontières à qualifier et Shenron comme gate produit final.
- L’ancienne page est préservée octet pour octet dans
  [le snapshot](docs/migration/workspace-architecture-before-monorepo-2026-10-01.md).
  Ses liens relatifs gardent pour base historique `docs/architecture/workspace/` ;
  ce snapshot n’est pas une documentation active à réparer.
- Vérification : aucune destination non résolue dans la page canonique selon
  `docs-links --scope repository --json` ; `git diff --check` réussi.
- INCOMPLET : le classement documentaire global reste ouvert. Le contrôle
  compte maintenant 5 957 documents, 8 920 liens et 1 972 destinations non
  résolues, car il inclut aussi le nouveau snapshot historique sans restaurer
  sa base d’origine. Cette augmentation ne signale pas une régression des
  liens actifs ; le vérificateur doit distinguer ces preuves des pages actives.

### Périmètre explicite du contrôle documentaire — 2026-10-01

- FAIT : `docs-links` accepte `--exclude-file <chemin relatif racine>` répété,
  uniquement pour des documents inventoriés. Un chemin absent, un dossier ou
  une exclusion hors inventaire provoque une erreur ; les exclusions apparaissent
  dans le rapport JSON et texte.
- `docs:check-links` exclut explicitement le seul snapshot d’architecture du
  workspace ajouté ci-dessus. Le contrôle sans option continue à le vérifier ;
  aucune exclusion globale de `docs/migration` n’est introduite.
- Résultat avec cette exclusion : 5 957 documents inventoriés, 8 882 liens
  examinés, 1 933 destinations non résolues. INCOMPLET : le contrôle reste rouge
  et le classement des autres preuves, routes importées et liens actifs est ouvert.
- Gates : 44 tests Infra réussis, 1 test natif conditionnel ignoré ; typecheck
  du package réussi ; format des deux fichiers TypeScript modifiés et
  `git diff --check` réussis. Oxc ne signale pas d’erreur, mais conserve
  quatre avertissements `no-await-in-loop` dans des boucles préexistantes.
- Les tests prouvent qu’une exclusion historique ne masque pas les échecs actifs,
  que le contrôle complet garde le snapshot et que les chemins invalides sont rejetés.

### Inventaire de revue documentaire — 2026-10-01

- FAIT : trois destinations de runbooks Infra corrigées vers les fichiers
  existants `config/shell-runtime.json` et
  `config/infra/inventory/aphrody-discord-dev-2026-09-29.md`. Le contrôle ne relève plus
  de destination manquante dans `docs/operations/infra/`.
- [Rapport de revue](docs/migration/document-links-review-2026-10-01.json) :
  1 930 destinations non résolues réparties sur 501 documents ; chaque
  destination et chaque action de revue sont conservées dans l’inventaire.
- Répartition : 599 références de documentation Bun importée, 414 références
  du README d’exemples Bevy importé, 270 références dans les preuves de migration,
  647 références encore non classées. Ces rôles ne prouvent ni validité ni
  nécessité d’exclusion ; les routes restent des candidates à vérifier.
- INCOMPLET : vérifier les bases de résolution et les mappings d’import avant
  de traiter les groupes tiers/historiques ; examiner autorité, propriétaire,
  date et consommateurs des 647 autres références. Aucune exclusion ajoutée.
- Vérification : contrôle exécuté avec le snapshot d’architecture explicitement
  exclu (code 1, défauts restants), somme des groupes égale au total, cibles des
  trois corrections présentes et `git diff --check` réussi. Pas de changement
  de code ; les tests Infra ne sont pas réexécutés pour ce lot documentaire.

### Amont, forks et bumps structurés — 2026-10-02

- FAIT : `.cache/upstream` ne garde que les quatre checkouts nécessaires au build (`mcp-server-tauri`, `simdutf-rio`,
  `tauri-plugin-dialog`, `serde-saphyr`) : 23 Go avant, 11 Mo après. Les 17 autres amonts sont des entrées `reference`
  de `config/upstream-sources.json`, lues en direct : `aphrody git upstream list|info|tree|read|search`, outils MCP
  `upstream_*`, skill `upstreams`, `aphrody-update upstream`. Vue générée : `docs/reference/infra/UPSTREAMS.md`.
- FAIT : sorties de build WSL déplacées vers `~/.local/share/aphrody/wsl-artifacts` (empreinte du `bzImage` vérifiée) ;
  audits WSL vers `docs/research/os/wsl-audits`.
- FAIT : bumps structurés par écosystème avec docs, holds et rollback : `aphrody-update rust|bun|uv`
  (`docs/operations/infra/update/{RUST,BUN,UV}.md`). Fork Bun fusionné avec l'amont `faac63e6` (8/8 `bun:aphrody`).
- OUVERT (décision du propriétaire) : 28 dépôts `aphrody-code` non référencés (`docs/research/infra/github-mirrors-audit-2026-10-02.md`) ;
  archivage ou suppression non effectués. Fork Oxc : l'amont a avancé, fusion couplée au bump Cargo.

### Dépendances via registres et Git direct — 2026-10-03

- Préférence propriétaire : Cargo/crates.io, Bun/npm et uv/PyPI ; Git épinglé
  lorsqu'une version publiée ne couvre pas le besoin ; aucun clone pour installer
  une dépendance ou lire une référence.
- Le bridge MCP utilise maintenant l'archive crates.io `tauri-plugin-mcp-bridge`
  0.13.0 avec les patches Tauri 3 et de sécurité existants. Les fichiers Rust/JS,
  `build.rs`, manifeste patché et licence sont identiques au package auparavant
  consommé dans le clone. Contrôle du consommateur Linux réussi, lock Cargo inchangé.
- Les quatre sources restaurées automatiquement sont des archives crates.io
  patchées : zéro clone Git requis par `sources:sync`. L'ancien clone est conservé
  dans un backup privé hors de `.cache/upstream` jusqu'aux gates depuis un clone propre.
- Python : retrait de l'override Git `langextract` dans la configuration imbriquée ;
  lock uv racine PyPI vérifié. Le SDK Antigravity local reste une exception explicite,
  car les extensions `voice` consommées ne figurent pas dans la roue publiée.
- Preuves et empreintes : [rapport](docs/migration/registry-preference-2026-10-03.json).
  Pas de revendication de parité Windows/macOS, de validation runtime ou de
  remplacement automatique des paquets tiers modifiés.

## 1. Contrats, cœur et compatibilité

Propriétaires : `crates/contracts`, `crates/native`, `crates/compat`,
`packages/bun`, `packages/compat`.

- [~] Auditer le graphe Cargo/Bun et les dépendances croisées par domaine.
  Cargo et Bun faits (voir « Audit Cargo par domaine ») ; dev/features ouverts.
- [ ] Conserver les contrats purs ; déplacer réseau, timeout et processus vers
  leurs propriétaires opérationnels. Le client kernel est déjà sous OS.
- [x] Distinguer moteur N2B Rust et façade CLI Bun ; le dossier Bun devient
  `n2b-client`, son nom public reste compatible jusqu’à une migration versionnée.
- [ ] Reprendre les critères ouverts des anciens plans contrats/native/compat.

Critères : check/clippy/test des propriétaires concernés ; contrats JSON-RPC,
ABI, erreurs et annulation vérifiés par des cas qui traversent les frontières.

### Client Bun N2B — 2026-10-01

- FAIT : le dossier `packages/compat/n2b-client` existe déjà ; le nom public
  `@aphrody/n2b-core` et les exports restent compatibles. La façade invoque
  le moteur Rust par processus et ne contient pas ses calculs de scan.
- Le repli de développement a été corrigé : il cherche désormais
  `target/debug/n2b` à la racine, au lieu de `packages/target/debug/n2b`.
  Installation PATH, override explicite et `N2B_BIN` gardent leur priorité.
- Un test isolé recrée le layout imbriqué, vide PATH et `N2B_BIN`, et prouve
  l’exécution du binaire de fixture placé au bon endroit. Le test shims de
  chemin utilise maintenant le dossier et le fichier source actuels.
- Gates : 15 tests réussis, Oxc sans avertissement sur les fichiers modifiés,
  build TypeScript des références puis typecheck client réussis,
  `git diff --check` réussi. Les tests CLI existants utilisent le binaire
  installé ; aucun rebuild du moteur Rust, test Windows ou contrôle ABI
  n’est établi par ce lot. La qualification générale Compat reste ouverte.

### Qualification N2B Linux — 2026-10-01

- FAIT : [rapport et logs](docs/migration/n2b-qualification-2026-10-01/report.json)
  conservés pour `aphrody-n2b`, `aphrody-n2b-core` et le client Bun.
- Build verrouillé réussi ; 49 tests Rust et 15 tests Bun réussis. Le client
  utilise explicitement le binaire issu du checkout actuel, dont le SHA-256
  est enregistré. Check et clippy `--all-targets --locked` avec refus des
  avertissements réussis pour ces deux packages Rust.
- INCOMPLET : features optionnelles, Windows/WASM, FFI N2B, ABI interop,
  plugin et packaging release restent à qualifier. Cette preuve Linux avec
  features par défaut ne clôt pas la qualification générale Compat.

### Résolution du plugin et helpers natifs N2B — 2026-10-01

- FAIT : le plugin Bun ne force plus `n2b` lors du contrôle de disponibilité.
  Il utilise désormais le même résolveur que le scan : override explicite,
  `N2B_BIN`, PATH puis repli workspace. Son script `test` exécute un vrai test.
- Test de régression : PATH vide, binaire de fixture dans `N2B_BIN`, build Bun
  réel et marqueur prouvant que le scan a été lancé (un plugin désactivé ne
  crée pas ce marqueur). Un test réussi ; build TypeScript des références,
  typecheck et Oxc sans avertissement réussis ; `git diff --check` réussi.
- Helpers `aphrody-n2b-native` : trois tests Rust et clippy all-targets verrouillé
  avec refus des avertissements réussis. La crate produit un `rlib`, consommé
  par l’interop ; ce contrôle ne prouve pas un `dlopen` Bun ou l’ABI agrégée.
- INCOMPLET : tests avec le module `bun:aphrody`, artefact interop qualifié,
  ABI réelle, Windows et packaging restent ouverts.

### Graphe direct des dépendances — 2026-10-01

- FAIT : [inventaire des arêtes déclarées](docs/migration/dependency-graph-review-2026-10-01.json)
  produit depuis les métadonnées Cargo verrouillées et les manifests des membres
  Bun actuels : 186 membres Cargo, 84 membres Bun ; 468 arêtes Cargo locales
  et 145 arêtes Bun locales, dont 142 et 68 traversent un domaine.
- Layout réussi ; aucun `workspace:` Bun sans membre déclaré ; aucune arête
  Cargo locale des contrats vers un autre domaine. Ce dernier résultat ne
  prouve pas la pureté des sources ni des dépendances externes.
- INCOMPLET : revue sémantique des dépendances croisées, pureté des contrats,
  résolution transitive et qualification des features/targets restent ouvertes.
- La FFI dépend toujours de `apps/cli` : deux appels directs à
  `locate_home_shenron` et `run_async`, avec neuf features transférées au CLI.
  L’extraction doit conserver dispatch, ABI et ces features ; supprimer seulement
  la dépendance casserait la surface exportée actuelle.
- Gates de ce lot : `cargo metadata --locked --no-deps --format-version 1`,
  `bun run monorepo:layout`, vérification des membres Bun et `git diff --check`
  réussis. Aucun build, test runtime ou contrôle ABI n’est établi par cet audit.

### A2A opérationnel sous OS — 2026-10-01

- FAIT : `a2a-client`, `a2a-server`, `a2a-grpc` et `a2a-coord` déplacés de
  `crates/contracts` vers `crates/os`. Noms publics, versions, features,
  licences et APIs conservés ; manifests racine et pipeline régénéré alignés.
- [Preuve source-vers-cible et logs](docs/migration/a2a-os-move-2026-10-01/report.json) :
  62 fichiers avec empreintes avant/après ; sept fichiers ajustés pour clippy
  (conditions simplifiées, assertion de chaîne vide, méthode privée renommée).
- Gates Linux features par défaut : 293 tests réussis après corrections,
  métadonnées Cargo verrouillées, check all-targets et clippy all-targets
  avec refus des avertissements réussis ; `git diff --check` réussi.
- INCOMPLET : consommateurs depuis clone propre, Windows, features optionnelles,
  pureté des autres contrats et broadcast du subsystem restent à qualifier.
  L’item global de séparation contrats/opérations reste ouvert.

### Gates Contrats Linux — 2026-10-01

- FAIT : tests de `aphrody-a2a`, `aphrody-a2a-pb`, `aphrody-agent-proto` et
  `aphrody-subsystem` réussis (172 tests, doc-tests inclus), ainsi que quatre
  tests unitaires `aphrody-app-protocol`. Clippy all-targets verrouillé avec
  refus des avertissements réussi sur ces cinq packages.
- [Logs](docs/migration/contracts-qualification-2026-10-01/contracts-tests.log)
  conservés avec le résultat clippy et les échecs upstream.
- INCOMPLET : les deux tests `upstream_fixtures_test` d’app-protocol échouent
  parce que `tests/fixtures/upstream/FIXTURES_REV` et les schémas sont absents.
  Aucun de ces tests n’est ignoré ou remplacé par des fixtures synthétiques.
  Leurs chemins sont désormais ancrés à `CARGO_MANIFEST_DIR`.
- L’ancien checkout Contrats inspecté ne contient pas non plus ces fixtures.
  Restaurer les schémas et leur provenance upstream vérifiée (révision attendue
  `78245b4…`) reste nécessaire avant qualification complète du protocole.
  Les consommateurs depuis clone propre et les autres plateformes restent ouverts.

### Fixtures app-protocol restaurées — 2026-10-01

- FAIT : 13 schémas JSON upstream et `FIXTURES_REV` restaurés depuis les blobs
  Git du commit source `96d1453…`, avant suppression par le nettoyage historique.
  [Rapport de provenance](docs/migration/app-protocol-fixtures-restored-2026-10-01.json)
  avec commit complet, chemins source/cible et SHA-256 de chaque fichier.
- Aucun schéma régénéré. Attribution upstream documentée ; le test vérifie
  maintenant la révision complète `78245b47af2a7aafcabe025828ceecca69db4df1`.
- Les 17 tests d’app-protocol, dont les deux tests upstream précédemment rouges,
  réussissent ; clippy all-targets verrouillé avec refus des avertissements et
  `git diff --check` réussis. Logs de reprise conservés dans le dossier de
  qualification Contrats.
- INCOMPLET : ces fixtures historiques ne prouvent pas la compatibilité avec
  le protocole upstream actuel, le runtime assemblé ou les autres plateformes.
  La qualification complète des contrats et consommateurs reste ouverte.

### Contrats et consommateurs A2A depuis clone propre — 2026-10-01

- FAIT : [rapport et logs](docs/migration/contracts-clean-clone-2026-10-01/report.json)
  depuis un clone du commit `92c44198`, propre avant et après les gates.
  Métadonnées : 186 membres, aucun chemin de dépendance locale hors du clone.
- Neuf packages : cinq propriétaires Contrats et les quatre consommateurs
  opérationnels A2A déplacés sous OS. 482 tests réussis, check all-targets et
  clippy all-targets verrouillés avec refus des avertissements réussis.
- Sources isolées, artefacts de compilation et cache Cargo partagés : cette
  preuve vérifie le clone propre, pas une compilation sans cache.
- INCOMPLET : kernel, CLI, interop et produits consommateurs ne sont pas
  qualifiés par ces gates ; Windows, features optionnelles et runtime assemblé
  restent ouverts. Aucun ancien checkout n’est supprimé.

## 2. Interop et CLI

Propriétaires : `crates/interop/ffi`, `packages/interop/native`, `apps/cli`.

- [x] Extraire les capacités partagées encore prises dans le CLI ; la FFI ne
  doit pas dépendre de l’application pour obtenir la logique de bibliothèque.
  Fait par Codex (498ef3b3d, docs e89e094fa) : bibliothèque `aphrody-command`
  (52 sources déplacées, façade `apps/cli` conservée) ; la FFI n’en dépend plus
  de l’application. 247 tests Rust, 15 Bun natifs ; check/clippy Linux
  all-targets et WASM verts ; catalogue 63 CLI / 1280 commandes conservé.
- [x] Unifier découverte, chargement et durée de vie de la bibliothèque native.
  `packages/interop/native/src/library.ts` est l'unique résolveur/chargeur,
  garde une poignée partagée et protège fermeture/rechargement ; tests du
  package natif et de l'adaptateur Shenron ci-dessous.
- [~] Faire consommer ce chargeur par Shenron ; retirer les chemins legacy du
  pipeline après vérification Linux/Windows et mode développement. Le pipeline
  délègue à `@aphrody/bun/shenron` ; release Linux x86_64 testée avec mode dev
  activé et désactivé. Windows reste à qualifier ; les alias d'environnement
  legacy sont conservés comme compatibilité.
- [~] Définir installation/version/ABI des artefacts ; aucun lancement ne doit
  déclencher une compilation implicite dans un daemon de production. Le
  manifeste cible/triple/libc, version package/crate, hash et ABI est défini ;
  l'installation isolée Linux et le smoke `APHRODY_FFI_DEV=0` passent. La
  distribution durable et les autres plateformes restent ouvertes.

Critères : tests FFI réels avec artefact qualifié, erreurs sans artefact,
compatibilité symboles/types, installation utilisable sans dossier `target`.

## 3. OS, shell et infrastructure

Propriétaires : `crates/os`, `crates/shell`, `crates/infra`,
`packages/os`, `packages/infra/workspace`.

- [x] Remplacer les références actives aux checkouts legacy dans les catalogues,
  outils kernel et configurations ; distinguer les outils de migration qui
  doivent encore savoir lire ces archives. Vérifié 2026-10-03 : aucun chemin
  `~/src` ni checkout séparé dans `config`, `crates/{os,shell,infra}`,
  `packages/{os,infra}` ; seules racines actives (`aphrody`, `aphrody-py`,
  `source`) ; mention `~/vps` restante = historique `config/rg/CHANGELOG.md`.
- [ ] Unifier catalogue, chemins de runtime, commandes et configuration de
  services ; un seul propriétaire par fonction Infra.
- [ ] Remplacer les anciennes hypothèses de dépôts séparés dans fleet/bridges/
  layering par le graphe du monorepo ; vérifier le catalogue régénéré.
- [ ] Compléter les scripts de qualification manquants sans scripts factices.
- [ ] Exécuter les étapes du pipeline par propriétaire, enregistrer code de
  sortie/log et couverture ; ne pas déclarer sain un package non testé.

Critères : `bun test packages/infra/workspace/test`, typecheck et Oxc réellement
appliqués aux fichiers ; services actifs, état hors target, source-sync borné
aux trois racines actives. WSL : disques, processus, shell et chemins revérifiés.

### Kernel : découverte Infra active et gates — 2026-10-01

- FAIT : la découverte automatique Infra du kernel ne sélectionne plus les
  checkouts séparés ni `src/` ; elle exige le manifest racine et le propriétaire
  actuel `crates/infra/ssh`. Les overrides explicites restent disponibles.
- Tests : un clone relocalisé reste découvrable depuis cwd/exécutable ; une
  archive legacy est rejetée ; le repli home exige le layout actuel.
- [Logs de qualification](docs/migration/kernel-qualification-2026-10-01/test.log) :
  79 tests réussis, un test GCS live ignoré faute de credentials/bucket de test.
  Check all-targets et clippy all-targets verrouillés avec refus des lint warnings
  réussis. Cargo conserve un avertissement de compatibilité future pour la
  dépendance tierce `proc-macro-error2 2.0.1`. Format du fichier et diff-check réussis.
- INCOMPLET : autres références legacy des outils/configurations, test GCS,
  services installés, Windows et qualification kernel depuis clone propre restent
  ouverts. Les services actifs ne sont pas redémarrés par ce lot de source.

### Kernel depuis clone propre — 2026-10-01

- FAIT : [rapport et logs](docs/migration/kernel-clean-clone-2026-10-01/report.json)
  depuis le clone propre du commit `c8bd44d7`, avec features par défaut/builtins.
  79 tests réussis ; check et clippy all-targets verrouillés réussis. Sources
  du clone utilisées, artefacts de compilation et registre Cargo partagés.
- Un test GCS live reste ignoré ; Cargo conserve le rapport de compatibilité
  future de `proc-macro-error2 2.0.1`. Le clone reste propre après les gates.
- INCOMPLET : services installés, Windows, GCS, catalogues/fleet/bridges et
  autres consommateurs restent à qualifier. Cette reprise clôt la limite
  « kernel depuis clone propre » du lot précédent, pas le gate OS/Infra global.

### Bridge Bun limité au monorepo actif — 2026-10-01

- FAIT : la découverte des workspaces Bun par Infra utilise uniquement la
  racine fournie (par défaut `<repo>`). Elle ne parcourt plus les
  checkouts frères, les remotes Git ou le catalogue historique pour ajouter
  des racines. La forme publique du catalogue est conservée.
- Le test crée une racine relocalisée et des frères legacy/UI : seule la racine
  fournie est retournée. Le contrôle réel retourne uniquement `aphrody`.
- Gates : 45 tests Infra réussis, un test natif conditionnel ignoré ; typecheck,
  format et diff-check réussis. Oxc sans erreur, trois avertissements préexistants
  (`no-map-spread`, `no-array-sort`, `no-await-in-loop`) restent dans le fichier.
- INCOMPLET : catalogue des binaires, fleet/layering, installation figée et
  qualification complète des bridges restent ouverts. Aucun checkout UI inspecté
  par la nouvelle découverte et aucun service modifié.

### Catalogue des binaires borné à la racine — 2026-10-01

- FAIT : discovery conserve la priorité des exécutables installés puis recherche
  uniquement les `target/release` et `target/debug` de la racine fournie.
  Les builds des anciens checkouts frères ne sont plus ajoutés au bridge.
- Les noms `.exe` sont normalisés pour la comparaison au catalogue ; les
  installations locales Windows utilisent le suffixe exécutable adapté.
- Test de layout isolé : builds frères legacy/UI rejetés, priorité release sur
  debug vérifiée, noms `.exe` catalogués et artefacts `.pdb`/hors domaine ignorés.
- Gates : 46 tests Infra réussis, un test natif conditionnel ignoré ; typecheck,
  format et diff-check réussis. Oxc sans erreur, trois avertissements préexistants
  dans le fichier (`no-await-in-loop` deux fois, `no-array-sort`).
- INCOMPLET : le test reconnaît des chemins `.exe`, sans exécuter Windows.
  Installation, provenance/version des binaires, ABI interop, fleet/layering et
  consommateurs assemblés restent ouverts. Les binaires installés restent prioritaires.

### Lancement Infra sans compilation implicite — 2026-10-01

- FAIT : le bridge Bun Infra cherche par défaut un exécutable installé sous
  `.local/bin` ou PATH ; il ne dépend plus de `target` et ne revient plus à
  `cargo run` lorsque le binaire manque. Un override `APHRODY_INFRA_BIN`
  invalide produit une erreur explicite, sans sélection silencieuse d’un autre binaire.
- Développement : `APHRODY_INFRA_BUILD_FROM_SOURCE=1` active explicitement
  `cargo run --quiet --locked --bin aphrody-infra --`. Un override binaire
  explicite garde priorité. `APHRODY_INFRA_USE_INSTALLED=1` n’est plus nécessaire
  puisque l’installation est le comportement par défaut.
- Tests : présence/absence d’installation, override invalide, opt-in source et
  priorité de l’override vérifiés. 47 tests Infra réussis, un natif conditionnel
  ignoré ; typecheck, format et diff-check réussis. Oxc sans erreur, un
  avertissement `no-await-in-loop` préexistant dans le résolveur.
- INCOMPLET : qualification de l’exécutable installé, versions/ABI, autres
  launchers et services de production restent ouverts. Les launchers de
  développement comptant sur une compilation automatique doivent définir
  l’opt-in explicite avant leur prochaine invocation.

### Launcher SSH kernel sans build implicite — 2026-10-01

- FAIT : les outils Infra du kernel exigent `APHRODY_INFRA_BUILD_FROM_SOURCE=1`
  pour consulter les builds workspace ou invoquer Cargo. Sans cet opt-in,
  ils utilisent `aphrody-ssh` installé sur PATH ou à côté du kernel, puis
  échouent clairement si aucun exécutable installé n’est disponible.
- Le build de développement utilise `--locked`. Le test prouve qu’un manifest
  seul ne déclenche pas un build sans opt-in et que le mode explicite conserve
  la sélection du manifest et le verrouillage Cargo.
- [Logs](docs/migration/kernel-source-optin-2026-10-01/test.log) : 80 tests
  réussis, un GCS live ignoré ; check et clippy all-targets verrouillés réussis,
  format et diff-check réussis. L’avertissement Cargo de compatibilité future
  `proc-macro-error2 2.0.1` reste présent.
- INCOMPLET : services installés et autres launchers restent à qualifier ;
  aucun redémarrage ou déploiement du kernel n’est effectué dans ce lot.

## 4. UI et bibliothèques navigateur

Propriétaire : `packages/ui`, `crates/ui`.

- [x] Retirer du point d’entrée de M3 Design tout serveur ou `process.exit()` à
  l’import ; placer démarrage/configuration dans une application.
- [x] Séparer la génération SVG native et les composants React navigateur ;
  aucun binding Bun natif dans le chemin d’un composant `use client`.
  Vérifié 2026-10-03 : 828 fichiers `"use client"` du dépôt (hors `upstream/`)
  bundlés (809 en cible bun) ; seul `m3-icons/src/react.tsx` atteignait
  `bun:ffi` : directive retirée (composant serveur, export `<repo>` server-only ;
  client = `./browser`), tests 13/13, typecheck vert. Constat hors UI : en
  cible navigateur, 77 composants client RG et 17 Shenron tirent des builtins
  Node (`util/types`, `child_process`, `tls`, `node:crypto`) : à qualifier par
  leurs propriétaires (sections 6 et 7).
- [x] Clarifier `render-tools` face au moteur `render`, avec identités publiques
  maintenues puis migration explicite si un renommage API est nécessaire.
  Décision 2026-10-03 : `crates/ui/render-tools` (`aphrody-render3d`) est retiré
  du dépôt, sans consommateur Cargo ni Bun ; `aphrody-render` (`crates/ui/render`)
  est le propriétaire unique du rendu. READMEs render, M3-RENDER et description
  softraster alignés ; le catalogue régénéré ne référence plus de chemin mort.
- [x] Requalifier tokens, composants, SSR/hydratation et exports navigateur.
  Requalification 2026-10-03 : `bun test` des 24 paquets `packages/ui` avec
  tests — tous verts (m3-icons, m3-theme, m3, material-web exigent
  `APHRODY_FFI_DEV=1` ou le paquet natif installé, sinon « native library not
  found ») ; `bun run typecheck` vert sur 23 paquets. Gate navigateur
  `scripts/audit/ui-browser-bundles.ts` (imports `?url` désormais résolus comme
  chez Vite/Next, asset absent = échec) : 70 ok, 13 server-only, 1 échec réel —
  `app-ui` via `react-selecto@1.26.3`, qui importe `@daybrush/utils` et
  `framework-utils` sans les déclarer (dépendances fantômes refusées par le
  linker isolé), corrigé par `publicHoistPattern` ciblé dans `bunfig.toml`
  (`hoist = false` conservé, `bun install --frozen-lockfile` sans changement) :
  gate 71 ok, 0 échec. SSR/hydratation : 22 fichiers de tests SSR et 3
  d'hydratation dans les suites vertes.

Critères : import sans effets, build navigateur sans Bun FFI, typecheck,
tests de composants et rendu. Les échecs historiques Gemini sont à reproduire.

### M3 Design sans effet à l'import ni FFI — 2026-10-01

- FAIT : `@aphrody/m3-design` n'exporte plus `server.ts`. Les handlers HTTP et le
  runner CLI vivent dans `src/handlers.ts` (aucun serveur, aucun `process.exit`
  à l'import) ; `server.ts` reste l'entrypoint applicatif.
- HCT passe à `@material/material-color-utilities` (catalogue racine, JS pur) ;
  le cœur n'importe plus `@aphrody/bun`. Le validateur de spec M3 est injecté
  (`new DesignCompiler({ validateSpec })`) ; seul `src/native.ts`, utilisé par
  `server.ts`, charge le binding natif. Sans validateur, la critique indique
  que la vérification est ignorée.
- Gates : typecheck réussi ; 23 tests réussis (15 échouaient avant, faute de
  lib FFI) ; import de `handlers.ts` vérifié sans effet ; serveur démarré et
  interrogé.
- INCOMPLET : parité du HCT JS contre l'implémentation native non mesurée au-delà
  des tests existants ; `generator.ts` importe encore `node:fs` ; le CLI avec
  validateur natif n'a pas été exécuté (artefact FFI absent). Build navigateur,
  composants React et séparation SVG natif restent ouverts.

### Requalification UI/M3 — 2026-10-01

- FAIT : `@aphrody/m3-icons/browser` (`M3IconSvg`) rend du SVG pré-généré sans
  importer `@aphrody/bun` ; l'entrée racine garde son API et son chemin natif.
  Le README documente la séparation ; `<m3-icon>` (Lit) reste natif.
- FAIT : `render-tools` documenté (README) comme façade kernel `aphrody-render3d`
  au-dessus du moteur `aphrody-render` ; aucun renommage, identités publiques
  inchangées.
- Défauts réels corrigés : `@aphrody/m3-tokens` ne déclarait pas
  `@aphrody/m3-config` (build impossible) ; deux regex tronquées dans
  `m3-next-migrate/src/layout.ts` (build impossible) ; chemins périmés de
  `m3-fonts` (`GS`, `MS`) après le déplacement sous `packages/ui` et le
  renommage `aphrody-icons` → `icons`.
- Gates : `turbo run build --filter='./packages/ui/*'` : 15 sur 15 réussis.
  Typecheck réussi pour tous les packages UI exécutés. Tests : m3-ai, m3-explorer,
  m3-fonts, m3-forms, m3-next, m3-next-migrate, m3-primitives, m3-tokens
  réussis sans FFI ; m3-icons (12), m3-theme (7), m3 (45), material-web (20),
  m3-design (23) réussis avec `APHRODY_FFI_DEV=1` et l'artefact release local.
  Le CLI m3-design avec validateur natif donne 100/100.
- INCOMPLET : sans artefact FFI qualifié installé, les tests de m3-icons,
  m3-theme, m3 et material-web échouent (pas de repli) ; l'artefact release local
  n'est pas qualifié ABI. SSR/hydratation en navigateur, tests de rendu visuel
  et le build navigateur de `m3-design` (`node:fs` dans `generator.ts`) ne sont
  pas établis. `m3-reader` n'a pas de script de test.

### GUI Rust sous `crates/ui` — 2026-10-01

- Défauts réels corrigés : `aphrody-tauri-3d` ne compilait plus contre wgpu 30
  (`SurfaceConfiguration::color_space`, enum `CurrentSurfaceTexture`,
  `Queue::present`) ; `aphrody-model-view` échouait dans son `build.rs` car la
  feature workspace `macos-private-api` n'était pas déclarée dans
  `tauri.conf.json` (`macOSPrivateApi: true`, comme Koharu).
  Comportement choisi : `Timeout`/`Occluded` sautent la frame, `Outdated`/`Lost`
  reconfigurent puis réessaient une fois.
- Gates : `cargo check --all-targets` et `cargo test` réussis sur les 18 crates
  UI du workspace, en mode `--offline` (tests : 395 réussis, 0 échec, 1 ignoré,
  somme des « test result » du journal). À l'époque `--locked` était bloqué par
  une modification concurrente de `crates/ai/rag-core/Cargo.toml` ; il fonctionne
  de nouveau (voir « Ligne Tauri 3 centralisée »), tant qu'aucune session ne
  laisse un manifeste sans `Cargo.lock` à jour.
- Les builds Tauri réécrivent des fichiers générés suivis (`permissions/
  autogenerated`, `gen/schemas`) : restaurés après chaque contrôle. À traiter
  par un propriétaire (génération hors arbre suivi ou commit explicite).
- FAIT : clippy all-targets avec refus des avertissements réussi sur les 18
  crates UI après corrections minimales (`chunks_exact` → `as_chunks`, tri par
  clé, conditions fusionnées, closures redondantes, un `#[expect]` motivé sur
  `draw_shadow`). Tests rejoués sur les six crates touchées : 165 réussis.
- INCOMPLET : `crates/ui/app` (hors workspace actif), rendu GPU réel, lancement
  des fenêtres Tauri et Windows/macOS non qualifiés.

### Compléments UI navigateur — 2026-10-01

- FAIT : `@aphrody/m3-design` n'importe plus `node:fs` dans son cœur ; le chargement
  des design systems est injecté (`loadDesignSystem`) et la lecture disque vit
  dans `src/node.ts` (identifiant validé contre la traversée de chemin). 25 tests.
- FAIT : `<m3-icon-svg>` (`@aphrody/m3-icons/browser/lit`) complète `M3IconSvg`.
- FAIT : tests d'hydratation SSR de `m3-primitives` (Badge, Button, Card, Divider,
  ProgressBar, Switch) avec témoin négatif prouvant la détection d'écart, et tests
  SSR/hydratation de `CollectionReader` ; `m3-reader` a désormais un script `test`.
- FAIT : `MangaReader` et `DatabookReader` testés (rendu serveur et hydratation).
  `swiper/react` importe `react` sans le déclarer en peer et le linker isolé ne
  peut pas le résoudre ; un patch `patchedDependencies` n'agit pas (le linker lit
  les métadonnées du registre). Contournement limité aux tests : plugin `onLoad`
  dans `m3-reader/test/setup.ts`. Les bundlers applicatifs ne sont pas concernés.
  `m3-reader` : 8 tests.
- INCOMPLET : hydratation limitée à un sous-ensemble de primitives, sans
  navigateur réel ni tests de rendu visuel.

### Rendu et fenêtres natives — 2026-10-01

- FAIT : rendu du showcase M3 1280x800 par `aphrody-render` : CPU (67 ms) et GPU
  via Vulkan logiciel llvmpipe (11 ms/frame à chaud). Écart mesuré CPU/GPU : moyenne
  0,032/255, maximum 25 (bords). Image CPU inspectée : sphère, tore, cône, ombres
  et panneau translucide corrects. Aucun GPU matériel dans cet environnement.
- CORRIGÉ ensuite : `aphrody-model-view` échouait au démarrage (`no runtime was
  configured`, Tauri 3 exige `Builder::runtime(...)`). Décision utilisateur :
  runtime le plus récent, le plus bas niveau et le moins coûteux en mémoire →
  `tauri-runtime-wry` (`.runtime(Wry::default())`) ; la fenêtre se lance sous
  `GDK_BACKEND=x11` (Wayland : erreur de protocole Gdk 71, non résolue). Les
  pixels de la fenêtre n'ont pas pu être capturés (XWayland).
- CONSTAT remplacé : `crates/ui/app` (`aphrody-app`) était exclu du workspace
  (Tauri 2.11.6, conflit `links = "Tauri"`) ; décision utilisateur « Migrer vers
  Tauri 3 » exécutée, voir la section suivante.

### Ligne Tauri 3 centralisée et migration d'`aphrody-app` — 2026-10-01

Remplace les deux derniers constats de la section précédente (runtime absent,
migration non entreprise). Détails : `docs/operations/ui/tauri-upstream.md`.

- FAIT : ligne amont établie. `tauri-apps/tauri` `v3` (70541fe2, 2026-09-30) est la
  ligne Tauri 3 (`tauri` 3.0.0-alpha.3, tag `tauri-v3.0.0-alpha.3`) ; `dev`
  (30da1fd6) porte `tauri` 2.12.1 et n'est pas Tauri 3. Les plugins ont une
  branche `v3` (d9be6d04) et des alphas 3.0.0-alpha.2 sur crates.io.
- FAIT : versions centralisées dans `[workspace.dependencies]` : `tauri` et
  `tauri-runtime-wry` 3.0.0-alpha.3, `tauri-build`, `tauri-plugin` et quinze
  `tauri-plugin-*` 3.0.0-alpha.2, `tauri-runtime-cef` 3.0.0-alpha.4. Aucun
  membre ne porte de version ni de révision git. Cargo.lock : une seule version
  par crate Tauri (wry 0.57.0, tao 0.37.1). Runtime par défaut : wry ; CEF
  réservé à Koharu (`koharu`, `koharu-app`) ; features `dynamic-acl`/`specta`
  déplacées de la racine vers les crates Koharu.
- FAIT : JS centralisé (`workspaces.catalog`) : `@tauri-apps/api` 3.0.0-alpha.2,
  `@tauri-apps/plugin-opener` 3.0.0-alpha.1 (alpha.2 trop récente pour
  `minimumReleaseAge` 3 jours). `bun install --frozen-lockfile` réussi ;
  `tsc --noEmit` réussi pour `@koharu/bridge`, `@koharu/sdk`, `@koharu/ui`.
- FAIT : `aphrody-app` migré et retiré de `exclude`. Changements imposés par
  Tauri 3 : `.runtime(tauri_runtime_wry::Wry::default())`, `tauri::Wry` →
  `tauri::DynRuntime`, `autolaunch()` → `autostart()`, permission
  `fs:allow-read-text-file` supprimée en amont (→ `fs:allow-read-file`),
  `macOSPrivateApi` déclaré. Une condition collapsible préexistante corrigée
  (`broker.rs`). Gates : `cargo check --all-targets` réussi, `cargo clippy
  --all-targets --no-deps -- -D warnings` réussi, `cargo test -p aphrody-app` :
  23 réussis, 0 échec ; `cargo check --locked` réussi. Sans `--no-deps`, clippy
  échoue dans `aphrody-translate` (3 erreurs préexistantes, hors Tauri).
- FAIT : fenêtres lancées (`GDK_BACKEND=x11`) : `xwininfo -root -tree` montre
  « aphrody » 1280x832 et le splash « Aphrody » 320x340, processus vivant.
  Pixels non capturés (capture impossible sous XWayland). Erreurs d'environnement
  non liées : `sd-daemon` absent, pas de StatusNotifierWatcher, pas de
  `update-desktop-database`.
- DÉFAUT AMONT contourné : `tauri-plugin-dialog` 3.0.0-alpha.2 (publié) ne compile
  pas contre `tauri` 3.0.0-alpha.3 (`run_on_main_thread` déplacé vers `Manager`) ;
  HEAD de la branche `v3` des plugins aussi. Copie crates.io + une ligne dans
  `.cache/upstream/tauri-plugin-dialog` (`[patch.crates-io]`, patch
  `patches/tauri-plugin-dialog-3.0.0-alpha.2.patch`).
- FAIT : forks inventoriés. `aphrody-code/tauri` 89499afc : seul changement
  `no_redirection_bitmap`, déjà présent dans Tauri 3 → retiré.
  `aphrody-code/plugins-workspace` 5baf71a4 : identique à `v2` amont → retiré.
  `koharu-rs/tauri-specta` : un commit (tauri >= 3) toujours nécessaire, amont
  `main` dépend encore de tauri 2.
- FAIT : `bun run tauri:sync[:check]` (`packages/infra/workspace/src/tauri-sync.ts`,
  `config/tauri-upstream.json`) : rapport courant/dernier, refs git, patches,
  `--check` (code 1 si en retard ou patch cassé), `--apply` borné à Cargo.toml
  racine + catalogue avec gate et retour arrière. 11 tests Bun réussis ; rapport
  réel : 0 en retard, 1 paquet `too-fresh` ; retour arrière vérifié sur une racine
  temporaire dont le gate échoue. `apply` réussi jusqu'au bout non exercé (aucune
  mise à jour disponible).
- INCOMPLET : `tauri-runtime-cef` alpha.4 compile (`koharu-app`, `koharu`) mais
  Koharu n'a pas été lancé ; `crates/os/drive` et `crates/web/drive-server`
  restent exclus, sans dépendance Tauri ; Windows/macOS non qualifiés.
- FAIT (suite) : `m3-next-migrate` génère des applications Tauri 3 (versions
  `TAURI_3` dans `src/scaffolder.ts`, runtime wry explicite, `tauri-plugin-opener`
  à la place de `plugin-shell`) ; `test/scaffold-tauri3.test.ts` (3 tests) échoue si
  les versions dérivent du `Cargo.toml` racine, du catalogue ou de
  `config/tauri-upstream.json`. `aphrody-ops tauri` (`tauri.ts`) vise
  `crates/ui/app`, construit les sidecars `aphrody` et `koharu-sdk` depuis ce
  workspace (le checkout frère reste prioritaire s'il existe) et embarque `ui-dist`
  tant que `packages/app-ui` n'existe pas dans le workspace.

### Registre des projets Tauri — 2026-10-01

- FAIT : `config/tauri-apps.json` liste tous les projets Tauri : trois applications
  (`aphrody-app`, `aphrody-model-view`, `koharu`), plugins et bibliothèques, paquets JS
  Koharu, générateur `m3-next-migrate` et fixtures amont sous `upstream/`
  (`mcp-server-tauri`, `tauri-plugin-webdriver`, `victauri`, `tauri-plugin-dialog`,
  `tauri-driver`). `bun run tauri:apps` parcourt tout l'arbre, y compris les chemins
  ignorés par git ou exclus du workspace Cargo (seuls `target`, `node_modules`, `.git`,
  `.turbo`, `.coord` sont ignorés) : 20 projets trouvés, 0 non enregistré.
- FAIT : `bun run tauri:apps:check` échoue si un projet ou un fichier de config
  `tauri*.conf.json` n'est pas enregistré, si un chemin enregistré a disparu, si
  l'appartenance au workspace Cargo diffère, si une crate première partie fixe sa propre
  version `tauri*` au lieu de `workspace = true`, si un paquet npm fixe `@tauri-apps/*`
  au lieu de `catalog:`, si un `$schema` n'a pas le tag Tauri épinglé, ou si une config vise
  les checkouts frères d'avant la fusion. `tauri:apps:fix` réécrit les `$schema`.
  État mesuré : toutes les crates et tous les paquets sont déjà centralisés ; seul écart
  réel, `crates/koharu/koharu/tauri.conf.json` appelait `bun --cwd ../aphrody-ui` avec un
  `cwd` d'avant la fusion : corrigé (`cwd` racine, filtres `@koharu/bridge` et
  `@aphrody/koharu-editor-example`), non lancé (Koharu CEF reste non exécuté).
- FAIT : `tauri-sync` n'a plus de liste propre : le gate `cargo check -p` et les chemins
  générés viennent du registre ; le `$schema` de chaque config première partie est suivi
  comme un miroir (écart signalé, réécrit par `--apply`, restauré si le gate échoue).
  Chemin « `--apply` réussi jusqu'au bout » enfin exercé, sur une racine temporaire
  (`test/tauri-sync-apply.test.ts`, 3 tests) ; `tauri-apps.test.ts` : 12 tests.
- INCOMPLET : les confs Koharu par plateforme répètent la fenêtre `main` et l'identifiant
  (Tauri remplace les tableaux lors de la fusion) ; les docs et skills Tauri 2 dupliqués
  (`docs/reference/ui/tauri`, `tauri-v2` sous `config/ai/plugins` et `plugins/aphrody`)
  relèvent de l'agent docs.

### Consolidation de la documentation UI/GUI/wgpu/Tauri/M3 — 2026-10-01

- FAIT : 159 copies byte-identiques de `docs/` supprimées au profit de la copie propriétaire
  (README de packages et crates UI, docs Material Web, docs Koharu, références de permissions).
  159 alias enregistrés dans `docs/migration/source-map.json` (`duplicateOf`), index régénéré,
  14 fichiers de liens entrants corrigés. 7 hubs README créés sous `docs/*/ui`. Six documents
  Tauri 2 marqués historiques avec renvoi vers la ligne Tauri 3 ; broche wgpu corrigée (30.0.1).
  Rapport : `docs/migration/ui-docs-consolidation-2026-10-01.json` ; outil
  `aphrody-ops docs-consolidate` (23 tests), option `--include` pour `docs-overlaps`.
- Mesures : liens non résolus globaux 2052 -> 2009 (périmètre UI 300 -> 287) ; 914 -> 765
  documents ; 172 -> 15 clusters exacts ; `docs-index` 216 cibles manquantes inchangées (iecode).
- INCOMPLET : 46 copies à chemins seuls différents, découpage en dossiers m3/gpu/gui et fusion
  des deux `M3-FRAMEWORK.md` non faits ; doublons de skills AI/NIE intouchés ; `docs:ai`,
  `bundle-llms-docs` et `pipeline-catalog` non lancés.

### Scaffold unique et conversion web vers Tauri 3 — 2026-10-01

- FAIT : `@aphrody/scaffold` (`packages/ui/scaffold`) est l'unique scaffold UI : coque Tauri 3
  (`tauriShell` : épingles, runtime wry/CEF explicite, capability, icône), gabarits `web`
  (`m3 new`, sortie byte-identique à l'ancienne), `app` (`next-migrate`) et `example` (l'exemple
  canonique), écriture sans écrasement. `TAURI_3`, l'encodeur PNG, les dérivations de noms et la
  config Tauri n'existent plus qu'une fois ; le miroir tauri-sync est unique
  (`packages/ui/scaffold/src/pins.ts`). Quatre README d'exemples hérités, dont le code n'existe
  plus, sont marqués historiques vers l'exemple unique. Doc : `docs/guides/ui/SCAFFOLD.md`.
- FAIT : `@aphrody/web-to-tauri` (sonde, plan, génération, parité) et la crate
  `aphrody-tauri-wrap` (runtime) convertissent un site, une web app ou un bundle en app Tauri 3.
  Modes `remote` (URL : page, API et backend inchangés), `sidecar` (serveur du projet en
  processus fils) et `bundle` (assets embarqués + proxy du backend). Politique de navigation,
  popups avec opener, téléchargements, iframes tierces, fournisseurs de connexion, registre des
  risques résiduels. Docs : `docs/guides/ui/WEB-TO-TAURI.md`, `docs/apis/ui/WRAP-CONFIG.md`.
  Commandes : `bun run ui:wrap`, `bun run ui:scaffold`.
- Vérifié : tests Bun scaffold 19, web-to-tauri 118, m3-next-migrate 28 ; typecheck des quatre
  paquets ; `ui:browser-audit` 60 ok / 0 échec ; `tauri:apps:check`, `tauri:sync:check` (dérive 0) ;
  Rust `aphrody-tauri-wrap` : check, clippy `-D warnings`, 23 tests, dont la table de politique
  exécutée par TypeScript et par Rust depuis un seul fichier de cas ; projets générés `remote`,
  `bundle` et `sidecar` : `cargo check` ; sonde et plan sur quatre sites réels.
- Vérifié en direct (WSLg, X11, WebKitGTK) : le projet `remote` généré depuis `https://example.com`
  ouvre une fenêtre 1280x800 dont le titre suit `document.title` ; contrôle de parité contre
  `aphrody-web` : titre, route, arbre et texte identiques (similarité 1) ; navigation externe,
  popup externe et `mailto:` transmis à l'OS avec l'URL exacte ; `file:` et `ms-msdt:` bloqués ;
  popup d'un site autorisé ouvert comme fenêtre. Première compilation et exécution du pont de
  debug `aphrody-tauri-debug` patché.
- INCOMPLET : parité non lancée sur un site avec API ou connexion ; modes `bundle` et `sidecar`
  vérifiés à la compilation seulement (pas de fenêtre) ; Windows, macOS et CEF non qualifiés ;
  pas de parité pixel ; proxy sans WebSocket ; sous-commande dans le CLI Rust `aphrody` non
  ajoutée (passer par `aphrody-ops`) ; binaire sidecar compilé par Bun : 81 Mo.
- Nettoyage UI/web (même jour) : suite Rust finale verte (clippy `-D warnings` sur 18 crates UI,
  `aphrody-app`, `aphrody-tauri-wrap`, `aphrody-tauri-debug`, `aphrody-web-engine` ; tests des
  crates Tauri et de `koharu-app`) ; typecheck des 24 paquets UI/web ; erreurs de lint corrigées
  dans le code first-party (imports inutilisés, `cause` perdue, paramètre public conservé en
  `_userId`) ; fichiers neufs formatés (oxfmt, rustfmt) sans toucher au code importé
  (`material-web`, `taffy`, drive, icons, identity : formatage d'origine conservé) ; `m3` et
  `m3-icons` passent (45 et 13 tests) avec `APHRODY_FFI_DEV=1`, sans quoi la bibliothèque native
  `aphrody-ffi` est refusée ; schémas Tauri générés conservés tels que Tauri 3 les produit (les
  `autogenerated/commands/*.toml` de Tauri 2 ne sont plus émis). Restent : 88 liens de docs UI/web
  cassés dans des documents importés, 1 091 fichiers UI/web non conformes à oxfmt dans du code
  importé, avertissements `no-await-in-loop` voulus (I/O séquentielle).

### Dédup UI/web : crates, assets, dépendances — 2026-10-01

Alias source vers cible et éléments conservés : `docs/migration/stack-dedup/ALIASES.json` (détail et
empreintes par lot dans les sept fragments voisins). Mesure reproductible : `bun run stack:dedup`.

- FAIT, crates mortes : `aphrody-tauri-m3` supprimée (zéro dépendant, zéro appel, zéro capability ; le
  relais de la couleur d'accent de l'OS qu'elle portait n'était branché nulle part, récupérable par
  `git show 3eb5e66a:crates/ui/tauri-m3/…`), feature `capture` d'`aphrody-m3-reproduce` retirée, `zbus`
  retiré du workspace.
- FAIT, fusions (noms de symboles FFI et d'outils MCP inchangés) : `aphrody-m3` vers
  `aphrody_m3_tokens::facade` ; `aphrody-logo` vers `aphrody_identity::logo` ; `aphrody-icons` vers
  `bun_rs::icons` (`aphrody-bun`) ; `aphrody-tauri-debug` vers `aphrody_tauri_wrap::debug` (feature
  `debug-bridge`, serveur loopback derrière la feature `bundle`, le viewer `aphrody-model-view` ne tire plus
  axum) ; `aphrody-web-media` vers `aphrody_web_extract::media` ; `aphrody-x-algorithm` vers
  `aphrody_x::algorithm` ; façade `aphrody-web` supprimée (`WebSubsystem` vit dans `aphrody-app` : 14 crates
  et 78 paquets tiers de moins dans le graphe de l'app).
- REFUSÉ avec chiffres : `aphrody-softraster` et `aphrody-sprite-sheet` (le dépôt voisin `iecode` les
  consomme par chemin ; les fusionner alourdirait `nie-render3d` et `nie-formats`), `aphrody-web-service` et
  `aphrody-web-chromium` (`rookie-cookies` pèse 182 paquets tiers).
- FAIT, assets : 236 fichiers (21,4 Mo) retirés de `crates/ui/app/ui-dist/fonts`, recopiés par `build.rs`
  depuis leurs paquets canoniques (`ui-dist.manifest`, test `ui_dist_assets`) ; 8,2 Mo de doublons non suivis
  sous `assets/ui` supprimés (alias dans `assets/ui/manifest.json`) ; `NotoColorEmoji` gardé en double
  (10,7 Mo, deux consommateurs incompatibles, sha256 égaux).
- FAIT, dépendances d'obscura : sha1/sha2 0.11, hmac 0.13, aes 0.9, aes-gcm 0.11, cbc 0.2, ctr 0.10,
  pbkdf2/hkdf 0.13, getrandom 0.4, cssparser 0.37, selectors 0.38, rcgen 0.14, `ureq` 3 (client sync,
  écart motivé au skill best-stack-2026 : reqwest bloquant panique dans un runtime async). Disparus du
  lock : cssparser 0.34, selectors 0.26, rcgen 0.13, yasna, ureq 2. Pins racine non touchés.
- Vérifié en une seule passe, priorité minimale, hors ligne : `cargo check` sur 34 paquets, 0 erreur,
  0 avertissement ; `aphrody-tauri-wrap` en quatre combinaisons de features ; clippy `-D warnings --locked`
  sur 15 crates et sur `aphrody-tauri-wrap` ; tests `tauri-wrap` 28 (20 sans feature par défaut),
  `m3-tokens` 144 (dont le doc-test de la façade), `identity` 60, parité pixel des icônes 8, `web-extract`
  65, `x` 76, `ui_dist_assets` 3, `obscura-dom` 82, `obscura-net` 107, `obscura-js` 429, rendu 67 ;
  `axum` absent du graphe de `aphrody-model-view` ; projets générés `remote`, `bundle`, `sidecar`
  (binaire sidecar remplacé par un fichier vide) et `remote` avec `debug-bridge` : `cargo check`.
  Bun : scaffold 21, web-to-tauri 118, m3 45, m3-icons 13, m3-next-migrate 28, m3-fonts 5, agent-browser 24,
  x 110, workspace 114, web-verify et crawlabilité 17 ; typecheck de 8 paquets ; `tauri:apps:check`,
  `tauri:sync:check`, `monorepo:layout`, `pipeline-catalog`, `ui:browser-audit` verts ; catalogue
  `docs/ecosystem/*` régénéré. Références obsolètes réécrites dans les docs, plans, skills du plugin et
  commentaires de paquets Bun ; `docs/migration/*` (provenance) laissé intact.
- INCOMPLET / NON PROUVÉ : `tsc` du workspace échoue sur `packages/infra/workspace/src/rg.ts:550`
  (modification d'une autre session) ; `docs:check-links` signale 2 008 liens cassés, tous dans des documents
  importés (aucun vers une crate supprimée) ; aucune fenêtre lancée pour `bundle` et `sidecar` ; la
  sémantique de `selectors` 0.38 (hôte sans caractéristiques, `:not()` imbriqués) est couverte par les tests
  d'`obscura-dom` mais pas validée sur de vraies pages ; `ureq` 3 (`proxy(None)`, 5 redirections) non
  exercé réseau ; `cargo test` non lancé sur `aphrody`, `aphrody-ffi`, `aphrody-mcp`, `aphrody-web-*` (check
  seulement). `packages/ui/assets` n'est pas suivi par git alors que `bun.lock` le déclare : l'ajouter au
  même commit que la suppression de `ui-dist/fonts`, sinon un clone propre perd 211 fichiers. Le
  `rerun-if-changed=../../packages/app-ui` de `crates/ui/app/build.rs` vise un dossier inexistant
  (antérieur). Rien n'est commité.
- Non traité (autres domaines, décision requise) : `aphrody-a2a-ui` orphelin ; `aphrody-kernel-client`,
  `aphrody-subsystem`, `aphrody-nu`, `koharu-*` (100 à 190 paquets tiers chacun) ; crates sans dépendant.

## 5. AI, Web et RAG

Propriétaires : `crates/ai`, `crates/web`, `packages/ai`, `packages/web`.

- [ ] Faire de `rag-core` le propriétaire unique des calculs RAG ; adapter
  Python à ce cœur et supprimer ses calculs dupliqués.
- [x] Corriger l’écart RRF : le premier résultat doit suivre la convention du
  cœur `1/(k+rang+1)` ; tester parité Python/Rust et cas vides/doublons.
- [ ] Requalifier les contrats Web/AI et reprendre les gates ouverts des plans
  historiques. Vérifier services externes séparément des tests déterministes.

### Web et navigateur (2026-10-01)

Cartographie : [architecture](docs/architecture/web/ARCHITECTURE.md) (21 crates
Rust, 3 paquets Bun, consommateurs, 16 écarts), contrat de service
[docs/apis/web/WEB-SERVICE-CONTRACT.md](docs/apis/web/WEB-SERVICE-CONTRACT.md),
configuration unique [config/web.json](config/web.json), automatisation
[docs/operations/web/AUTOMATION.md](docs/operations/web/AUTOMATION.md), guides
[smoke et crawl](docs/guides/web/WEB-SMOKE-AND-CRAWL.md),
[debug Tauri](docs/guides/web/TAURI-DEBUG.md),
[UI crawlable](docs/guides/web/CRAWLABLE-UI.md), enquête
[docs/research/web/tauri-debugging-survey-2026-10-01.md](docs/research/web/tauri-debugging-survey-2026-10-01.md).

FAIT (vérifié) :
- `aphrody-web crawl` ajouté au binaire (enveloppe `aphrody-web-crawl`, robots,
  schéma `aphrody-web.crawl/1`), exercé par le smoke ; `launch --workers N` :
  garde qui tue les workers (SIGINT/SIGTERM, toute sortie) : compilé (`cargo
  check` du moteur), comportement non exercé. `Cookie` de `aphrody-web-chromium`
  sans valeur dans `Debug` : écrit avec son test, ni compilé ni exécuté.
- Client Bun unifié dans `@aphrody/agent-browser` : `/service` (fetch, markdown,
  artifact, scrape, crawl, session, screenshot, query), `/engine` (cycle de vie
  sur port éphémère), `/config`, `/test-preload`, `/tauri`. Les tests ne laissent
  plus de processus `aphrody-web` (le hook `process.on("exit")` n’est pas exécuté
  par `bun test`).
- `cargo check --all-targets` sur les 21 paquets web : 0 erreur, 0 avertissement.
  `cargo clippy --all-targets -D warnings` échouait avant (3 lints dans
  `aphrody-translate`, dépendance de `aphrody-web-bridge`) ; corrigé, passe.
- Bun : `@aphrody/agent-browser` 24 tests passent (avant : 6 passent, 1 échoue,
  1 erreur « server did not start » sous charge, serveur orphelin) ;
  `@aphrody/web-test` 41 passent (avant : 40 passent, 1 hook expiré) ; scripts
  web 12 tests passent ; typecheck des deux paquets et des scripts propre.
- `bun run web:smoke` : 11 vérifications sur fixtures loopback (fetch Markdown,
  artifact, scripts V8, crawl avec robots, CDP, DOM, refs d’accessibilité,
  clic/saisie, PNG, PDF, arrêt propre) en 1,2 s avec le binaire construit.
- `config/pipeline.json` régénéré par le générateur (63 lignes ajoutées, dont
  celles d’autres domaines détectées au même moment).
- UI crawlable : `bun run web:crawlability` rend 8 pages SSR des paquets m3
  (primitives, forms, explorer, trois readers) servies en loopback, les parcourt
  avec `aphrody-web crawl` et mesure le HTML initial (HTMLRewriter) ; sortie 0 sur
  l’état final. Avant correction : 2 widgets sans nom (`ProgressBar`,
  `CircularProgress`), 6 références `aria-*` pendantes, 0 `data-m3-component`,
  16 `data-testid` (coque seule) ; après : 0, 0, 206, 29 ; 8/8 pages atteintes par
  `<a href>`, couverture texte du crawler min 0,268 / moyenne 0,465 (497 mots sur
  906 visibles, inchangée). Seuils figés dans
  `config/web-crawlability.baseline.json` (14 régressions détectées sur le HTML
  d’avant). Tests : 11 (audit) + 9 (`m3-next` sitemap/robots/llms.txt/JSON-LD)
  + primitives 108, forms 12, explorer 11, reader 10 ; `ui:browser-audit` 47 ok,
  11 serveur seul, 0 échec.
- Enquête des outils de debug Tauri (30 recherches GitHub, crates.io, npm) ;
  quatre forks épinglés sous `upstream/` et trois forks GitHub `aphrody-code`
  créés, rien n’est poussé ; `bun run tauri:apps:check` et `tauri:sync:check`
  passent.

INCOMPLET (non vérifié) :
- Aucun test Rust n’a été exécuté sur ce lot : `cargo test` des 21 paquets (la
  référence a échoué à la compilation à cause d’une édition concurrente, puis
  arrêtée à la demande), 4 tests de `crawl.rs` et 1 test de
  `aphrody-web-chromium` écrits mais non lancés ; seul `cargo check` du moteur
  (tous les targets) est passé.
- Plugin de debug Tauri 3 : patch de 11 fichiers sur le pont hypothesi
  (`patches/tauri-plugin-mcp-bridge-0.13.0-tauri3.patch`, rejoue l’arbre épinglé),
  module `debug` d'`aphrody-tauri-wrap` (ex-crate `aphrody-tauri-debug`) et câblage `aphrody-model-view` **jamais compilés
  ni lancés**. Une fenêtre `aphrody model` s’est ouverte sous X11 (vue dans
  `xwininfo`) avec une construction antérieure, sans canal de debug : aucune
  fenêtre n’est « vérifiée ». Pas de façade CDP au-dessus du pont, pas de backend
  pont dans `aphrody-tauri-mcp`, chemins Windows/macOS non compilés.
- Consommateurs hors couche : cheerio/curl/regex (RG, Shenron), `crates/ai/tools`
  `web_fetch`, `siteone` dans n2b, clients de l’API retirée `aphrody-web-api` ;
  résolution `bxc` de `aphrody-web-bridge`. Voir les écarts 6 à 16 de
  l’architecture ; rien n’a été migré.
- `web:verify:rust` (check, clippy, test) non lancé pour cause de charge machine.
- UI crawlable : pas de générateur `m3-manifest.json`, wrappers Lit/`md-*` hors
  fixture (`@lit-labs/ssr` absent de `bun.lock`), options du `Select` en portail
  et chapitres de `CollectionReader` absents du HTML serveur, contenu des
  formulaires absent du Markdown de l’extracteur, `CardTitle` toujours `h3`. Les
  sites produit (`apps/shenron/site`, `apps/rg/website`, bases de données requises)
  n’ont pas été servis : le gate mesure la contribution des composants
  (`--seed URL` pour un site réel).

## 6. Consommateurs RG et autres domaines

Propriétaires : `packages/rg`, `apps/rg`, domaines Discord/Koharu/FUT.

- [x] Extraire les handlers Storage/Realtime/CDN vers leurs packages ; l’API
  importe les bibliothèques, les apps conservent configuration et démarrage.
  Fait 2026-10-03 : `packages/rg/{cdn,realtime,storage}` (`@rosegriffon/*`,
  export `./server`), importés par l’API du bot ; démarrage autonome toujours
  sous `import.meta.main` ; le CDN ne crée plus son dossier ni ne lit son
  manifeste à l’import (initialisation à la première requête, sonde d’import
  vérifiée). Tests cdn 20, realtime 4, storage 12 ; typecheck des trois et du
  bot verts ; bot 1315 pass / 20 échecs dus à l’absence de base Postgres.
- [ ] Sortir le daemon Cron de son package partagé.
- [x] Donner catalogue boutique et registres communs à un package de domaine ;
  retirer l’import du site depuis le bot. Fait 2026-10-03 : catalogue déplacé
  vers `@rosegriffon/types/shop` (`packages/rg/types/src/shop.ts`, sans import) ;
  le site le réexporte depuis `src/lib/shop/products.ts`, le bot l’importe du
  paquet ; plus aucun import bot → site. Tests bot boutique 57, types 69 ;
  typecheck bot, site et types verts.
- [ ] Reprendre les gates historiques de chaque produit effectivement importé.
  Gates déclarés 2026-10-03 (`bun run test` / `typecheck`), tous verts :
  apps RG bot 1237, website 402 ; 20 paquets `packages/rg` (dont achillea-core
  212, cron 173, patreon-bun 174) ; discord aphrody-messaging 9, kit 20
  (typecheck réparé : `skipLibCheck`, `@sapphire/shapeshift@4` incompatible avec
  `@types/node` 26) ; koharu bridge/sdk/ui typecheck, editor ; fut 148. Reste :
  smoke de chaque application. Prérequis constaté : `apps/rg/website/sql/migrations`
  ne contient que des migrations incrémentales (2026-08+), sans schéma de base ;
  la seule base locale est le Supabase auto-hébergé RG (non jetable). Un smoke
  exige un dump de schéma RG à importer dans un Postgres jetable.

Critères : imports des packages sans serveur, tests handlers/contrats puis
smoke de chaque application, packaging autonome des assets partagés.

### Autonomie Discord et élimination du fork upstream — 2026-10-01

- FAIT : les dépendances Discord (`discordx`, `@discordx/di`, `@discordx/pagination`,
  `@discordx/importer`, `@discordx/utilities`, `discord.js` ^14.27.0, `discord-api-types` ^0.38.55,
  `@discordjs/rest` ^2.6.3) sont unifiées et cataloguées dans le `workspaces.catalog` racine sous Bun 1.4.2 et TypeScript 7.0.2.
- FAIT : création du package partagé `@aphrody/discord-kit` (`packages/discord/kit`) qui centralise :
  - Négociation d'intents pré-vol (`resolveGrantedIntents`, `assertDiscordTokenMatchesProfile`) pour éviter la coupure fatale 4014 ("Disallowed intents").
  - Limites de cache mémoire et sweepers de production (`createProductionCacheOptions`) calibrés pour Bun en 24/7.
  - Dispatcher d'interactions résilient (`safeExecuteInteraction`) récupérant les pannes avec `editReply` si différé, réponses éphémères propres et garde autocomplétion.
  - Initialisation sécurisée des commandes avec parsing du `rawError` Discord (`initApplicationCommandsSafe`, `clearGuildCommandsSafe`).
  - Guards partagés (`NotBot`, `createMonoGuildGuard`).
  - Gestion du cycle de vie et arrêt gracieux (`registerGracefulShutdown`).
- FAIT : alignement et montée en gamme des trois bots (`apps/shenron/bot`, `apps/rg/bot`, `apps/rg/achillea-bot`) qui consomment désormais `@aphrody/discord-kit`.
- FAIT : élimination complète de `upstream/discord` (2 232 fichiers, 3,9 Go libérés) et des références legacy.
- FAIT : `scripts/audit/discord-verify.ts` contrôle désormais l'intégrité du catalog (8 paquets), `@aphrody/discord-kit` (typecheck, 16 tests, build), `@aphrody/messaging` (typecheck, 9 tests, build), `@shenron/bot` (type-check, 412 tests), et `@rosegriffon/bot` (1 228 tests).
- FAIT : pipeline de compilation native autonome (`bun build --compile`) opérationnel pour les bots Discord via `scripts/build/compile-discord-bot.ts` et `bun run discord:compile [shenron|rg|all] [--smoke]`.
- FAIT : résolution des verrous de bundling AOT pour DiscordX :
  - Points d'entrée `entry-standalone.ts` garantissant le polyfill `reflect-metadata` avant l'évaluation de `tsyringe`/`discordx`.
  - Table statique de chargeurs `apps/rg/bot/src/modules.ts` permettant l'empaquetage complet des commandes tout en préservant le chargement dynamique par profil (`rg` vs `azalee`) au runtime.
  - Détection `isCompiledBinary()` et `getBotRuntimeInfo()` dans `@aphrody/discord-kit` pour désactiver les transports threadés (`pino-pretty`) sous binaire autonome.
  - Ajout des arguments CLI standards (`--help`, `--version`, `--dry-run`) permettant d'inspecter les binaires sans ouvrir de socket Discord.
- Gates validés : 100% passants avec `bun run discord:verify --compile` (16/16 tests kit, 9/9 tests messaging, 412/412 tests shenron, 1 228/1 228 tests rg-bot, compilation autonome et smoke check des deux binaires natifs).

## 7. Shenron, produit final

Propriétaires : `packages/shenron`, `apps/shenron`.

- [x] Examiner puis intégrer les trois fichiers laissés non suivis par Gemini :
  `databooks-defauts.ts`, `slug.ts`, `wiki-slugs.ts`. Ils restent préservés ;
  une copie présente ne prouve pas que les consommateurs ont migré.
- [x] Donner règles wiki/databooks et registres au package config ; retirer les
  imports de règles depuis le site dans le pipeline. Vérifié 2026-10-03 sur HEAD :
  `@shenron/config` possède `databooks-defauts`, `slug`, `wiki-slugs` et le
  registre du corpus ; les fichiers du site ne sont que des réexports ; aucun
  import du pipeline vers `apps/shenron/site` (11 fichiers importent
  `@shenron/config`) ; seul `workflows.ts` lance un script du site par processus.
- [ ] Consommer le chargeur interop unique et les calculs RAG qualifiés.
- [ ] Reproduire les tests/configuration historiques ; corriger les erreurs
  actuelles avant les tests bout en bout de site, bot et pipeline.
  Gates 2026-10-03 (`APHRODY_FFI_DEV=1`) : tests bot 426, site 1278 (+1 échec
  sur la page non suivie `wiki/manga/revue` du lot Koharu non commité, conteneur
  écrit à la main au lieu de `<PageShell>`), api 97, auth 94, config 47, db 78,
  images 18, pipeline 286, ui 47 (la page `wiki/manga/revue` corrigée dans le
  working tree avec `<PageShell as="main">` : design-system 11/11 ; fichier
  toujours non suivi, à committer par l’auteur du lot Koharu). Typecheck : les 9 scripts appelaient `tsgo`,
  absent ; passés à `tsc` (TypeScript 7 natif épinglé) : 9/9 verts. Reste : bout
  en bout site/bot/pipeline.
- [ ] Valider le produit assemblé après passage des gates de ses dépendances.

Critères : corpus/règles partagés, tests pipeline/config, build site/bot,
smoke documenté. Une mise en production est une opération distincte.

### Gates Shenron reproduits — 2026-10-03

- Tests (`APHRODY_FFI_DEV=1`) : config 47, pipeline 286 (7 ignorés), bot 426, site
  1279 (66 ignorés), db/auth/api/images/ui verts ; 9 typechecks sur 9 verts.
- Postgres jetable (PostgreSQL 18, `initdb` sous `/tmp`, port libre ; les ports
  54321-54329 appartiennent à une pile Supabase locale, non touchée) avec le DDL
  des schémas site `public` (33 tables) et `bot` (49) exporté hors connexion par
  `drizzle-kit export`, puis `unaccent`, `pg_trgm` et `vector`. Site : 1297 réussis,
  2 ignorés, 42 échecs. Les 42 sont des assertions sur le contenu du corpus
  (Kamehameha, Goku, tome 1 id 1420 à 221 planches…) sans aucune erreur de schéma
  ni de requête : ils exigent le corpus du store protégé, qui n'est pas fabriqué.
  Les 41 tests à tables temporaires (`character-consolidation`,
  `databooks-ecriture-sure`, `community-tops`) passent pour la première fois
  contre un vrai Postgres.
- Build site : `next build` lit `DATABASE_URL` à la collecte (`generateStaticParams`,
  voulu) ; sans elle il échoue sur `/news/[slug]`. Avec la base jetable : 270 routes
  en 13,5 s. `next start` : `/`, `/wiki`, `/news`, `sitemap.xml`, `robots.txt`,
  `/api/health`, `/api/wiki/events`, `/api/canon/references` répondent 200 (contenu
  vide), `/wiki/personnages` 307. Variables exigées : `DATABASE_URL`,
  `BETTER_AUTH_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` (valeurs
  locales jetables). Le build inclut deux fichiers non suivis du lot Koharu.
- Défaut corrigé : `discord compile shenron --smoke` échouait (`Could not resolve
  ../../assets/fonts/google-sans-flex.woff2`). Le commit 96cd8a74c avait supprimé
  la copie du bot, identique par SHA-256 à `apps/shenron/site/public/fonts/`, sans
  migrer le CSS du dashboard, qui retombait aussi sur la police système à
  l'exécution. `styles.css` référence l'unique copie du site, `styles.compiled.css`
  est régénéré ; binaire de 151,6 Mo et smoke `--help` réussis, `bun run build`
  inline la police. Test de garde `tests/dashboard-css-assets.test.ts` : rouge sur
  l'ancien CSS, vert sur le correctif.
- Ouvert : `drizzle-kit` ne s'exécute pas sous le linker isolé (`db:generate`,
  `db:migrate`, export : « Please install latest version of drizzle-orm », le pair
  optionnel `drizzle-orm` n'étant pas lié à côté de lui) ; contourné pour cette
  passe par un lien temporaire du magasin `node_modules`, retiré. Correction
  durable : `publicHoistPattern` ciblé dans `bunfig.toml`, ou lien déclaré.
- Ouvert : trois tests du bot (`rag-eval`, `rag-aphrody`, `rag-filter`), modifiés
  par une autre session, échouent « RAG preload incomplete or stale; run
  rag:prepare » (392 réussis, 3 échecs à cette heure, contre 426/0 plus tôt) ; non
  attribués à ce lot. Le smoke du binaire ne prouve pas une connexion Discord ;
  le bout en bout site, bot et pipeline sur corpus réel reste à établir.
- Chargeur natif : le pipeline Shenron n'ouvre aucune bibliothèque lui-même ;
  `src/aphrody/native.ts` passe par `@aphrody/bun/shenron`, qui partage la poignée
  unique, la vérification d'artefact et les ABI de
  `packages/interop/native/src/library.ts`. Avec `APHRODY_FFI_DEV=1` et l'artefact
  release local, `test/aphrody/native.test.ts` réussit 6 sur 6 ; sans artefact les
  cinq tests natifs sont ignorés ; avec `APHRODY_FFI_REQUIRE_NATIVE=1` le test de
  persona exige en plus `APHRODY_FFI_TEST_PERSONA_PATH`. Artefact installé et
  qualifié, Windows et calculs RAG qualifiés restent ouverts : l'item de la
  section 7 reste à faire.

### Studio desktop Shenron × Koharu — 2026-10-03

- Décision du propriétaire : l'app Aphrody (`crates/ui/app`) devient l'outil unique
  d'administration Shenron, de manga/traduction Koharu, de databooks,
  d'entraînement et du Drive dbfr ; plan détaillé
  [aphrody-app-studio.md](docs/plans/ui/aphrody-app-studio.md). Lève la réserve
  de `GEMINI.md` ; la mise en production site/bot reste distincte.
- FAIT (124fe0570) : destination `/studio` ; onglet Shenron natif (`@shenron/ui`)
  sur l'API publique extraite de `aphrody-command::shenron_cmd` ; dashboard admin
  complet en fenêtre native avec pont `window.aphrodyNative` vers l'IA locale
  (`llama-server` géré) et panneau « IA locale » sourcé RAG dans le cockpit IA ;
  onglet Manga sur `koharu_rpc`. `cargo-serial check -p aphrody-app` vert,
  typecheck site vert, test de navigation 11/11.
- FAIT ensuite : Entraînement (629b6fc7d), Databooks & corpus hors ligne
  (5f801fdb2), Drive dbfr OAuth + volume `gdrive` `/dbfr` (37048cb9c) ; plus
  aucun onglet en attente. `cargo-serial check -p aphrody-app` vert à chaque lot.
- FAIT : éditeur Koharu complet dans l'onglet Manga (bf81e3c64), `koharu-app`
  générique sur le runtime ; `cargo-serial check -p aphrody-app -p koharu` vert.
- Restent : doublon `KoharuBroker` ↔ état `koharu-app` ; fusion OCR/LLM Koharu ↔
  `aphrody-ocr*`/`llama-server` ; régénération de `ui-dist` ; exécution de l'app
  non encore observée.

### Migration du calcul du pipeline vers ses propriétaires Rust — en cours

- Frontière demandée : Shenron ne conserve que les types/contrats, la
  configuration, le site, le bot, l'IA produit et l'UI. Aphrody possède les
  exécutions partagées, les traitements, le crawl et les données opérationnelles ;
  préférer ses services distants pour éviter un backend ou un stockage Shenron.

- Le chunking partagé de `packages/shenron/pipeline/scripts/_rag-chunk.ts` a
  été remplacé par l'appel Bun FFI `shenronRagChunk`, implémenté par
  `aphrody-rag-core::MarkdownChunker` avec les options de parité Shenron. Les
  trois consommateurs (`ingest-aphrody-rag.ts`, `_rag-corpus-sources.ts` et
  `_rag-sources-pg.ts`) continuent d'utiliser le contrat `{content, section}` ;
  ils ne portent plus l'algorithme de découpage.
- Le crate RAG avait déjà des fixtures de parité Markdown et TypeScript ; le
  nouveau symbole FFI réutilise le même `ChunkOptions::shenron_parity`. Le
  typecheck du pipeline et celui du package natif Bun passent ;
  `cargo check -p aphrody-ffi --offline` et `cargo fmt --check -p aphrody-ffi`
  passent également dans l'état courant du checkout.
- L'export `bxc corpus` est maintenant synchronisé vers le RAG Aphrody par son
  API distante, avec génération, retrait des documents obsolètes et vecteurs
  requis ; le manifeste de reprise vit dans l'espace Aphrody sous `~/.aphrody`.
  Le flux n'écrit donc plus un index SQLite Shenron/local. La commande Rust
  `aphrody rag ingest-shenron` reste disponible pour les imports locaux et ses
  règles de compatibilité, mais n'est plus le consommateur par défaut du
  pipeline produit.
- La commande de traduction unifiée appelle maintenant le worker du site et
  celui-ci passe ses segments au crate Rust `aphrody-translate`; le daemon Google
  démarré depuis un checkout BXC a été retiré de ce flux. L'arbitrage et le dépôt
  des databooks restent des règles produit Shenron.
- Restent à migrer et qualifier : MCP et A2A (transport et stockage de tâches),
  OCR et revue, import/crawl BXC vers Aphrody Web Rust, orchestration infra, et
  médias/traduction manga. Réutiliser `aphrody-mcp`, `aphrody-a2a-server` /
  `aphrody-a2a-client`, `aphrody-ocr`, `aphrody-translate`, `aphrody-infra`,
  `aphrody-web` et Koharu ; ne pas recréer leurs moteurs dans Shenron.
- Les consumers Shenron doivent garder les types, les options/configurations
  et les contrats éditoriaux, appeler les propriétaires Aphrody par API/SDK ou
  binaire installé, et déplacer données opérationnelles et jobs vers l'espace
  Aphrody. La migration entière reste à prouver par contrat et exécution de bout
  en bout ; l'inventaire MCP/A2A, OCR, BXC/crawl et infra n'est pas terminé.
- La migration entière n'est pas validée : il reste à établir l'inventaire
  complet des consommateurs et propriétaires, les gates ABI/FFI depuis artefact
  construit, les vérifications Linux/Windows et les exécutions de bout en bout.

### Migration backend Shenron et fusion Koharu (2026-10-02)

- Embeddings : le transport direct E5 (sidecar `aphrody-shenron-embed`) est
  retiré ; `ai/embeddings.ts`, `ShenronEmbeddingsClient`, `rag-build`,
  `ingest-aphrody-rag`, `rag-status`, `rag-eval` et le RAG du bot passent par
  `POST /api/v1/shenron/embed`. `rag-embed-vectors` et `rag-resync-entites`
  délèguent l'ingestion à `/rag/ingest` + `/rag/sync/finish`. Le rerank reste
  sur le sidecar.
- A2A : la route `site/api/a2a` est un proxy vers `aphrody a2a serve`
  (`APHRODY_A2A_URL`), alias `tasks/get|list|cancel` → A2A 1.0. Le broker TS
  reste : il manque côté Rust un bind socket Unix, `.coord/messages.jsonl` /
  `tasks.json` et un flux SSE continu.
- Entraînement : `/train run|job` (bot, admin) lance `aphrody train run` sur
  les triples dbfr ; `aphrody train run` prend par défaut
  `workspaces/dbfr/training/triples.jsonl` avec `APHRODY_AGENT_DOMAIN=dbfr`.
  Le binaire installé doit être reconstruit avec `--features train`. Pas de LoRA
  sans rollouts/gold dbfr.
- Koharu → Shenron : `koharu-sdk` (koharu-library) piloté par
  `KoharuSdkClient` ; `pipeline koharu-submit` ; file `manga_candidates` +
  traductions publiées (SQLite du bot), API staff `/api/manga/candidates*`,
  publique `/api/manga/planche/:pageId/traduction`, commande `/scanlate` ;
  site : route `…/planche/[n]/traduction`, page staff `/wiki/manga/revue`,
  bouton « Traduction FR » du lecteur ; app : onglet Shenron de l'éditeur
  Koharu et `koharu_rpc_batch`. Clé de page commune `série:tome:planche`.
- Gates : bot 425/425, pipeline 268 pass / 2 échecs préexistants
  (`_rag-corpus-sources`), site tsc + tests manga/A2A, cargo check
  `aphrody --features train`, `aphrody-app`, `koharu-sdk`, test
  `dbfr_domain_defaults_triple_input`. Non prouvé : exécution réelle bout en
  bout (Koharu → bot → site), colonne Postgres de traduction absente,
  `editor-components.test.tsx` bloque.

### Inférence de production et entraînement Shenron (2026-10-02, suite)

- Service `aphrody-ai-http` (unité suivie `config/systemd/user/aphrody-ai-http.service`,
  secrets dans `~/.aphrody/private/shenron/ai-http.env`) actif sur 127.0.0.1:8789.
  `/llm/chat` démarre le daemon llama.cpp géré quand aucune URL n'est fixée
  (feature `managed-llama` d'aphrody-mcp), client poolé, une reprise sur
  connect/502/503/504, 504 sur timeout, `usage` relayé, repli Gemini Web via
  `APHRODY_SHENRON_LLM_FALLBACK=gemini-web`. Preuve live : réponse en 7,3 s à froid.
- Modèle de chat de cet hôte : `qwen3-4b-instruct-2507-q4km`. Le 30B-A3B ne se
  charge pas (WSL 21 Go RAM, non prêt après 10 min). Sans RAG le 4B hallucine.
- Bloquant : `llama-server` b11312 installé sans CUDA (aucun device, ~15 tok/s).
  Build CUDA (`~/.local/lib/aphrody/llama/b11312-cuda`, sm_89) interrompu par
  pression mémoire ; relancer avec `-j 2`.
- A2A : `aphrody a2a serve --unix --coord-dir --no-tcp` reprend le broker TS
  (module `legacy_broker`, 36 tests a2a-coord, preuve live socket 0666) ;
  `a2a-broker.ts` n'est plus qu'un lanceur.
- LoRA : base HF `Qwen3-4B-Instruct-2507` téléchargée ; générateur
  `pipeline/scripts/build-chat-rollouts.ts` (11 tests) ; gold 1091 requêtes ;
  aucun rollout encore produit (génération CPU arrêtée).
- Binaires release installés dans `~/.local/lib/aphrody/installed-20261002b`
  (`aphrody` koharu,rag,train,ocr,jobs ; `aphrody-mcp`), précédent conservé.

### Fine-tuning chat Shenron — premier cycle (2026-10-02)

- Professeur réseau : `build-chat-rollouts.ts --teacher antigravity`
  (`aphrody antigravity chat`, gemini-3-flash) ; 67 % d'acceptation sur essai,
  395 rollouts au moment de l'écriture, génération en cours. Gemini Web : session
  expirée (bootstrap 502).
- `aphrody train run --kind lora` prouvé de bout en bout sur GPU : chargement
  bf16 direct GPU (aphrody-py `lora.py`), conversion GGUF via
  `convert_lora_to_gguf.py` b11312. v1 : 320 exemples, 400 pas, loss 3,79 → 3,02,
  `runs/shenron-chat-v1/adapter.gguf`.
- Service : `APHRODY_SHENRON_CHAT_LORA` attache l'adaptateur au daemon géré
  (vérifié dans le spec). Désactivé en production : qualité non améliorée et
  4,9 tok/s sur CPU. Reste : build CUDA llama.cpp, dataset complet, rang LoRA
  plus élevé, évaluation sur le gold (1091 requêtes) avant promotion.

### Adaptateur Shenron v2 promu (2026-10-02)

- v2 : 1495 rollouts antigravity, rang 16 sur q/k/v/o/gate/up/down
  (`APHRODY_LORA_RANK`, `APHRODY_LORA_TARGETS` dans aphrody-py `lora.py`),
  1500 pas, loss 3,74 → ~1,6–2,0, `runs/shenron-chat-v2/adapter.gguf`.
- Évaluation `pipeline/scripts/eval-chat-gold.ts` (30 questions gold
  non vues, route live) : base 10 ancrées / 6 refus / 20 timeouts / 23,6 s ;
  v2 28 ancrées / 0 refus / 0 erreur / 7,3 s. Métrique lexicale indulgente :
  sans contexte RAG v2 hallucine encore (Piccolo). v2 actif en production
  (`APHRODY_SHENRON_CHAT_LORA`), toujours sur CPU tant que le build CUDA manque.

### A2A du bot vers Rust (2026-10-02)

- `apps/shenron/bot/src/api/a2a-proxy.ts` : carte, `/api/a2a/jsonrpc`,
  `/api/a2a/events` relayés vers `aphrody a2a serve` (`APHRODY_A2A_URL`),
  alias legacy → A2A 1.0, `tasks/update` → -32601, 502 si amont absent. Le
  hub A2A interne de `server.ts` (store `.coord`, SSE, cancel shell) est retiré.
  Bot : 426/426 (8 tests broker TS remplacés par 1 test lanceur + 8 tests proxy).
  La carte publiée est désormais celle du serveur Rust.

## Commandes de contrôle

```bash
bun run monorepo:layout
bun run monorepo:state --out /tmp/aphrody-state.json
bun run monorepo:clean                         # inventaire sans suppression
bun run monorepo:clean --apply
bun run infra:pipeline:sync
bun packages/infra/workspace/src/ops.ts pipeline plan
cargo metadata --locked --no-deps --format-version 1
cargo check --all-targets --locked
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

Toute validation doit nommer son périmètre et ses limites. Les anciens tests
Gemini et les catalogues historiques ne constituent pas l’état courant.

## 8. Coordination commune Claude / Codex / agy — demande active

- [~] Auditer et dédupliquer toutes les surfaces A2A sur le monorepo actuel.
- [x] Centraliser règles, mémoire et conversations par les propriétaires existants.
- [x] Configurer les trois agents pour travailler simultanément dans le même
  checkout et la même branche, avec attribution des fichiers et coordination.
- [x] Vérifier les launchers, imports de sessions et échanges réels ; distinguer
  configuration, dry-run et exécution concurrente prouvée.

Le sous-agent `a2a_audit` a terminé l’audit en lecture seule. Les formats natifs
Claude/Codex/agy ne sont pas interchangeables ; leur partage doit passer par
les adaptateurs de sessions canoniques et une mémoire commune.

### Catalogue SSH actif

45 tests SSH, check et clippy all-targets verrouillés réussis après remplacement
 de la découverte automatique du checkout frère Infra par le monorepo identifié
 via `Cargo.toml` et `crates/infra/ssh/Cargo.toml`. Overrides explicites conservés ;
 test de layout actuel et rejet des archives ajouté. Aucun accès SSH distant
 n’est établi par ces tests.

### Coordination commune : audit et première configuration

- Audit délégué terminé ; [résultats et reste à traiter](docs/migration/a2a-centralization-audit-2026-10-01.json).
- FAIT : registre A2A local, pairs retirés sans fallback public, Codex ajouté au
  runner, alias agycli et cwd commun. Contexte AGENTS et résumés `.coord/shared`
  injectés dans les prompts. CLAUDE.md et GEMINI.md pointent vers AGENTS.md.
- FAIT : service utilisateur `aphrody-agent-session-sync` actif, ingestion
  Claude/Codex/agy toutes les 30 secondes par le propriétaire session existant.
  Source de service suivie sous config/systemd/user ; données privées hors Git.
- 29 tests a2a-coord et clippy réussis. Provisioners Codex/agy corrigés vers
  config/ai/plugins/aphrody ; check CLI all-targets réussi (log /tmp/shared-cli-check.log).
- Rappel croisé, claims, garde de branche, brokers/proxies et simultanéité
  qualifiés ci-dessous. Projections d’enveloppes et endpoints legacy restent ouverts.

### Coordination commune : contexte vivant et claims

Rappel des trois propriétaires externes via aphrody-session, filtré sur le
workspace et publié atomiquement dans `.coord/shared/TRANSCRIPTS.md`. Le service
installé le renouvelle toutes les 30 secondes ; le launcher l’injecte. Claims
de sous-arbres via les verrous OS aphrody-proc, garde de branche et commande
`aphrody a2a invoke --peer <agent> --claim <famille> "tâche"` installées.
Le terminal réexporte le proxy OS ; l’entrée historique du broker Shenron
réexporte l’application. 32 tests coord, 37 session, 24 terminal et 8 broker
réussis ; clippy sans dépendances et check CLI all-targets réussis. Le clippy
avec dépendances échoue sur deux lints aphrody-config indépendants.

Rapport agy vérifié partiellement : source legacy absente, remote cible absent,
assets importés encore non suivis. 370 fichiers Shenron (3 253 903 477 octets)
préservés sous `~/.aphrody/private/shenron/home`, hashes source/copie égaux ;
copie source conservée et exclue de Git. Cela ne prouve pas les hashes du
checkout legacy supprimé, les pushes legacy ou les 21 Go annoncés.

Preuve native simultanée : Claude, Codex et agy lancés par le CLI installé,
claims distincts, exits 0 en 9,61 / 11,17 / 18,10 s. Chaque agent confirme
le cwd, main et les propriétaires des autres dans TRANSCRIPTS. Vérification
en lecture seule ; aucune édition de code concurrente n’est revendiquée.

Requalification live 2026-10-03 : le service de miroir `aphrody-agent-session-sync`
était activé mais arrêté ; relancé, il tourne sans redémarrage et a actualisé
87 fichiers du miroir privé. Il est configuré `--no-memory` : cela prouve
l'import dans le miroir, pas l'alimentation de la mémoire d'un profil.
`aphrody-agent-live` est également actif ; snapshot `.coord/shared/LIVE.json`
du 2026-10-03 02:18:18Z : 5 processus, 99 sessions du workspace, 37 enveloppes
A2A bornées, zéro problème de collecte. Les 32 enveloppes horodatées couvrent
le 2026-09-30 18:54Z au 2026-10-03 02:00Z. Les associations PID/session restent
heuristiques ; les échanges concurrents prouvés restent ceux du rapport daté
ci-dessus. Initialement arrêté, `aphrody-agent-domain-sync@aphrody` a été lancé
après lecture des instructions de ce profil. L'unité impose le workspace canonique
et le filtre n'ingère que les sessions dont les tours portent exclusivement le
marqueur `APHRODY_AGENT_DOMAIN=aphrody`. Elle reste active, sans redémarrage ;
l'état du miroir a 5 sources, le transcript profilé a été régénéré à 02:20:53Z.
Lecture SQLite strictement agrégée : 13 entrées mémoire sont associées à
`<repo>` (10 Claude, 3 Codex), aucun texte n'a été extrait.
Limites : cette observation clôt le flux profil Aphrody seulement ; les profils
dbfr/ie, les plateformes A2A publiques et l'attribution exacte PID/session
restent hors preuve.

### Enveloppes A2A : propriétaire des valeurs sortantes

OS réexporte EnvelopeKind depuis aphrody-a2a ; sa construction projette le
CoordEnvelope canonique. Les variantes de canal et leurs graphies appartiennent
au contrat. La projection entrante reste permissive pour préserver les aliases
type/subject et les champs historiques ; les identifiants OS env-* restent
compatibles. Tests de projection des cinq kinds et de lecture legacy réussis,
avec tests complets aphrody-a2a/a2a-coord et clippy scoped sans dépendances.
La projection TypeScript Shenron étendue reste à qualifier.

### Projection TypeScript A2A Shenron

Base CoordEnvelope et kinds générés depuis envelope_schema() du propriétaire
Rust par l’exemple export_coord_types. Shenron importe cette projection et
garde uniquement ses extensions produit et noms de transport legacy ouverts.
Génération reproductible byte-for-byte, typecheck TypeScript 7 du package,
oxlint des deux fichiers et clippy du générateur réussis. Les tests A2A ciblés
(24) et la suite pipeline complète passent ; aucun Cargo requis à l’exécution
TypeScript. Les endpoints publics et la sémantique de routage kernel restent
à qualifier ; cette étape ne ferme pas le plan global.

### Transports HTTP A2A du site et du bot dédupliqués — 2026-10-03

Le parseur JSON/NDJSON, la résolution URL, les erreurs 502, les requêtes JSON-RPC
et le transport SSE sont maintenant propriétaires de
`@shenron/pipeline/aphrody/a2a-transport`. Les adaptateurs site/bot conservent
leurs alias legacy distincts, le `no-store` du site et le streaming du bot.
Tests d'intégration par serveur loopback : bot 8/8 (24 assertions), site 7/7
(35 assertions). Typechecks pipeline et bot réussis ; Oxc sur les trois modules
et format des sources réussis. Le typecheck complet du site reste rouge sur deux
TS2559 dans `src/lib/service-health.ts`, fichier modifié par le travail
parallèle et hors de ce lot. Le runtime public, la migration des autres surfaces
et le broker mémoire conservé pour le dashboard ne sont pas clos par ce
déplacement : l'audit global reste partiel.

### Routage A2A kernel vers les pairs enregistrés

`a2a/message/send` sélectionne le propriétaire enregistré du tool par target ;
le handle retenu protège la sélection contre les changements concurrents du
registre. Les aliases kernel/aphrody-kernel et la cible omise conservent le
dispatch général. Cible inconnue, incorrecte, vide ou non-string rejetée avant
appel ; droits de session et policy conservés. Test IPC d’un pair distant
bun_scraper et test de rejet sans effet de bord réussis dans la suite kernel
(79 pass, 1 GCS live ignoré). Clippy scoped all-targets réussi ; avertissement
Cargo future-incompatibility existant sur proc-macro-error2 2.0.1.
Cette qualification couvre les pairs enregistrés via IPC, pas les endpoints
HTTP publics ni les agents qui ne sont pas enregistrés au kernel.

### Calculs RAG Python raccordés au cœur

Binding Rust : cosine et RRF délégués à aphrody-rag-core ; top-k conserve
validation/mapping des IDs et utilise cosine canonique. Python ne calcule plus
ces opérations ; noms py_* conservés comme aliases, extension manquante explicite.
RRF utilise 1/(k+rank+1), égalités déterministes et doublons selon le cœur.
52 tests rag-core, 30 tests adaptation/packaging réussis ; clippy native scoped
réussi. Cas vides, k=0, doublons, égalités et vecteurs invalides vérifiés via
l’extension compilée. Artefact Python contient les bytes fusion canoniques
et le wrapper avec glue de module ; hashes/provenance vérifiés. Wheel et
sdist construits hors workspace puis installés dans des environnements isolés
avec smoke RRF corrigé. Rapport de qualification suivi sous docs/migration ;
qualification effectuée en mode worktree explicite. Pas de publication externe.

### Gates AI et état live demandé

Configuration : deux lints corrigés, 106 tests et clippy all-targets avec
dépendances réussis. Models : 118 tests réussis, lints lib/test corrigés.
Agent Home : 104 unit tests réussis ; trois tests d’intégration échouent sur
profils privés et chemin crates/home/shenron inexistant. Ne pas traiter ce
gate comme vert. Clippy du contexte partagé révèle ensuite cinq lints memory.
RAPTOR conserve des calculs NumPy float64 par lots : audit restant suivi,
propriétaire unique global RAG non déclaré complet.

Demande active : état live via Aphrody OS/kernel et Infra/Workspace reliant
IDs/PIDs agents Claude/Codex/agy/modèles locaux, sessions, actions, mémoire,
A2A, branche/HEAD/commits et propriétaires crates Rust/packages Bun. Réutiliser
probe_live_processes, adaptateurs external session, catalogue Workspace et
inspection Git kernel. Identifier séparément observation exacte et corrélation
heuristique ; aucun changement Git ne doit être attribué sans preuve.

### Profils isolés et Docs DBFR — qualification installée

- FAIT : CLI et MCP installés routent les sessions et la mémoire vers les
  profils `aphrody`, `dbfr` et `ie`. Le miroir global ne nourrit plus la mémoire.
  Les trois services de domaine sont actifs ; Codex, Claude et agy ont chacun
  répondu au smoke natif dans leur profil. Le MCP conserve ses 159 outils.
- FAIT : sept Docs DBFR lus via le MCP Google Drive et convertis en Markdown
  Agent Home/OpenClaw/A2A dans le store privé. Personnalité Shenron, logique,
  contexte, rôles et liens conservés ; revue indépendante, hashes et chargeur
  Rust réel vérifiés. Neuf tests Google réussis. Synchronisation documentaire
  en lecture seule active ; ancien service système concurrent désactivé.
- FAIT : références CLI (71 commandes présentes) et TOOLS canoniques mises
  à jour ; setup Infra et outils natifs qualifiés dans leurs rapports.
- INCOMPLET : sauvegarde entraînement Drive en cours, 33/35 artefacts et
  1 197 217 839 octets vérifiés à cette observation. Aucun nouvel entraînement
  ou appel d’inférence locale n’est revendiqué. Clippy CLI/MCP avec dépendances
  et intégrations Agent Home restent en correction ; gates produit ouverts.
- Preuves : [runtime domaines](docs/operations/workspace/HISTORY.md),
  [Docs DBFR](docs/operations/workspace/HISTORY.md),
  [sauvegarde modèles](docs/operations/workspace/HISTORY.md).

### RAPTOR euclidien et gates Agent Home — 2026-10-01

- FAIT : moyennes et distances carrées du raffinement AHC appartiennent à
  `rag-core`. Les adaptateurs Python préservent float32 UMAP et float64 ; tri,
  argmin, arrêt avant remappage et itérations restent dans la politique Python.
  Noyau direct sans tableau N×K×D ; réduction compatible avec les cas NumPy
  vérifiés. Le contre-exemple seed37 qui change un label par promotion passe.
- Gates : neuf tests de noyaux, Clippy Rust ciblé, 59 tests consommateur installé
  et 15 tests packaging réussis. Wheel et sdist construits depuis la révision
  Rust 2153ec6f ; reconstruction isolée réussie et extension identique.
  Les wheels complets diffèrent par timestamp/UUID du SBOM et RECORD associé.
- INCOMPLET : budget performance ouvert (float32 2,45× plus lent, float64
  0,64× le temps NumPy sur 256×32×97, médiane sept runs). Le reste des calculs
  et des consommateurs RAG reste à qualifier ; aucune clôture globale.
- FAIT : intégrations Agent Home hermétiques, 104 unitaires + trois intégrations
  + un doctest et Clippy ciblé réussis ; ancien gate profils privés corrigé.
- Preuves : [RAPTOR euclidien](docs/operations/workspace/HISTORY.md),
  [Agent Home](docs/operations/workspace/HISTORY.md).

### Règles Shenron et optimisation euclidienne — 2026-10-01

- FAIT : les trois fichiers `slug`, `wiki-slugs`, `databooks-defauts` sont
  exportés comme modules purs de `@shenron/config`. Les deux scripts RAG du
  pipeline importent ce package ; les anciens chemins du site réexportent
  les 32 valeurs/fonctions canoniques, vérifiées identiques, sans copie de calcul.
  44 tests config, 250 tests pipeline (quatre ignorés), 26 tests règles du site
  avant/après, typechecks config/pipeline et deux bundles scripts réussis.
- Limite : qualification sur worktree concurrent ; correction préexistante
  dans config/databooks-defauts préservée hors de ces commits. Autres règles
  et registres et qualification depuis clone propre restent ouverts.
- FAIT : réduction euclidienne monomorphisée, arithmétique inchangée ; 74 tests
  wheel installé/packaging, neuf tests noyaux et Clippy ciblé réussis.
  Révision Rust 812c3b0f et pin Python 9e6a827 ; sdist reconstruit hors dépôt.
  Mesure release alternée 41 samples : float32 1,154→0,306 ms et float64
  0,704→0,317 ms pour 256×32×97 ; résultats identiques bit à bit à NumPy.
- INCOMPLET : cette mesure ne qualifie pas le budget global, les autres formes
  ni les produits matriciels. Le gate CLI/MCP avec dépendances progresse.
- Preuves : [règles canoniques](docs/operations/workspace/HISTORY.md),
  [optimisation euclidienne](docs/operations/workspace/HISTORY.md).

### Chargeur natif partagé et gates transitifs — 2026-10-01

- FAIT : adaptateur Bun Shenron délègue au chargeur `@aphrody/bun`, avec
  import différé, reprise, handle partagé et close/reload communs. L’alias
  SHENRON_FFI_LIB est résolu par le propriétaire ; overrides contradictoires
  rejetés. Dépendance workspace et son seul hunk bun.lock enregistrés.
- Gates : quatre tests chargeur/17 assertions, deux typechecks, Oxc et format
  réussis. INCOMPLET : deux des six tests consommateur échouent sur doctor et
  authStatus ; ces défauts sont reproduits avec l’ancien adaptateur sur le
  même artefact Linux de développement. Aucun gate release ABI n’est établi.
- FAIT : RAG, prompts, context, LLM infra et secrets passent Clippy ciblé strict
  et 116 tests/doctests cumulés. Le contrat insert_chunk neuf arguments est
  préservé avec une exception de compatibilité localisée et documentée.
- INCOMPLET : gate CLI/MCP all-targets no-default arrêté sur trois lints du
  compilateur Discord ajouté concurremment, propriétaire informé ; ses sources
  sont préservées. Le déplacement persona FFI vers le profil DBFR est en cours.
- Preuves : [chargeur](docs/operations/workspace/HISTORY.md),
  [gates transitifs](docs/operations/workspace/HISTORY.md).

### Ingestion RAG commune et gates AI — 2026-10-01

- FAIT : l’indexeur général et Shenron remplacent métadonnées/chunks via la
  même transaction du store RAG. Échec d’insertion : métadonnées, FTS et
  vecteurs précédents conservés, puis reprise réussie. Remplacement vide et
  identifiant d’upsert après une autre insertion couverts par régressions.
- FAIT : six propriétaires AI/A2A passent Clippy strict all-targets avec
  dépendances. 159 tests/doctests uniques réussis : RAG 52, skills 35,
  A2A 38, OAuth 17, train 8, supervisor 8 + un doctest. Contrats HTTP A2A
  vérifiés sur auth, CRUD, isolation des namespaces, filtres et enveloppes.
- INCOMPLET : gate CLI/MCP no-default échoue encore sur trois diagnostics
  Discord et neuf terminal-backend. Features de production, clone propre,
  artefacts installés et gates produit ouverts. Embeddings générés après la
  transaction ; leur génération complète n’est pas atomique avec les chunks.
- Preuves : [rapport et logs](docs/operations/workspace/HISTORY.md).
  Checkout concurrent ; aucun remote Git configuré, commits locaux seulement.

### Gateway / Firefly et gate CLI/MCP — 2026-10-01

- FAIT : boucles de lignes SSE et gardes cache/CORS/options simplifiées sans
  changer leurs conditions ni les arrêts sur fin/erreur. Clippy strict avec
  dépendances et all-targets réussi ; 51 tests Firefly, 39 tests Gateway et
  un doctest réussis, aucun échec ni test ignoré. Format et diff contrôlés.
- INCOMPLET : gate CLI/MCP no-default terminé en échec sur cinq diagnostics
  NotebookLM, un terminal et deux Web crawl. Le miroir Web porte des changements
  concurrents préservés ; aucun gate intégré vert n’est établi.
- Qualification Linux depuis le worktree, dans un target temporaire pour éviter
  le verrou d’une compilation concurrente ; sccache conservé. Clone propre,
  providers live, plateformes et features produit restent ouverts.
- Preuves : [rapport et logs](docs/operations/workspace/HISTORY.md).

### NotebookLM et progression du gate CLI/MCP — 2026-10-01

- FAIT : gardes de disponibilité d’artefact et de décodage Boq simplifiées,
  listes rustdoc et assertion des discriminants corrigées. Valeurs des payloads
  RPC préservées lors du formatage. Clippy strict all-targets avec dépendances,
  format et diff réussis ; 27 tests et un doctest réussis, aucun ignoré.
- Fixtures Boq : forme encodée, payloads récupérés, enveloppes étrangères et
  données tronquées vérifiés. Les tests de surface publique ne lancent pas le CLI.
  Aucun appel Google live ni qualification de polling distant n’est établi.
- INCOMPLET : gate CLI/MCP no-default désormais arrêté sur un diagnostic terminal
  et deux du miroir Web. Famille terminal déléguée et miroir concurrent préservés.
  Features produit, clone propre, plateformes et artefacts installés restent ouverts.
- Preuves : [rapport et logs](docs/operations/workspace/HISTORY.md).

### Navigation documentaire AI et périmètre réel — 2026-10-01

- FAIT : README produit et index AI renvoient aux workspaces et au plan racine ;
  les guides importés gardent leur périmètre. Retrait de l’opt-out sccache du
  guide de démarrage et des commandes d’orchestration importées non qualifiées.
- Contrôle direct via le parseur Infra existant : 32 destinations cassées avant,
  zéro après sur 65 liens locaux. Existence des fichiers/dossiers vérifiée ;
  ancres, sites externes et vérité des pages liées ne sont pas qualifiés.
- Index importé préservé octet pour octet dans
  [son snapshot](docs/migration/ai-documentation-index-before-monorepo-2026-10-01.md) ;
  base historique `docs/products/ai/_source/` et hash consignés.
- INCOMPLET : le vérificateur global exclut désormais `docs/products` et
  `_source`, entre autres catégories. Ses 5 870 documents inventoriés, 751 liens
  examinés et 95 destinations non résolues ne couvrent pas ces pages ; la baisse
  par rapport aux anciens inventaires ne prouve pas une réparation globale.
  Aucune exclusion générale ajoutée dans ce lot. Classement global toujours ouvert.
- Gate CLI/MCP revalidé : mêmes trois diagnostics terminal/Web ; modifications
  concurrentes préservées. Diff documentaire contrôlé ; aucun test propriétaire
  répété pour ce lot sans changement de code.
- Preuves : [audit direct, hashes et périmètres](docs/operations/workspace/HISTORY.md).

### Audit Cargo par domaine — 2026-10-01

- FAIT : `cargo metadata --locked --no-deps`, 181 packages, dépendances hors dev.
  `contracts`, `native` et `compat` restent purs : une seule arête inter-domaine
  (`aphrody-bun-docs` → `aphrody-subsystem`).
- Cycles de domaines : `os` ↔ `shell` (kernel→shell optionnel,
  terminal-backend→a2a-coord, nu→kernel-client) ; `ai` ↔ `web`
  (`aphrody-web-bridge` → `aphrody-translate`). Inversions : `aphrody-ffi` →
  `aphrody` (apps/cli) et `aphrody-yolo` (infra) → kernel-client.
- FAIT Bun : 83 packages résolus (l’en-tête en annonce 84, écart à expliquer),
  aucun package → app, aucun cycle ; arêtes `apps` → `packages` uniquement.
- INCOMPLET : dépendances dev/par cible et résolution par features
  non audités ; aucune arête corrigée, aucun build ni test exécuté.
- Classement : `aphrody-ffi` → `aphrody` est intentionnel (un seul appel,
  `aphrody::run_async`, `crates/interop/ffi/src/lib.rs:987`) ; il se résout par
  l’extraction des capacités du CLI déjà listée en section Interop, pas isolément.
- Preuves : [audit](docs/migration/cargo-domain-audit-2026-10-01.json).

### Triage des 647 références non classées — 2026-10-01

- FAIT : chaque référence du rôle `unclassified` du rapport de revue est classée
  par heuristique de nom et d’existence de fichier (aucun document modifié) :
  229 sans propriétaire identifié, 150 candidates de déplacement (au plus trois
  fichiers suivis du même nom), 92 routes de site qui existent avec `.md`/`.mdx`
  (guide Discord importé, donc non défectueuses), 86 assets ou licences non
  importés, 46 routes/externes, 44 chemins de dépôts frères d’avant le monorepo.
  Somme : 647.
- INCOMPLET : les classes sont des heuristiques, pas des défauts confirmés. Les
  150 candidates et les 229 sans propriétaire demandent une vérification manuelle
  contre la source pinnée avant correction ; aucun lien n’est réparé ici.
- Preuves : [triage](docs/migration/document-links-unclassified-triage-2026-10-01.json).

### Inventaire des références de scripts — 2026-10-01

- FAIT : 849 fichiers suivis sous `scripts/` ; recherche de leur chemin relatif
  complet dans les fichiers suivis hors `upstream/` et `docs/migration/`.
  741 n’ont aucune référence par chemin complet (dont `scripts/tools` 463/483,
  `scripts/build` 96/97, `scripts/audit` 82/94, `scripts/migration` 17/17,
  `scripts/dev` 12/12).
- INCOMPLET : la méthode ne voit ni les chemins relatifs au dossier courant
  (`bun ./build/x.ts` dans un `package.json` de sous-dossier), ni l’invocation
  par nom de base ou dynamique. Ces 741 sont des candidats, pas des scripts
  inutilisés ; rien n’est supprimé. Un second passage par nom de base dans les manifests et
  `pipeline.json` ramène les candidats de 741 à 688. Reste : comparer aux commandes déclarées du
  pipeline (`config/pipeline.json`) et aux `scripts` des manifests.
- Preuves : [inventaire](docs/migration/scripts-reference-inventory-2026-10-01.json).

### Effets d’import M3 Design et frontière `use client` — 2026-10-01

- FAIT : `packages/ui/m3-design/src/index.ts` n’exporte que types, parser, hct,
  prompts, generator et handlers ; le serveur et `process.exit` vivent dans
  `src/server.ts`, lancé explicitement. `import("./src/index.ts")` sous Bun
  réussit sans serveur ni sortie (10 exports). Aucun correctif nécessaire : le
  critère était déjà satisfait ; `node.ts` n’est importé que par un test.
- Analyse statique des 73 fichiers `use client` de `packages/ui` suivis par leurs
  imports relatifs : aucun import de `bun:*`, `bun` ou `@aphrody/native`.
  Seules `m3-config/tsup.ts` et `m3-next-migrate/src/scanner.ts` (outillage) et
  des tests importent `node:fs`.
- INCOMPLET : imports de packages nus non suivis ; aucun build navigateur,
  SSR/hydratation ni typecheck exécuté. La séparation SVG natif/React reste ouverte.

### Constat `render-tools` — 2026-10-01

- CONSTAT : `crates/ui/render-tools` (crate `aphrody-render3d`, binaire
  `aphrody-render3d-mcp`) est supprimé dans l’index Git (`D `) et absent du
  working tree, comme `crates/ui/model-view`. Le lot de dédup UI/web l’avait
  conservé (`docs/migration/stack-dedup/render-merge.json`) ; l’auteur de la
  suppression n’est pas établi (`.coord/shared/LIVE.md` ne l’établit pas).
- Liens actifs vers ce chemin, donc cassés tant que la suppression tient :
  `docs/architecture/ui/README.md:25-26`, `docs/ecosystem/ECOSYSTEM.md:125`,
  `crates/ui/render/README.md:39`. Seuls les symboles `bun_rs_render3d_png` de
  `aphrody-bun` subsistent ; aucun autre propriétaire des outils `render3d_*`.
- Rien restauré ni modifié : identité publique `aphrody-render3d` à décider.

### Gate CLI/MCP revérifié — 2026-10-01

- CONSTAT : `cargo clippy -p aphrody -p aphrody-mcp --all-targets --locked
  --no-default-features -- -D warnings` ne bute plus sur `web-crawl`
  (`wiki_page.rs` existe désormais). Il échoue sur six diagnostics de
  `crates/web/web-frames` : import `BufRead` inutilisé (`media.rs:4`),
  deux `div_ceil` manuels (`descriptor.rs:49-50`), un `if` réductible
  (`index.rs:82`), deux `Ok(…?)` inutiles (`service.rs:76-77`).
- INCOMPLET : crate non suivie sous claim actif `frames-rust-owner` (codex) ;
  aucun correctif appliqué par ce lot. Les diagnostics en aval du premier
  échec ne sont pas connus.

### Couverture documentaire explicite restaurée — 2026-10-01

- FAIT : le vérificateur Infra n’exclut plus implicitement catégories, chemins
  ou dates. Seuls les fichiers demandés par `--exclude-file` sont exclus ;
  `scanned` conserve l’inventaire, `checked` et `checkedFiles` prouvent le périmètre.
- Régression reproduite : deux tests existants échouaient car `docs/migration`
  était ignoré. Désormais 115 tests Infra réussis, un natif ignoré, aucun échec ;
  produit, référence, recherche, snapshot, upstream et index `_source` couverts.
  TypeScript 7.0.2, Oxc strict, format et diff réussis. Narrowing de l’option
  `rg inventory --out` corrigé sans changer son comportement.
- INCOMPLET : scan complet (deux snapshots exclus explicitement), 5 870 documents
  inventoriés, 5 868 vérifiés, 11 236 liens locaux, 2 719 destinations non résolues.
  Ce total inclut routes importées, chemins historiques, assets et licences ;
  il ne mesure pas les défauts actifs confirmés. Le classement reste ouvert.
  Les deux pages de navigation AI sont maintenant couvertes, sans défaut de cible.
- Les ancres et sites externes ne sont pas vérifiés. Documents de packages/apps
  hors `docs` non inventoriés. Aucune preuve historique réécrite.
- Preuves : [rapport, tests et inventaire exhaustif](docs/operations/workspace/HISTORY.md).

### Script `test` de `@rosegriffon/discord-sync` — 2026-10-01

- FAIT : ajout de `"test": "bun test"` ; deux fichiers de test existaient sans
  script. `bun run test` : 2 tests réussis, 0 échec.
- Contrôle de manifests (git ls-files, hors typecheck) : quatre autres packages
  avec sources TypeScript sans `tsconfig.json` (`ai/google`, `rg/assets`,
  `rg/config`, `ui/eslint-plugin-m3`). INCOMPLET : aucun typecheck ajouté sans
  vérifier qu’il passe ; le total « 69 packages » du pipeline utilise d’autres
  critères et n’est pas réconcilié ici.

### Artefact natif réel et routage doctor Shenron — 2026-10-01

- Requalification des contrats de résolution/manifestes au HEAD courant
  (sources du chargeur inchangées depuis le clone qualifié) : `bun test
  --isolate packages/interop/native/test-library.test.ts
  packages/interop/native/test-native-artifact.test.ts
  packages/shenron/pipeline/test/aphrody/native-contract.test.ts
  packages/shenron/pipeline/test/aphrody/native.test.ts` : 10 réussis, 6
  ignorés, aucun échec. Les 6 tests qui exigent un artefact installé sont
  ignorés faute d'artefact dans le checkout courant ; le smoke réel release
  reste prouvé par le clone propre décrit ci-dessous.

- FAIT : la FFI Shenron ajoute déjà son namespace. L’adaptateur n’envoie plus
  `shenron doctor` à cette ABI, mais `doctor --json` ; l’erreur de sous-commande
  dupliquée reproduite sur l’artefact construit est corrigée. AuthStatus passe.
- FAIT : builds Linux debug et release+gpu réussis ; six tests consommateur
  passent sur chacun. Persona comparée octet pour octet à une fixture DBFR
  complète ; aucun ancien mot fixe imposé au SOUL configuré. Quatorze tests
  chargeur passent, quatre comparatifs de forks ignorés ; smokes ABI et CLI passent.
- Qualification explicite : `APHRODY_FFI_REQUIRE_NATIVE=1` échoue si la librairie
  manque ; sans ce mode, cinq tests sont déclarés ignorés. Les imports du package
  isolé et l’isolation de l’alias SHENRON_FFI_LIB dans les fixtures sont corrigés.
- Requalification packaging 2026-10-03 : clone propre du commit
  `7d927b1fa82213df38d68f2dd9bad4433eb116ef`, métadonnées Cargo `--locked`, puis
  staging canonique `bun-native --gpu` depuis ce clone. Build release réussi ; le
  smoke du consommateur isolé passe avec le mode développement activé puis désactivé.
  Manifeste `@aphrody/bun` : ABI 1/4/1/1/1/2/1, `features: ["gpu"]`,
  `consumerSmoke: passed`, artefact Linux x86_64 de 264 255 704 octets,
  SHA-256 `4fdc85087208baf2005130193adcc945734431190837c6ca499e9205b718bd79`,
  empreinte Cargo.lock `879c5bddc4e34da10f94679769ae3a988b75806f74ec4879b80d7b7428564dd3`.
- Gates : deux typechecks, Oxc strict, format et diff réussis. Suite pipeline :
  230 pass, quatre ignorés, un échec live MediaWiki (HTTP 403 terraria.wiki.gg).
- Le staging a exercé la copie vers une installation temporaire isolée
  `node_modules/@aphrody/bun`, sans cible Cargo exploitable ni override de
  bibliothèque ; le smoke release réussit aussi avec `APHRODY_FFI_DEV=0`.
  Cela qualifie l'installation temporaire Linux x86_64 GNU depuis ce clone,
  pas une distribution durable ni son activation dans un service.
- INCOMPLET : autres plateformes non qualifiées. Features GPU compilées sans preuve
  d’exécution matérielle GPU.
  Doctor dégradé et recherche éventuellement vide ne prouvent pas un produit prêt.
  Gate CLI/MCP terminal/Web Frames encore ouvert ; aucun gate global vert annoncé.
- Preuves : [rapport, hashes binaires et logs](docs/operations/workspace/HISTORY.md).

- 2026-10-01: isolate workspace operation loading through lazy imports and add private IECODE package archive preparation with allowlists, checksums and dirty-source provenance. Five dispatcher/packaging tests pass (26 assertions); staged whitespace check passes. External IECODE workspace memberships and consumer installation migration remain pending.

- 2026-10-01: consumed IECODE packages as revision-qualified local archives from the pinned sibling checkout, without registry publication or external workspace membership. Removed migrated RG source copies; catalog and overrides keep producer versions separate. A clean source snapshot resolves 2,906 packages, installs with a frozen generated lockfile, resolves Inagle Zod 3.25.76 and RG Zod 4.6.5 independently, and executes Inagle --help. Six packaging/dispatcher tests pass (29 assertions); checks reject missing archive entrypoints, dirty or mismatched source revisions. Release assembly and CI checkout/preparation integration remain pending.

- 2026-10-01: wired RG CI to the pinned sibling checkout/private archive preparation and configured its checkout credential. Release assembly now selects the monorepo paths, prepares a detached producer snapshot without modifying the developer checkout, builds Discord Kit before the bot, and includes producer provenance in release.json. Ranked uses the existing RG SQL owner and explicit achillea schema instead of an absent legacy config/retired database. Nine packaging/build tests pass (31 assertions); 1,264 bot tests pass (3,738 assertions) with local fixture environment values. On the clean consumer snapshot, Discord Kit, the standalone bot and API/ranked bundles build. Website compilation passes (7.1s) after adding producer TypeScript packages to transpilePackages and removing the conflicting server external; page collection fails without DATABASE_URL. Full production assembly, activation and live service behavior remain unverified. actionlint, scoped whitespace and Bash syntax pass.

- 2026-10-01: removed RG bot TypeScript package aliases that still targeted the pre-migration ../../packages layout; retained only the application-local @/* alias and resolved shared libraries through package exports. On the clean installed snapshot, compiler resolution confirms RG assets/db/types and the pinned IECODE Inagle/Azalee archives. Scoped Oxc formatting and whitespace checks pass. Bot typechecking remains at 211 errors before and after this configuration cleanup; missing ranked authentication/dependencies and existing API type errors remain open. No production readiness claimed.

- 2026-10-01: reconnected ranked authentication to @rosegriffon/achillea-core/auth instead of the missing @/auth module. Session and realtime verification share the existing portable Web Crypto owner with distinct purpose/audience checks; HTTP handlers and all three Colyseus rooms await verification. Server-signer/transport tests cover cookie, bearer, context/options precedence, expiry, tampering, malformed claims and missing secrets. Clean installed snapshot: 1,483 core/bot tests pass (5,787 assertions), core typechecking passes, scoped Oxc and formatting pass. Bot typechecking improves from 211 to 210 errors; missing ranked direct dependencies remain the next integration gate. Cookie adapter uses the documented Bun CookieMap contract (https://bun.sh/docs/runtime/cookies); audience/expiry handling follows RFC 7519 sections 4.1.3-4.1.4. No live authentication or production activation claimed.

- 2026-10-01: restored ranked direct dependencies through the root Bun catalog: @colyseus/core 0.17, Bun WebSockets 0.17, schema 4, Express 5 and the compatible http-proxy-middleware 3 API. Consumers import the core directly rather than the umbrella package and follow the 0.17 Room state/onLeave contract (https://docs.colyseus.io/migrating/0.17). Generated bun.lock passes frozen installation (2,950 packages); Discord Kit builds before bot typechecking. Clean installed snapshot: bot typechecking passes (previously 210 errors), 1,485 core/bot tests pass (5,793 assertions). Completed/canceled admin resolutions explicitly report applied=false, with isolated-process regressions; CDN response fixtures now declare their tested JSON contracts. Ranked bundles 771 modules with all dependencies included and starts on an ephemeral loopback port: health=200/ok, anonymous challenge=401. Scoped Oxc/format/whitespace gates pass. Concurrent desktop script edits are excluded from this batch. RG SQL persistence, clean pipeline dependency-build ordering and full website/CI/deployment gates remain unverified.

- 2026-10-01: added shared Bun dependency artifact preparation from active workspace manifests and workspace: edges. RG prepare/check/pipeline and VPS assembly use this owner; file archives remain outside the consumer source graph. Builds run in dependency order, reject artifact cycles/missing build scripts and stop on failure; dependent gates cannot consume stale output after a failed build. Nine dependency/RG contract tests pass (17 assertions), scoped strict TypeScript/Oxc/format and Bash syntax pass; decision links pass (56 repository links). On the clean installed snapshot with Discord Kit/Patreon dist output removed, the owning RG bot typecheck command rebuilds its required Kit exports and passes. Full RG preparation selects exactly Kit and Patreon. Website, SQL and complete pipeline/deployment qualification remain open.

- 2026-10-01: repaired cron navigation response and Bun websocket type imports, and decoded binary CDP views through an exact-span non-shared byte copy. Clean installed snapshot cron typechecking passes; five isolated CDP wire regressions pass (15 assertions), covering text, buffers, bounded typed/DataView and shared views. CDP Oxc/format and scoped whitespace pass. Cron lint still reports six pre-existing unused declarations and fourteen warnings; full pipeline remains unqualified. GitHub inventory finds 34 accessible private aphrody-labs repositories; 33 inspected default heads/trees are distinct, separately owned aphrody-ui excluded. Whole-tree uniqueness does not prove component deduplication; local ownership documentation claims deletions not yet confirmed by the live inventory. Private inventory evidence retained outside source.

- 2026-10-01: rejected obsolete per-request scraping browser profiles before contacting the single shared CDP endpoint. The existing failing CI request-routing regression now passes: 52 scrape tests, 163 assertions; clean snapshot cron typechecking and scoped Oxc/format/whitespace pass. Retired aphrody-labs/iecode-cpp and aphrody-labs/fut after comparing current remote refs against full verified bundles; all bundle/metadata SHA-256 checks and complete-history bundle verification pass locally and on dbfr. No active workspace manifest/workflow references either former repository. GitHub deletion confirmed by HTTP 404. Histories and unmatched contents are preserved privately on both hosts. aphrody-os secondary bundle transfer remains in progress; no deletion or complete organization deduplication claimed. The published ownership document is being edited concurrently and was excluded.

- 2026-10-01: restored the RG navigation route inventory to the moved apps/rg/website source and typed the existing anchor click handler explicitly. Clean installed snapshot: all 39 app-shell tests pass (169 assertions), app-shell typechecking passes; scoped Oxc/whitespace pass. Full cron suite also passes after the preceding profile fix: 172 pass, one explicitly skipped live CDP integration, 524 assertions. Other website/configuration/production gates remain open.

- 2026-10-01: gave @rosegriffon/config its own strict no-emit project for the exported Tailwind constants, rather than treating a consumer Next preset as the package project. Removed four shared aliases that pointed Inagle/Inagle Cross to retired RG source copies; producer archives resolve through package exports. Clean installed snapshot config, cron and app-shell typechecks pass; scoped JSON format/whitespace pass. No duplicated producer source, additional React dependency or alternate backend added.

- 2026-10-01: completed the aphrody-os secondary backup through the owning aphrody-ssh native SFTP upload after infra_sync rejected the missing rclone dbfr configuration. All 12 backup-file SHA-256 checks pass on both hosts; complete-history bundle verification preserves every current branch/tag ref. Live issue/release inventory is empty. Retired aphrody-labs/aphrody-os and confirmed HTTP 404; unique source variants remain in verified private backups. Three redundant repositories are removed in this batch; organization-wide consolidation remains open. No action against the separately owned aphrody-ui repository.

- 2026-10-01: qualified 63 remaining raw ranked table references with achillea inside the shared RG database, and scoped stale-lobby cleanup to RANKED events so tournaments/disputes survive. Added the owning RG telemetry migration (idempotence rehearsed twice), passed JSON objects directly to Bun.SQL to avoid storing a JSON string (https://bun.com/docs/runtime/sql#inserting-data), and normalized numeric API IDs from PostgreSQL int8 strings with an exact safe-integer guard. A disposable loopback PostgreSQL 18 fixture uses the canonical lobby/telemetry migrations and public shadow tables: four integration tests pass (19 assertions), covering persistence/finalization retry, namespace isolation, telemetry object round-trip, oversized ID refusal and cleanup boundaries. Fixture stopped cleanly; no shared cluster or production schema mutated. Clean installed snapshot bot typechecking passes; new-file Oxc/format and scoped whitespace pass. Broader bot/core run: 1,563 pass, six skips, 20 failures (5,973 assertions); live SQL/API tests fail against the intentionally unavailable loopback fixture URL and remain unqualified. Earlier smaller-suite green results do not establish this broader gate. Production migration/SQL behavior, website/CI and complete organization consolidation remain open.

- 2026-10-01: separately checked the new PostgreSQL integration test with a scoped strict project because the bot default project includes src only. Added explicit row-result types for the two fixture projections; the test project now typechecks without weakening compiler settings. New-file Oxc/format and whitespace pass; changes are type-only and do not alter the already verified PostgreSQL runtime assertions.

- 2026-10-02: resolved the RG search regression through the existing @rosegriffon/app-shell export instead of a retired relative package path. Declared the root-owned Happy DOM preload dependency and React declaration packages through existing catalog entries; generated bun.lock preserves the package-version set. Removed experimental.viewTransition, absent from the installed Next 16.3.5 configuration contract. Clean source snapshot: frozen install checks 2,558 installations across 2,950 packages; search regression passes (one test, nine assertions), scoped Oxc/format and Bun workspace contract pass (82 manifests). Owning RG typecheck rebuilds Patreon before the website and reduces 44 errors to six; remaining Zukan ownership, Better Auth request/response, GLTF inference and Stripe API-version conflicts are not hidden. No full website/CI/deployment success claimed. Concurrent UI changes and RG config changes are excluded.

- 2026-10-02: consumed published IECODE 92e027f647744ba20be55a18b992400131ad2eca through the existing release preparation owner, updating source pin, all three catalog/override archives and Bun-generated lock together. RG imports the Inagle Zukan catalog export, preserves all 5,407 records by SHA-256 and handles missing nicknames; removed the silent empty-catalog fallback and duplicated consumer shape. Root Three declarations restore third-party GLTF type resolution without casts or scene changes. Better Auth 1.7.6 receives the linked local account ID from a session-user-filtered projection and explicit TOTP setup checks its discriminated response. Stripe SDK 22.6.2 pins the matching 2026-08-26.dahlia monthly API contract (https://docs.stripe.com/upgrades); no Dashboard/webhook destination changed. Clean installed snapshot: frozen install passes (2,950 packages/2,558 installations), complete website typechecking passes, all 402 website tests pass (2,649 assertions), producer export bytes match canonical hash; tests using in-memory fallback do not establish live SQL delivery. Five producer packaging tests pass (25 assertions), Bun contract passes (82 manifests), scoped formatting and whitespace pass. Scoped Oxc exits zero with existing warnings. Full CI, authenticated live behavior, production SQL/build/deployment and single scraper-owner consolidation remain pending.

- 2026-10-02: reconciled the final Infra handoff with the published IECODE/RG source pin and ranked/catalog batches. GitHub ownership guidance now requires the sole verified WSL backup, records removal of the earlier Windows copy and distinguishes current executing Actions runs from historical startup failures. Renamed the two untracked imported RG agent documents to explicit historical references with root-contract routing; no competing execution policy introduced. VPS read-only service inspection confirms rg-website/api/bot/cron active on the previous 5691ba4b release; Aphrody site/AI units inactive. No production service mutation, WSL cluster start or parked-stash restoration. New native/rendered crawler qualification follows remotely before publication.

- 2026-10-02: rewrote the Infra Bun platform map around existing monorepo owners and the sole aphrody-web crawl contract, removing retired split-repository build directions. Corrected migrated Infra config/script links. The full Infra reference link gate now passes (37 documents/108 links), previously 26 broken links; scoped whitespace passes. RG CI 36935223127 is terminal failure: the old Zukan import blocker is gone, while TypeDoc generation, format/lint/tests and missing SQL build configuration remain. These are explicit follow-up gates, not a successful deployment.

- 2026-10-02: repaired RG release assembly prerequisites after monorepo consolidation: private pinned IECODE archives replace obsolete registry credential/root.env requirements, public assets generate through their owner before Next tracing, and only external Python dispatcher symlinks are excluded from the Bun artifact. Activation accepts canonical aphrody-labs/aphrody provenance and retained rg artifacts for explicit rollback, rejecting other repositories. Bash syntax and scoped whitespace pass. Isolated VPS fixture passes unknown-provenance and insecure-env rejection, failed-readiness/config/public-probe rollback, canonical activation and legacy rollback; systemctl, nginx and HTTP are mocked and every path is temporary. This verifies the adapter, not production assembly or deployment.

- 2026-10-02: consolidated rendered RG recon, reference-document and Reddit acquisition, DuckDuckGo transport and UniversalFutScraper behind the sole Aphrody Web owner. Native Web owns bounded response prefixes, rendered link discovery, retry scheduling and host pacing; domain parsing/cache/artifact decisions stay with consumers. Added a synchronous shared crawler facade for NIE. VPS qualification uses a temporary 12-member dependency closure with Rust 1.98.1 and the original locked version set: network preview one test, rendered engine crawl five tests, frontier 35 tests all pass. Initial projection/uncached-offline attempts stopped before tests; final metadata prunes membership without dependency version drift. Bun Web/cron suite passes 123 tests/352 assertions, both typechecks pass, scoped format/whitespace pass. FUT direct Web dependency is recorded in Bun-generated lock; clean snapshot frozen install checks 2,558 installs/2,950 packages. Network preview was already published with concurrent UI commit 2633c3afd; its fixture is now independently qualified. Remaining independent FUT acquisition/frontier and IECODE script paths are explicitly inventoried; no complete crawler consolidation, whole FUT green gate, NIE consumer gate or production deployment claimed.

- 2026-10-02: removed the recursive and massive FUT scheduling frontiers in favor of bounded native Web passes. Captured HTML reaches domain parsing/persistence once; missing captures and failed HTTP statuses fail explicitly. FUTBin, FUT.GG, evolutions, SBC and endpoint probes acquire through the owner; stop propagates AbortSignal to its process. Recursive defaults are finite and unsupported local cookie files currently fail before network/database access, pending native context support. Web/cron/FUT regression suite passes 125 tests/363 assertions; clean installed frozen snapshot checks 2,558 installs/2,950 packages, focused tests pass (12 tests/54 assertions). Full FUT typecheck reports nine remaining errors in retired BXC interop and absent nativeCache; no full FUT green claim. Scoped formatting and whitespace pass. Global Bun gate currently reports 83 manifests and one missing engines.bun on a concurrent untracked shell package, outside this batch. Shared native Rust owners and quarantine remain unchanged; no WSL native build or production activation. Producer preparation from current IECODE ed17e443 successfully yields pinned 92e027f6 archives without altering the producer checkout, proving revision isolation survives unrelated source advancement.

- 2026-10-02: completed the Aphrody Web cookie and binary-response contract. `aphrody-web crawl --cookie-file` imports repeatable Cookie-Editor/Obscura jars through the existing scoped cookie owner and shares that jar with rendered requests; `fetch --fail-on-http-error` rejects non-2xx before raw output while preserving default debug behavior. Bun service forwards cookie paths without reading them and returns native original bytes; recursive FUT passes its cookie files to the shared owner. Native VPS gates pass (7 crawl tests, 1 binary-status test); Bun service/FUT regressions pass (14 tests, 58 assertions), Web typecheck and scoped whitespace pass. Fourteen Inagle tests in IECODE also pass (76 tests, 1,240 assertions) for its pending Web-backed Zukan consumer. These source changes require publishing Web CLI, wrapper and consumer together; IECODE's `operations.revision` must then advance from 1364ad476 to the published Web owner. RG authenticated HTTP changes are a separate batch and have not been included in this qualification.

- 2026-10-03: RG producer pin advanced to IECODE c832e6c553a99ccad92cc64e4ff5b952f7c28c42 after current Inagle/NIE FFI contract review, fail-closed Zukan ordering and CLI version corrections. Workspace now prepares the pinned snapshot before frozen install, resolves named catalogs, and publishes immutable archives through an atomic manifest with confined paths and hashes. Cron imports do not launch the daemon; bot tests include explicit disposable-fixture guards; release catalog bytes and hash are retained. Focused infrastructure tests, bot and Cron owner gates pass (SQL/native/live skips remain explicit). Canonical rg:pipeline is the integrating gate; application-wide website cleanup is unfinished and production activation is not yet qualified.

- 2026-10-03: owner authorized VPS build/test/release factory, Shenron runtime on DBFR and complete RG application shutdown. RG 12 application/service/timer units are stopped and disabled; host zram retained, protected data/releases preserved, about 4.7 GiB RAM recovered. Canonical build-factory config and Workspace Infra SSH facade pin clean sources, serialize heavy jobs and reuse Cargo/sccache/Bun/uv caches. Rust wrappers reject default local heavy execution; retained build bypasses use serialized owner. Current Shenron release adapter supports monorepo source layout and DBFR local PostgreSQL qualification; actual factory build and DBFR migration remain pending, not claimed from fixture checks.

- 2026-10-03: owner-authorized native integration of the four patched Rust
  implementations into `crates/native/simdutf`, `crates/compat/serde-saphyr`,
  `crates/ui/tauri-plugin-dialog` and `crates/ui/tauri-plugin-mcp-bridge`.
  Preserve upstream package identities, features, licenses, tests and code;
  packages are internal (`publish = false`), with one root Cargo lock.
  Native Git and Bun source verification inspect the integrated paths.
  Factory VPS: 773 imported-source tests and six native Git source/catalogue
  tests pass; Tauri dialogue/bridge/wrapper and terminal all-target checks pass.
  Native Git clippy passes for all targets with warnings denied.
  Update owner: 163 tests and typecheck pass. Locked all-features Cargo metadata
  requires no sibling source directory. Original external copies removed only
  after a complete private archive was verified against every recorded hash.
  Provenance and validation: `docs/migration/native-source-integration-2026-10-03.json`.

- 2026-10-03: repaired only the existing IECODE Rust publication adapter
  `scripts/iecode/publish-rust-crates.sh`. Its qualified allowlist is
  `aphrody-wii`, then `aphrody-aarch64`; canonical producer paths replace
  obsolete directories. Cargo uses its normal credential-provider chain,
  requires a clean producer checkout and a locked graph, and runs scoped
  check/test/clippy through the existing serialized owner before sequential
  publication. `--plan` prints the validation commands without executing them;
  `--dry-run` verifies packages without uploading. Removed the nonexistent
  `release:check` prerequisite and `--allow-dirty`. Bash syntax, scoped Git
  whitespace and an isolated mocked-owner fixture pass: five ordered locked
  commands, dry-run forwarding, dirty-source rejection before any command,
  unknown-mode rejection and side-effect-free planning. Real Cargo gates were
  not rerun by this worker, per the repository resource policy; no publication,
  credentials modification, installation or commit was performed in this batch.

- 2026-10-03: integrating validation of the repaired IECODE publication adapter:
  `APHRODY_LOCAL_CARGO=1 APHRODY_CARGO_JOBS=2
  CARGO_TARGET_DIR=/tmp/iecode-publisher-config-target
  IECODE_ROOT=../iecode scripts/iecode/publish-rust-crates.sh --dry-run`
  passes scoped check/test/strict Clippy and both package verification builds.
  Twenty-two unit tests pass; zero doctests are not additional coverage.
  Cargo explicitly aborts both uploads in dry-run mode. The local override was
  limited to this small diagnostic; serial locking and sccache remain active.
  No producer code/version changed and output stays outside the clean checkout.

## Gestion centralisée des extensions — 2026-10-03

- [x] Sources uniques des huit plugins sous `~/plugins`; 13 128 357 octets de
      caches détachés retirés, 274 contenus uniques conservés dans `_recovered`.
      Rapport de relocation et inventaires SHA-256 historiques conservés.
- [x] `aphrody-workspace plugins` fournit `status`, `fix-refs`, `clean`,
      `prepare`, `validate`, `install`, `uninstall`; registre extensible des
      fournisseurs, scopes de domaine, détection PATH et plans avant mutations.
- [x] Réutilisation de `@aphrody/paths`, `@aphrody/bun`, Bun YAML/TOML,
      Oxfmt, `aphrody-skills` et validateurs natifs Claude/agy. Codex n'annonce
      pas de validateur natif de plugins. Préparation idempotente vérifiée.
- [x] Références opérationnelles réparées, overlays synchronisés, YAML et
      hooks corrigés. Recherche déléguée à Codex, Claude et agy via A2A et
      `aphrody docs search`; [guide central](docs/guides/ai/AGENT_PLUGINS.md).
- [x] 173 tests Workspace passent, 19 conditionnels ignorés; 18 gates natifs
      supplémentaires passent (36 installations/retraits plugins/skills/MCP,
      scopes utilisateur/projet, profils temporaires). TypeScript Workspace et
      Update passent; lint du gestionnaire et format des fichiers concernés passent.
- [x] Huit bundles sans erreur structurelle, 42 validations natives passent.
  Le lanceur BXC 0.9.15 déjà installé dans le store Aphrody est exposé dans
  `~/.local/bin`; BXC passe sa validation agy. Aucun bundle propriétaire
  réactivé dans le home réel.
- [ ] Gate documentaire global encore périmé : catalogues ecosystem
      (ECOSYSTEM.md, CLI.md, ecosystem.json), documentation.json et llms.txt.
      Ces artefacts partagés en cours de modification sont laissés hors de ce batch.
      Index durable des helps installé régénéré : 989 pages, 8 probes en échec,
      39 exécutables absents et une résolution inconnue signalés par l'outil.
