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

## Actualisation — 2026-10-15 à 16:41 UTC

Le `main` local est aligné sur `origin/main` au commit
`8fe0645e6909bf0e61e8373f2d148de8e0f5752f`. Le binaire Aphrody installé a
encore été vérifié ; `aphrody web dragon-ball index --help` ne présente pas
`--catalogue`. Le source Rust correspondant reste sur le fork Bun au commit
`bcf03c2fae8d54f6657dbe3ac5df14807c8ba7af`.

J’ai préparé deux worktrees propres isolés et synchronisé leur source exacte sur
le VPS. Le premier build a échoué avant compilation, car le chemin `../bun` du
workspace n’avait pas encore reçu son snapshot ; le dépôt secondaire a ensuite
été synchronisé et vérifié au commit Bun indiqué ci-dessus. Trois invocations
ont échoué immédiatement avec `no such command: cargo` : l’interface
`vps-cargo run` attend directement les arguments Cargo, et les appels initiaux
avaient répété le mot `cargo`. La commande correctement formée,
`vps-cargo run --jobs auto -- build --release -p aphrody --features index
--locked`, a compilé les dépendances et les crates Bun/Aphrody avec 12 jobs.
Après un scan initial lent du cache Git partagé, elle a échoué avec code 101 sur
le module transféré `crates/os/kernel/core/src/gcs.rs` :
`aphrody-web-source::module!` refuse ce chemin car le fichier correspondant
manque dans `packages/web/rust/integrations/` du fork Bun piné. Les références
`crate::gcs` échouent ensuite en cascade. Pourtant,
`packages/web/rust/transfer-receipt.json` possède l’entrée source/destination
de ce fichier ; la réconciliation est incomplète dans le commit Bun
`bcf03c2fae8d54f6657dbe3ac5df14807c8ba7af`. Le binaire complet n’a donc pas été
produit.

Au relevé VPS suivant : 12 CPU, 19 Gio de mémoire disponibles, 515 Gio libres
sur `/home/ubuntu/build/storage`, mais 2,2 Gio libres sur le volume déclaré
`/home/ubuntu/build` (100 %) et swap saturé. Le linker du build Bun partagé
attendait le stockage depuis plus de 31 minutes et des lectures Git/ext4 étaient
bloquées. Les verrous Cargo sont désormais libres et les snapshots distants
restent isolés sur les révisions attendues. Je n’ai ni contourné les verrous, ni
modifié les jobs ou caches concurrents.

Gates locaux sur worktree pruné : `cargo metadata --no-deps --format-version 1
--locked` passe ; `bun check` ne démarre pas, car `@types/bun` et `@types/node`
ne sont pas installés. `bun install --frozen-lockfile --offline` est impossible
dans ce snapshot incomplet : dix workspaces Material externes requis manquent.
La source Rust transférée avait déjà ses gates ciblés verts dans le reçu de
livraison initial ; cette tentative n’ajoute donc pas une qualification du
binaire CLI complet. `aphrody --help` n’a pas été installé ni activé.

Les données manga/wiki demeurent sous le propriétaire Shenron. Le dernier reçu
disponible ici reste celui de 15:05 UTC : 329 tomes, 219 lecteurs complets, 110
sans lecteur public ; les assets collectés ne sont pas des intégrales. Le relevé
wiki antérieur compte 84 fiches écrites dont 78 textes exactement relus en
public, avec six profils de comédiens attendant le correctif d’affichage et des
candidats bloqués non documentables. Je n’ai fait aucune nouvelle écriture
éditoriale ou mutation de publication. Les deux claims d’intégration affichent
`released`; le claim d’activation Shenron reste détenu par son propriétaire.

## Actualisation — 2026-10-15 à 17:03 UTC

Le source Bun nécessaire à l’intégration, après restauration exacte de la
source GCS transférée (SHA-256
`5ac01afcbe07fddfc8e60af17a4535db40b70dd35d7c908988f4d93b629b8a17`), est
commité et poussé sur `aphrody-labs/bun/main` en `6f1c9a1ccc2039e57d0a46b6234b65d87db61b04`.
Le build release ciblé Aphrody a réussi par l’usine déclarée, avec 12 jobs :

```sh
bun scripts/build/rust/vps-cargo.ts run --jobs auto \
  --config /home/ubuntu/aphrody-build/dragonball/vps-cargo.json -- \
  build --release -p aphrody --features index --locked
```

