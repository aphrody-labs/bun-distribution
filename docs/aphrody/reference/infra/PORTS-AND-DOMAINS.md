# Ports, domains and routes — explanatory view

This page is a historical ledger of prior route/port decisions, not a generated
current inventory. Use it to understand retired entries only. The machine
catalogues below define current declared policy; dated runtime observations are
separate evidence.

Authoritative sources (never a second registry):

- `tools/config/service-catalog.json` — every unit, its loopback port, health check, owning repository
  and `status`.
- `tools/config/host/nginx/routes.json` — every public host and path, and the internal paths reached through
  a public host.
- `tools/config/production-topology.json` — the port policy (`publicPorts` vs `internalOnly`) per host.
- `tools/config/a2a-peers.json` — the A2A registry (JSON-RPC endpoints and agent cards).
- `tools/aphrody/config/asset-catalog.json` — the static CDN release trees of `cdn.aphrody.com`, served by
  `aphrody-fonts-proxy`.
- `crates/infra/infra/src/validate.rs` (`aphrody-infra validate`) enforces cross-catalog
  consistency: no two services share a port or unit, every `port`/`health` is loopback/private and
  declared `internalOnly` in the topology, every retired entry carries `status`+`retiredAt`, and
  the A2A/local-AI/pipeline/repository registries agree with the catalog.

## 1. Port range scheme

No formal range policy existed before 2026-09-26; ports were assigned service-by-service as each
stack shipped. The ranges below describe the pattern that already exists in the catalog and are
now the policy for new services — pick the next free port in the layer's range instead of an
arbitrary number.

| Range | Layer | Members (2026-09-26) |
| --- | --- | --- |
| `80`, `443` | Public — nginx only. No application ever binds these. | — |
| `3000`–`3099` | Bun/Next web frontends | `rg-website` 3004, `rg-website-preview` 3014 (generated cookie-gated preview upstream), `aphrody-web-api` 3007 (retired). Reserved, no current owner: 3000, 3005 (occupied by something outside this catalog per docs/PLAN.md 2026-09-23 — do not reassign), 3006. |
| `4000`–`4099` | Discord bot / companion APIs | `rg-achillea-bot` 4000 (API), 4002 (ranked Colyseus), 4005 (socket.io, currently unrouted by the live nginx conf). |
| `5000`–`5099` | Shenron stack | `shenron-bot` 5006, `shenron-mcp` 5010 (retired), `shenron-site` 5011. |
| `5432`, `6379` | Shared runtime data plane | PostgreSQL 5432 (loopback only, both `vps` and `dbfr`), Redis 6379 (loopback only, `vps`). |
| `8000`–`8099` | Specialized engines (nie) | `nie-site` 8085, `nie-model-serve` 8790 (both retired). |
| `8700`–`8799` | Historical Aphrody AI allocation | `aphrody-a2a` 8788, `aphrody-ai-http` 8789 (MCP `/mcp` incl. `dragonball.*`), `aphrody-shenron-embed` 8794 (retired 2026-09-25). `aphrody-site` 8083 is also retired. Local CLI defaults (2026-10-08): `aphrody gateway serve` 8786 (moved from 8795), `aphrody infra remote serve` 8795 (browser desktop) plus RFB/VNC 5900 on the same address, tunnel-only. |
| `8800`–`8899` | RG backend services | `rg-api` 8800 (self-host port; since 2026-10-17 the API runs as the Vercel Function `rg-api` and no longer serves Storage, Realtime or CDN routes — Supabase Cloud Storage/Realtime replace them and the `@rosegriffon/{storage,realtime,cdn}` packages are deleted). Retired 2026-09-26, reserved: `rg-cdn` 8801, `rg-storage` 8810, `rg-realtime` 8812; `supabase-internal` 8811 (superseded template, unused). Dead/legacy in this band, not live: `rg-postgrest` 8809 (retired, no consumer), `achillea-postgrest`/`-storage`/`-realtime` 8820–8822 (superseded `achillea.rosegriffon.conf` plan, never promoted to the catalog), `n2b-server`/`shai-http` 8802/8803 ("futur" placeholders in the superseded `api.rosegriffon.conf`, never implemented). |
| `15000`–`15999` | Private cross-host tunnels | `shenron-pg-tunnel` 15433 (loopback `vps` → SSH tunnel → `dbfr:5432`; 5432 itself is never exposed on `vps`). |
| *(unscoped, intentionally off-catalog)* | Internal ops tooling, no public domain | `stack-ip.conf` (3080 public-loopback listener, upstream `stack_api` 3010) and `staging-nds.conf` (127.0.0.1:8889, explicitly never public by design) — orphaned, no owning code found in any sibling repo, banners added in place; see §4 item 10. |

