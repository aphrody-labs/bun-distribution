<!-- SPDX-License-Identifier: Apache-2.0 -->

# Objectifs d'Omar — Dragon Pixel

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

[Dragon Pixel](../../examples/crystal-universe/README.md) est la proposition
jouable : styles/couleur personnalisables, combos, sauts, projectiles, charge,
transformation, cinq vagues IA, score, victoire/défaite, pause et reprise.
Graphismes originaux dessinés sur Canvas ; aucune dépendance ajoutée.

Contrôles actuels :

- `bun test examples/crystal-universe/engine.test.js` : 5 réussis, 20 assertions ; énergie/transformation, dégâts/coûts/cooldown, cinq vagues/victoire/score, mort/arrêt, saut/bornes/styles.
- `oxlint --deny-warnings examples/crystal-universe/*.js` : vert.
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

## Nom du jeu — 2026-10-07

Demande authentifiée : [nommer le jeu « Dragon Pixel »](https://discord.com/channels/1554189180030947338/1557354118710829117/1557386591985602601).
Le titre HTML, le titre visible, le README et le message du serveur portent
désormais ce nom. Le chemin technique `examples/crystal-universe/`
a été migré avec ses commandes et liens locaux. Les noms des jeux
ayant inspiré ses mécaniques conservent leur attribution.

Vérification actuelle du renommage : serveur Bun lancé sur `127.0.0.1:4318`,
réponse HTTP 200 analysée : `<title>Dragon Pixel — mini-jeu d'Omar</title>`
et texte du `<h1>` égal à `Dragon Pixel` ; ancien nom absent du HTML servi.
Sortie du serveur : `Dragon Pixel: http://127.0.0.1:4318/`.
Tests moteur : 5 réussis, 20 assertions ; oxlint strict, oxfmt et
`git diff --check` réussis. Aucun déploiement public effectué.

## Consolidation de la racine — 2026-10-07

Le prototype autonome Bun est maintenant sous `examples/crystal-universe/`.
Les commandes de validation ci-dessus décrivent leur chemin historique ; pour
les relancer, utiliser `bun test examples/crystal-universe/engine.test.js` et
`oxlint --deny-warnings examples/crystal-universe/*.js`. Le serveur se lance par
`bun examples/crystal-universe/serve.js`. Les imports relatifs et les ressources
restent dans le même dossier ; aucune copie de moteur ni dépendance ajoutée.

Validation du déplacement : les six fichiers de code/ressources sont identiques
octet par octet à leur version Git avant migration. Les cinq tests moteur passent
(20 assertions). oxlint strict et oxfmt passent avec les règles du dépôt et
l'exclusion globale des exemples désactivée dans des configurations temporaires.
Le serveur Bun sur un port loopback éphémère sert les quatre ressources avec un
contenu identique au disque ; trois chemins non autorisés retournent 404.
Le serveur est arrêté après les sondes. `yolo ops docs check --skip-ecosystem`
passe ; le contrôle global des liens ne trouve aucun lien local cassé mais
relève quatre chemins morts préexistants hors du lot. Aucun build moteur,
rendu navigateur ou activation du fork n'est revendiqué par ce déplacement.
