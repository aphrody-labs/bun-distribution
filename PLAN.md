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

## 1. Contrats, cœur et compatibilité

Propriétaires : `crates/contracts`, `crates/native`, `crates/compat`,
`packages/bun`, `packages/compat`.

- [ ] Auditer le graphe Cargo/Bun et les dépendances croisées par domaine.
- [ ] Conserver les contrats purs ; déplacer réseau, timeout et processus vers
  leurs propriétaires opérationnels. Le client kernel est déjà sous OS.
- [ ] Distinguer moteur N2B Rust et façade CLI Bun ; le dossier Bun devient
  `n2b-client`, son nom public reste compatible jusqu’à une migration versionnée.
- [ ] Reprendre les critères ouverts des anciens plans contrats/native/compat.

Critères : check/clippy/test des propriétaires concernés ; contrats JSON-RPC,
ABI, erreurs et annulation vérifiés par des cas qui traversent les frontières.

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
