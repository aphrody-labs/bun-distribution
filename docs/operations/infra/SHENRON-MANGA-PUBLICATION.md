<!-- SPDX-License-Identifier: Apache-2.0 -->

# Publication permanente des acquisitions manga

Le pool unique `shenron-manga-workers.service` reste sur le VPS. Son transfert
borné appartient à `shenron-manga-handoff.timer` ; le consumer de publication
`shenron-manga-publication.service` tourne sur DBFR, auprès des stores existants.
Ces services ne constituent pas un deuxième crawler.

Le code produit appartient à Shenron : `manga-pool-handoff.ts`,
`manga-publication-worker.ts`, `manga-publication-validation.ts`, le planner,
l'adapter éditorial et les importers manga canoniques. Les binaires sont compilés
sur la fabrique et transférés par SFTP Infra après vérification SHA256.

## Configuration et capacités

`scripts/tools/infra/prepare-shenron-manga-runtime.ts` propose un plan puis,
avec `--apply`, projette sur DBFR les options du catalogue propriétaire partagé.
Il vérifie l'accès administratif en lecture, dérive les 21 éditions du catalogue
public et conserve seulement les credentials nécessaires dans `worker.env`
privé. Le réplica est celui du bot, dans
`/home/ubuntu/apps/shenron/shared/bot/data/bot.db` ; sa synchronisation utilise
le propriétaire produit `runReplicaSync` avec les deux seules tables manga.

Le modèle du pipeline et sa politique ne contiennent que des références de
chemins vers les stores. Leurs copies privées sur le VPS sont épinglées dans
`<pool>/candidate-template.json`, découvert sans redémarrage du pool.
Les jetons PostgreSQL, administratifs, S3 et Cloudflare restent sur DBFR.
Le renouvellement S3 réutilise le timer propriétaire existant.

Le transfert transporte les octets acquis référencés, les reçus et les fichiers
d'entrée épinglés, dans des archives tar non compressées bornées. Le descripteur
prêt apparaît atomiquement après les deux transferts. DBFR vérifie tous les SHA,
les tailles et les deux pins du modèle avant l'import privé. Les configurations
contenant des credentials et les formats non pris en charge restent en quarantaine.
La base du pool, les captures brutes et le corpus ne traversent pas les hôtes.

La capacité `shenron-manga-editorial-backup.ts` exige le compte root de DBFR et
un job sous l'inventaire privé propriétaire. Elle utilise uniquement le conteneur
PostgreSQL existant : dump complet, inventaire `pg_restore --list`, présence des
données des deux tables et des révisions, empreinte en streaming et reçu privé.
Elle n'écrit pas dans PostgreSQL. Le module d'activation CDN existant prépare
ses propres pins frais et sa sauvegarde hors hôte.

Le consumer publie les assets vérifiés avant l'import canonique, puis publie la
projection du catalogue après la relecture éditoriale. Les jobs CDN distincts
se réconcilient avec l'état réellement actif. Un chapitre absent reçoit son ID
uniquement dans la transaction canonique ; une notice et deux couvertures ne
deviennent pas des pages manga. La complétude ne se déduit pas du nombre d'images.

## Installation et observation

Relire les unités du catalogue, vérifier leurs SHA et exécuter
`systemd-analyze verify` avant installation, puis `daemon-reload` et activation
par `aphrody infra ssh exec --host <hôte>`. Le timer de transfert fonctionne
toutes les 60 secondes ; le consumer est un service permanent protégé par flock.
Le rollback arrête et désactive uniquement ces deux nouvelles unités et le timer,
en conservant les files, preuves et stores. Il ne touche pas au pool source.

Le 15 octobre 2026 à 13 h 37 UTC :

- DBFR : consumer `enabled`, `active/running`, `MainPID=1072619`,
  `NRestarts=0`, `ExecMainStatus=0`. Le cycle `once` du binaire installé a fini
  avec le code 0 ; le statut privé porte des files vides et `completeCatalogue=false`.
- VPS : timer `enabled`, `active/waiting`, dernier oneshot `Result=success`,
  `ExecMainStatus=0`. Il signale l'attente de la base du pool, qui n'est pas encore
  ouverte pendant l'attente du build source suivie par son propriétaire.
- Binaire consumer : source Shenron `bd13214e`, SHA256
  `ef76c13e372aa7c52c6d8429494c2ea6328c77c36bc744671e07c80e25a30992`.
- Gates : contrôle natif de 59 fichiers, lint et format verts ; 14 tests produit,
  60 assertions, dont lancement réel de la CLI sur une file vide. La capacité
  Infra a deux tests et cinq assertions. Le writer a aussi été qualifié sur un
  PostgreSQL 18 isolé par son propriétaire.

Cette observation prouve l'activation du consumer et de son transfert périodique.
Elle ne prouve aucune nouvelle publication, aucun dossier acquis complet ni le
démarrage des seize workers source. Aucun lot public nouveau n'a été exécuté
faute d'acquisition qualifiée. Le statut privé du consumer reste sous
`/home/ubuntu/.aphrody/private/shenron/manga-publication/worker/status.json`.
