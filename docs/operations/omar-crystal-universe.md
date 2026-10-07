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

État historique avant installation : `/home/ubuntu/.local/bin/aphrody web crawl-index --help` répondait `unrecognized subcommand 'crawl-index'` et l'aide `aphrody web --help` confirmait l'absence de cette capacité. Aucun ancien script de crawl n'a été utilisé.
`aphrody home query 'Dragon Crystal Warriors of the Universe' --profile aphrody
--limit 5` retourne `hits: []`.

Installer la capacité produit `web crawl-index` pour pouvoir indexer les fiches
autorisées (profil aphrody, labels omar, maximum 25 requêtes et profondeur 2,
respect robots), puis vérifier leur présence avec `aphrody home query`.
Cette dépendance a été levée le 2026-10-07 par installation de la capacité produit ; voir la campagne ci-dessus. L'achèvement global demeure ouvert pour le jeu complet, le corpus exhaustif et les assets sous licence.

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

`apps/community/crystal-universe/age1000-map.js` définit un plan de cinq secteurs originaux ; `game.js` le dessine sur Canvas dans le mini-jeu local. Shenron rend un schéma original sur `/games/dragon-pixel` et possède maintenant la source canonique Rust à `crates/shenron-re/src/world/xenoverse3.rs` (six zones, huit repères et sept routes), ainsi que `wasm_get_xenoverse3_prototype_map` et le wrapper Bun/TS `getXenoverse3PrototypeMap()`. Le mini-jeu standalone et la page Shenron n’ont pas encore été reliés à l’export Rust. Il s’agit d’un prototype jouable/consultable, non d’un « full game AAA » ; contenu réseau, monde ouvert, assets licenciés et progression persistante ne sont pas présents.

Le graphe Rust et les tests natifs ont été commités dans la branche locale Shenron `omar/xenoverse3-map-20261007`, commits `8db6c0f1` et `030b797e`, créée depuis `origin/main` `4c45010c`. 24 tests Rust, 10 tests Bun/TS (49 assertions), Clippy `-D warnings`, `cargo check` wasm32, génération `wasm-bindgen 0.2.129`, lint, format et diff-check passent. Le push Shenron a été réessayé et refusé par GitHub (« Write access to repository not granted »); ces commits restent locaux à la branche et ne sont pas revendiqués comme publiés. Le prototype reste non déployé.

### Périmètre dbxv2, actifs et Steam

`docs/reference/root/PLAN.md` de Shenron marque la fusion dbxv2 incomplète. `vendor/dbxv2` est un sous-module vers `aphrody-code/dbxv2`, épinglé à `fabc19c0021e3e992786dc2a093a749c8a1c26f0`; le plan l’identifie comme propriétaire/sous licence Proprietary. Le checkout du sous-module est actuellement vide, et aucun checkout/asset dbxv2 correspondant n’a été trouvé au chemin local attendu. Le commit Shenron `10fdd60c` apporte un moteur de formats en Rust, crate `shenron-re`, scan des seuls manifests d’installation Steam et wrappers WASM; cela ne prouve ni portage complet Bun/Rust, ni extraction de ressources.

Le scanner Steam existant lit `steamapps/appmanifest_*.acf`, sans jetons ni profils privés ; aucun flux de données de compte, dépôt d'assets de jeu, copie vers le PC/VPS/DBFR ou production CDN n'a été effectué. La licence et l'inventaire complet des assets du jeu/du toolkit ne permettent pas une redistribution publique dans la carte/CDN. Le contenu du jeu reste dans les stores du propriétaire ; aucun résultat d'extraction/données privées n'est ajouté à Git.

## 2026-10-07 — Connexion Dragon Pixel au RAG Shenron

L'écran Dragon Pixel expose maintenant une recherche d'archives Dragon Ball. Le serveur local valide `q` (2–120 caractères), limite la réponse à huit résultats et relaie vers l'API publique Shenron sans exposer de secret. L'interface n'insère que du texte avec `textContent` et affiche les liens sources dans un nouvel onglet isolé. Aucun scan/page d'image n'est embarqué.

Vérification réelle : serveur Bun local sur `127.0.0.1:4328`, `GET /` → 200 ; `GET /api/lore/search?q=Goku%20Namek` → 200, résultats sourcés dont « Planète Namek » et « Goku — Saga Namek » avec URLs dragonballfr.com ; entrée d'un caractère → 400. `aphrody_shenron_rag_search` confirme les mêmes corpus et extraits côté MCP. Gates du lot : `bun test apps/community/crystal-universe/engine.test.js` (5 tests, 20 assertions), `oxlint --deny-warnings apps/community/crystal-universe/*.js`, `oxfmt --check apps/community/crystal-universe`, `git diff --check` — tous verts.

