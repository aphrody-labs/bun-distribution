# Rose Griffon — historical free-tier load allocation

This is an operational snapshot dated 2026-10-17. Its source paths describe
the Rose Griffon layout at that time; application source is now owned by the
separate `aphrody-labs/rosegriffon` repository. Do not use these old paths as
current build or deployment instructions.

Rose Griffon runs on four platforms: Vercel (Hobby), Supabase (Free), Neon (Free) and the VPS behind
Cloudflare. The rule is simple: **everything stateful, long-lived or heavy runs on the VPS; the three
managed platforms only serve what fits their free allotment with caching in front of it.** The previous
Vercel team was blocked for exceeding fair use, so every guardrail below is enforced in code or
configuration, not by convention.

Quotas were read from the official documentation on 2026-10-17 (links in each section). Re-check them
before raising a ceiling: the platforms change their free plans without notice.

## Allocation at a glance

| Platform | Runs there | Hard free quota (per month) | Estimated use | Main guardrail |
| --- | --- | --- | --- | --- |
| Vercel Hobby, project `rg-website` | Next.js site: ISR pages, dynamic pages (filtered lists, news, profile, auth), public GET routes, image optimizer for uploads | 1 M invocations, 4 h Active CPU, 360 GB-h provisioned memory, 1 M CDN requests, 100 GB Fast Data Transfer, 10 GB Fast Origin Transfer, 1 M ISR reads, 200 k ISR writes, 5 k image transformations | 60–120 k invocations, < 1.5 h CPU, < 40 GB-h, 0.5–2 M CDN requests (see risks), ≈ 1–2 k transformations | ISR + CDN caching, narrow proxy matcher, `fra1`, image bypass for game assets |
| Vercel Hobby, project `rg-api` | Unified Elysia API (one Bun function): wiki/inagle/content/community/achillea reads, auth, billing | same team allotment as above (shared) | 20–40 k invocations once the CDN absorbs the reads | `CDN-Cache-Control` on public GETs, `fra1`, 60 s ceiling |
| Supabase Free, project `rg` | Postgres (accounts, content, Achilléa, Discord mirror), Auth tables, Storage (uploads), Realtime Broadcast, pg_cron trigger | 500 MB database, 1 GB Storage, 5 GB uncached + 5 GB cached egress, 2 M Realtime messages, 200 peak Realtime connections, 50 k MAU | ≈ 95 MB database after the `inagle_*` move, < 2 GB egress, Realtime below 0.5 M messages if the Discord mirror stays quiet | server-side SQL with named columns, Broadcast-only Realtime, Vercel image cache in front of Storage |
| Neon Free, project `inagle` | Read-only game mirror `inagle_*` (wiki data, 263 MB) | 100 CU-h compute, 1 GB storage per project, 5 GB egress, scale to zero after 5 min (cannot be disabled), 2 CU max | 15–40 CU-h if the wiki stays cached; storage ≈ 0.36 GB (main branch, 2026-10-17) | scale to zero, 0.25–1 CU, ISR + in-memory list cache so the compute wakes rarely |
| VPS (12 cores, 45 GB RAM, 203 GB disk, Cloudflare in front) | `rg-core`: Discord gateway bot, Colyseus ranked (WebSockets), `nie-model-serve` with the 58 GB IEVR install, every periodic task, `cdn.rosegriffon.fr` media origin | no metered quota (fixed cost) | — | carries all heavy and long-lived work so the managed platforms never do |

## Vercel (Hobby)

