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

- `rosegriffon.fr` : application Next.js 16 unique (`apps/rg/website`, `rg-website.service` :3004 / `-b` :3014)
  regroupant le portail Rose Griffon, le wiki complet Inazuma Eleven: Victory Road (`/wiki`), les tournois
  et compétitif Achilléa (`/achillea`), les actualités et chroniques (`/news`, `/chroniques`), la boutique (`/shop`),
  l'espace communauté (`/community`), l'administration (`/admin`) et l'authentification Better Auth unifiée.
- `azalee.rosegriffon.fr` & `achillea.rosegriffon.fr` : domaines historiques sans application ni service propre ; nginx applique une
  redirection permanente respectivement vers `https://rosegriffon.fr/wiki` et `https://rosegriffon.fr/achillea`.
- `api.rosegriffon.fr` : API unifiée ElysiaJS :8800 (`apps/rg/bot/src/api`), 153 routes englobant
  l'ensemble des services Rose Griffon, Achilléa (`/v1/achillea/*`), le bridge Azalée (`/v1/azalee/*`), le moteur de jeu Colyseus Ranked,
  le hub temps réel WebSocket (`/v1/achillea/ws`), et les services intégrés in-process Storage, CDN et Realtime.
- `apps/rg/bot` (`rg-bot.service`) : démon et bot Discord souverain unique multi-profils (`rg`, `azalee`, `achillea`),
  compilable en binaire ELF autonome AOT (`dist/rg-bot`).
- Toutes les unités fragmentées historiques (`rg-achillea-bot.service` :4000/:4002/:4005, `rg-cdn.service` :8801,
  `rg-storage.service` :8810, `rg-realtime.service` :8812, `azalee-bot.service`, `azalee-api`) sont définitivement retirées et consolidées.
- Validation automatisée monorepo : 100% tests unitaires verts (RG, Achilléa, Azalée), 100% type-check vert, builds de production validés.

## Retired surfaces

- The standalone Azalée Next application and its `azalee-web` A/B units are
  retired. Do not build, deploy, restart, monitor, or recreate them. The wiki is
  released exclusively with [`apps/rg/website`](../../../apps/rg/website).

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
  archive `~/archives/retired-rg-ai-20260908T101029Z`.

## Agent rules

- Treat `infra/` and the installed nginx/systemd state as the production contract.
- Validate with `sudo nginx -t`, `systemctl --failed`, endpoint probes, and listener
  inspection before claiming a deployment.
- Keep the local MCP stdio path; never restore the retired public HTTP transport.
- A kernel reboot is pending but was intentionally deferred to avoid interrupting
  the continuously served sites.
