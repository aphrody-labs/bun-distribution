<!-- SPDX-License-Identifier: Apache-2.0 -->

# Qualification M3 après déplacement — 7 octobre 2026

Ce reçu couvre le checkout partagé après déplacement vers `packages/ui/` (not in repo).
Les fichiers sources de la migration restent sous le claim `m3-root-absorption`.
Il complète le [reçu Infra/Git](config-consumers-2026-10-07.md) ; aucune
installation ni publication de runtime n'est qualifiée par ces contrôles.

## Contrôles acquis

| Contrôle | Résultat |
| --- | --- |
| Déclarations des bibliothèques, pipeline canonique | 11 builds, 1 résultat en cache, 13 paquets sans `build.config.ts` ignorés |
| TypeScript, `typecheck --no-cache --json` | 25 contrôles exécutés, aucun échec ni skip |
| App UI : TypeScript et `bun test src` | 216 tests, 988 assertions, aucun échec |
| Pipeline, SDK et audits : sept fichiers de tests | 51 tests, 136 assertions, aucun échec |
| Exports des paquets | 34 paquets, aucune anomalie |
| Polices épinglées, `fonts-sync --check --json` | Fichiers présents et empreintes conformes |
| Next : tests et tests DOM | 49 tests et 10 tests DOM passés, un test natif ignoré |
| CSS natif, binding réel `@aphrody/bun` | Source FFI, 49 rôles comparés, aucune différence avec la référence JS |
| Liens M3 après correction du README showcase | Aucun lien mort |

Le test natif ignoré de Next cherche encore une bibliothèque sous l'ancien
chemin relatif `../../target/release`. La sonde CSS séparée appelle le binding
canonique `packages/interop/native/src/index.ts`, sans bibliothèque de substitution.
Elle ne qualifie ni toutes les variantes de couleurs ni le cycle de vie graphique.

## Suites restant en échec

La commande de tests des paquets du pipeline canonique a terminé avec le code 1.
Les comptes ci-dessous sont ceux des suites concernées ; les rapports de tests
enfants imprimés par les fixtures ne sont pas additionnés en un total global.

| Suite | Échecs observés | Cause ou limite observée |
| --- | --- | --- |
| `@aphrody/scaffold` | 2 | Racine calculée sous `packages/`, lecture erronée de « packages/packages/m3/package.json » |
| `@aphrody/m3-mcp` | 6 | Catalogue et tokens cherchés dans l'ancien arbre `packages/` |
| `@aphrody/m3-next-migrate` | 11 | Contrat du propriétaire hérité du scaffold ; « packages/package.json » absent |
| `@aphrody/m3-design` | 1 | Fixture React générée : ancien tsconfig et types React non résolus |
| `@aphrody/m3-icons` | 7 | Bibliothèque installée sans Material Symbols embarqués |
| `@aphrody/m3` | 14 dans la suite principale | Chemins des polices, fixtures Tailwind et scaffold ; builds/compile non qualifiés |

L'audit d'assets relève deux chemins morts dans le showcase :

- « packages/ui/app-ui/showcase/scripts/browser-contract.ts » : chemin relatif
  erroné du répertoire de résultats « .coord/runs/m3-prod/ ».
- `packages/ui/app-ui/showcase/src/styles.css` (not in repo) : chemin relatif de
  `GoogleSansFlex-latin.woff2`.

Le README du showcase a été corrigé pour pointer vers `crates/ui/app/Cargo.toml`.
Cette correction reste avec les fichiers déplacés du propriétaire de migration.
Les chemins sources concurrents n'ont pas été modifiés pour rendre les gates verts.

Les références entre guillemets décrivent les chemins observés lors de ces essais,
y compris les cibles absentes. Elles ne constituent pas des liens documentaires.
Les chemins canoniques de l'interface sont sous `m3/packages/app-ui` (ancien essai sous `packages/ui/` (not in repo)).

## Reprise et preuves

Avant intégration de la migration, corriger les racines du scaffold et du catalogue,
les références de polices et les fixtures générées, puis relancer les suites
entières et l'audit d'assets. La présence des fichiers de polices ne prouve pas
leur inclusion dans la bibliothèque native installée : celle-ci nécessite sa
propre qualification et un build sur la fabrique.

Un essai natif séparé a demandé `cargo test -p aphrody-m3-tokens -p aphrody-svg
--all-features --locked`, via le tunnel Cargo sérialisé. Le job
`2026-10-07T19-34-57-953Z-c6d9b4e8840a` s'est arrêté avec le code 101
au chargement des manifestes : le manifeste concurrent
`crates/compat/oxc-bridge/Cargo.toml` (not in repo) hérite de `oxc_formatter`, absent des
dépendances du workspace. Aucun test de ces deux crates n'a été exécuté.
Le claim `oxc-bun-ffi-wasm-20261007` couvre ce manifeste et les dépendances Oxc.
Le journal est conservé dans `.coord/proofs/m3-native-gates-20261007/test.log` (not in repo).
Les gates natifs restent à relancer sur un snapshot cohérent.
La régénération documentaire s'arrête ensuite sur la même erreur de
`cargo metadata`, même avec `--skip-ecosystem` ; les liens du reçu passent.
Le gate documentaire acquis plus tôt ne qualifie pas ce nouvel état concurrent.

Les journaux locaux sont dans `.coord/proofs/config-consumers-20261007/` (not in repo) :
`m3-runner-test.log`, `m3-packages-test.log`, `m3-fonts-check.json`,
`m3-exports.json`, `m3-assets.json`, `m3-links-final.json`,
`m3-build-libraries.log`, `m3-typecheck-fresh.log` et `m3-css-default.json`.
Ils sont ignorés par Git. Le plan global et les gates des onze consommateurs
Rust restent ouverts ; le dernier essai Rust échoue dans le WinClean concurrent.
