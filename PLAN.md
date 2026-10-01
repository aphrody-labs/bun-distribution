<!-- SPDX-License-Identifier: Apache-2.0 -->
# Plan du monorepo Aphrody — 2026-10-01

## Objectif et autorité

Shenron est le produit final. La qualification suit les fondations, leurs
adaptateurs, l’infrastructure, puis les consommateurs. Ce plan décrit l’état
observé et les travaux restant à exécuter ; une commande planifiée ne constitue
pas un résultat de validation.

Racines actives : `aphrody`, `aphrody-py`, `iecode` sous `/home/aphro`.
`/home/aphro/src` est une archive legacy. Le checkout séparé `aphrody-ui` reste
sous la responsabilité de son agent. Les anciens plans importés sont des
preuves historiques : [ancien plan](docs/migration/PLAN-before-reorganization-2026-10-01.md)
(conserver la base racine pour ses anciens liens).

## État vérifié

- 84 packages Bun déclarés ; 186 membres Cargo actifs, 210 manifests locaux
  inventoriés, dont des manifests imbriqués hors du workspace actif.
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

## 0. Structure et hygiène

- [x] Séparer CLI, interop, clients OS et UI par propriétaires.
- [x] Retirer `aphrody-` des dossiers de crates et des packages Infra redondants.
- [x] Centraliser les commandes de scan, nettoyage et génération du pipeline
  dans `@aphrody/workspace` ; retirer l’exclusion globale `packages/**` d’Oxc.
- [x] Nettoyer les builds et caches ; sortir les exécutables et l’état du
  source-sync de `target` ; redémarrer les services avec les chemins actuels.
- [ ] Qualifier chaque groupe de doublons restant : propriétaire, consommateurs,
  licence, nécessité de copie au packaging. Supprimer uniquement après mise à
  jour des consommateurs et vérification du packaging.
- [ ] Classer les documents historiques et corriger les liens réellement cassés
  dans la documentation active. Ne pas réécrire les preuves de migration.
- [ ] Classer les scripts importés par commande utilisée, propriétaire et
  références entrantes ; supprimer ceux devenus inutilisés après preuve.
- [ ] Réduire les préfixes de fichiers qui ne décrivent aucun rôle, en conservant
  les conventions imposées (`Cargo.toml`, `package.json`, `index.ts`).

Critères : installation Bun figée, métadonnées Cargo, layout, liens documentaires
actifs, aucun import vers une ancienne implantation déplacée.

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
  existants `config/bun-fork.json`, `config/shell-runtime.json` et
  `inventory/aphrody-discord-dev-2026-09-29.md`. Le contrôle ne relève plus
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

## 1. Contrats, cœur et compatibilité

Propriétaires : `crates/contracts`, `crates/native`, `crates/compat`,
`packages/bun`, `packages/compat`.

- [ ] Auditer le graphe Cargo/Bun et les dépendances croisées par domaine.
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

- [ ] Extraire les capacités partagées encore prises dans le CLI ; la FFI ne
  doit pas dépendre de l’application pour obtenir la logique de bibliothèque.
- [ ] Unifier découverte, chargement et durée de vie de la bibliothèque native.
- [ ] Faire consommer ce chargeur par Shenron ; retirer les chemins legacy du
  pipeline après vérification Linux/Windows et mode développement.
- [ ] Définir installation/version/ABI des artefacts ; aucun lancement ne doit
  déclencher une compilation implicite dans un daemon de production.

Critères : tests FFI réels avec artefact qualifié, erreurs sans artefact,
compatibilité symboles/types, installation utilisable sans dossier `target`.

## 3. OS, shell et infrastructure

Propriétaires : `crates/os`, `crates/shell`, `crates/infra`,
`packages/os`, `packages/infra/workspace`.

- [ ] Remplacer les références actives aux checkouts legacy dans les catalogues,
  outils kernel et configurations ; distinguer les outils de migration qui
  doivent encore savoir lire ces archives.
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

## 4. UI et bibliothèques navigateur

Propriétaire : `packages/ui`, `crates/ui`.

- [ ] Retirer du point d’entrée de M3 Design tout serveur ou `process.exit()` à
  l’import ; placer démarrage/configuration dans une application.
- [ ] Séparer la génération SVG native et les composants React navigateur ;
  aucun binding Bun natif dans le chemin d’un composant `use client`.
- [ ] Clarifier `render-tools` face au moteur `render`, avec identités publiques
  maintenues puis migration explicite si un renommage API est nécessaire.
- [ ] Requalifier tokens, composants, SSR/hydratation et exports navigateur.

Critères : import sans effets, build navigateur sans Bun FFI, typecheck,
tests de composants et rendu. Les échecs historiques Gemini sont à reproduire.

## 5. AI, Web et RAG

Propriétaires : `crates/ai`, `crates/web`, `packages/ai`, `packages/web`.

- [ ] Faire de `rag-core` le propriétaire unique des calculs RAG ; adapter
  Python à ce cœur et supprimer ses calculs dupliqués.
- [ ] Corriger l’écart RRF : le premier résultat doit suivre la convention du
  cœur `1/(k+rang+1)` ; tester parité Python/Rust et cas vides/doublons.
- [ ] Requalifier les contrats Web/AI et reprendre les gates ouverts des plans
  historiques. Vérifier services externes séparément des tests déterministes.

## 6. Consommateurs RG et autres domaines

Propriétaires : `packages/rg`, `apps/rg`, domaines Discord/Koharu/FUT.

- [ ] Extraire les handlers Storage/Realtime/CDN vers leurs packages ; l’API
  importe les bibliothèques, les apps conservent configuration et démarrage.
- [ ] Sortir le daemon Cron de son package partagé.
- [ ] Donner catalogue boutique et registres communs à un package de domaine ;
  retirer l’import du site depuis le bot.
- [ ] Reprendre les gates historiques de chaque produit effectivement importé.

Critères : imports des packages sans serveur, tests handlers/contrats puis
smoke de chaque application, packaging autonome des assets partagés.

## 7. Shenron, produit final

Propriétaires : `packages/shenron`, `apps/shenron`.

- [ ] Examiner puis intégrer les trois fichiers laissés non suivis par Gemini :
  `databooks-defauts.ts`, `slug.ts`, `wiki-slugs.ts`. Ils restent préservés ;
  une copie présente ne prouve pas que les consommateurs ont migré.
- [ ] Donner règles wiki/databooks et registres au package config ; retirer les
  imports de règles depuis le site dans le pipeline.
- [ ] Consommer le chargeur interop unique et les calculs RAG qualifiés.
- [ ] Reproduire les tests/configuration historiques ; corriger les erreurs
  actuelles avant les tests bout en bout de site, bot et pipeline.
- [ ] Valider le produit assemblé après passage des gates de ses dépendances.

Critères : corpus/règles partagés, tests pipeline/config, build site/bot,
smoke documenté. Une mise en production est une opération distincte.

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
