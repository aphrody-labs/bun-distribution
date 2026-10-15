<!-- SPDX-License-Identifier: Apache-2.0 -->
# Index Dragon Ball et complétude Shenron — 2026-10-15

## Demande et propriétaires

Enrichir `aphrody web dragon-ball index` avec les exports du catalogue Shenron,
puis compléter les 110 tomes manquants et les lacunes du wiki. Le produit
Aphrody conserve l'intégration ; les sources Rust Web transférées restent dans
le fork Bun, sous `packages/web/rust`. Les données éditoriales et lecteurs sont
administrés par Shenron et ses writers existants.

La commande d'indexation accepte les catalogues publics locaux par l'option
répétable `--catalogue` (`--catalog`). Les exports connus sont également lus dans
le dossier de campagne. Un catalogue explicite peut initialiser un nouveau
dossier privé. Chaque tome, chapitre, publication, épisode, article, statistique
Jump et asset devient consultable avec ses métadonnées et sa provenance.
Les corps JSONL conservent aussi langue, catégorie, auteurs, champs structurés
et références médias. Les pages du catalogue CDN restent locales ; leur SHA-256,
révision, dénombrement et unicité sont vérifiés avant l'écriture des documents.

La chaîne réutilise `aphrody-command`, `aphrody-web-crawl`,
`aphrody-web-extract`, le DOM du fork et `aphrody-rag`. Aucun moteur,
dépendance, corpus ou média n'est copié dans Aphrody. Le profil `shenron`
reste isolé. Les lecteurs, OCR, arbitrages canoniques et écritures éditoriales
ne sont pas activés par une indexation hors ligne.

## Ressources du contexte

La demande suivante autorise l'utilisation simultanée des CPU et de la mémoire.
L'inventaire local relève 12 vCPU et 45 Gio de RAM, dont environ 25 Gio
disponibles. L'attente disque reste élevée ; le volume de travail est à 98 %.
`APHRODY_CARGO_JOBS=auto` sélectionne désormais les CPU disponibles dans le
wrapper existant, en conservant ses verrous et le cache partagé. Les valeurs
numériques et le comportement par défaut conservent leur contrat précédent.
Le test Web ciblé a été relancé avec 12 jobs, en réutilisant ses artefacts.
Les tests du wrapper utilisent un répertoire temporaire en RAM. Le préchargement
en 12 lectures parallèles a également relu 4 178 manifestes Cargo, soit
10 139 180 octets, sans erreur ; aucune accélération comparative n'est revendiquée.
Aucune suppression de stores, aucun déplacement de cache partagé ou arrêt de
build concurrent n'a été effectué.

## Données et limites observées

L'API publique confirme 329 tomes, 219 lisibles et 110 sans lecteur. La collecte
officielle Jump+ a vérifié 31 pages japonaises de Yamcha : 31 GET réussis,
31 SHA distincts et 8 193 654 octets. L'épisode suivant est non public et ne
fournit pas de structure de pages. Cette sérialisation partielle ne prouve pas
la complétude du tome relié ; aucun nouveau tome complet n'est annoncé.
Le reçu d'acquisition et les références restent dans le store privé.

Le wiki compte 10 754 fiches, dont 108 champs à compléter dans la queue fraîche.
Sept propositions disposent de citations officielles ; les 11 URL sources
ont été requalifiées depuis DBFR. Leur application attend la release serveur
compatible avec les snapshots et comparaisons optimistes du writer existant.
Aucun PATCH n'a été effectué au moment de cet audit.

L'image `b90f81052ef4ec7947dfea4f597eecf4f77e4811` a ensuite été construite.
Le smoke historique a échoué car `docker0` est absent ; la même image immuable
a passé les smokes de version et de bot avec `--network=none`. Le terminal
historique reste à 1 et les scripts de packaging privés refusent un reçu
alternatif. Le claim exclusif d'activation du propriétaire est préservé :
aucun transport d'image, cutover concurrent ou PATCH n'est annoncé.

## Livraisons et vérification

L'index enrichi est livré sur `origin/main` du fork Bun par `e09dda60ae`,
dans les propriétaires Rust existants et leur intégration CLI transférée.

Le mode CPU explicite est livré sur `origin/main` d'Aphrody par `f05eafe5d` :
9 tests, 29 assertions, `bun check`, `bun lint`, `bun fmt --check`, syntaxe
Bash et contrôle des espaces passent sur le wrapper et ses tests.

La collecte Jump+ est livrée sur `origin/main` de Shenron par `6c11a02e`
(greffe du lot local `a4fa57d5`, modifications concurrentes conservées) :
10 tests, 69 assertions et gates Bun ciblés passent. Le worker reste en attente
de sa dépendance native ; ce commit ne prouve pas de nouveau tome complet.

Le SDK source Web passe ses 10 tests et son Clippy strict ciblé. Les 69 tests
du crawler Rust passent également sur le lot final. Le test de reprise vérifie
désormais les trois documents produits (texte et deux références médias),
ainsi que l'absence de nouvelle requête à la reprise. Le format Rust et le
contrôle des espaces passent sur les chemins modifiés.
Le Clippy du crawler avec `--all-targets -- -D warnings` passe également.
Ces gates qualifient le crawler et le SDK source ; le binaire CLI complet,
son installation et son activation ne sont pas qualifiés par ce lot.

Les preuves détaillées et les snapshots éditoriaux restent dans les rapports
privés Shenron. Les décomptes ci-dessus décrivent l'observation datée, pas une
complétude des mangas, du wiki, du crawl, du runtime installé ou du site actif.
