---
title: "Production status"
description: "Verified production topology and retired surfaces"
scope: ["ops", "agents"]
status: "stable"
---

# Production status

Last verified: **2026-09-20 UTC** on the Rose Griffon VPS.

> **Authority.** Ports, units, hosts and routes are owned by `aphrody-infra`
> (`config/service-catalog.json`, `config/nginx-routes.json`, `config/production-topology.json`);
> where this page disagrees, `aphrody-infra` wins. As of 2026-09-25 the VPS runs only RG and
> Shenron: Aphrody, NIE and IECode are not deployed.

## Live surfaces

- `rosegriffon.fr` : application Next.js 16 unifiée (`apps/website`, `website-web.service` :3004 / `-b` :3014)
  regroupant le portail Rose Griffon, le wiki complet Inazuma Eleven: Victory Road (`/wiki`), les actualités
  et chroniques (`/news`, `/chroniques`), la boutique (`/shop`), l'espace communauté (`/community`),
  l'administration (`/admin`) et l'authentification Better Auth.
- `azalee.rosegriffon.fr` : domaine historique sans application ni service propre ; nginx applique une
  redirection permanente vers `https://rosegriffon.fr/wiki`.
- `rosegriffon.fr/achillea` : tournois, classements ELO, licences et clans Achilléa, rendus par
  `apps/website`; `achillea.rosegriffon.fr` redirige vers cette surface. Les routes métier déjà
  contractées (`tournaments`, `leagues`, `organizations`, `licenses/verify`, `wallet`,
  `users/leaderboard`, liste `clans`, `sanctions`) passent par `rg-api` ; le ranked (:4002),
  Socket.IO (:4005) et les mutations encore non portées restent temporairement dans
  `achillea-bot` (:4000).
- Postgres (port 5432), PostgREST (:8809), Storage (:8810), Realtime (:8812), CDN (:8804, :8788),
  API unifiée (`rg-api.service`, montage Azalée `/v1/azalee`) et bot Achilléa (`achillea-bot.service`)
  actifs. Les anciens `azalee-api` et `azalee-bot` sont retirés.
- Toutes les sondes HTTP publiques et internes retournent `200 OK`.
- Validation automatisée monorepo : 100% tests unitaires verts (18/18 tâches Turborepo, 850+ tests),
  100% type-check vert (20/20 tâches Turborepo), 100% lint vert (14/14 tâches Turborepo), build de
  production validé.

## Retired surfaces

- The standalone Azalée Next application and its `azalee-web` A/B units are
  retired. Do not build, deploy, restart, monitor, or recreate them. The wiki is
  released exclusively with `apps/website`.

- The BXC public site is a future project, not a production service. Its systemd
  units, crawlers, scheduler, and public origin are disabled. The public vhost
  returns `410` until a new release is explicitly promoted.
- Public MCP and RAG HTTP endpoints return `410`. `rg-mcp`, `rag-api`,
  `rg-rag-embed`, and the `8799` tunnel are inactive and masked.
- MCP remains available only through the local stdio process used by the agent
  host. Do not recreate an HTTP listener or re-enable the retired units.

## Backups and cleanup

- Automatic backup timers for RG, BXC, cloud mirrors, and the package database are
  disabled. The latest verified PostgreSQL dumps remain under `/var/backups/postgres`.
- Regenerable BXC runtime databases, crawls, captures, cookies, `node_modules`, and
  `dist` were removed. They are recoverable by reinstalling/building/recrawling;
  they are not Git source data.
- The retired AI/MCP/RAG configuration and data remain in the private mode-0700
  archive `/home/ubuntu/archives/retired-rg-ai-20260908T101029Z`.

## Agent rules

- Treat `infra/` and the installed nginx/systemd state as the production contract.
- Validate with `sudo nginx -t`, `systemctl --failed`, endpoint probes, and listener
  inspection before claiming a deployment.
- Keep the local MCP stdio path; never restore the retired public HTTP transport.
- A kernel reboot is pending but was intentionally deferred to avoid interrupting
  the continuously served sites.
