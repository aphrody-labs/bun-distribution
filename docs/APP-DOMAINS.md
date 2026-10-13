# Application domains

The application hostnames in infra/apps.json use the existing aphrody-app
Worker in the aphrody.app zone. This is the single public edge owner. The
main homepage, www redirect, and assets/dist R2 custom domains retain their
existing ownership.

## Hosts

| App | Public hostname | Edge owner |
| --- | --- | --- |
| Filmcraft | https://filmcraft.aphrody.app | aphrody-app |
| Artcraft | https://artcraft.aphrody.app | aphrody-app |
| Photocraft | https://photocraft.aphrody.app | aphrody-app |
| Vectorcraft | https://vectorcraft.aphrody.app | aphrody-app |
| Effectcraft | https://effectcraft.aphrody.app | aphrody-app |
| Lightcraft | https://lightcraft.aphrody.app | aphrody-app |
| PDFcraft | https://pdfcraft.aphrody.app | aphrody-app |
| Wordcraft | https://wordcraft.aphrody.app | aphrody-app |
| Soundcraft | https://soundcraft.aphrody.app | aphrody-app |
| Designcraft | https://designcraft.aphrody.app | aphrody-app |
| CADcraft | https://cadcraft.aphrody.app | aphrody-app |
| Deckcraft | https://deckcraft.aphrody.app | aphrody-app |
| Gridcraft | https://gridcraft.aphrody.app | aphrody-app |
| Figcraft | https://figcraft.aphrody.app | aphrody-app |
| APT | https://apt.aphrody.app | aphrody-app |
| Desktop | https://desktop.aphrody.app | aphrody-app |

## Routing and qualification

Each hostname is an enabled Workers Custom Domain with preview routing disabled.
Cloudflare owns its DNS record and certificate provisioning. Its managed,
proxied DNS record routes to the Worker; it is not a private backend address.
Domain changes use the configured Cloudflare MCP and preserve existing DNS or
Worker ownership when a hostname conflicts.

A valid DNS answer and HTTPS response qualify public edge routing. The current
edge response remains the existing public site. Application executables,
application behavior, native backends and independent deployment require their
own build and deployment receipts. A hostname response does not qualify those
application capabilities.

The ignored out/app-domains/receipt.json records preflight DNS/domain ownership,
creation results, read-back checks, public DNS/HTTPS observations, and separate
certificate provisioning state. No Worker code upload is part of hostname
attachment. Shared assets and artifacts use their existing R2 custom domains;
application hosts do not duplicate asset objects.

API owner: [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
