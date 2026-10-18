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

## Hosts

| App | Canonical hostname | Existing alias | Edge owner |
| --- | --- | --- |
| Video | https://app-video.aphrody.app | https://filmcraft.aphrody.app | aphrody-app |
| Generation | https://app-generation.aphrody.app | https://artcraft.aphrody.app | aphrody-app |
| Images | https://app-images.aphrody.app | https://photocraft.aphrody.app | aphrody-app |
| Vectors | https://app-vectors.aphrody.app | https://vectorcraft.aphrody.app | aphrody-app |
| Compositing | https://app-compositing.aphrody.app | https://effectcraft.aphrody.app | aphrody-app |
| Photo processing | https://app-photo-processing.aphrody.app | https://lightcraft.aphrody.app | aphrody-app |
| PDF | https://app-pdf.aphrody.app | https://pdfcraft.aphrody.app | aphrody-app |
| Documents | https://app-documents.aphrody.app | https://wordcraft.aphrody.app | aphrody-app |
| Audio | https://app-audio.aphrody.app | https://soundcraft.aphrody.app | aphrody-app |
| Layout | https://app-layout.aphrody.app | https://designcraft.aphrody.app | aphrody-app |
| CAD | https://app-cad.aphrody.app | https://cadcraft.aphrody.app | aphrody-app |
| Slides | https://app-slides.aphrody.app | https://deckcraft.aphrody.app | aphrody-app |
| Tables | https://app-tables.aphrody.app | https://gridcraft.aphrody.app | aphrody-app |
| Interface layouts | https://app-interface-layouts.aphrody.app | https://figcraft.aphrody.app | aphrody-app |
| APT | https://apt.aphrody.app | — | aphrody-app |
| Desktop | https://desktop.aphrody.app | — | aphrody-app |

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
