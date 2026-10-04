<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody Web OS portal

This directory is the public portal served by `aphrody-site` at `/`. It belongs
to Aphrody OS. It calls only the site's authenticated Web and canvas API routes;
it does not load or present Aphrody AI, RAG, agents, or Niers assets.

The portal currently sends:

- `POST /api/v1/web/scrape` with a validated HTTP(S) URL and the selected
  `static` or `render` profile.
- `POST /api/v1/web/crawl` with a 10-page, depth-one limit, then
  `GET /api/v1/web/crawl/stats` for the returned job.
- `GET /api/v1/web/index/search` with a keyword query.
- `POST /api/v1/canvas/render` with a bounded M3 scene, displaying the returned PNG.

These calls need the site's Bearer token. The user enters it into the page;
`src/portal-api.ts` holds it in memory only. It is cleared on page exit or by
the Clear button. No browser storage, URL parameter, cookie, or external origin
receives it. The public M3 CDN CSS files and OpenAPI contract are linked from the
page. Availability of a backend or an indexed corpus depends on deployment.

From the repository root, rebuild both files embedded by Rust after any source
change:

```powershell
bun build crates/aphrody-site/web/src/app.ts --target browser --minify --outfile crates/aphrody-site/web/dist/app.js
bun build crates/aphrody-site/web/src/styles.css --target browser --minify --outfile crates/aphrody-site/web/dist/styles.css
bun test crates/aphrody-site/web/test
tsc --noEmit -p crates/aphrody-site/web/tsconfig.json
```
