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

## Actualisation — 2026-10-15 à 14:15 UTC

Le correctif de préservation des BOM est livré dans Shenron `813d11d3`, intégré
sur `origin/main` (`f60ff727`). Les gates locales de son lot sont vertes : 19 tests,
121 assertions, vérification native sur six fichiers, lint et format. Un test
reconstruit 57 reçus en retrouvant exactement leur SHA-256 avec le BOM conservé ;
13 différences restent inexpliquées et quarantainées. Aucun reçu privé n'a été
réécrit et le service manga n'a pas été redémarré : l'activation du changement
dans le processus déjà lancé n'est pas prouvée.

Le statut public observé à 14:15:04 indique 329 tomes, 219 lecteurs, 110 sans
lecteur et 74 médias vérifiés dans le collecteur. À 14:14:43, le pool actif avait
terminé 2 380 tâches avec quatre workers actifs et 11 157 tâches en file. La
projection avait examiné 861 entrées, en mis 2 108 en quarantaine, et n'avait
émis aucun bundle ni écriture publique. DBFR ne comptait aucun candidat,
handoff ou tâche de publication à 14:15 ; aucun tome supplémentaire n'est donc
qualifié comme complet.

## Actualisation — 2026-10-15 à 14:57 UTC

La supervision privée Shenron a exécuté une passe `once` sur DBFR à 14:56:50
UTC. Le reçu expurgé signale un état `partial`, sans candidat nouvellement traité,
avec 6 propositions approuvées, 90 bloquées, 10 647 complètes, 3 quarantainées
et 8 rejetées. La passe suivante est planifiée à 20:56:41 UTC. Une lecture
SQLite au même moment montrait aussi des lignes remplacées et une quatrième ligne
quarantainée, d’où une différence entre le résumé du superviseur et les statuts
bruts de la file ; aucune modification manuelle des décisions n’a été faite.

L’export immuable des six propositions possède des reçus de writer déjà établis
pour cinq identifiants : section 13087 (`g2gznhxpwvrc3crbgxf5av27`), databooks
27 (`e8fk0pwtdaslbg8ynokn2mky`) et 23 (`g5xr7741sl9n1j8pfdxifvaz`), et
media work 15 (`rhzefsejmp41q4vutd577rbo`) ainsi que section 13090
(`iwymmeepzp3uda70u0u6jiqm`). La page publique de cette dernière a aussi été
relue en HTTP 200 à 14:36:48. Les reçus résident dans le store DBFR protégé ;
aucune écriture n’a été rejouée.

La preuve disponible ne couvre pas Dragon Ball SD (`media_works/7`) : aucun
reçu correspondant n’a été trouvé. Les routes d’API publiques et admin renvoient
403 depuis la session Infra actuelle, donc ce champ ne peut pas être marqué
publié ou confirmé. Les éléments disponibles ne permettent pas de qualifier les
90 propositions bloquées ; les corrections wiki restent partielles. Le timer
est actif et conserve ses limites de 4 workers / 20 candidats, sans publication
automatique.

## Actualisation — 2026-10-15 à 15:00 UTC

Le dépôt Shenron `origin/main` apporte depuis le précédent relevé les preuves
suivantes : 84 fiches wiki distinctes écrites, dont 78 textes relus exactement
sur le site public ; six articles de comédiens attendent encore le correctif
d’affichage de l’image commune. Un lot séparé de sept corrections a ses backups,
CAS, relectures et révisions signées vérifiés. Ces 84 fiches incluent les
corrections précédentes : elles ne doivent pas être additionnées aux reçus
ponctuels déjà listés ici. Dix corrections lexicales de Fû ne comptent pas comme
fiches. Le détecteur de champs manquants mesure mal certains synopsis originaux
restés nuls malgré un texte français public. Sources des reçus détaillés dans le
store Shenron protégé et docs/reference/root/REPRISE.md de son origin/main.

