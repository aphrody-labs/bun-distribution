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
  racine fournie (par défaut `/home/aphro/aphrody`). Elle ne parcourt plus les
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

- [ ] Retirer du point d’entrée de M3 Design tout serveur ou `process.exit()` à
  l’import ; placer démarrage/configuration dans une application.
- [ ] Séparer la génération SVG native et les composants React navigateur ;
  aucun binding Bun natif dans le chemin d’un composant `use client`.
- [ ] Clarifier `render-tools` face au moteur `render`, avec identités publiques
  maintenues puis migration explicite si un renommage API est nécessaire.
- [ ] Requalifier tokens, composants, SSR/hydratation et exports navigateur.

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
  `upstream/tauri-plugin-dialog` (`[patch.crates-io]`, patch
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

- [ ] Extraire les handlers Storage/Realtime/CDN vers leurs packages ; l’API
  importe les bibliothèques, les apps conservent configuration et démarrage.
- [ ] Sortir le daemon Cron de son package partagé.
- [ ] Donner catalogue boutique et registres communs à un package de domaine ;
  retirer l’import du site depuis le bot.
- [ ] Reprendre les gates historiques de chaque produit effectivement importé.

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
- [ ] Donner règles wiki/databooks et registres au package config ; retirer les
  imports de règles depuis le site dans le pipeline.
- [ ] Consommer le chargeur interop unique et les calculs RAG qualifiés.
- [ ] Reproduire les tests/configuration historiques ; corriger les erreurs
  actuelles avant les tests bout en bout de site, bot et pipeline.
- [ ] Valider le produit assemblé après passage des gates de ses dépendances.

Critères : corpus/règles partagés, tests pipeline/config, build site/bot,
smoke documenté. Une mise en production est une opération distincte.

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

- [ ] Auditer et dédupliquer toutes les surfaces A2A sur le monorepo actuel.
- [x] Centraliser règles, mémoire et conversations par les propriétaires existants.
- [x] Configurer les trois agents pour travailler simultanément dans le même
  checkout et la même branche, avec attribution des fichiers et coordination.
- [ ] Vérifier les launchers, imports de sessions et échanges réels ; distinguer
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
- Preuves : [runtime domaines](docs/operations/ai/agent-domain-runtime-qualification-2026-10-01.json),
  [Docs DBFR](docs/operations/ai/dbfr-drive-markdown-2026-10-01.json),
  [sauvegarde modèles](docs/operations/ai/agent-home-trained-artifact-sync-2026-10-01.json).

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
- Preuves : [RAPTOR euclidien](docs/operations/ai/raptor-euclidean-qualification-2026-10-01.json),
  [Agent Home](docs/operations/ai/agent-home-integration-qualification-2026-10-01.json).

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
- Preuves : [règles canoniques](docs/operations/shenron/canonical-rule-exports-2026-10-01.json),
  [optimisation euclidienne](docs/operations/ai/raptor-euclidean-optimization-2026-10-01.json).

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
- Preuves : [chargeur](docs/operations/shenron/native-loader-consolidation-2026-10-01.json),
  [gates transitifs](docs/operations/ai/cli-mcp-dependency-qualification-2026-10-01.json).

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
- Preuves : [rapport et logs](docs/operations/ai/unified-owner-qualification-2026-10-01/report.json).
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
- Preuves : [rapport et logs](docs/operations/ai/gateway-firefly-qualification-2026-10-01/report.json).

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
- Preuves : [rapport et logs](docs/operations/ai/notebooklm-qualification-2026-10-01/report.json).

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
- Preuves : [audit direct, hashes et périmètres](docs/operations/ai/documentation-navigation-qualification-2026-10-01.json).
