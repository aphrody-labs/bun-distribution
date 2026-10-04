<!-- SPDX-License-Identifier: Apache-2.0 -->
# URL, slug and SEO conventions — the public Aphrody web surfaces

Scope: every public-facing website across `%USERPROFILE%\src` — `aphrody-web`
(`docs/products/web/crates/aphrody-site`), `nie` (`apps/nie-web` (not in repo) + `crates/tools/nie-site` (not in repo)), `rg`
(`iecode/apps/rg/website`) and `shenron` (`apps/shenron/site`). This is the single reference for
how a URL is shaped, how a page announces itself to crawlers, and how an old
URL is retired without breaking. It does not cover deployment (owned by
`aphrody-infra`) or content editorial policy (owned by each site).

## 0. Where each site actually stands (2026-09-26)

Read live status from `yolo/config/host/nginx/routes.json` and
`config/service-catalog.json` before assuming a host is reachable — do not
hard-code it here, it drifts. As of this audit:

| Site | Host(s) | Status |
| --- | --- | --- |
| `rg` `iecode/apps/rg/website` | `rosegriffon.fr`, `api.`, `cdn.`, `achillea.`, `ranked.`, `azalee.` | live |
| `shenron` `apps/shenron/site` | `dragonballfr.com`, `bot.`, `cdn.` | live |
| `aphrody-web` `docs/products/web/crates/aphrody-site` | `aphrody.com` | **retired** 2026-09-25 |
| `nie` `crates/tools/nie-site` (not in repo) | `nie.aphrody.com` | **retired** 2026-09-25, except the `staticPaths` below |
| `shenron-mcp` | `mcp.dragonballfr.com` | **retired** 2026-09-25, superseded by `aphrody-mcp` `dragonball.*` (no public HTTP replacement) |

`nie.aphrody.com`'s route is retired but `nginx-routes.json` still enumerates
`staticPaths: ["/downloads/inacord/latest.json", "/downloads/channels/stable/latest.json", "/downloads/files/"]`.
**Never remove `/downloads/inacord/latest.json`** (`nie` `crates/tools/nie-site/src/routes/downloads.rs` (not in repo),
mounted at `crates/tools/nie-site/src/app.rs:153` (not in repo)): the standalone Inacord
Tauri app (`nie/apps/inacord`) was deleted 2026-09-26, but its already-installed
Windows clients still poll this endpoint through their embedded Tauri updater
config, indefinitely. The endpoint is not dead code.

Because `aphrody-site` and `nie-site`'s public routes are retired, they are
**not** the reference implementation below — `rg` and `shenron` are. Do not
invest further SEO work on the retired hosts beyond not breaking what a
lingering client or crawler still hits; do not build new sitemap/OG/hreflang
surfaces for them. If either is ever revived as a public host, follow this
document from a clean slate and read the domain from env/config, never as a
literal (see §6 — `aphrody-site` currently hard-codes `https://aphrody.com` in
~10 files; that must be fixed before any relaunch, not after).

## 1. URL and slug shape

- **kebab-case, lowercase, ASCII.** Every site already converges on this
  independently: rg (`/a-propos`, `/charte-engagements`), shenron
  (`wiki-slugs.ts`: "kebab-case, minuscules, sans accents"), nie-web/nie-site
  (game-screen stems are `snake_case` because they mirror the game's own
  asset names — kept, but new non-game routes must be kebab-case).
- **No trailing slash.** Next.js default (no `trailingSlash` config) on rg and
  shenron; nie-site strips a trailing slash with a 308 redirect
  (`crates/tools/nie-site/src/routes/pages.rs` (not in repo) `navigation_redirect`). Do not
  configure `trailingSlash: true` anywhere in this ecosystem.
- **Locale prefix policy is per-site, not global — do not unify it blindly:**
  - `rg` and `shenron`: **no locale in the URL.** Language is a runtime
    preference (cookie/`Accept-Language`), same URL for every language
    (`rg` `iecode/packages/rg/i18n/src/resolution.ts`, `shenron` `src/i18n/request.ts`).
    This means neither site can emit `hreflang` today (see §4) — that is a
    known, accepted gap given single-URL content, not a bug to silently patch
    with fake alternates.
  - `nie-site`/`nie-web`: **locale IS in the URL** (`/en`, `/es`, `/ja`
    prefixes, French unprefixed at root — `crates/tools/nie-site/src/i18n.rs` (not in repo),
    mirrored client-side in `apps/nie-web/src/routing.ts` (not in repo)). This is the
    correct pattern for genuinely translated content; keep it there, do not
    collapse it to match rg/shenron.
  - A new site in this ecosystem: if content is actually translated
    per-locale, prefix the URL (`nie` pattern) and emit `hreflang`. If
    language is only a UI preference over identical content, do not prefix
    (`rg`/`shenron` pattern) and do not fake `hreflang`.
