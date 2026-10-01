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
  somme des « test result » du journal). Le mode `--locked` est bloqué : une autre
  session a modifié `crates/ai/rag-core/Cargo.toml` sans mettre à jour
  `Cargo.lock` ; le lockfile a été restauré tel quel après les contrôles.
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
- DÉFAUT NON CORRIGÉ : `aphrody-model-view` compile mais échoue au démarrage :
  `no runtime was configured` (Tauri 3 exige `Builder::runtime(...)`). Le runtime
  du workspace est `tauri-runtime-cef` (Koharu) ; `tauri-runtime-wry` n'est pas
  une dépendance. Choisir le runtime est une décision d'architecture : le binaire
  CEF est absent ici et `aphrody-tauri-3d` attache une couche native à la fenêtre
  (DirectComposition sous Windows). Aucune fenêtre Tauri n'a pu être lancée.
- CONSTAT : `crates/ui/app` (`aphrody-app`, Tauri 2.11.6 fork git plus quinze
  plugins sur révisions git) ne peut pas rejoindre le workspace (Tauri 3.0.0-alpha.2,
  conflit `links = "Tauri"`) ; l'exclusion précède le déplacement des dossiers.
  Sa migration vers Tauri 3 n'est pas entreprise.

## 5. AI, Web et RAG

Propriétaires : `crates/ai`, `crates/web`, `packages/ai`, `packages/web`.

- [ ] Faire de `rag-core` le propriétaire unique des calculs RAG ; adapter
  Python à ce cœur et supprimer ses calculs dupliqués.
- [x] Corriger l’écart RRF : le premier résultat doit suivre la convention du
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
