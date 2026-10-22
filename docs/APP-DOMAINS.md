# Application domains

The 14 library application identities come from the
`@aphrody/bun-workspace` capability catalog. Aphrody Infra owns the concrete
hostname and DNS intent in `tools/config/cloudflare/aphrody.app.json`; its
read-only domain audit checks those values against the capability catalog,
Bun OS distribution inventory and Bun Worker configuration. This page is the
consumer map for that contract. The canonical form is
`app-<capability>.aphrody.app`, with the forked library hostname as an alias.
APT and the Bun desktop keep product hostnames in the Bun OS distribution
inventory, which Infra also checks against its desired state. Bun owns Worker
runtime and routing configuration. The homepage, www redirect and assets/dist
R2 custom domains retain their existing owners.

## Canonical origin and paths

The canonical origin is https://aphrody.com. Product hosts are no longer
separate identities: each one answers a permanent 301 to a path of the apex,
preserving the sub-path and query string. The declarative source is
`infra/config/routes.catalog.json` (host to `{kind, path, keep}`, plus the
path to WebOS package map). The WebOS Worker (`apps/webos/worker/index.ts`)
derives `redirectFor` from it, the WebOS shell opens the package of a catalog
path, and the legacy `/?app=<package>` link redirects to the package path.
`bun.aphrody.com` now redirects straight to the apex (no hop through
aphrody.app).

Hosts that stay separate (`keep: true`): `git.aphrody.app`, `source.aphrody.app`, `deploy.aphrody.app`, `downloads.aphrody.com`, `cdn.aphrody.com`, `assets.aphrody.app`, `dist.aphrody.app`, `nie.aphrody.com`.

| Host | Kind | Redirects to |
| --- | --- | --- |
| app-video.aphrody.app | app | https://aphrody.com/film |
| filmcraft.aphrody.app | craft-alias | https://aphrody.com/film |
| app-generation.aphrody.app | app | https://aphrody.com/art |
| artcraft.aphrody.app | craft-alias | https://aphrody.com/art |
| app-images.aphrody.app | app | https://aphrody.com/photo |
| photocraft.aphrody.app | craft-alias | https://aphrody.com/photo |
| app-vectors.aphrody.app | app | https://aphrody.com/vector |
| vectorcraft.aphrody.app | craft-alias | https://aphrody.com/vector |
| app-compositing.aphrody.app | app | https://aphrody.com/effect |
| effectcraft.aphrody.app | craft-alias | https://aphrody.com/effect |
| app-photo-processing.aphrody.app | app | https://aphrody.com/light |
| lightcraft.aphrody.app | craft-alias | https://aphrody.com/light |
| app-pdf.aphrody.app | app | https://aphrody.com/pdf |
| pdfcraft.aphrody.app | craft-alias | https://aphrody.com/pdf |
| app-documents.aphrody.app | app | https://aphrody.com/word |
| wordcraft.aphrody.app | craft-alias | https://aphrody.com/word |
| app-audio.aphrody.app | app | https://aphrody.com/sound |
| soundcraft.aphrody.app | craft-alias | https://aphrody.com/sound |
| app-layout.aphrody.app | app | https://aphrody.com/design |
| designcraft.aphrody.app | craft-alias | https://aphrody.com/design |
| app-cad.aphrody.app | app | https://aphrody.com/cad |
| cadcraft.aphrody.app | craft-alias | https://aphrody.com/cad |
| app-slides.aphrody.app | app | https://aphrody.com/deck |
| deckcraft.aphrody.app | craft-alias | https://aphrody.com/deck |
| app-tables.aphrody.app | app | https://aphrody.com/grid |
| gridcraft.aphrody.app | craft-alias | https://aphrody.com/grid |
| app-interface-layouts.aphrody.app | app | https://aphrody.com/fig |
| figcraft.aphrody.app | craft-alias | https://aphrody.com/fig |
| craft.aphrody.app | craft | https://aphrody.com/art (sub-paths kept) |
| play.aphrody.app | product | https://aphrody.com/play |
| apt.aphrody.app | product | https://aphrody.com/apps |
| desktop.aphrody.app | product | https://aphrody.com/apps |
| os.aphrody.com | product | https://aphrody.com/os |
| creator.aphrody.com | product | https://aphrody.com/creator |
| bun.aphrody.com | product | https://aphrody.com/ |
| aphrody.app | legacy-apex | https://aphrody.com/ |
| www.aphrody.app | legacy-apex | https://aphrody.com/ |
| www.aphrody.com | www | https://aphrody.com/ (sub-paths kept) |

`play.aphrody.app/` still goes through `playRedirect` to `/workspace/games`
first. `os.aphrody.com` and `creator.aphrody.com` are served by their nginx
vhosts today and only follow the catalog once their vhosts redirect. The
sections below describe the pre-consolidation hostnames and the DNS, Worker
route and custom-domain ownership those redirects still rely on.

## Previous hosts

The 14 library applications keep `app-<capability>.aphrody.app` plus the library alias until Cloudflare routes are removed; both redirect as listed above.

## Routing and qualification

The existing application hostnames are attached to the configured edge.
Cloudflare owns its DNS record and certificate provisioning. Its managed,
proxied DNS record routes to the Worker; it is not a private backend address.
Domain changes use the configured Cloudflare MCP and preserve existing DNS or
Worker ownership when a hostname conflicts.

A valid DNS answer and HTTPS response qualify public edge routing. Both names
currently share the existing edge response. Application executables,
application behavior, native backends and independent deployment require their
own build and deployment receipts. A hostname response does not qualify those
application capabilities.

The 14 canonical `app-*` DNS records remain proxied; 14 Worker routes bind them
to `aphrody-app`. The library-name aliases use enabled `aphrody-app` Worker
custom domains. APT, desktop, the apex, and `www` also use enabled custom domains
with previews disabled. `video.aphrody.app` remains an R2 custom domain and is
not an application alias.

Live Cloudflare readback on 2026-10-13 found 50 DNS records, all 14 canonical
Worker routes, and 18 enabled Worker custom domains (14 library aliases plus
APT, desktop, the apex, and `www`). A native HTTPS HEAD check returned 200 for
the apex, all 14 canonical hosts, all 14 aliases, APT, and desktop; `www`
returned 301. This supersedes the earlier 12/14 HTTP 200 observation. These
responses qualify hostname routing only; they do not establish application
readiness, native artifact availability, behavior, or independent deployment.

The ignored out/app-domains/receipt.json records preflight DNS/domain ownership,
creation results, read-back checks, public DNS/HTTPS observations, and separate
certificate provisioning state. No Worker code upload is part of hostname
attachment. Shared assets and artifacts use their existing R2 custom domains;
application hosts do not duplicate asset objects.

API owner: [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Craft browser frontends

`https://craft.aphrody.app/<app>/` serves the static wasm32 builds of the Craft
web apps (`/cad/`, `/deck/`, `/design/`, `/fig/`, `/grid/`, `/light/`, `/pdf/`,
`/photo/`, `/sound/`, `/vector/`, `/word/`) behind a landing page at `/`. The
Cloudflare record is a proxied `A craft` to the VPS, the TLS certificate is a
Let's Encrypt ECDSA certificate issued like `play.aphrody.app`, and the vhost is
`infra/config/host/nginx/craft/craft.aphrody.app.conf`.
`scripts/aphrody/tools/infra/deploy-craft-frontends.ts` compiles on the VPS,
content-addresses the bundles, replaces `~/apps/craft-web/current` in place and
installs the vhost (`nginx -t` before reload). An app whose wasm build fails is
left out of the landing page and reported by the script.
