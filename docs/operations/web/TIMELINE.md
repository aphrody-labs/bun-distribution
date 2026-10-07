<!-- SPDX-License-Identifier: Apache-2.0 -->

# Chronologie Shenron : code Bun et rafraîchissement

La collecte et les projections appartiennent au paquet
[`@aphrody/timeline`](../../../packages/web/timeline/README.md). La collecte
précédente sous scripts/tools/web/timeline/ a été retirée. Le raccordement au foyer
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
| RAG de production               | 716 passages et 716 vecteurs E5, dans l'espace `shenron:timeline`              |
| Chat public                     | HTTP 200 hybride ; cinq passages de cette projection, dont l'identité attendue |
| Données de formation            | 655 exemples train et 61 évaluation ; aucun entraînement exécuté             |

Le corpus et les exports vivent dans le store protégé
`/home/ubuntu/.aphrody/workspaces/dbfr/private/web/timeline/`, hors dépôt. Les
fiches vérifiées des 16 tomes publiés répondent HTTP 200. Le crawl incrémental
revisite 32 fiches par passage à une requête par seconde, conserve les derniers
textes valides en cas de panne et renouvelle les projections.
Le passage complet a vérifié les 716 fiches sans échec, puis actualisé les
652 documents restants du foyer DBFR, sans erreur d'indexation. Les exemples
train/évaluation reçoivent également ces textes enrichis au rafraîchissement.
Les 655 exemples train et les 61 exemples d'évaluation ont tous une fiche
source et leurs identités ne se recouvrent pas. Le rafraîchissement raccordé
au RAG de production s'est terminé avec `Result=success`, code zéro,
716 accusés d'indexation vectorielle et aucun retrait initial.

La bibliothèque Bun produit également `prepared/rollouts.jsonl`,
`gold.jsonl` et `training.json`, avec les empreintes SHA-256 des entrées.
Le chargeur existant `aphrody_train.lora.load_examples`, exécuté avec
Python 3.12.15 dans l'environnement propriétaire déjà installé, accepte
les 655 exemples et son contrôle anti-fuite passe contre les 61 cas gold.
Les questions commencent par l'identité de la fiche ; les cibles gold
utilisent l'API détail pour distinguer les Âges partageant une même page.
Le modèle, le bail GPU et l'export GGUF restent du ressort du trainer existant.

Le test du chat public `/api/chat` a répondu HTTP 200 en mode hybride, avec
cinq identités du nouvel espace et celle demandée. La réponse CPU a pris
86,18 secondes ; le premier essai borné à 60 secondes avait expiré. Ce test
confirme le raccordement des passages, sans qualifier la précision générale
du modèle ni une latence acceptable pour tous les utilisateurs.

## Exécution et installation

```sh
yolo ops shenron timeline refresh --output /chemin/prive/timeline --index --crawl-budget 32
yolo ops shenron timeline query --output /chemin/prive/timeline
```

`SHENRON_TIMELINE_REDIS_URL` sélectionne l'instance Redis. L'unité de
rafraîchissement charge le fichier protégé existant
`/etc/aphrody/shenron-compute-client.env` : `APHRODY_AI_HTTP_URL` et
`APHRODY_AI_HTTP_TOKEN` raccordent les passages à l'API RAG utilisée par le
site et le bot. Le code Bun exige l'accusé d'indexation E5 de chaque document,
puis termine une synchronisation limitée à l'espace `shenron:timeline`.
Une erreur empêche le retrait des anciens passages de cet espace. Les unités sont
déclarées dans le [catalogue Infra](../../../config/host/catalog.json) :

- [`shenron-timeline-refresh.service`](../../../config/host/systemd/shenron/shenron-timeline-refresh.service)
- [`shenron-timeline-refresh.timer`](../../../config/host/systemd/shenron/shenron-timeline-refresh.timer)
- [`shenron-timeline-api.service`](../../../config/host/systemd/shenron/shenron-timeline-api.service)

Le timer est horaire, persistant, avec cinq minutes de délai aléatoire. Le
premier déclenchement automatique observé le 7 octobre à 14:00:56 UTC s'est
terminé à 14:01:35 UTC avec le code zéro : 32 fiches revérifiées sans échec,
716 passages et vecteurs validés, ainsi que les fichiers LoRA régénérés.
Le déclenchement suivant était programmé pour 15:04:16 UTC.
Le serveur JSON/GraphQL écoute seulement sur `127.0.0.1:8813`. Aucune route publique
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

Douze tests Bun passent : ordre éditorial, intégrité de collection, pagination,
provenance, SQL idempotent, séparation train/évaluation, panne/récupération des
fiches et import dans une autre application via `Bun.serve`, upserts RAG
idempotents, retrait limité à un espace après indexation complète et format
des entrées LoRA avec provenance, séparation et empreintes. Les typechecks du
paquet et du propriétaire Workspace passent, ainsi que oxlint strict et oxfmt.
Le catalogue global présente quatre unités Shenron non déclarées dans d'autres
chantiers ; elles restent sous leurs propriétaires.

L'entraînement des poids, son évaluation et la promotion restent ouverts. Le
placement propriétaire est le WSL d'Omar ; l'inventaire actuel indique son accès
authentifié non activé : aucun handshake WireGuard sur le VPS, et les sondes
ICMP et TCP SSH vers `10.200.77.10` échouent. Les binaires Aphrody inspectés
sur le poste et DBFR ne portent pas la fonctionnalité `train`. La collecte,
les vecteurs E5 et le raccordement au chat sont vérifiés ; aucun entraînement
des poids, gain de précision ou promotion n'est revendiqué.