## 2. Service catalog (loopback ports)

| Service | Port(s) | Unit | Repo | Status |
| --- | --- | --- | --- | --- |
| aphrody-site | 8083 | `aphrody-site.service` | aphrody-web | retired 2026-09-25 (bundle redeploy) |
| aphrody-web-api | 3007 | `aphrody-web-api.service` | aphrody-web | retired 2026-09-25 |
| aphrody-ai-http | 8789 | `aphrody-ai-http.service` | aphrody-ai | retired 2026-09-25 |
| aphrody-shenron-embed | 8794 | `aphrody-shenron-embed.service` | aphrody-ai | retired 2026-09-25 |
| aphrody-a2a | 8788 | `aphrody-a2a.service` | aphrody-ai | retired 2026-09-25 |
| nie-site | 8085 | `nie-site.service` | nie | retired 2026-09-25 |
| nie-model-serve | 8790 | `nie-model-serve.service` | nie | retired 2026-09-25 |
| rg-website | 3004 | `rg-website.service` | rg | live |
| rg-api | 8800 | `rg-api.service` | rg | live |
| **rg-cdn** *(added 2026-09-26)* | 8801 | `rg-cdn.service` | rg | retired 2026-09-26 (unit disabled, absorbed by rg-api; excluded from the RG release roster) — see §4 |
| rg-bot | — | `rg-bot.service` | rg | live (Discord worker only) |
| rg-achillea-bot | 4000, 4002, 4005 | `rg-achillea-bot.service` | rg | live (4005 currently unrouted) |
| rg-cron | — | `rg-cron.service` | rg | live |
| **rg-storage** *(added 2026-09-26)* | 8810 | `rg-storage.service` | rg | retired 2026-09-26; public path `/storage/v1/` is served by rg-api:8800 — see §4 |
| **rg-realtime** *(added 2026-09-26)* | 8812 | `rg-realtime.service` | rg | retired 2026-09-26; public path `/realtime/v1/` is served by rg-api:8800 — see §4 |
| rg-sauvegarde, rg-infra-monitor | — (timers) | `*.timer` | rg / aphrody-infra | live |
| shenron-site | 5011 | `shenron-site.service` | shenron | live |
| shenron-mcp | 5010 | `shenron-mcp.service` | aphrody-ai (historical) | retired 2026-09-25 |
| shenron-bot | 5006 | `shenron-bot.service` | shenron | live |
| shenron-pg-tunnel | 15433 (→ dbfr 5432) | `shenron-pg-tunnel.service` | shenron | live |
| shenron-backup | — (timer) | `shenron-backup.timer` | shenron | live |
| PostgreSQL | 5432 | distro package | — | live, loopback only |
| Redis | 6379 | distro package | — | live, loopback only |

Bold rows were missing from `tools/config/service-catalog.json` before this audit even though their
systemd unit and their port already existed in `production-topology.json`'s `internalOnly` list —
closed 2026-09-26.

## 3. Domains and routes