Cette liaison fournit une recherche du RAG, pas l'ingestion/la redistribution de toutes les planches OCR. Le catalogue MCP expose 147 volumes/tomes OCR sur plusieurs séries, mais ce décompte seul ne prouve pas que les 42 tomes d'une édition précise ou tout Dragon Ball Super soient complets. Le jeu reste un mini-jeu Canvas 2D solo : pas de moteur Xenoverse 2, rendu 3D/WebGPU ni multijoueur réseau. Les assets et les données de Xenoverse 2 restent indisponibles localement ; `vendor/dbxv2` était absent/vide selon le relevé précédent et les assets suivis du checkout ne comprennent aucun paquet Xenoverse. Leur licence d'extraction/redistribution n'est pas établie. Aucun asset de jeu, donnée privée ou scan sous droit n'a été copié ou publié. Ces dépendances maintiennent l'objectif global ouvert.

## 2026-10-07 — Référence RAG Dragon Ball (profil Shenron isolé)

La campagne native `aphrody web dragon-ball` a collecté les cibles bornées
`wikipedia-fr,wikipedia-en`, sans galerie ni média, avec profondeur 2 et budget
global 25. `robots.txt` actuel ne bloque pas le User-Agent de la campagne sur ces
domaines. Résultat : 25 requêtes, 25 documents FR, 988 chunks indexés dans le profil
`shenron`, aucune erreur; Wikipédia EN reste en attente (9 seeds) car le budget est
épuisé. Le rapport natif `aphrody web dragon-ball status --profile shenron --json`
confirme `completed:false`, `documents:25`, `network_requests:25`.

Vérification : `aphrody home query ... --profile shenron` retrouve l’article Dragon
Ball et l’information des 42 volumes/519 chapitres, une fiche *Dragon Ball Super*
et des extraits de l’arc Moro, en français et en anglais. Le corpus est documentaire
et partiel : il ne contient pas les pages intégrales ni les images des 42 tomes; il
ne prouve pas l’exhaustivité de DBS. Aucun profil aphrody/dbfr/ie n’a été utilisé
pour cette campagne.

Reprises natives le 2026-10-07 : plusieurs tranches FR/EN, chacune plafonnée à 25
requêtes et profondeur 2, sans médias. La sortie privée compte désormais 150
documents (75 FR + 75 EN); les dernières tranches ont ajouté 25 documents et 956
chunks FR, puis 25 documents et 1 485 chunks EN, sans erreur. Les recherches du
profil `shenron` retrouvent la référence aux 42 tomes/519 chapitres et des entrées
DBS/Moro en anglais et en français. La frontier conserve 168 pages FR et 179 EN en
attente; le rapport natif reste `completed:false`. Ces références ne sont pas les
chapitres intégraux et ne démontrent pas l’exhaustivité du RAG source.

Contrôle de métadonnées du corpus manga via `dragonball.manga_tomes` (profil source
Shenron, sans conserver ni citer le texte renvoyé) : DB `vol1` indique 221 pages,
DB `vol42` 234 pages, un chapitre DBS `ch1370` 45 pages. Cela confirme des entrées
OCR aux deux extrémités de la série et dans DBS, mais pas l’existence/complétude de
chaque volume intermédiaire, la complétude de DBS, ni les droits de réutilisation.
Les réponses de détail incluent des transcriptions; aucun passage de manga n’a été
copié dans le dépôt ou affiché dans le jeu au cours de ce contrôle.

## 2026-10-07 — Commandes manette

Dragon Pixel lit maintenant l'API Gamepad du navigateur : stick gauche/croix pour
le déplacement, boutons standard A saut, X combo, B projectile, Y charge, LB
transformation et Start pause/reprise. Le Start est traité sur front montant pour
que l'appui maintenu ne bascule pas plusieurs fois; le polling fonctionne également
après reconnexion. Le module pur `gamepad.js` est servi par le serveur local.

Vérification : ajout d'un test simulant axes, D-pad, boutons, Start et déconnexion;
suite moteur `bun test apps/community/crystal-universe/engine.test.js` : 6 tests,
24 assertions, tous verts. Oxlint strict, oxfmt et diff-check verts. Le serveur sur
`127.0.0.1:4329` sert `/gamepad.js` (200) et la page (200); recherche RAG `Goku
Namek` via ce serveur renvoie des résultats avec URL source. Aucun périphérique
physique n'était connecté, donc le mapping matériel sur un vrai contrôleur reste
non qualifié. Cette entrée ne fournit pas le rendu 3D/WebGPU ni le multijoueur.

## 2026-10-07 — Atelier de création d'avatar

Dragon Pixel propose maintenant un éditeur local d'avatar original : nom, race,
coiffure, couleurs de peau, cheveux et tenue. Les choix sont normalisés et conservés
dans le `localStorage` du navigateur; l'arène dessine ces traits sans charger d'images
ni de personnages Xenoverse. Si le stockage est indisponible, l'avatar reste
utilisable en mémoire.

Vérification : test couvrant choix valides, normalisation de saisies invalides,
sérialisation/relecture et JSON corrompu. L'éditeur est un prototype 2D : aucun morph
3D, réglage avancé de proportions, équipement du jeu ou sauvegarde multijoueur.
