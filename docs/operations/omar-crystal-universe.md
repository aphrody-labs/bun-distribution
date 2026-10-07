<!-- SPDX-License-Identifier: Apache-2.0 -->

# Objectifs d'Omar — Crystal Universe

Preuves recueillies le 2026-10-07 UTC. Demande authentifiée :
[message source](https://discord.com/channels/1554189180030947338/1557354118710829117/1557385939393716335).

## Recherche et téléchargements effectifs

Fiches produit Google Play lues par `aphrody web fetch --json` :

- [Dragon Crystal — Arena Online](https://play.google.com/store/apps/details?id=com.CrystalDev.DragonCrystalArena) : combat 2D, charge, transformations, arènes et multijoueur.
- [Warriors of the Universe](https://play.google.com/store/apps/details?id=com.GamerMind.Warriors_of_the_Universe_Online) : personnalisation, combos, capacités et invasion par vagues, solo et multijoueur.

Archives téléchargées depuis les liens XAPK exposés par les pages
[Dragon Crystal sur APKPure](https://apkpure.com/dragon-crystal-arena-online/com.CrystalDev.DragonCrystalArena/download) et
[Warriors of the Universe sur APKPure](https://apkpure.com/warriors-of-the-universe-online/com.GamerMind.Warriors_of_the_Universe_Online/download).
Les fichiers restent hors Git dans `/home/ubuntu/.aphrody/artifacts/omar-crystal-universe/`.

| Fichier                         | Version du manifeste | Identifiant                                   | SHA-256                                                          |
| ------------------------------- | -------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| `dragon-crystal.xapk`           | 39.262129 (200180)   | com.CrystalDev.DragonCrystalArena             | 3e612c6fd3e115391a5abef34a0a4330180b566204d27e360f9b53760b294a62 |
| `warriors-of-the-universe.xapk` | 2.7.5 (2007005)      | com.GamerMind.Warriors_of_the_Universe_Online | 2b117deb9e98f94ae68c45ea355cb8676a5b7ba0970738bb587942163cfc8111 |

`unzip -t` : aucune erreur dans les deux archives. `unzip -p ... manifest.json` :
identifiants conformes aux fiches Google Play. Dragon Crystal : ARM64, Android ≥ 5.1 ;
Warriors : ARMv7, Android ≥ 6. Le téléchargement n'est pas une preuve
d'installation ni d'exécution sur téléphone. XAPK contient des APK séparés :
il faut un installateur prenant en charge ce format sur un appareil compatible.
Aucune comparaison des certificats éditeur ni analyse antimalware locale n'est revendiquée.

## Implémentation et proposition

[Crystal Universe](../../apps/community/crystal-universe/README.md) est la proposition
jouable : styles/couleur personnalisables, combos, sauts, projectiles, charge,
transformation, cinq vagues IA, score, victoire/défaite, pause et reprise.
Graphismes originaux dessinés sur Canvas ; aucune dépendance ajoutée.

Contrôles actuels :

- `bun test apps/community/crystal-universe/engine.test.js` : 5 réussis, 20 assertions ; énergie/transformation, dégâts/coûts/cooldown, cinq vagues/victoire/score, mort/arrêt, saut/bornes/styles.
- `oxlint --deny-warnings apps/community/crystal-universe/*.js` : vert.
- Serveur Bun sur `127.0.0.1:4317` : HTML, JS et CSS HTTP 200 avec types corrects ; accès à `GOAL.md` HTTP 404.
- CDP natif local sur `127.0.0.1:9222` : titre, canvas, neuf boutons ; démarrage avec vague 1 et énergie qui évolue ; pause `aria-pressed=true` ; aucune exception JavaScript.
- Vue mobile 390 × 844 : largeur du contenu 390, sept commandes tactiles, capture inspectée.
- Captures hors Git : `prototype-desktop.png`, `prototype-mobile.png` dans le dossier des archives.

Le navigateur natif refuse la navigation vers les adresses privées. Le contrôle
visuel a donc injecté le HTML/CSS et le code local dans un nouvel onglet vierge
par CDP ; la desserte HTTP a été contrôlée séparément. Le chargement complet par
URL dans un navigateur de téléphone et le jeu au toucher physique restent à
qualifier. L'onglet de test a été fermé sans toucher aux autres onglets.

## Dépendance ouverte : indexation native

`/home/ubuntu/.local/bin/aphrody web crawl-index --help` répond
`unrecognized subcommand 'crawl-index'`. L'aide `aphrody web --help` confirme
l'absence de cette capacité installée. Aucun ancien script de crawl n'a été utilisé.
`aphrody home query 'Dragon Crystal Warriors of the Universe' --profile aphrody
--limit 5` retourne `hits: []`.

Installer la capacité produit `web crawl-index` pour pouvoir indexer les fiches
autorisées (profil aphrody, labels omar, maximum 25 requêtes et profondeur 2,
respect robots), puis vérifier leur présence avec `aphrody home query`.
Ce volet demeure ouvert ; l'achèvement global n'est pas revendiqué.
