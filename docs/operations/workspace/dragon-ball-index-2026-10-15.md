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

Le wiki compte 10 754 fiches. Le snapshot éditorial présenté dans l'actualisation
ci-dessous a été corrigé après relecture : il portait sur 83 fiches et 131
champs manquants, pas 86 fiches. Sept corrections antérieures étaient déjà
publiées ; le relevé du writer a établi leurs révisions historiques.

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

## Actualisation — 2026-10-15 à 13:58 UTC

Le serveur Shenron `b90f8105` est actif et `/api/health` répond 200. La
relecture du writer a confirmé sept corrections déjà publiées, avec leurs sept
révisions historiques exactes ; aucun PATCH supplémentaire n'a été envoyé.
L'inventaire complet récent compte 10 754 fiches et 86 fiches avec 131 champs
encore manquants, contre 108 fiches au relevé précédent. Les manques touchent
55 épisodes (103 champs), une œuvre, 11 databooks, neuf sections, deux combats,
un tournoi et quatre comédiens. Quatre synopsis sont présents dans l'API
publique et la description du databook 40 apparaît sur sa page. Les notices des
comédiens ne figurent pas dans le résumé staff. Reçu privé de vérification après
release : SHA-256
`c025aa003227fceea04f3e80208672b4fe9037954418ee6a791f6be80c5dd2b8`.

Le worker manga tourne sur le VPS depuis 13:55:40 UTC (PID 4051905, aucun
redémarrage). Le reçu de progression public observé à 13:56:40 UTC compte 329
tomes, 219 lecteurs complets, 52 220 pages de catalogue et zéro média vérifié.
Le worker accepte 16 tâches en parallèle et en exécutait quatre, avec 1 316
tâches en attente, 176 terminées, trois échouées, 64 refusées par robots et une
tâche sans capacité requise. Le service de publication manga DBFR est actif ;
`/api/health` répond 200, tandis que
`/api/manga/coverage` répond encore 404. À 13:58 UTC, la file canonique du
publisher ne contenait aucun bundle qualifié, candidat ou handoff ; le dernier
reçu de projection indiquait zéro émission et zéro écriture publique. Les 110
tomes restent donc sans lecteur complet public. Les 31 pages Jump+ de Yamcha
déjà vérifiées ne constituent pas un tome complet. Les tâches terminées ou les
pages listées ne sont pas comptées comme ressources manga acquises.

La source de l'index catalogue reste livrée sur le fork Bun, avec ses gates Rust
verts. En revanche, `aphrody web dragon-ball index --help` depuis le binaire
installé n'expose que `--output`, `--profile`, `--state` et `--json` ; il ne
reconnaît pas encore `--catalogue`. Le binaire complet n'a donc pas été reconstruit,
installé ni activé après le commit de source. Aucun build CLI séparé n'a été
lancé pendant les compilations Bun partagées. Le stockage dédié
`/home/ubuntu/build/storage` dispose de 492 Gio libres sur un volume de 492 Gio ;
`/home/ubuntu/build` n'en a que 3,4 Gio.

Les comptes de progression manga et l'inventaire wiki restent des observations
datées. Les sources privées, propositions, médias et détails d'identification
des tomes demeurent dans le store Shenron protégé.

## Actualisation — 2026-10-15 à 14:07 UTC

Le writer wiki a appliqué à `media_works/14` une correction du synopsis français
avec backup, snapshot frais, CAS et relecture indépendante. La révision
`eex86twbniakbab3oqq6e0e1` est visible sur l'API publique (HTTP 200). Au relevé
GET seul de 14:07:15, il reste 77 fiches avec 125 champs manquants : 55 épisodes
(103 champs), six databooks, neuf sections, deux combats, un tournoi et quatre
comédiens. L'œuvre est complète. D'autres writers ont aussi complété cinq
databooks depuis le précédent snapshot ; leurs écritures n'ont pas été rejouées
ni écrasées. Le serveur `b90f8105` reste actif et son claim d'activation demeure
chez son propriétaire. L'inventaire ne prouve pas que les 77 fiches soient
documentables : les candidats sans source ou avec données en conflit restent
non modifiés.

Le statut expurgé du worker manga public observé à 14:05:41 compte 329 tomes,
219 avec lecteur, 110 sans lecteur, 53 220 pages listées et zéro média vérifié.
Le pool configuré pour seize workers en exécutait cinq ; 1 316 tâches étaient
terminées, 2 470 en attente, 74 en échec et 279 refusées par robots. Le publisher
DBFR est actif, mais son état relevé à 14:04:59 n'avait aucun bundle, candidat
ou handoff qualifié ; la dernière projection indiquait zéro émission et écriture
publique. Il n'existe toujours pas de galerie complète associée à une édition
exacte pour les 110 tomes. Les 31 pages Jump+ de Yamcha ne forment pas un tome.

À 14:05 UTC, un build release Bun partagé était actif avec quatre jobs ; le
build debug précédent utilisait douze. Le volume dédié libre ne justifie pas de
contourner le verrou de build. Le binaire `aphrody web dragon-ball index --help`
installé ne reconnaît toujours pas `--catalogue` ; sa reconstruction,
installation et activation restent à qualifier.
