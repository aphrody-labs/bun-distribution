<!-- SPDX-License-Identifier: Apache-2.0 -->
# VPS architecture and topology

Operator overview of the production application VPS (SSH alias `vps`). It explains the layers
and where each fact is recorded; it deliberately does not restate addresses, ports or unit lists,
which drift. Restored from the retired `aphrody` monolith (`docs/vps/`) and rewritten against the
catalogs of this repository.

| Fact | Source of truth |
|---|---|
| Workloads, units, health URLs, loopback ports, source repositories | [`config/service-catalog.json`](../../config/service-catalog.json) |
| Public hosts, Nginx upstreams and internal routes | [`config/nginx-routes.json`](../../config/nginx-routes.json) |
| Host roles, priorities, public and loopback-only ports | [`config/production-topology.json`](../../config/production-topology.json), [`docs/PRODUCTION-ALLOCATION.md`](../PRODUCTION-ALLOCATION.md) |
| Targets and SSH aliases | [`inventory/targets.json`](../../inventory/targets.json) |
| Last dated observation of the host | [`inventory/vps-source.json`](../../inventory/vps-source.json) (evidence, never live state) |
| Kernel, sysctl and journald tuning | [`host/aphrody-os/VPS-TUNING.md`](../../../../host/aphrody-os/VPS-TUNING.md), [`host/sysctl/`](../../host/sysctl/) |
| Release layout and activation | [`docs/IMMUTABLE-RELEASES.md`](../../../operations/infra/IMMUTABLE-RELEASES.md), [`docs/RG-IMMUTABLE-RELEASES.md`](../../../operations/infra/RG-IMMUTABLE-RELEASES.md) |

The VPS was reset to a clean slate on 2026-09-22 and is rebuilt only from immutable releases
deployed by `aphrody-infra deploy`. A unit named below is a catalog entry, not a claim that it
is running: observe the live units and the active release before concluding anything.

## Contents

1. [System services](#system-services)
2. [Application planes](#application-planes)
3. [Network and Nginx](#network-and-nginx)
4. [Detailed pages](#detailed-pages)

## System services

The distribution's systemd is the supervisor (see the root `README.md`, "Current decision").

- **PostgreSQL** (distribution package, `postgresql@<major>-main.service`): primary relational
  store, reachable through the local Unix socket and loopback TCP only. Databases per plane are
  described in [DATABASES.md](../../../reference/infra/vps/DATABASES.md).
- **Redis** (`redis-server.service`): loopback-only cache, offline queues and distributed locks.
- **Nginx**: the single public reverse proxy; it terminates TLS and forwards to loopback
  upstreams declared in `config/nginx-routes.json`.

Their ports are listed under `hosts.vps.network` in `config/production-topology.json`; none of
them is public.

## Application planes

Each plane has its own release root (`releases/`, `current`, `shared/`) declared by the
`workingDirectory`, `releaseRoot` and `policies.applicationRoots` entries of the service catalog.

| Plane | Catalog services | Built from |
|---|---|---|
| `aphrody` | `aphrody-site`, `aphrody-web-api` | `aphrody-web` (`crates/aphrody-site`, BXC server `apps/bxc/src/server/index.ts`) |
| `aphrody` | `aphrody-a2a`, `aphrody-ai-http`, `aphrody-shenron-embed` (`shenron-mcp` retired: `dragonball.*` in `aphrody-mcp`) | `aphrody-ai` (`aphrody a2a serve`, `aphrody-mcp http`, `aphrody-embed serve`) |
| `rg` | `rg-website`, `rg-api`, `rg-bot`, `rg-achillea-bot`, `rg-cron`, `rg-sauvegarde` | `rg` |
| `shenron` | `shenron-site`, `shenron-bot`, `shenron-pg-tunnel`, `shenron-backup` | `shenron` |
| `nie` | `nie-site`, `nie-model-serve` | `nie` (runs from its checkout until it has a release plane) |

The `aphrody` release is assembled by `scripts/build-aphrody-stack-release.sh` from the pinned
category checkouts; the contents of each artifact are listed in `docs/IMMUTABLE-RELEASES.md`.

### Agents on the VPS

Claude Code, Grok Build and Gemini (`agy`) share one MCP configuration
(`~/.config/aphrody/mcp.json`, servers `aphrody-mcp` and `bxc-mcp`). The stack is described in
`../aphrody-ai/docs/agent-stack/README.md` and synchronised by
[`scripts/aphrody/vps-sync-agent-stack.sh`](../../scripts/aphrody/vps-sync-agent-stack.sh).
The X client (`@aphrody-code/x`, X Pro decks and Radar) lives in `aphrody-web/packages/x`.

## Network and Nginx

Only `80/443` are public. Every application listener binds loopback and is reached through
Nginx:

- public hosts map one-to-one to a catalog service in `config/nginx-routes.json` (`routes`);
- path-scoped routes on a shared public host (A2A, AI REST, the Web API under `aphrody.com`)
  are listed under `internal` with their `publicHost` and `paths`;
- `aphrody-infra validate` rejects a route whose upstream port disagrees with the catalog.

Probe a route or a loopback service with `aphrody-infra probe <url> --target vps` rather than
copying ports into documents.

## Detailed pages

- [Databases and storage](../../../reference/infra/vps/DATABASES.md): PostgreSQL databases, Redis usage and embedded SQLite
  stores.
- [RAG and inference](../../../reference/infra/vps/RAG.md): hybrid retrieval, embeddings and synthesis models.
- [REST and GraphQL APIs](../../../apis/infra/vps/APIS.md): API servers, authentication boundaries and Nginx exposure.
- [OVHcloud operations](../ovh/README.md): Manager/API inventory, DNS and VPS runbook.