Official limits: [Hobby plan](https://vercel.com/docs/plans/hobby),
[fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines),
[pricing (ISR allotments)](https://vercel.com/pricing),
[function limits](https://vercel.com/docs/functions/limitations),
[image optimization limits](https://vercel.com/docs/image-optimization/limits-and-pricing).

Included per month on Hobby: 1,000,000 function invocations, 4 CPU-hours of Active CPU, 360 GB-hours of
provisioned memory, 1,000,000 CDN requests, 100 GB Fast Data Transfer, 10 GB Fast Origin Transfer,
1,000,000 ISR reads and 200,000 ISR writes (8 KB units), 5,000 image transformations, 300,000 image cache
reads, 100,000 image cache writes. One function region, 300 s maximum duration, 100 deployments a day.
When an allotment is exhausted the feature stops until 30 days have passed; there is no paid overflow.

**Commercial use is not allowed on Hobby.** The fair use page counts "any method of requesting or
processing payment from visitors" and "advertising the sale of a product or service" as commercial;
donations are explicitly allowed. See the risks section.

### What runs there

- `rg-website`: the Next.js site. Public, non-personalised pages are ISR; pages that read the session,
  `searchParams` or must be live stay dynamic.
- `rg-api`: the unified API as one Bun function (`apps/rg-bot/src/scripts/build-vercel.ts`).
- Nothing scheduled: no Vercel cron. pg_cron in Supabase calls `https://api.rosegriffon.fr/v1/cron/<task>`;
  that host must resolve to `rg-core` on the VPS, not to the Vercel deployment.

### Estimate (reference month: 50,000 page views)

- Dynamic renders: filtered wiki lists, news, community, search, profile and auth ≈ 30–40 % of views,
  plus client prefetches of dynamic links ≈ 30–60 k invocations. ISR regenerations are bounded by the
  intervals: home ≤ 8.6 k (300 s), wiki index ≤ 2.9 k (900 s), ~20 list routes ≤ 14.4 k (3600 s), detail
  pages ≈ one per visited id per hour. Total 60–120 k invocations, far under 1 M.
- Active CPU: ≈ 40–80 ms per dynamic render → 1–2.5 k CPU-seconds, under 1 h of the 4 h.
- Provisioned memory: 2 GB × wall time; with `fra1` next to the databases, renders stay under 0.5 s and
  Fluid shares instances → < 40 GB-h of 360.
- CDN requests: every page view is one document plus the JS/CSS chunks, prefetches and images. With
  `/_next/static` served by Vercel this is 20–40 requests per view (1–2 M a month), which is **above
  the 1 M allotment**; serving the chunks from `cdn.rosegriffon.fr` (`NEXT_PUBLIC_CDN_URL`) brings it to
  5–10 per view.
- Image transformations: only first-party uploads are optimized, each variant is cached 31 days, one
  output format → ≈ number of distinct uploads × widths used, 1–2 k a month.

### Guardrails in place

| Guardrail | Where |
| --- | --- |
| Single region `fra1` (Supabase and Neon are in `eu-central-1`) for both projects; also set as the project default function region | `apps/rg-website/vercel.ts`, `apps/rg-bot/vercel.ts`, `apps/rg-bot/src/scripts/build-vercel.ts` (`.vc-config.json` `regions`) |
| Default max duration (300 s) for the site; 60 s for the API function; no cron on Vercel | `vercel.ts` files, `build-vercel.ts` |
| Proxy (Routing Middleware) only on `/dashboard`, `/admin`, `/profil/settings`: it used to run on every page and doubled invocations before the CDN | `apps/rg-website/src/proxy.ts` |
| Public pages are ISR: `force-static` + `revalidate`. The root layout reads `cookies()`/`headers()` for the locale, which made every page dynamic even with `revalidate`; `force-static` is required | home (300 s), `/wiki` (900 s), `/achillea` (300 s), about/support/projects pages, `notre-equipe` (3600 s, revalidated by staff actions), wiki lists without filters and wiki detail pages (3600 s), `/sondages/[pollId]`, `/news/tweet/[id]` (1 day), `sitemap.xml` (3600 s) |
| On-demand revalidation of the whole wiki after a mirror republication (`revalidatePath("/wiki", "layout")`; the previous paths matched no route) | `apps/rg-website/src/app/api/ops/revalidate/wiki/route.ts` |
| `s-maxage` + `stale-while-revalidate` on public GET routes of the site | `apps/rg-website/src/lib/cache-public.ts`, used by `/api/public/*`, `/api/galerie`, `/api/recherche`, `/api/discord/messages` (15 s) |
| `CDN-Cache-Control` on public GET reads of the API (`/v1/wiki`, `/v1/inagle`, `/v1/community` 1 h; `/v1/content` 5 min; Achilléa standings 1–5 min); skipped for `Authorization`, errors and handlers that set their own header | `apps/rg-bot/src/api/plugins/public-cache.ts` |
| Image optimizer only for first-party uploads (static imports, `public/`, Supabase Storage); game assets of `cdn.rosegriffon.fr`, Discord, Twitch, X and the official encyclopedia are served unoptimized. `next/image` is aliased to the guard | `apps/rg-website/src/lib/image-cdn.tsx`, `next.config.ts` (`webpack` alias, `formats: ["image/webp"]`, `minimumCacheTTL` 31 days) |
| `/_next/static/*` immutable for one year | `next.config.ts` `headers()` |

### Still dynamic on purpose

Filtered wiki lists (`/wiki/chara?element=…`), news list and articles (session for comments/admin),
tag pages, community (tabs in `searchParams`), search, profile, settings, auth, admin, shop/checkout,
Achilléa user areas, `/a-propos/rejoindre-rg` (staff list read behind the admin guard), `/wiki/avatar`
(`?code=`), `/wiki/sons` and `/wiki/videos` (live CPK listings exceed the 60 s prerender limit),
`/wiki/modeles`, `/wiki/textures`, `/wiki/mode`. The
filtered wiki lists keep a 10-minute in-memory cache per filter combination in each Fluid instance
(`apps/rg-website/src/lib/wiki-service.ts`) so they do not wake Neon on every visit.

## Supabase (Free)

Official limits: [billing and quotas](https://supabase.com/docs/guides/platform/billing-on-supabase),
[egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

Included: 500 MB database per project, 1 GB Storage, 5 GB uncached egress and 5 GB cached egress,
50,000 MAU, 2,000,000 Realtime messages, 200 peak Realtime connections, 500,000 Edge Function
invocations; Storage image transformations are unavailable on Free. Two free projects per owner. Over a
quota the project enters a grace period, then restrictions apply until the next cycle.

### What runs there

- Postgres: accounts and Better Auth tables, articles and settings, Achilléa, the Discord metadata mirror,
  cron execution history. 359 MB today, of which 263 MB are `inagle_*` tables moving to Neon → ≈ 95 MB.
- Storage: uploads (news images, team photos, avatars) written once with unique names and
  `Cache-Control: immutable`.
- Realtime: **Broadcast only**. The `supabase_realtime` publication contains no table and no
  `postgres_changes` subscription exists; the trigger `public.rg_realtime_notify()` sends sanitised rows
  of `comments`, `settings`, `profiles`, `discord_channels`, `discord_messages`, `discord_polls` and
  `discord_poll_options` to public topics `rg:<table>` (`apps/rg-website/src/lib/realtime.ts`).
- pg_cron: 16 jobs (≈ 24 HTTP calls an hour, ≈ 17.5 k a month) calling `rg_cron.appeler()`.

### Estimate

- Database: ≈ 95 MB of 500 MB after the move; the Discord mirror is the only growing set.
- Egress: the site reads Postgres server-side through the pooler with named columns; the browser only
  uses Realtime and Storage uploads. Storage downloads go through the Vercel image cache (31 days), so
  each upload leaves Supabase a handful of times a month. Estimate < 2 GB of 5 GB uncached.
- Realtime messages: one message per broadcast per connected subscriber. `discord_messages` fans out
  every mirrored Discord message; with 20 open tabs and 2,000 mirrored messages a day that is 1.2 M a
  month. Keep the mirror to the republished channels only.
- Realtime connections: every open tab of a page that subscribes (home settings listener, comments,
  community) holds one connection; 200 concurrent tabs is the ceiling.

### Guardrails in place

- No PostgREST from the browser for data reads; server-side SQL selects named columns.
- Broadcast-only Realtime (no `postgres_changes`, no table in the publication).
- Vercel image cache in front of Storage, with uploads immutable.
- `pg_stat_statements` is enabled (schema `extensions`); see "What to watch".

Observed on 2026-10-17 (`pg_stat_statements` since 2026-10-09): the heaviest statements are the one-off
`COPY` of the `inagle_*` restore; at runtime `select * from inagle_skills …` (1,520 calls, wide JSONB rows,
moving to Neon), the Discord member upsert (5,029 calls) and PostgREST schema-cache reloads (≈ 200,
one per restart or DDL). No browser-originated query shows up in the top list.

## Neon (Free)

Official limits: [plans](https://neon.com/docs/introduction/plans),
[scale to zero](https://neon.com/docs/introduction/scale-to-zero).

Included: 100 CU-hours per project per month, 1 GB storage per project (20 GB across Free projects),
5 GB egress per project, autoscaling up to 2 CU, 10 branches, 6 h restore window. Computes suspend after
5 minutes idle and this cannot be disabled on Free. When the CU-hours run out the compute is suspended
until the next period; data is kept.

### What runs there

The `inagle` project (`weathered-wildflower-90536406`, `aws-eu-central-1`, Postgres 18) holds the
read-only game mirror read by the wiki (`INAGLE_DATABASE_URL`).

### Estimate

A compute awake at 0.25 CU all month would burn 182 CU-h, nearly twice the allotment: the wiki must not
keep it awake. Each wake costs at least 5 minutes at 0.25 CU (≈ 0.02 CU-h), so 100 CU-h allow about
4,800 wakes a month at minimum size. ISR pages regenerate at most hourly and only when visited, the
filtered lists hit the in-memory cache first, and the API's wiki reads are CDN-cached for an hour. Target:
15–40 CU-h a month.

### Guardrails in place

- Both endpoints (`ep-dawn-paper-b98eb93j` on the default branch, `ep-royal-river-b9nnuvzx`) already use
  autoscaling 0.25–1 CU and the default 5-minute suspend (`suspend_timeout_seconds: 0` = default). The
  CU-hour allotment is per project, so an idle second branch costs nothing but an active one competes.
- Wiki pages ISR (1 h) with on-demand revalidation after republication; API wiki reads CDN-cached 1 h;
  filtered lists cached 10 min in memory.

## VPS

The VPS (12 cores, 45 GB RAM, 203 GB disk, behind Cloudflare) has a fixed cost and no metered quota, so it
carries everything the managed platforms must not do:

- `rg-core`: the Discord gateway bot, Colyseus ranked matchmaking (long-lived WebSockets), every periodic
  task (the pg_cron jobs above must target it), and heavy media.
- `nie-model-serve` with the 58 GB IEVR install: decodes game textures, models and media live from the
  CPK archives, served as `cdn.rosegriffon.fr` through Cloudflare. All wiki images point there and are
  never optimized by Vercel.
- The natural home of `/_next/static` once the media origin publishes each build (`NEXT_PUBLIC_CDN_URL`).

## What to watch and where

| Signal | Where | Threshold to act |
| --- | --- | --- |
| Vercel usage per resource (invocations, Active CPU, provisioned memory, CDN requests, data transfer, ISR, images) | Dashboard → team `aphrody-dev` → Usage; Vercel MCP `get_runtime_errors` / `get_runtime_logs` for the culprit route | any resource above 60 % before the 20th of the month |
| Cache hit rate and misses per route | `vercel logs` (cache status and reason), `curl -sSI <url> \| grep -i x-vercel-cache` | a public page or API read that shows `MISS`/`BYPASS` repeatedly |
| Image transformations | Dashboard → Usage → Image Optimization | more than 1,500 by mid-month: look for a new remote host reaching the optimizer |
| Function regions | Deployment → Functions tab shows `fra1` | any other region |
| Supabase database size, egress, Realtime messages and peak connections | Dashboard → project `rg` → Usage; MCP `get_advisors` (performance and security) | database > 350 MB, egress > 3 GB, messages > 1.2 M, peak > 150 |
| Heavy Supabase queries | MCP `execute_sql`: `select query, calls, rows from extensions.pg_stat_statements order by rows desc limit 20` | a runtime query returning thousands of rows per call |
| PostgREST schema reloads | same view, `pg_timezone_names` calls | grows daily without deployments |
| pg_cron target and failures | MCP `execute_sql` on `cron.job` / `cron.job_run_details`; `rg_cron.appeler` URL | jobs pointing at a host served by Vercel |
| Neon compute hours and storage | Console → project `inagle` → Monitoring; MCP `describe_project` (`compute_time_seconds`, `active_time_seconds`) | > 50 CU-h by mid-month |
| Neon endpoints never suspending | MCP `list_postgres_endpoints` (`current_state`, `suspended_at`) | `active` for hours with no traffic: find the poller |
| Neon heavy queries | MCP `inspect_database` checks `outliers` and `calls` (needs `pg_stat_statements`) | a wiki query run thousands of times a day |

## Risks

- **Commercial use on Hobby.** The site embeds a shop with Stripe checkout (`/shop`, `/api/checkout`,
  `/api/webhook/stripe`), Patreon tiers and discounts, and preconnects to Google AdSense. Vercel's fair use
  guidelines classify payment processing, product sales and advertising as commercial; donations alone
  are not. Moving the shop, Patreon checkout and ads to the VPS, or the site to a Pro plan, removes the
  conflict. Not changed here.
- **CDN requests.** Without `NEXT_PUBLIC_CDN_URL`, every JS/CSS chunk is a Vercel CDN request; at
  50 k page views a month this approaches or exceeds the 1 M allotment.
- **pg_cron through Vercel.** `rg_cron.appeler()` posts to `https://api.rosegriffon.fr/v1/cron/*`; while that
  host resolves to the Vercel `rg-api`, ≈ 17.5 k task runs a month (Discord sync, publishing, warm-up)
  execute as Vercel invocations.
- **Realtime fan-out.** `discord_messages` broadcasts every mirrored message to every open tab; a busy
  channel can approach the 2 M message allotment, and popular pages count toward the 200 connections.
- **Dynamic prefetches.** `<Link>` prefetches of dynamic routes are invocations; long link lists toward
  filtered wiki pages multiply them.
- **ISR cold paths.** Crawlers walking every wiki id regenerate each detail page once an hour at most; the
  catalog size (≈ 6 k characters, skills, items) bounds it, but a crawler storm shows up as ISR writes.
