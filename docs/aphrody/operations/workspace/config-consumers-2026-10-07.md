<!-- SPDX-License-Identifier: Apache-2.0 -->
# Consommateurs de configuration et migration M3 — 7 octobre 2026

Ce lot poursuit le [plan](../../PLAN.md) après la
[qualification Infra](infra-qualification-2026-10-07.md). Les preuves portent
sur des snapshots privés de l'arbre de migration en cours.

## Défaut reproduit et correction

La CLI isolée précédemment qualifiée acceptait un service de santé sans champ
`port`, dont le champ `host` désignait un hôte inexistant. La fixture attribuait
`qualification-unknown-host` au service `aphrody-site` : validation réussie,
aucune erreur. Ce résultat expose une absence de contrôle de l'hôte.

Le validateur examine désormais l'hôte avant de chercher un port explicite.
Les listeners de santé, les upstreams supplémentaires et les services sans port
participent donc au contrôle de leur hôte. Le test existant couvre ces formes.
Les services sans champ `host` conservent les règles de collision conservatrices.

Le lot intègre aussi les corrections précédemment présentes : routes nginx du
snapshot sélectionné, contrôle des collisions par hôte conservant toutes les
revendications, ports internes du bon hôte, et fixtures Git compatibles avec
les snapshots détachés sans référence de branche.

## Preuves acquises

| Contrôle | Résultat |
| --- | --- |
| Infra, tests Linux après correction | 84 réussis |
| Git, tests unitaires Linux | 27 réussis |
| Git, cinq suites d'intégration Linux | 21 réussis |
| Ensemble Infra/Git | 132 réussis, aucun échec ni ignore ; doctests sans cas |
| Infra/Git, Clippy Linux toutes cibles | réussi, avertissements interdits |
| Infra/Git, check MSVC toutes cibles | réussi |
| App-ui canonique | TypeScript réussi ; 216 tests, 988 assertions, aucun échec |
| M3, TypeScript après construction des exports | 25 paquets réellement contrôlés, sans cache, aucun échec ni exclusion |
| M3 Next, suites normales et DOM | 49 + 10 réussis, un cas sauté |
| M3 Next, appel natif direct au propriétaire | source `ffi` pour scheme et tokens ; 49 rôles identiques au schéma JS ; aucune erreur |
| M3, lint du périmètre déclaré | code zéro, avertissements présents |
| Bibliothèques M3, pipeline existant | 11 construites, une en cache, 13 sans configuration de build |

Le snapshot Infra/Git testé est
`34d31a15e86a8eeb0346967bd9031393fc77550d`.
Le Clippy porte sur `f4f46c84a438621d4d745faa73d494a298af3654` et le check
MSVC sur `54cbed0085f51823e206a482769e459b22acf750` ; les deux terminent
avec le code zéro. Le check croisé ne prouve pas une exécution Windows.
Les 25 contrôles TypeScript ont été relancés avec `--no-cache` après production
des exports de déclaration réels. Les échecs de résolution initiaux des exemples
et de M3 Bun sont ainsi résolus. Aucun alias de sources ni exclusion de test
n'a été ajouté. Les fichiers générés restent ignorés par Git.

Le cas sauté cherche encore une ancienne bibliothèque sous un chemin relatif
au paquet. Une sonde directe utilise le propriétaire réel, résolu dans
`packages/interop/native/src/index.ts` : appel de `bun_rs_m3_css`, puis libération
par `bun_rs_free_string`. Elle retrouve les 49 rôles attendus et le token primaire.
La disponibilité native est ainsi prouvée pour ce cas ; le prédicat du test
reste à corriger dans le chantier de migration qui revendique ce chemin.

## Gates encore ouverts

La sélection des onze consommateurs, avec fonctionnalités par défaut et
verrou de dépendances, s'est arrêtée à la compilation de `aphrody-command` :
`E0277`, dans `winclean_cmd.rs:230`. Le nouveau digest de `sha2` n'implémente
pas `LowerHex`. Ce fichier est revendiqué par le chantier Windows natif actif.
Une correction de formatage est préparée dans les preuves de coordination.
La suite complète reste ouverte ; les seuls gates Infra/Git ne la clôturent pas.

La build des bibliothèques M3 ne qualifie pas les treize paquets sans
configuration de build. Le test M3 Next sauté, les avertissements de lint,
les autres suites M3, la compilation CLI complète, l'installation et le rendu
natif restent à qualifier. Les profils, données protégées et fichiers
concurrents sont préservés.