Le build a terminé en 8 min 43 s. Il reste des avertissements non bloquants
existants (exigence semver avec métadonnées, documentation/commentaires et
fonction inutilisés). L’artefact
`/home/ubuntu/aphrody-build/dragonball/aphrody-bin/aphrody` et le binaire
installé `~/.local/share/aphrody/bin/aphrody` ont tous deux le SHA-256
`18c1816a12d14f1117291b82bdd2836a83be5ce9f605b55d2144ed5a6eac68f5`.
L’installation a conservé l’ancien binaire et évité l’activation du démarrage
(`self install --keep-legacy --no-boot`). L’aide du binaire installé expose
`--catalogue`. Le test hors ligne d’un catalogue synthétique `shenron-manga-cdn/v1`
a matérialisé et indexé deux documents sans erreur, avec les titres, ISBN et
empreinte attendus ; il ne lit ni ne republie de corpus privé ou de médias.

Le test Rust ciblé de `aphrody-web-source`, lancé via le même factory avec
`--locked`, a ensuite passé après la libération des verrous partagés : 3 tests
unitaires de source, 5 tests de catalogue, 2 tests consommateur et 2 doctests
(dont un compile-fail), zéro échec. Il a compilé `aphrody-web-source` et
`catalogue_index` en profil release.

Le reçu public du worker sur le VPS observé à 17:03:08 UTC indique 329 volumes,
222 lisibles et 107 sans lecteur complet, 53 304 pages listées et 1 995 assets
vérifiés ; la recherche est toujours indisponible. Le worker est `running`, avec
16 workers configurés (aucun actif à cet instant), 51 544 tâches en attente,
6 503 terminées, 111 en échec, 296 refusées par robots et deux bloquées par le
fournisseur. Ces assets ne prouvent pas l’intégralité d’un volume. DBFR
`/api/health` répond 200 et `/wiki/manga` répond avec sa page HTML publique ;
cela ne constitue ni un audit exhaustif des fiches ni une confirmation du nombre
total d’entrées exactes. Aucune donnée wiki/manga éditoriale n’a été écrite ou
publiée dans cette actualisation.

## Actualisation — 2026-10-15 à 17:16 UTC

Le reçu public du worker observé à 17:15:13 UTC conserve 329 volumes, 222
lisibles, 1 995 assets vérifiés et `search: unavailable`; sa prochaine
réconciliation est planifiée à 18:15:13. Le processus tourne sous une limite de
12 cœurs et 20 Gio, sans throttling CPU observé, avec environ 373 Mio de mémoire
utilisée. Au relevé, la progression indique zéro worker actif et zéro tâche en
cours malgré 51 544 tâches en attente. La capacité CPU/mémoire est donc déjà
déclarée par l’unité, mais l’absence de recherche reste une limite de couverture ;
il n’y a pas de justification à allouer de la mémoire artificielle.

La tentative de planification d’un manifeste wiki approuvé a été refusée avant
toute mutation, car le snapshot administratif avait changé. Une relecture
authentifiée confirme que plusieurs propositions correspondantes ont déjà été
remplies ou remplacées : les notices `db_databooks/23` et `/27`, Jaco (`15`),
et les sections Vegeta `13087` et `13090` contiennent les textes approuvés ; le
synopsis de Dragon Ball SD (`media_works/7`) a une autre formulation actuelle ;
celui de SDBH (`11`) est également déjà renseigné. Aucune de ces opérations
obsolètes n’a été réappliquée. L’export immuable et la file restent préservés ;
les corrections futures nécessitent un snapshot neuf et une nouvelle revue
indépendante.

## Actualisation — 2026-10-15 à 17:31 UTC

Le pool manga tournait à environ 93 % d’un cœur avec 456 Mio résidents
(pic historique 1,4 Gio), sous son plafond déclaré de 12 cœurs et 20 Gio. Il
avait 16 workers configurés, zéro tâche active, 51 544 en attente et 6 503
terminées. Le CPU élevé malgré l’absence d’activité justifiait une correction
du polling, pas une hausse artificielle de mémoire.

Shenron `c23af7334560415973d61f51a6ce16569f1c308b` arrête maintenant le scan
des slots dès que `claim()` ne trouve plus de tâche éligible : la file SQLite
était interrogée jusqu’à 16 fois par tour sans qu’un slot supplémentaire
puisse rendre une tâche réclamable. Le correctif a passé 23 tests ciblés et
187 assertions, `bun check`, `bun fmt --check` et `bun lint` sur le fichier
(avertissements existants du fichier, aucune erreur). Les mêmes portes ont
été rejouées sur le VPS après fast-forward ; le SHA des octets déployés a été
comparé avec le commit.

Le seul service manga, `shenron-manga-workers.service`, a redémarré via Infra.
Le nouveau PID 602749 a écrit `ready.json` et `workers.json` pour 16 workers,
avec le runtime Bun 1.4.4 qualifié (`dfde053a…`). Le statut public confirme
`activeWorkers=0`, `running=0`, 51 544 en file et `search=unavailable`.
Une mesure courte immédiatement après le démarrage oscillait entre 65 et 84 %
d’un cœur, donc elle ne suffit pas à revendiquer un gain comparatif durable ;
la récupération du pool et les lectures SQLite restent à profiler. Limites
systemd inchangées : `CPUQuota=1200%`, `MemoryHigh=16G`, `MemoryMax=20G`.