| Host | Path(s) | Backs onto | Status |
| --- | --- | --- | --- |
| `aphrody.com` (+`www.`) | `/` | aphrody-site :8083 | retired 2026-09-25 |
| `aphrody.com` | `/api/v1/a2a`, `/.well-known/agent-card.json` | aphrody-a2a :8788 | retired 2026-09-25 |
| `aphrody.com` | `/api/v1/models`, `/api/v1/rag/*` | aphrody-ai-http :8789 | retired 2026-09-25 |
| `aphrody.com` | `/api/v1/web/` | aphrody-web-api :3007 | retired 2026-09-25 |
| `mcp.aphrody.com` | `/mcp` | aphrody-site :8083 | retired 2026-09-25 (`tools/config/host/nginx/aphrody/aphrody-apex.conf`) |
| `n2b.aphrody.com` | `/api/v1/n2b`, `/api/v1/n2b/` | aphrody-site :8083 | retired 2026-09-25 (`tools/config/host/nginx/aphrody/aphrody.com.conf`) |
| `bot.aphrody.com` | `/` | `aphrody-discord-dev` (`127.0.0.1:4010`) | Bun dev app: signed Discord HTTP interactions, Gateway session for non-interaction events, OAuth2 login/callback; managed by `aphrody-infra` |
| `downloads.aphrody.com` / `admin.aphrody.com` | `/` | none — reserved, explicit 410 | reserved; no backing service |
| `cdn.aphrody.com` | `/s/`, `/h/`, `/s/manifest.json` | static `aphrody-cdn` release trees `/home/ubuntu/apps/cdn/current` and `symbols/current` (`tools/aphrody/config/asset-catalog.json`), served by `aphrody-fonts-proxy` (`127.0.0.1:8796`) | live on the vps host nginx since 2026-10-23 (`scripts/aphrody/tools/infra/cdn.ts publish`) |
| `nie.aphrody.com` | `/health`, `/api/`, `/f/`, `/b`, `/cdn/` | nie-site :8085, nie-model-serve :8790 | retired 2026-09-25 |
| `nie.aphrody.com` | **`/downloads/inacord/latest.json`, `/downloads/channels/stable/latest.json`, `/downloads/files/`** | static Inacord updater feed (`~/nie/var/releases/inacord/public/...`) | **kept live intentionally** (docs/PLAN.md 2026-09-26 ledger entry) even though the rest of the nie backend and the Inacord desktop app itself are retired — installed clients still poll this feed |
| `rosegriffon.fr` (+`www.`) | `/` | rg-website :3004 | live |
| `api.rosegriffon.fr` | `/` | rg-api :8800 | live |
| `cdn.rosegriffon.fr` | `/static/`, content-addressed images, `/` fallback | rg-api :8800 (not rg-cdn :8801 — see §4) | live |
| `achillea.rosegriffon.fr` | `/health/check`, `/api/` | rg-achillea-bot :4000 | live |
| `ranked.rosegriffon.fr` | `/` (WS upgrade aware) | rg-achillea-bot :4002 | live |
| `azalee.rosegriffon.fr` | `/storage/v1/`, redirects to `rosegriffon.fr/wiki` and `/admin` | rg-api :8800 (storage), else 301 | live, legacy alias host |
| `dragonballfr.com` (+`www.`) | `/` | shenron-site :5011 | live |
| `bot.dragonballfr.com` | `/` | shenron-bot :5006 | live |
| `cdn.dragonballfr.com` | `/_next/static/`, `/_next/image`, `/wiki/`, `/assets/` | shenron-site :5011 | live |
| `mcp.dragonballfr.com` | `/a2a`, `/.well-known/agent-card.json` | shenron-mcp :5010 | retired 2026-09-25, superseded by `aphrody-mcp dragonball.*` |
| `rpbey.fr`, `www.rpbey.fr`, `api.rpbey.fr`, `cdn.rpbey.fr`, `play.rpbey.fr` | — | — | **retired 2026-09-26: domain sold, operator decision (see `docs/PLAN.md` (not in repo)).** Removed entirely, not just marked dead — see §4 item 12. |
| `bot.rosegriffon.fr` | — | nothing | dead DNS record, resolves to the VPS with no `server_name` (docs/ops/OVH.md); not fixable from this repo (DNS mutation is out of scope) |

**2026-09-26 (all-in-one bundle):** `fut-api` / `fut.aphrody.com` (8088), registered the same
morning without a unit, a release plane or a submodule, was removed from both catalogs (never
deployed). `rg-cdn`, `rg-storage` and `rg-realtime` are `status: retired` so the RG release
roster matches the live release (`5691ba4b`: website, api, bot, achillea-bot, cron).

## 4. Gaps and owner decisions found by this audit (2026-09-26, all closed)

Fixed in this pass (see `tools/config/service-catalog.json`, `tools/config/production-topology.json`,
`tools/config/a2a-peers.json`, and the header banners added to the nginx files under `iecode/config/rg/host/nginx/`):

1. `rg-cdn` (8801), `rg-storage` (8810), `rg-realtime` (8812) had real systemd units and reserved
   topology ports but no `service-catalog.json` entry — added.
2. `rg-achillea-bot`'s socket.io port (4005, set by the unit's own `SOCKET_PORT` env var) was
   undeclared anywhere — added to `additionalUpstreams` and `production-topology.json`.
3. The A2A peer record for `aphrody` pointed at a retired service/route without saying so — now
   carries `status`/`retiredAt` like the `shenron` peer already did.
