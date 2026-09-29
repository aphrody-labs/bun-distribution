---
title: "Déploiement et exploitation"
description: "Procédures de publication des applications et services Rose Griffon"
scope: ["monorepo", "ops"]
status: "stable"
---

# Déploiement et exploitation

L'état de production vérifié est consigné dans
[PROD-STATUS.md](PROD-STATUS.md). Une publication est toujours une action
explicite sur le VPS ; un `git push` seul ne déploie rien.

## Frontends

| Surface | Source | Runtime |
| --- | --- | --- |
| Rose Griffon et wiki Azalée `/wiki` | `apps/website` | `website-web.service` :3004 / `website-web-b.service` :3014 |
| Achilléa `/achillea` | `apps/website` | rendu Next unifié ; API et temps réel restent dans `apps/achillea-bot` |
| `azalee.rosegriffon.fr` | redirection vers `rosegriffon.fr/wiki` | aucun service, aucun build |

Azalée n'est pas un frontend autonome. Le nom reste utilisé par la
bibliothèque de données et le montage `/v1/azalee` de l'API unifiée ; cela ne
justifie jamais un second build Next ni un second bot Discord. Voir
[azalee.md](azalee.md).

## Publier Website

```bash
bun run deploy website
bun run deploy:status
```

Cette commande produit une seule release Next, contenant le portail et `/wiki`,
puis effectue la bascule bleu/vert. La séquence, la prévisualisation et le retour
arrière sont documentés dans
[deploiement-sans-coupure.md](deploiement-sans-coupure.md).

Les commandes `deploy azalee`, `ship-azalee.sh` et les unités `azalee-web*`
sont retirées de l'architecture. Ne pas les restaurer depuis l'historique Git.

## Services sans build Next

Les API, bots, le CDN et le cron se rechargent indépendamment. Leur nom Azalée
éventuel décrit leur domaine fonctionnel, pas un frontend :

```bash
sudo systemctl restart rg-cron.service
```

Le wiki Azalée, son index CPK et ses textes sont servis par le montage
`/v1/azalee` de `rg-api.service`; les anciens services `azalee-api` et
`azalee-bot` sont retirés.

Le contrat des assets partagés et la procédure CDN sont dans
[assets-cdn.md](assets-cdn.md). Publier une modification de cette surface exige
de déployer ensemble le cron, nginx et leur configuration systemd ; ne pas
copier les mêmes assets dans plusieurs répertoires `public/`.

Avant de modifier une unité ou nginx, valider la configuration :

```bash
bun run infra:check
sudo nginx -t
systemctl --failed
```

Les services MCP et RAG HTTP publics sont retirés. Le MCP reste local via
stdio ; ne pas recréer de listener public.

## Sondes

```bash
curl --fail --silent --show-error https://rosegriffon.fr/
curl --fail --silent --show-error https://rosegriffon.fr/wiki
curl --head https://azalee.rosegriffon.fr/
```

La dernière sonde doit observer une redirection permanente vers le wiki, jamais
un upstream `azalee-web`.

## Données du wiki

Le miroir SQLite des tables `inagle_*` est produit dans le dépôt `niers`, puis
consommé par les packages de données et Website. Une correction ne se fait
jamais directement dans le miroir. Les responsabilités sont détaillées dans
[architecture-unifiee-ievr.md](architecture-unifiee-ievr.md) et
[database.md](database.md).

## Règles de sécurité opérationnelle

- Un seul processus `next build` à la fois, toujours pour Website.
- Ne jamais supprimer une release ou un artefact actuellement servi.
- Toujours lancer `nginx -t` avant un rechargement.
- Ne jamais inscrire un secret dans une unité ou dans Git ; utiliser les
  fichiers d'environnement protégés.
- Ne pas réactiver une surface marquée retirée dans
  [PROD-STATUS.md](PROD-STATUS.md).