L’API publique est toujours à 329 volumes, 222 avec lecteur complet et 107
sans lecteur complet ; les 3 aperçus connus gardent leur statut partiel,
soit 110 volumes manquants ou partiels. Le worker ne constitue pas une preuve
de complétude. La recherche Google reste bloquée par la réponse anonyme vide ;
aucun retry ni contournement n’a été fait. Les propositions wiki restent
partielles : plusieurs approuvées sont déjà présentes sous un autre texte et
les sources officielles manquent pour les éléments encore vides ; aucune
écriture wiki n’a été ajoutée dans ce lot.

## Index RAG terminé — 2026-10-15

La génération locale du catalogue Dragon Ball s’est achevée dans le profil
`workspace-shenron`. Le run 17 est `succeeded` : 85 828 documents indexés,
89 802 chunks, 0 erreur et 0 document inchangé. Le run graphe 18 a aussi
réussi : 85 828 fichiers scannés et hachés, 171 656 nœuds, 85 828 arêtes,
0 erreur. Les entrées provenaient de quatre exports locaux fournis à
`aphrody web dragon-ball index --catalogue` (catalogue Shenron, épisodes
Toei, statistiques Jump et actualités officielles). Les fichiers et la base
restent dans le profil privé Shenron ; les compteurs décrivent cet index
privé et ne signifient pas que les contenus manga manquants ont été acquis,
ni qu’ils sont publiquement lisibles.

La porte `bun run docs:check` a été exécutée et échoue sur des artefacts
documentaires préexistants obsolètes (`STATE.md`, `llms.txt`, README racine,
`docs/README.md`, `documentation.json` et quatre fichiers `docs/ecosystem`),
ainsi qu’un groupe de doublons exacts conservé. Le reçu passe
`git diff --check`. Son commit n’a pas été créé dans cette session : le
fichier partagé `.git/index.lock`, vide et sans processus propriétaire
visible, bloque toujours toute mise à jour de l’index Git. Les changements
concurrents sous `packages/infra/paths/` sont préservés.

## Complément et correction de livraison — 2026-10-15 à 18:00 UTC

Correction : le reçu a depuis été committé et poussé sur `main` par
`d00029296941df7bc8c7a0439b9786922cd89a3f` ; son SHA distant a été relu. Le
verrou orphelin avait pu être retiré après vérification de son âge, de son
contenu vide et de l’absence de détenteur. Le commit n’inclut que ce document.

La couverture publique relue à 18:00:22 donne 329 notices : 222 avec des pages
listées, 107 sans page listée, et trois volumes qui ne sont que des aperçus
(147, 619, 620). Les 107 se répartissent en 90 notices hors SOSH sans pages
listées — ARALE 33, DBGT_ANIME_COMICS 3, DBS_ANIME_COMICS 3,
DB_LIGHT_NOVELS 3, DB_SD 23, JACO 3, NEKOMAJIN 3, SDBH 19 — et 17 fiches
SOSH (702–718) sans page. La couverture précise que l’intégralité de la
pagination et la disponibilité des assets ne sont pas vérifiées ; ces nombres
ne prouvent donc pas que les 222 lecteurs listés soient complets.

À 18:00, le pool de collecte restait actif avec 16 workers configurés, zéro
tâche active, 51 544 en file, 6 503 terminées, 111 en échec/reprise, 296
refus robots, deux blocages de fournisseur et une capacité de recherche
indisponible. Le reçu de projection compte 3 966 documents projetés, zéro
candidat émis, zéro écriture publique et zéro écriture éditoriale. Les 3 989
quarantaines se répartissent entre 3 498 identités édition/ISBN exactes
insuffisantes, 468 galeries natives ordonnées absentes et 23 empreintes de
capture différentes. Cela exclut une publication sûre par les writers
canoniques à partir des candidats actuels.

La page de [Shueisha pour Dragon Ball SD 10](https://www.shueisha.co.jp/books/items/contents.html?isbn=978-4-08-883767-3)
confirme le titre, 192 pages imprimées, l’ISBN et un lien officiel « essai ».
Ce lien mène à un aperçu éditeur et n’établit ni l’accès aux 192 pages ni une
pagination exploitable pour les autres éditions. La capture d’aperçus publics
est déjà revendiquée par `.coord/claims/codex-shueisha-preview-capture.json` ;
aucun captureur ni sortie privée de ce propriétaire n’a été modifié ou lancé.
La campagne wiki a aussi un claim actif sur son inventaire et ses propositions ;
aucune proposition ni écriture publique n’a été ajoutée ici.