4. `iecode/config/rg/host/nginx/supabase-compat.inc`'s `/rest/v1/` and `/graphql/v1/` blocks hard-coded
   `127.0.0.1:8809` (`rg-postgrest`), a service `docs/PLAN.md` (not in repo)'s ledger records as removed with no
   consumer (2026-09-23) and for which no systemd unit exists anywhere in this repo — marked
   retired in place (not deleted, so the location shape survives if it's ever redeployed).
5. Six pre-consolidation per-host RG nginx templates (`rosegriffon.conf`,
   `achillea.rosegriffon.conf`, `api.rosegriffon.conf`, `cdn.rosegriffon.conf`,
   `ranked.rosegriffon.conf`, `azalee.rosegriffon.conf`) and `supabase-internal.conf` predate and
   are superseded by the consolidated, release-managed `iecode/config/rg/host/nginx/rg-production.conf`
   (docs/PLAN.md, 2026-09-25 "Live rg.conf is nginx/rg/rg-production.conf" decision) but carried no
   marker saying so — every one now has a header banner naming its replacement, so nobody
   reinstalls a stale vhost next to the live one.
6. The four `rpbey.fr` templates (`rpbey.fr.conf`, `api.rpbey.fr.conf`, `cdn.rpbey.fr.conf`,
   `play.rpbey.fr.conf`) carried no note that the domain is not this VPS's per the *declared live
   nginx state* (docs/ops/OVH.md already knew this, the templates didn't say so) — banners added,
   cross-referencing that finding. **Update:** the `rg` sibling audit (§5) found this is only half
   the picture, and the operator has since sold the domain — the four templates were deleted, see
   item 12 below.
7. `production-topology.json`'s `internalOnly` list mixed live ports with three that no service has
   ever declared (3000, 3005, 3006) and was missing 3014 (the RG preview-environment upstream,
   `iecode/config/rg/host/nginx/generated/website_preview.conf`) — split into `internalOnly` (real, declared) and a
   new `reservedNoCurrentOwner` array (3000, 3005 — occupied by something outside this catalog per
   the 2026-09-23 ledger entry, do not reassign — and 3006) so the two categories are no longer
   silently merged. `aphrody-infra validate` stays green either way since no catalog service
   references 3000/3005/3006.

Resolved by the `rg` sibling audit (§5) the same day — no longer open:

8. ~~rg-cdn vs rg-api for `cdn.rosegriffon.fr`~~ — **answered.** `apps/api/src/index.ts` (not in repo) (in the
   `rg` repo) imports `handleCdn`/`handleStorage`/`handleRealtime` from the sibling `iecode/packages/rg/cdn`,
   `iecode/packages/rg/storage`, `iecode/packages/rg/realtime` packages and mounts them **in-process** on `rg-api:8800`, with
   its own comments confirming the intent: `// remplace rg-cdn:8801`, `// remplace rg-storage:8810`,
   `// remplace rg-realtime:8812`. So `rg-production.conf` proxying everything to `:8800` is correct,
   not a regression; `rg-cdn.service`/`rg-storage.service`/`rg-realtime.service` are an
   alternate/older standalone deployment mode of the *same code*, currently superseded by the
   unified `rg-api` path for live traffic (one exception: `iecode/apps/rg/website/src/lib/db/platform.ts`'s
   admin health dashboard still probes `:8810`/`:8812` directly as a standalone-service check).
   `tools/config/service-catalog.json`'s notes for these three services were corrected accordingly.
9. ~~rg-storage/rg-realtime: proxied via rg-api, or a dead standalone unit?~~ — same answer as #8.

Left as findings by the first pass (owner decisions needed) and all closed by the follow-up pass
of 2026-09-26 — nothing in this section is open any more:

10. ~~`stack-ip.conf` (port 3080, upstream `stack_api` 3010) and `staging-nds.conf`
    (`127.0.0.1:8889`)~~ — **resolved 2026-09-26: neutralized in place, not cataloged.** A
    repo-wide search of every sibling checkout (`aphrody-ai`, `aphrody-ui`, `aphrody-web`,
    `aphrody-os`, `nie`, `rg`, `shenron`) for `stack_api`/`:3010`/`/var/www/stack` and for
    `dust`/NDS-emulator code found no owning service, systemd unit, or catalog entry for either
    template — both are orphaned from this repository's point of view. Rather than inventing a
    catalog entry for a service that does not exist, both got a header banner (matching the
    existing superseded-vhost convention) recording the finding and warning against installing
    either without first confirming a live owner. `staging-nds.conf`'s own design intent (a staged
    NDS emulator, deliberately never public) is unchanged and still documented inline; it simply
    has no implementing code yet in this ecosystem.
11. ~~`tools/config/host/nginx/aphrody/aphrody.com.conf`'s `mcp.`, `downloads.`, `n2b.`, `api.` hosts~~ — **resolved
    2026-09-26.** `mcp.aphrody.com`, `n2b.aphrody.com` and `api.aphrody.com` all back onto
    already-retired services (`aphrody-site` :8083, plus `aphrody-a2a` :8788 and `aphrody-ai-http`
    :8789 for `api.aphrody.com`; `api.aphrody.com` itself, its server block, route and DNS record were
    removed on 2026-10-09) — added matching `tools/config/host/nginx/routes.json` entries with
    `status: retired`/`retiredAt: 2026-09-25` (same date as the services they back), plus an inline
    banner on each server block in `tools/config/host/nginx/aphrody/aphrody.com.conf`/`aphrody-apex.conf` naming the
    retirement. `downloads.aphrody.com` (and its `bot.`/`admin.` siblings) is different in kind:
    it never had a backing service — it is a reserved placeholder returning an explicit 410 — so
    it correctly has no `nginx-routes.json` entry (that schema requires a `service` to reference);
    documented this distinction inline in the conf and in §3 above instead of forcing a route
    entry that would have no service to point at.
12. ~~`rpbey.fr` contradiction~~ — **resolved 2026-09-26, operator decision: the domain was sold.**
    Neither side of the contradiction stands any more, so instead of picking one this pass removed
    the domain outright: the four `nginx/rg/*rpbey.fr*.conf` (not in repo) templates and the `rpbey.fr` block in
    the live `rg-production.conf` (server_name list and the 503 maintenance server); the `rpbey.fr`
    entry in the `aphrody.com` OVH profile's domain set (`packages/aphrody-ovh/src/profiles.ts` (not in repo),
    `crates/infra/ovh/src/profile.rs`, and their tests); the `cdn.rpbey.fr` entry in `rg`'s
    `iecode/packages/rg/cdn/server.ts` `ALLOWED_PUBLIC_HOSTS` (and its test in `iecode/packages/rg/cdn/server.test.ts`); and
    the `rpbey.fr`/`*.rpbey.fr` branch of the nginx-stats parser in `rg`'s
    `iecode/packages/rg/cron/src/tasks/stats/achillea.ts`. `docs/reference/infra/ops/OVH.md` and `docs/ovh/README.md` (not in repo) now
    record the sale instead of describing a live-but-unserved zone. No route ever existed in
    `tools/config/host/nginx/routes.json`/`tools/config/service-catalog.json` for this domain, so no catalog entry
    needed removing there. CHANGELOG/history mentions (e.g. `shenron/docs/archive/`) were left
    untouched, per the "history stays" rule.