Le worker manga est toujours vivant (PID 4167233, démarré à 14:33:55). Reçu
expurgé du VPS à 14:57:03 : 329 tomes, 219 lecteurs complets, 110 sans lecteur,
1 169 assets vérifiés, 5 574 tâches terminées, 52 470 en attente, deux actives,
106 échouées, 296 refusées par robots, deux bloquées par le fournisseur et une
capacité search indisponible. Ces compteurs décrivent l’acquisition d’assets,
pas la validation d’un tome complet ni une publication. Le publisher DBFR reste
suspendu à l’image API exposant `readerExtent` ; aucune intégrale nouvelle n’est
annoncée.

## Correction de preuve — Dragon Ball SD, 2026-10-15 à 15:02 UTC

La lecture authentifiée du writer DBFR et de l’historique a depuis confirmé que
`media_works/7` possède un `synopsisFr` non nul, révision
`as2gz1i96bjhpr8xl9bkzfx2` du 15 octobre à 13:29:13 UTC. L’index public
`/wiki/manga` répond 200 et contient le titre Dragon Ball SD et ce synopsis.
La page détail `/wiki/manga/7` répond 404 ; cela ne contredit pas la présence du
texte dans l’index. Le synopsis public diffère de la proposition immuable
examinée dans le relevé de 14:57 : aucun PATCH n’a été effectué pendant cette
vérification et la proposition n’a pas été rejouée. Cette preuve authentifiée
remplace la mention précédente indiquant que la publication de `media_works/7`
ne pouvait être confirmée.

## Réconciliation des propositions bloquées — 2026-10-15 à 15:01 UTC

Une relecture authentifiée, sans mutation, des 90 entrées `blocked` de la file
wiki sur DBFR a obtenu 90 réponses administratives HTTP 200. Au moment de cette
lecture, 27 avaient toutes les cibles de leur proposition déjà renseignées
(4 œuvres, 18 databooks et 5 fiches de comédiens) : leur statut de file est
périmé, mais cette vérification n’a pas réécrit la base SQLite. Quarante-huit
autres ont déjà `synopsisFr` renseigné, tandis que le champ générique `synopsis`
reste nul ; ces champs ne sont pas interchangeables et ne sont pas comptés
comme deux synopsis français manquants.

Les 15 candidats dont toutes les cibles sont encore vides sont sept épisodes,
deux combats, un tournoi et cinq sections de statistiques de Vegeta. Les cinq
sections concernent le power scaling, désactivé conformément à la doctrine ;
elles ne sont pas complétées par extrapolation. Cette vérification n’est pas un
nouvel inventaire complet du wiki et ne change pas le décompte global.

## Actualisation — 2026-10-15 à 15:05 UTC

Le reçu d’acquisition public du VPS à 15:04:05 UTC compte toujours 329 tomes,
219 lecteurs complets et 110 sans lecteur. Le worker est vivant et a terminé
5 836 tâches ; il possède 1 328 assets vérifiés, avec 52 209 tâches en attente,
107 en échec, 296 refusées par robots, deux bloquées par le fournisseur et une
capacité de recherche indisponible. Aucun de ces assets n’est assimilé à un tome
complet. DBFR `/api/health` répond 200, mais le catalogue public tronqué à la
lecture ne démontre pas de nouvelle extent de lecteur ni publication.

Le dépôt Shenron contient un changement non commité sous propriétaire dans son
manifest bibliographique et deux tests : l’ISBN japonais officiel de DBS 24 est
associé à l’identifiant historique 147, tandis que le preview Shueisha est
explicitement d’une page et incomplet. Les tests ciblés passent (14 tests,
40 assertions) et `git diff --check` est propre. Cette édition précise ne
qualifie pas un tome entier. Les fichiers ont des changements locaux préexistants
dans Shenron; ce reçu ne les intègre ni ne les publie.

Le binaire Aphrody installé a été recontrôlé :
`aphrody web dragon-ball index --help` n’expose toujours pas `--catalogue`.
Le source correspondant est livré dans le fork Bun, mais ce binaire n’a pas été
reconstruit ou activé. Sur l’hôte, le volume `/home/ubuntu/build` est à 98 %
(7 Gio libres), tandis que deux builds Bun sont actifs et que le test Shenron
source tourne en 12 jobs. Je n’ai pas lancé de build Aphrody concurrent ni
contourné le verrou partagé. Le volume `/home/ubuntu/build/storage` a 549 Gio
libres, mais cette capacité ne rend pas qualifié le chemin de build courant.
