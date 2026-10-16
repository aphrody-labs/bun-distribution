<!-- SPDX-License-Identifier: Apache-2.0 -->
# Intégration Taffy — 2026-10-07

Taffy reste le paquet `taffy` 0.12.1, sous licence MIT, avec les mêmes features.
Son propriétaire canonique devient `crates/ui/taffy` ; le patch Cargo remplace
l'ancien chemin crates/vendor/taffy. Aucun moteur n'est copié dans un consommateur.

## Sources et correctif

Le déplacement initial conserve les 54 fichiers suivis octet pour octet.
Deux fichiers évoluent ensuite : `src/tree/taffy_tree.rs` et `MIGRATION.json`.
La nouvelle note `LOCAL-PATCHES.md` décrit le correctif. Les hashes d'import,
la révision historique du fork `4cd8b38fc06e1dcec43c13b6962e6e1e87064ec8`,
le nom du paquet, sa version, sa licence et les algorithmes de layout sont conservés.

`TaffyTree::remove` libère immédiatement le contexte de mesure du nœud retiré
et invalide les caches de ses parents. Un second retrait du même identifiant
renvoie `InvalidInputNode`. Le test de régression vérifie le destructeur du
contexte et la largeur du parent, de 80 à 0 après le retrait.

## Qualification native initiale

Les commandes suivantes ont terminé sur le snapshot
`dc6f41ef2160b89d1abe7f500d0fb02c6536be50`, sur le VPS GNU/Linux,
avec Rust 1.98.1, LLVM 22.1.8, quatre jobs et le sccache partagé :

| Commande Cargo | Résultat | Job VPS |
| --- | --- | --- |
| `test -p taffy --lib removing_measured_child_releases_context_and_invalidates_parent_layout --locked -- --test-threads=1` | 1 test passé, 109 filtrés | `2026-10-07T20-30-13-506Z-dc6f41ef2160-render-taffy-remove` |
| `check -p taffy --all-targets --locked` | Code 0 | `2026-10-07T20-32-09-525Z-dc6f41ef2160-render-taffy-check` |
| `test -p taffy --lib --locked -- --test-threads=1` | 110 tests passés, aucun échec ni test ignoré | `2026-10-07T20-32-58-034Z-dc6f41ef2160-render-taffy-test` |
| `clippy -p taffy --all-targets --locked -- -D warnings` | Code 0 | `2026-10-07T20-40-15-513Z-dc6f41ef2160-render-taffy-clippy` |

Les features par défaut sont `std`, `taffy_tree`, `flexbox`, `grid`,
`block_layout`, `float_layout`, `calc`, `content_size` et `detailed_layout_info`.

## Candidat isolé et résolution Cargo

Le candidat `e81f1a4c53c7f92183dd0510a9714149bbb19970` contient uniquement
le déplacement Taffy, le correctif et deux déclarations Cargo racine, sur la
base commitée `277a69807a67e0032b93597dca31cfa32f7d6677`. Les changements
Oxc, renderer, M3 et WinClean non commités des autres sessions sont exclus.

Cargo a généré son lockfile par `update -p taffy --offline` dans le job
`2026-10-07T20-58-12-602Z-e81f1a4c53c7-taffy-lock`. Aucun paquet ni version
n'est ajouté, retiré ou mis à jour. L'entrée Taffy gagne ses références
`cssparser 0.37.0`, `document-features`, `roxmltree 0.21.1` et `serde_json`,
déjà présentes ailleurs dans le lock. Cargo répare également la référence
`windows-sys 0.61.2` déjà déclarée dans le manifeste FFI commité.

Le lockfile généré, conservé avant libération du verrou de fabrique, fait
669 794 octets et porte le SHA-256
`47a69e29831c5deda78a1d19e274dd849d201cc1558103fb3ad6c675e50fe595`.
Il n'a pas été édité à la main. Une première tentative de capture a échoué
avant Cargo, car le wrapper privé utilisait une option de configuration absente ;
la reprise utilise le chemin par défaut du propriétaire sans nouveau transfert.