13. ~~Port 8811 (`SUPABASE_INTERNAL_URL`)~~ — **resolved 2026-09-26: routed to `rg-api:8800`
    (absorbed), not un-superseded.** `rg`'s own `iecode/packages/rg/db/src/env.ts` (`INTERNAL_URL`),
    `iecode/packages/rg/cron/src/lib/storage-assets.ts` (`baseStorage()`) and `iecode/apps/rg/website/next.config.ts`'s
    storage `rewrites()` (`FALLBACK_STORAGE_URL`) all now default `SUPABASE_INTERNAL_URL` to
    `http://127.0.0.1:8800` instead of `:8811`, since `rg-api` absorbs storage/realtime in-process
    (items 8/9 above) and is the only backend `rg-production.conf` actually routes `/storage/v1/`
    and `/realtime/v1/` to. `:8811`/`supabase-internal.conf` stays marked superseded, unchanged;
    `rg/docs/self-host-supabase.md` carries a dated addendum pointing at this decision so the
    still-documented `SUPABASE_INTERNAL_URL=:8811` design isn't mistaken for the live default.

## 5. Sibling-repository code audit (hard-coded ports/hosts)

Parallel read-only+trivial-fix passes over `aphrody-ai`, `aphrody-ui`, `aphrody-web`, `aphrody-os`,
`nie`, `rg`, `shenron` on 2026-09-26, cross-checked against the catalog above. Summary (see the
commit trailers in each repo for any fix that landed):