- **One canonical origin per site**, read from env with a single fallback
  constant — never scattered literals. Pattern (see `rg`
  `iecode/apps/rg/website/src/lib/site-url.ts`, added by this change):
  ```ts
  export const SITE_URL = (process.env.NEXT_PUBLIC_BASE_URL || "https://<apex>").replace("://www.", "://");
  export function absoluteUrl(path: string) { return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`; }
  ```
  `shenron` already has the Bun/TS equivalent at `apps/shenron/site/src/lib/config.ts`
  (`SITE_URL`, backed by `packages/shenron/config/src/public-urls.ts`) — reuse it, do
  not add a second one. `nie-site`'s Rust equivalent is `Config.origine`
  (`crates/tools/nie-site/src/config.rs` (not in repo), CLI `--origin` / env
  `NIE_SITE_ORIGIN`), read by every template instead of a literal.
  **No cross-repo shared npm/crate package was created for this**: `rg` is a
  Bun/Next monorepo with its own `@rosegriffon/*` namespace, `shenron` its own
  `@shenron/*`, and `nie-site`/`aphrody-site` are separate Rust crates with no
  existing shared web-SEO crate in `docs/ecosystem/ECOSYSTEM.md`.
  Inventing one cross-repo package for two independent product stacks (one
  Bun, one Rust; different domains, different registries) would be new
  infrastructure, not reuse — out of scope here. The convention above is the
  shared contract; the code is one small file per repo, in that repo's own
  idiomatic location.
- **Old slugs redirect, they don't 404.** `rg` `next.config.ts` `redirects()`
  and `shenron` `next.config.ts` `redirects()` / `src/proxy.ts` both carry
  large permanent-redirect tables from every renamed/merged route. Any slug
  rename in this ecosystem MUST add a redirect entry in the same commit, not
  a follow-up. `nie-site` does the same at the HTTP layer
  (`crates/tools/nie-site/src/routes/pages.rs` (not in repo) `navigation_redirect`, 308) and
  additionally exposes legacy aliases through `canonical` metadata for names
  that don't need an HTTP redirect (`route_canonique`).

## 2. Canonical tags

- One canonical per page, absolute, same-origin as the response. Never point
  a page's canonical at a *different* subdomain unless that subdomain is
  genuinely where the content now lives.
  - **Fixed by this change**: `rg` `apps/website/src/app/news/[slug]/page.tsx`
    built its canonical as `https://azalee.rosegriffon.fr/news/${slug}` even
    though the route is served at `rosegriffon.fr/news/<slug>` — Azalée's
    news app was merged into `iecode/apps/rg/website` and `azalee.rosegriffon.fr` no
    longer serves `/news` at all. That canonical told Google the real page
    was a duplicate of a page that can't be reached. Now uses `absoluteUrl()`.
- Do **not** set a blanket `canonical` on a root layout that every child page
  inherits (rg's `app/layout.tsx` and shenron's per-page pattern both avoid
  this deliberately, with a comment explaining the regression it once
  caused: every child page's `alternates.canonical` collapsed to the home
  page). Each publicly-indexable page sets its own.

## 3. Sitemaps, robots.txt, Open Graph / Twitter, JSON-LD, `llms.txt`

- `sitemap.xml` and `robots.txt` are **generated**, not static files, on
  every live site (`app/sitemap.ts` + `app/robots.ts` in rg/shenron, Askama
  templates behind `/sitemap.xml`/`/robots.txt` routes in nie-site). Coverage
  must track real public routes — several past regressions on rg/shenron
  were exactly "a page went public but nobody added it to the sitemap" or
  the reverse; keep sitemap generation driven by the same access/gating
  function the pages themselves use (`isPathPublic` in both rg and shenron),
  not a hand-maintained list that drifts.
- Every publicly indexable page sets Open Graph + Twitter Card metadata; use
  the site's existing helper rather than inlining tags (`rg`
  `src/components/shared/StructuredData.tsx` + per-domain helpers like
  `app/achillea/metadonnees.ts`; `shenron` `src/lib/og.ts` `ogMeta()` +
  `src/components/JsonLd.tsx`/`SiteJsonLd.tsx`; `nie-site`
  `donnees_structurees()` in `crates/tools/nie-site/src/routes/pages.rs` (not in repo)).
- JSON-LD: at minimum `Organization` + `WebSite` (with `SearchAction` if the
  site has search) site-wide, plus per-entity schema on content pages
  (`Article`, `BreadcrumbList`, `Person`, etc.). All four sites already do
  this for their live surfaces except `aphrody-site`, which has none (see
  §0 — not a priority while retired).
- `llms.txt` (llmstxt.org convention) is adopted by `shenron`
  (`app/llms.txt/route.ts`) and `nie-site` (`templates/llms.txt` /
  `llms-full.txt`); `rg` does not have one yet. Not required by this task,
  but if `rg` adds one, generate it the same way shenron does — derived from
  the live route/access registry, never a hand-written list of URLs that can
  go stale. Shenron's own doc comment on that file records exactly this
  failure mode: a *static* `public/llms.txt` committed 2026-09-12 went stale
  within the same day advertising a dead subdomain and vanished paths; the
  dynamic route replaces it for that reason. Any `llms.txt`, admin API docs
  page, or public API response that lists a "live" endpoint must be verified
  against `yolo/config/host/nginx/routes.json` — see §5.

## 4. hreflang

Only emit `hreflang` when content is actually served at a different URL per
locale (`nie-site`/`nie-web`, which do this correctly with a reciprocal
alternates test — `crates/tools/nie-site/src/i18n.rs` (not in repo)
`les_alternatives_sont_reciproques_et_completes`). `rg` and `shenron` have no
locale-prefixed URLs and therefore correctly have no `hreflang` — do not add
`alternates.languages` pointing multiple locale claims at one identical URL,
that is worse than omitting it.

## 5. Links to retired things

Before shipping a page that names a specific host or a specific product,
check `yolo/config/host/nginx/routes.json` and `service-catalog.json` for
`"status": "retired"`. Found and fixed by this audit:

- `shenron` `apps/shenron/site` advertised `https://mcp.dragonballfr.com/mcp` as a
  live, public MCP endpoint in four places that a real client or crawler
  could hit: the public JSON response of `GET /api/manga`
  (`src/app/api/manga/route.ts`), the dynamic `GET /llms.txt`
  (`src/app/llms.txt/route.ts`), the admin API-docs page
  (`src/app/admin/api-docs/page.tsx`), the admin A2A dashboard
  (`src/app/admin/a2a/A2AViewer.tsx`), and the offline knowledge-base export
  script (`apps/shenron/site/scripts/exporte-base-connaissance.ts`, which actively `fetch()`ed
  the dead host). `mcp.dragonballfr.com` was retired 2026-09-25 (`shenron-mcp`
  superseded by `aphrody-mcp` `dragonball.*`, which has no public HTTP
  equivalent — see `service-catalog.json` `"supersededBy"`). All five now
  either drop the entry or say plainly that it was retired; none invents a
  replacement URL that doesn't exist.
- The Inacord Tauri app (`nie/apps/inacord`) and the Spacedrive-derived Drive
  Tauri host (`aphrody-ui/drive/apps/tauri`) were both deleted 2026-09-26.
  Audited `aphrody-web`, `nie`, `rg` and `shenron` for dangling links: `rg`
  and `shenron` have zero references to either. `nie` still mentions
  "Inacord" extensively (`apps/nie-web/src/inacord/*`,
  `crates/tools/nie-site/src/routes/pages.rs` (not in repo) `/inacord` route) — this is
  **not** a dangling reference to a retired thing, it's the still-live
  in-browser Inacord workspace ("merged into this site on 2026-09-12: the
  former `inacord.aphrody.com` workspace now lives here"); only the
  standalone desktop packaging was retired. `crates/tools/nie-site/src/routes/downloads.rs` (not in repo)'s
  doc comment referenced the now-deleted `apps/inacord/src-tauri/tauri.conf.json` (not in repo)
  as if it still existed in-tree; updated to explain the endpoint outlives the
  deleted source tree for already-installed clients (see §0).
- No references to "drive"/a Tauri drive host were found in any of the four
  audited repos (the only "drive" hits are Google Drive integrations,
  UI icon names, or unrelated words like "Overdrive").

## 6. Domain literals

Prefer one `SITE_URL`/`origine` constant read from env (§1) over scattering
the literal domain. Known remaining drift, left as-is by this change because
fixing it has no live SEO impact and is disproportionate to this task:

- `rg` `iecode/apps/rg/website`: `https://rosegriffon.fr` is hard-coded in ~78 files
  beyond the sitemap/robots layer, including `StructuredData.tsx` and
  `achillea/metadonnees.ts`. These already resolve to the *correct* value
  (unlike the `news/[slug]` bug this change fixed) — centralizing them is a
  larger, separate refactor of a large production site, not a defect.
- `shenron` `apps/shenron/site`: `https://dragonballfr.com` is hard-coded in ~25
  places outside `lib/config.ts`'s "single source of truth" — same judgment:
  correct value today, worth centralizing in a dedicated pass, not urgent.
- `aphrody-site` (retired): `https://aphrody.com` is a literal in ~10 files
  with no single constant at all. Must be fixed to a single env-driven
  constant *before* any future relaunch (§0); not worth refactoring while the
  host is retired and unreachable.

## 7. 404s

Every live site has a branded custom 404 (`rg` `app/not-found.tsx` +
`app/achillea/not-found.tsx`; `shenron` `app/not-found.tsx`; `nie-site`
returns a real `404` status with `noindex` from the SSR shell rather than a
silent `200`, `crates/tools/nie-site/src/routes/pages.rs` (not in repo)). Keep this: a
custom 404 that still returns HTTP 200 is worse than none, it tells crawlers
the broken page is real content.
