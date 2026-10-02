---
title: "Déploiement cloud portable"
description: "Cible Vercel, Fly.io ou Cloud Run sans dépendance VPS"
scope: ["website", "cloud", "ops"]
status: "stable"
---

# Déploiement cloud portable

Le monorepo distingue désormais la surface HTTP stateless et les workers. Le
site Next est la seule surface à déployer sur Vercel, Fly.io ou Cloud Run ; les
bots Discord et le Cron sont des processus workers séparés, jamais des Serverless
Functions.

## Choix de plateforme

| Surface | Cible recommandée | Contrat |
| --- | --- | --- |
| `apps/website` | Vercel | projet avec Root Directory `apps/website` et `apps/website/vercel.json` |
| `apps/website` | Fly.io / Cloud Run | image `infra/cloud/website.Dockerfile`, port `PORT`, écoute `0.0.0.0` |
| Postgres + Auth + Storage + Realtime | Supabase Cloud | URL publique, clé publishable et service-role via secrets |
| Postgres seul | Neon | `DATABASE_URL` poolée ; conserver Supabase Cloud pour Auth, Storage et Realtime |
| `apps/bot`, `apps/achillea-bot`, `packages/cron` | Fly Machine / Cloud Run Job ou worker | secrets runtime, une instance par consommateur Discord/Cron |

Ne pas connecter directement une base Neon à un client navigateur :
`DATABASE_URL` est exclusivement serveur. Le navigateur continue d’employer
`NEXT_PUBLIC_SUPABASE_URL` et une clé publique Supabase.

## Secrets runtime

Ces valeurs ne sont jamais présentes dans l’image ou dans `NEXT_PUBLIC_*` :

- `DATABASE_URL` : URL SSL poolée Supabase ou Neon ;
- `SUPABASE_SERVICE_ROLE_KEY` : serveur uniquement ;
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` ;
- OAuth Discord/Twitch/Patreon, Stripe, SMTP et `CRON_SECRET` ;
- `CRON_API_URL` : URL HTTPS du worker Cron lorsque l’administration Website
  n’est pas dans le même réseau privé.

Les variables `NEXT_PUBLIC_*` sont figées au build Next. Toute modification de
l’URL ou de la clé publique Supabase nécessite donc un nouveau déploiement de
Website ; les secrets serveur peuvent être changés au runtime.

## Conteneur

Construire depuis la racine du dépôt :

```bash
docker build -f infra/cloud/website.Dockerfile -t rosegriffon-website .
docker run --rm -p 8080:8080 --env-file .env.production rosegriffon-website
```

L’image finale ne contient que la sortie Next standalone, les assets publics et
les dépendances tracées. Elle n’embarque ni fichiers `.env`, ni `node_modules`
de développement, ni artefacts VPS.

## Fly.io et Cloud Run

`infra/cloud/fly.website.toml` donne le contrat Fly : une machine minimale,
healthcheck `/api/health`, pool Postgres plafonné à quatre connexions.

`infra/cloud/cloudrun.website.yaml` est un manifeste de départ. Remplacer
`IMAGE_TO_REPLACE`, injecter les secrets par Secret Manager et ne pas définir
`PORT` : Cloud Run le fournit au conteneur. Le Dockerfile accepte ce port et
écoute toutes les interfaces.

## Vérification avant publication

```bash
bun --filter @rosegriffon/website type-check
docker build -f infra/cloud/website.Dockerfile -t rosegriffon-website .
docker run --rm -p 8080:8080 --env-file .env.production rosegriffon-website
curl -f http://localhost:8080/api/health
```

Une migration de données et un déploiement cloud restent deux opérations
distinctes : exporter et valider la base avant de basculer DNS ou OAuth.
