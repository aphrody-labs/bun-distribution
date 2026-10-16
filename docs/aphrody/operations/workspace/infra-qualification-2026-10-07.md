<!-- SPDX-License-Identifier: Apache-2.0 -->
# Qualification Infra et sccache — 7 octobre 2026

Ce lot poursuit le [plan](../../PLAN.md) dans l'arbre principal privé
Aphrody. Les snapshots de qualification contiennent la migration en cours ;
ils ne constituent pas une qualification globale de la branche publiée.

## Corrections

- La commande `infra --root <répertoire> validate` cherche désormais les
  modèles systemd dans le répertoire sélectionné, comme ses catalogues.
  Les opérations sur les hôtes conservent leur résolution de configuration.
- Le démarrage partagé de sccache conserve ses métadonnées temporaires dans
  le cache permanent. Il retire les marqueurs de job et impose
  `SCCACHE_IDLE_TIMEOUT=0`, conformément à la
  [configuration officielle de sccache 0.18.0](https://github.com/mozilla/sccache/blob/v0.18.0/docs/Configuration.md).
  Une acquisition longue de toolchain ne provoque donc plus son expiration
  suivie d'un redémarrage avec le dossier temporaire du job.
- Le second hôte utilise son propre cache permanent lorsque le verrou hérité
  est prouvé dans le noyau. Un marqueur d'environnement seul reste insuffisant.
- Le chemin de Docker est résolu avant l'audit privilégié, afin que le chemin
  sécurisé de sudo conserve le propriétaire sélectionné.
- Chaque invocation Cargo préchauffe sccache sous le verrou de fabrique.
  Le processus compilateur conserve l'environnement temporaire de son job.

## Récupération native

Après la préparation du SDK MSVC, le daemon sccache du VPS conservait encore
une référence au dossier temporaire partagé. Le garde de nettoyage a refusé
de vider ce dossier.

La récupération a vérifié l'exécutable, les seuls chemins de cache et de
temporaire concernés, ainsi que l'absence de compilateur actif, puis acquis le
verrou exclusif de fabrique. `sccache --stop-server` a terminé le daemon ;
le propriétaire Workspace l'a redémarré avec la politique corrigée.
Le cache disque est conservé. Les observations natives du VPS et du second
hôte confirment le dossier permanent et le délai d'expiration nul.

## Preuves acquises

| Contrôle | Résultat |
| --- | --- |
| Infra + Git, tests Linux initiaux | 84 + 27 réussis |
| Infra + Git, check Linux initial, toutes cibles | réussi |
| Infra + Git, Clippy Linux initial, toutes cibles, avertissements interdits | réussi |
| Infra + Git, check MSVC initial, toutes cibles | réussi |
| Infra, tests Linux après correction, second hôte | 84 réussis |
| Infra + Git, Clippy Linux final, toutes cibles, avertissements interdits | réussi |
| Infra + Git, check MSVC final, toutes cibles | réussi |
| Nettoyage et daemon partagé, Bun | 18 réussis, 82 assertions |
| Routage Cargo, Bun | 6 réussis |
| TypeScript Workspace et fichier de test Cargo ciblé | réussis |
| oxlint strict, oxfmt et syntaxe Bash du lot | réussis |
| CLI reconstruite, validation du snapshot | 25 services, 15 routes, 18 variables ; aucune erreur ni avertissement |
| CLI native, sélection explicite du répertoire | validation positive réussie ; unité sélectionnée retirée détectée ; répertoire réel réussi |
| CLI copiée sous WSL, ABI et sélection explicite du répertoire | version exécutable ; validation positive réussie ; unité sélectionnée retirée détectée ; répertoire réel réussi |
| Documentation Aphrody, génération et contrôle ciblés, liens | réussis |

Le snapshot des tests Infra finaux est
`eb2f4f349c4da25e5eb8cf8d23f3fd1ef5490d4f`. La CLI a été construite et exécutée
sur `4700202e1f9d259a213b52f982b6284f23a535d4`, avec la fonctionnalité `jobs`.
Le Clippy final porte sur `c26509374c08180f6eedb513780825aff0dd15ff`, et le
check MSVC final sur `8c207b2dc112895e82993243422e491f20067ebb`.
Ces jobs ont terminé avec le code zéro. Les fichiers de preuve locaux restent
dans le dossier de coordination ignoré par Git.

Le correctif de fabrique est livré par
`7637689ac930fbb6f219a16f75b1dfef21b19a3c`, poussé puis constaté sur
`workspace/main`. Le staging UI concurrent est inchangé.

## Artefact isolé et suites ouvertes

La CLI copiée dans le dossier de qualification a le même SHA-256 que le
binaire du VPS :
`2f73f6afd038ca8034458322c24c470d806c6a74f45e45184ce57a293e4a09a3`.
Sa version s'exécute sous WSL. Les contrôles locaux retrouvent les codes
zéro, un et zéro pour la fixture positive, l'unité sélectionnée manquante et
le répertoire réel ; le contrôle négatif vérifie aussi le nom de l'unité.
Le binaire installé et ses alias restent ceux de l'installation existante.
La promotion par la fabrique sur une révision propre reste ouverte.

Le TypeScript global des scripts relève `TS2352` dans
`scripts/release/publish-downloads.ts:1573` : une conversion vers `PublishedFile`
manque les champs `version`, `target` et `kind`. Ce chemin appartient au chantier
de publication concurrent. Le contrôle ciblé du fichier modifié ici réussit.
Les autres gates de migration et les installations du plan restent ouverts.

La génération documentaire inter-dépôts échoue sur les métadonnées Cargo
d'IECODE (`No such file or directory`). Le périmètre Aphrody passe avec
`docs generate --check --skip-ecosystem` ; ses liens locaux passent également.