Le candidat initial `91bf4e1ec4ab5fb8f14cd0433ca6efe73084eae2` ajoute ce lockfile.
Le candidat final `340ea08d31397f7e98c5844058a6e9877dd27b71` incorpore également la mise
en forme du nouveau test : les sources avant et après cette correction sont
identiques après normalisation par rustfmt. Le test ajouté respecte la politique
de format du dépôt. Le contrôle rustfmt du fichier entier échoue encore sur le
format historique importé ; aucune réécriture générale ni qualification globale
du format n'est revendiquée.
Ses sept gates ont terminé avec le code 0 :

| Commande Cargo | Résultat | Job VPS |
| --- | --- | --- |
| `check -p taffy --all-targets --locked` | Code 0 | `2026-10-07T21-08-51-674Z-340ea08d3139-taffy-source-suite-taffy-check` |
| `test -p taffy --lib --locked -- --test-threads=1` | 110 tests passés, aucun échec ni test ignoré | `2026-10-07T21-08-51-674Z-340ea08d3139-taffy-source-suite-taffy-test` |
| `clippy -p taffy --all-targets --locked -- -D warnings` | Code 0 | `2026-10-07T21-08-51-674Z-340ea08d3139-taffy-source-suite-taffy-clippy` |
| `check -p taffy --all-targets --all-features --locked` | Code 0 | `2026-10-07T21-08-51-674Z-340ea08d3139-taffy-source-suite-taffy-all-features` |
| `check -p taffy --no-default-features --lib --locked` | Code 0, un warning hérité | `2026-10-07T21-08-51-674Z-340ea08d3139-taffy-source-suite-taffy-minimal` |
| `check -p taffy --target x86_64-pc-windows-msvc --lib --locked` | Code 0 | `2026-10-07T21-08-51-674Z-340ea08d3139-taffy-source-suite-taffy-msvc` |
| `check -p taffy --target wasm32-unknown-unknown --lib --locked` | Code 0 | `2026-10-07T21-08-51-674Z-340ea08d3139-taffy-source-suite-taffy-wasm` |

Les deux cross-checks sont des compilations de bibliothèque, sans exécution
Windows ni navigateur. La configuration minimale conserve un warning
`unreachable_patterns` dans `crates/ui/taffy/src/style/mod.rs` :
avec tous les layouts désactivés, Display ne contient que None. Ce fichier
est identique à la source importée ; aucune absence globale de warnings
n'est revendiquée. Clippy strict porte sur les features par défaut.
Les sources du candidat sont toujours identiques aux 55 fichiers locaux
au moment de la préparation documentaire.

## Limites des consommateurs

Les liens du périmètre `docs/operations/workspace` passent : dix documents,
quinze liens, aucun lien ni chemin courant cassé. Le contrôle documentaire
global du worktree (`yolo ops docs generate --check --skip-ecosystem`) signale
des inventaires générés périmés : `docs/reference/workspace/STATE.md`,
`README.md`, `docs/README.md` et `docs/reference/workspace/documentation.json`.
La consolidation concurrente reste en cours ; ce lot ne qualifie pas cette
gate globale. Les générations MEMORY et UPSTREAMS du lot sont contrôlées
avec leurs sources de métadonnées.

Le job `2026-10-07T20-24-35-737Z-dc6f41ef2160-render-component-test`
(`test -p aphrody-render -p aphrody-bun --lib --tests --locked -- --test-threads=1`)
échoue avec le code 101 avant les tests : dix diagnostics sur les dimensions
intrinsèques et le type d'erreur des espacements, ainsi que quinze warnings
numériques. Le propriétaire actif a ensuite corrigé des sources ; ces changements
ne sont pas couverts par ce job.

L'adaptateur courant refuse explicitement les dimensions intrinsèques
`min-content` et `max-content`. Les pistes grid natives et la mesure de texte
avec une dimension `auto` sont des contrats distincts. Cette limitation reste
ouverte ; aucun support CSS complet n'est établi par les tests Taffy.

Ce lot ne qualifie ni les adaptateurs renderer/M3/Bun/WASM, ni leur ABI,
le packaging, l'installation, l'activation, le GPU, le bureau réel ou Windows
natif. Les contrôles de compilation croisée, lorsqu'ils passent, ne prouvent
pas une exécution sur la cible. Le [plan global](../../PLAN.md) reste ouvert.
