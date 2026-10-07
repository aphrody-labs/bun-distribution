<!-- SPDX-License-Identifier: Apache-2.0 -->

# Chronologie Shenron : code Bun et rafraîchissement

La collecte et les projections appartiennent au paquet
[`@aphrody/timeline`](../../../packages/web/timeline/README.md). Les anciens
scripts `scripts/tools/web/timeline/` ont été retirés. Le raccordement au foyer
DBFR est dans le propriétaire existant
[`@aphrody/workspace`](../../../packages/infra/workspace/src/shenron.ts), appelé
par `yolo ops shenron timeline`. La bibliothèque ne lance aucun sous-processus ;
l'adaptateur Infra appelle le propriétaire natif `aphrody home index`.

## Sources et résultats observés le 7 octobre 2026

La source est <https://dragonballfr.com/wiki/timeline>. Son ordre vient de
<https://dragonballfr.com/api/timeline>, et les références imprimées des Âges
viennent de <https://dragonballfr.com/api/public/wiki/timeline_events>.

| Projection sur DBFR             | Preuve observée                                                              |
| ------------------------------- | ---------------------------------------------------------------------------- |
| JSON                            | 684 médias et 32 repères d'Âges                                              |
| Table SQLite `shenron_timeline` | 659 épisodes, 9 films, 16 tomes, 32 Âges                                     |
| SQL                             | Import transactionnel exporté ; pas de modification éditoriale PostgreSQL    |
| Redis                           | Hash : 716 ; ensemble médias : 684 ; ensemble Âges : 32                      |
| GraphQL                         | Requête HTTP réelle ; référence au Daizenshuu 7 et Âge −4237 retrouvés       |
| Foyer DBFR                      | 716 passages ajoutés ; recherche native retrouve « Naissance des Kaïōshins » |
| Données de formation            | 655 exemples train et 61 évaluation ; aucun entraînement exécuté             |

Le corpus et les exports vivent dans le store protégé
`/home/ubuntu/.aphrody/workspaces/dbfr/private/web/timeline/`, hors dépôt. Les
fiches vérifiées des 16 tomes publiés répondent HTTP 200. Le crawl incrémental
revisite 32 fiches par passage à une requête par seconde, conserve les derniers
textes valides en cas de panne et renouvelle les projections.
Deux passages ont vérifié 64 fiches sans échec. Le dernier passage a actualisé
32 documents du foyer DBFR, sans erreur d'indexation.

## Exécution et installation

```sh
yolo ops shenron timeline refresh --output /chemin/prive/timeline --index --crawl-budget 32
yolo ops shenron timeline query --output /chemin/prive/timeline
```

`SHENRON_TIMELINE_REDIS_URL` sélectionne l'instance Redis. Les unités sont
déclarées dans le [catalogue Infra](../../../config/host/catalog.json) :

- [`shenron-timeline-refresh.service`](../../../config/host/systemd/shenron/shenron-timeline-refresh.service)
- [`shenron-timeline-refresh.timer`](../../../config/host/systemd/shenron/shenron-timeline-refresh.timer)
- [`shenron-timeline-api.service`](../../../config/host/systemd/shenron/shenron-timeline-api.service)

Le timer est horaire, persistant, avec cinq minutes de délai aléatoire. Le
serveur JSON/GraphQL écoute seulement sur `127.0.0.1:8813`. Aucune route publique
ni règle Nginx n'a été ajoutée. Le module déployé est le build Bun du propriétaire
Workspace, installé dans `/home/ubuntu/.local/lib/aphrody/shenron/workspace.mjs`.
La bascule vers ce module a été qualifiée par le résultat systemd `success`,
le code de sortie zéro et une réponse HTTP 200 du serveur JSON/GraphQL.

Pour livrer : compiler `packages/infra/workspace/src/shenron.ts` avec `bun build
--target=bun`, composer les unités avec le propriétaire `packages/engine/core`,
transférer via `aphrody infra ssh sftp`, vérifier le SHA-256 du module et les
unités avec `systemd-analyze verify`, puis appliquer via `aphrody infra ssh
exec`. Vérifier le résultat du service, le timer, HTTP GraphQL et Redis. Un
repli arrête les deux unités persistantes et préserve tout le store privé.

## Validation et travail restant

Huit tests Bun passent : ordre éditorial, intégrité de collection, pagination,
provenance, SQL idempotent, séparation train/évaluation, panne/récupération des
fiches et import dans une autre application via `Bun.serve`. Les typechecks du
paquet et du propriétaire Workspace passent, ainsi que oxlint strict et oxfmt.
Le catalogue global présente quatre unités Shenron non déclarées dans d'autres
chantiers ; elles restent sous leurs propriétaires.

L'entraînement des poids, son évaluation et la promotion restent ouverts. Le
placement propriétaire est le WSL d'Omar ; l'inventaire actuel indique son accès
authentifié non activé. Les binaires Aphrody inspectés sur le poste et DBFR ne
portent pas la fonctionnalité `train`. L'indexation du foyer ne prouve pas que
le chat de production consomme déjà ces passages, ni que des vecteurs ont été
calculés. La collecte complète des fiches liées, la correction de leurs pannes
éventuelles et la qualification du modèle restent à vérifier.
