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

[Dragon Pixel](../../apps/community/crystal-universe/README.md) est la proposition
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

## Nom du jeu — 2026-10-07

Demande authentifiée : [nommer le jeu « Dragon Pixel »](https://discord.com/channels/1554189180030947338/1557354118710829117/1557386591985602601).
Le titre HTML, le titre visible, le README et le message du serveur portent
désormais ce nom. Le chemin technique `apps/community/crystal-universe/`
reste compatible avec les commandes et liens existants. Les noms des jeux
ayant inspiré ses mécaniques conservent leur attribution.

Vérification actuelle du renommage : serveur Bun lancé sur `127.0.0.1:4318`,
réponse HTTP 200 analysée : `<title>Dragon Pixel — mini-jeu d'Omar</title>`
et texte du `<h1>` égal à `Dragon Pixel` ; ancien nom absent du HTML servi.
Sortie du serveur : `Dragon Pixel: http://127.0.0.1:4318/`.
Tests moteur : 5 réussis, 20 assertions ; oxlint strict, oxfmt et
`git diff --check` réussis. Aucun déploiement public effectué.

## 2026-10-07 — sources officielles et carte AGE 1000

### État des annonces (vérifié le 2026-10-07)

- Toei Animation annonce **Dragon Ball Super: Beerus** comme édition *enhanced* de l’anime Dragon Ball Super, pour l’automne 2026 ; la page officielle renvoie à une bande-annonce de lancement et un visuel. Le même communiqué annonce la production de **Dragon Ball Super: The Galactic Patrol**. Aucune image sous copyright n’est reprise dans le prototype.
- Bandai Namco annonce Xenoverse 3 sur PS5, Xbox Series et PC/Steam pour 2027. Les descriptions officielles présentent West City en AGE 1000, son université et ses quartiers, le Great Saiya Squad, un accès d’expédition vers un glacier, la création de héros, la coopération, Soul Assist/Soul Switch/Awoken et des styles de combat. Les captures officielles sont descriptives, non incorporées.
- La carte complète des zones et leurs connexions n’a pas été publiée dans les sources examinées. Le plan livré est une proposition de prototype original, pas une reconstruction fidèle ni une carte officielle. Les fonctionnalités et visuels annoncés peuvent changer avant la sortie.

Sources primaires :

- Toei Animation, annonce « Dragon Ball Super: Beerus » : <https://www.toei-animation.com/dragon-ball-super-beerus/>.
- Toei Animation, « The Galactic Patrol Set For Production » : <https://www.toei-animation.com/dragon-ball-super-the-galactic-patrol/>.
- Bandai Namco Europe, trailer West City (23 juin 2026) : <https://en.bandainamcoent.eu/dragon-ball/news/become-the-hero-of-new-dragon-ball-era-dragon-ball-xenoverse-3>.
- Bandai Namco Europe, guide de combat (11 septembre 2026) : <https://en.bandainamcoent.eu/dragon-ball/news/dragon-ball-xenoverse-3-battle-system-guide>.
- Dragon Ball Official Site, compte rendu de démo : <https://en.dragon-ball-official.com/news/01_4279.html>.
- Steam, fiche publique DB Xenoverse 2 (propriétaire, modes, personnalisation) : <https://store.steampowered.com/app/454650/DRAGON_BALL_XENOVERSE_2/>.

Indexation native effectuée le 2026-10-07 :
`/home/ubuntu/.local/bin/aphrody web crawl-index <4 URL officielles> --label omar-xenoverse3-super-remake --profile aphrody --max-requests 25 --max-depth 2` : 25 requêtes, 24 pages écrites, 0 erreur, 191 chunks, frontier incomplète (450 pending). Les requêtes `aphrody home query --profile aphrody` pour « Xenoverse 3 West City AGE 1000 combat trailer » et « Dragon Ball Super Beerus enhanced visual trailer fall 2026 » retrouvent respectivement les annonces officielles Xenoverse 3/West City et Beerus/visuel. Le profil `aphrody` a été utilisé ; aucune donnée des profils dbfr/ie n’a été consultée.

### Livrable carte

`apps/community/crystal-universe/age1000-map.js` définit un plan de cinq secteurs originaux ; `game.js` le dessine sur Canvas dans le mini-jeu local. Shenron rend le même concept dans `apps/site/src/app/games/dragon-pixel/age1000-map.ts` et `Age1000Map.tsx`, sur `/games/dragon-pixel`. Un graphe Rust source-attributed a aussi été ajouté dans `shenron-re/crates/shenron-re/src/world/xenoverse3.rs` (six zones, huit repères et six routes), avec l’export `wasm_get_xenoverse3_prototype_map`; crate tests, Clippy strict et check WASM ciblé verts. La carte est un prototype jouable/consultable, non un « full game AAA »; le site utilise actuellement son schéma TypeScript original et non encore les données exportées par Rust/WASM. Contenu réseau, monde ouvert, assets licenciés et progression persistante ne sont pas présents.

Le module Rust a été commité sur la branche locale Shenron `omar/xenoverse3-map-20261007` au commit `8db6c0f1`, créée sur `origin/main` (`4c45010c`). 24 tests Rust, Clippy `-D warnings`, `cargo check` wasm32 et diff-check passent. Le push Shenron a été refusé par GitHub (droits d’écriture non accordés); le commit reste local à cette branche et n’est pas revendiqué comme publié. `wasm-bindgen` CLI est absent, le paquet WASM généré et l’intégration web à partir du nouvel export restent à faire.

### Périmètre dbxv2, actifs et Steam

`docs/reference/root/PLAN.md` de Shenron marque la fusion dbxv2 incomplète. `vendor/dbxv2` est un sous-module vers `aphrody-code/dbxv2`, épinglé à `fabc19c0021e3e992786dc2a093a749c8a1c26f0`; le plan l’identifie comme propriétaire/sous licence Proprietary. Le checkout du sous-module est actuellement vide, et aucun checkout/asset dbxv2 correspondant n’a été trouvé au chemin local attendu. Le commit Shenron `10fdd60c` apporte un moteur de formats en Rust, crate `shenron-re`, scan des seuls manifests d’installation Steam et wrappers WASM; cela ne prouve ni portage complet Bun/Rust, ni extraction de ressources.

Le scanner Steam existant lit `steamapps/appmanifest_*.acf`, sans jetons ni profils privés ; aucun flux de données de compte, dépôt d’assets de jeu, copie vers le PC/VPS/DBFR ou production CDN n’a été effectué. La licence et l’inventaire complet des assets du jeu/du toolkit ne permettent pas une redistribution publique dans la carte/CDN. Le contenu du jeu reste dans les stores du propriétaire ; aucun résultat d’extraction/données privées n’est ajouté à Git.