- **aphrody-os**: zero hits against the catalog; no fix needed.
- **aphrody-ai**: every literal that duplicates a canonical `APHRODY_AI_*` value already resolves
  through that env var first; nothing trivial to fix. One drift found and fixed 2026-09-26:
  `crates/ai/rag-eval/src/main.rs` (not in repo)'s `DEFAULT_MCP_URL` defaulted to `https://aphrody.com/mcp`,
  a path/host with no live entry in `tools/config/host/nginx/routes.json` (its `aphrody-site` backend is
  retired). Made env-driven (`APHRODY_MCP_HTTP_URL`, checked before the local default) with the
  local default repointed at `http://127.0.0.1:8789/mcp` — `aphrody-mcp http`'s own `--bind`
  default and `/mcp` mount (`crates/ai/mcp/src/main.rs` (not in repo)), the one MCP HTTP origin this
  ecosystem actually runs locally by convention. `--url` (CLI) still wins over both.
- **aphrody-ui**: same pattern (env-first, literal only as fallback); nothing trivial to fix. One
  drift flagged for the owner: `m3/packages/app-ui/src/shenron-studio.tsx` (not in repo)'s "local model inference"
  field defaults to `127.0.0.1:8790`, which is actually `nie-model-serve`'s port, not a generic
  local-inference port, and (unlike the sibling `embedUrl` field) isn't persisted — needs a product
  decision on what it should really point at.
- **aphrody-web**: fixed and committed (`8bd5380`) two literal-duplicates-in-scope-value cases —
  `crates/aphrody-site/src/gateway.rs` (not in repo) now calls the existing `aphrody_api::a2a_url()` helper
  instead of repeating `"http://127.0.0.1:8788"`, and `apps/bxc/src/db/AphrodyRedis.ts` (not in repo) now imports
  the already-exported `DEFAULT_REDIS_URL` instead of repeating the Redis literal. Everything else
  (aphrody-site's own 8083/3007/8788 defaults, bxc's CDP debug ports, dev-server defaults) matches
  the catalog or is out of scope (local tooling).
- **nie**: nothing to fix — the prior 2026-09-25 report's two flagged issues are already resolved
  upstream: `nie net server`'s default no longer collides with `nie-site` (bumped to `127.0.0.1:8796`
  with an explicit comment), and the `ai.json` `127.0.0.1:8792` A2A literal is not dead, it is
  `nie`'s documented slot in the cross-repo A2A convention, bound externally by the `aphrody` CLI
  (`aphrody a2a serve --bind 127.0.0.1:8792`, `docs/A2A-CODEX.md` (not in repo)).
- **rg**: fixed and committed (`60fa573`) two literal-duplication cases (a `:8800` log literal next
  to the `PORT` constant already in scope in `apps/api/src/index.ts` (not in repo); a repeated
  `"http://127.0.0.1:8811"` fallback extracted to `FALLBACK_STORAGE_URL` in
  `iecode/apps/rg/website/next.config.ts`). Also answered the two open architecture questions this audit had
  left for the `rg` owner (§4 items 8/9, now resolved) and surfaced two new findings recorded above
  as §4 items 12 (the `rpbey.fr` contradiction) and 13 (the live `:8811` default), both since
  resolved (2026-09-26, see those items) — and
  independently confirmed the `rg-postgrest`/`:8809` retirement claim is accurate from `rg`'s own
  source (no live call site; the real PostgREST-successor type-generation script now targets
  `pg-meta` on `:8813`, not `:8809`).
- **shenron**: fixed and committed (`d00c8825`) one case (`shenron:apps/site/scripts/index-databooks-redis.ts`
  now reuses the shared `resolveRedisUrl()` instead of a literal). Flagged for the owner, not fixed
  (a different agent was already mid-edit on the same MCP-retirement cleanup, so these were
  reported rather than raced against): several executable, live dependencies on the retired
  `mcp.dragonballfr.com` / `127.0.0.1:5010` remain — `ai.json`'s own agent-card
  (`supported_interfaces`, `coord.http_bind`), the `dragon-ball` MCP plugin's client config
  (`plugins/dragon-ball/mcp_config.json` (not in repo), `.mcp.json`), and three ops scripts that actively probe or
  call the dead host (`shenron:scripts/audit/test-a2a-live.ts`, `shenron:scripts/ops/observability-snapshot.ts`,
  `shenron:scripts/monitor-shenron-engine.ts`).
